// New plan wizard — the demo's 3 questionnaire steps (plan §1 step 4):
// 1 Personal Details, 2 Body Composition (pre-filled from InBody), 3 Medical.
// Generates via /v3/generate and saves the structured plan model.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { Field, Alert, Loading, Spinner } from '../components/ui'
import {
  fetchLookups, activityDisplayName, sortActivities, activityMultiplier,
  dietaryDisplayName, EXCLUDED_CONDITIONS, EXCLUDED_ALLERGIES,
  GOAL_KEYWORDS, GOAL_LABELS, PLAN_STYLE_KEYWORDS, matchTypeId, calcAge,
} from '../lib/fitApi'
import { generateSafePlan } from '../lib/planGenerator'
import { restrictionLabel } from '../lib/restrictionNames'
import { arDigits } from '../lib/digits'

export default function NewPlan() {
  const { id: clientId } = useParams()
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const { profile } = useAuth()

  const [client, setClient] = useState(null)
  const [inbodyList, setInbodyList] = useState(null)
  const [lookups, setLookups] = useState(null)
  const [error, setError] = useState(null)
  const [step, setStep] = useState(1)
  const [generating, setGenerating] = useState(false)

  const [form, setForm] = useState({
    goal: 'maintain', planStyle: 'normal', activityId: '', dietaryTypeId: '',
    inbodyId: '', height: '', weight: '', muscle: '', fat: '', lbm: '', bmr: '',
    calories: '', caloriesTouched: false,
    conditionIds: [], allergyIds: [], noConditions: false, noAllergies: false,
  })

  useEffect(() => {
    Promise.all([
      supabase.from('clients').select('*').eq('id', clientId).single(),
      supabase.from('inbody_results').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
      fetchLookups().catch((e) => { setError(`Lookup API unreachable: ${e.message}`); return null }),
    ]).then(([{ data: c }, { data: ib }, lk]) => {
      setClient(c)
      setInbodyList(ib || [])
      setLookups(lk)
      if (ib?.length) applyInbody(ib[0])
    })
  }, [clientId])

  function applyInbody(row) {
    if (!row) return
    const v = row.confirmed || {}
    setForm((f) => ({
      ...f,
      inbodyId: row.id,
      height: v.height ?? f.height,
      weight: v.weight ?? f.weight,
      muscle: v.smm ?? f.muscle,
      fat: v.fatMass ?? f.fat,
      lbm: v.lbm ?? f.lbm,
      bmr: v.bmr ?? f.bmr,
    }))
  }

  const activities = useMemo(() => lookups ? sortActivities(lookups.activities) : [], [lookups])
  const conditions = useMemo(
    () => (lookups?.conditions || []).filter((c) => !EXCLUDED_CONDITIONS.includes(c.conditionName)),
    [lookups]
  )
  const allergies = useMemo(
    () => (lookups?.allergies || []).filter((a) => !EXCLUDED_ALLERGIES.includes(a.allergyName)),
    [lookups]
  )

  // Daily calories auto-calc: BMR × activity multiplier, manual override allowed
  useEffect(() => {
    if (form.caloriesTouched || !form.bmr || !form.activityId || !lookups) return
    const act = lookups.activities.find((a) => a.enumId === form.activityId)
    const mult = activityMultiplier(act)
    if (mult) setForm((f) => ({ ...f, calories: Math.round(parseFloat(f.bmr) * mult) }))
  }, [form.bmr, form.activityId, form.caloriesTouched, lookups])

  if (!client || inbodyList === null) return <Loading />

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const setNum = (k) => (e) => setForm({ ...form, [k]: e.target.value, ...(k === 'calories' ? { caloriesTouched: true } : {}) })

  function toggleList(k, id, noneKey) {
    const list = form[k].includes(id) ? form[k].filter((x) => x !== id) : [...form[k], id]
    setForm({ ...form, [k]: list, [noneKey]: false })
  }

  const stepValid = {
    1: form.activityId && form.dietaryTypeId && client.dob && client.gender,
    2: form.calories, // only daily calories is required; body-comp fields optional
    3: form.noConditions || form.conditionIds.length >= 0, // conditions optional
  }

  async function generate() {
    setGenerating(true)
    setError(null)
    try {
      const typeId = matchTypeId(lookups.planTypes, GOAL_KEYWORDS[form.goal], 'typeId')
      const secondaryTypeId = matchTypeId(lookups.planSecondaryTypes, PLAN_STYLE_KEYWORDS[form.planStyle], 'secondaryTypeId')
      if (!typeId || !secondaryTypeId) throw new Error('Could not resolve goal/plan style IDs from the API lookups')

      const payload = {
        firstName: client.first_name,
        lastName: client.last_name,
        gender: client.gender,
        dateOfBirth: client.dob,
        age: calcAge(client.dob),
        activityLevelTypeEnumId: form.activityId,
        dietaryTypeId: form.dietaryTypeId,
        typeId,
        secondaryTypeId,
        height: parseFloat(form.height) || 0,
        weight: parseFloat(form.weight) || 0,
        muscleMass: parseFloat(form.muscle) || 0,
        fatMass: parseFloat(form.fat) || 0,
        bmr: String(form.bmr || '0'),
        lbm: String(form.lbm || '0'),
        kilocalorieNeeded: parseFloat(form.calories) || 0,
        // Restrictions are intentionally NOT sent to the API. Its own filtering
        // corrupts the plan — it deletes offending ingredients (leaving
        // incoherent dishes), zeroes serving sizes to 0 g, and reshuffles whole
        // meals. We generate an unrestricted, coherent plan and apply targeted
        // 1:1 substitutions ourselves below (see lib/dietaryRules.js), which
        // preserves dishes and quantities.
        conditionIdSet: [],
        conditionNote: '',
        allergyIdSet: [],
      }

      const selectedConditionIds = form.noConditions ? [] : form.conditionIds
      const selectedAllergyIds = form.noAllergies ? [] : form.allergyIds
      const allergyNames = allergies.filter((a) => selectedAllergyIds.includes(a.allergyId)).map((a) => a.allergyName)
      const conditionNames = conditions.filter((c) => selectedConditionIds.includes(c.conditionId)).map((c) => c.conditionName)

      // Generate a plan that is already safe for the client's restrictions:
      // unsuitable ingredients are swapped, and un-fixable dishes are replaced
      // with suitable ones pulled from extra API calls — all invisibly.
      const { plan: planModel, apiResponse, substitutions } = await generateSafePlan(
        payload,
        { allergyNames, conditionNames },
        { fullName: `${client.first_name} ${client.last_name}`, dob: client.dob, dailyKcal: payload.kilocalorieNeeded, goalText: GOAL_LABELS[form.goal] },
      )
      planModel.dietary = { substitutions } // silent audit trail

      const { data: plan, error: insErr } = await supabase.from('plans').insert({
        gym_id: profile.gym_id,
        client_id: clientId,
        inbody_result_id: form.inbodyId || null,
        created_by: profile.id,
        questionnaire: { ...payload, goal: form.goal, planStyle: form.planStyle, allergyNames, conditionNames },
        plan_data: planModel,
        api_response: apiResponse,
      }).select().single()
      if (insErr) throw insErr

      const { error: trErr } = await supabase.rpc('transition_plan', { p_plan_id: plan.id, p_action: 'generated' })
      if (trErr) throw trErr

      navigate(`/plans/${plan.id}/edit`)
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const inbodyLabel = (r) =>
    `${r.test_date || r.created_at?.slice(0, 10)} · ${r.confirmed?.weight ?? '?'} kg (${r.model})`

  return (
    <div>
      <h1>{t('wizard.title')} — {client.first_name} {client.last_name}</h1>
      <Alert kind="error">{error}</Alert>

      <div className="step-progress">
        <div className="step-progress-line" style={{ width: `${((step - 1) / 2) * 100}%` }} />
        {[1, 2, 3].map((n) => (
          <div key={n} className={`step-item ${step === n ? 'active' : ''} ${step > n ? 'completed' : ''}`}>
            <div className="step-circle">{arDigits(n, lang)}</div>
            <div className="step-label">{t(`wizard.step${n}`)}</div>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="card">
          {!lookups && <Alert kind="warn">Lookups not loaded — check the network / proxy.</Alert>}
          <div className="grid cols-2">
            <Field label={t('wizard.activity')} required>
              <select value={form.activityId} onChange={set('activityId')}>
                <option value="">{t('wizard.selectActivity')}</option>
                {activities.map((a) => (
                  <option key={a.enumId} value={a.enumId}>{activityDisplayName(a.description, lang)}</option>
                ))}
              </select>
            </Field>
            <Field label={t('wizard.dietaryType')} required>
              <select value={form.dietaryTypeId} onChange={set('dietaryTypeId')}>
                <option value="">{t('wizard.selectDietary')}</option>
                {(lookups?.dietaryTypes || []).map((d) => (
                  <option key={d.dietaryTypeId} value={d.dietaryTypeId}>{dietaryDisplayName(d.dietaryTypeName, lang)}</option>
                ))}
              </select>
            </Field>
          </div>

          <label className="field">
            <span>{t('wizard.planStyle')} *</span>
            <div className="radio-cards cols-2">
              {['normal', 'if'].map((s) => (
                <div className="radio-card" key={s}>
                  <input type="radio" id={`ps-${s}`} name="planStyle" checked={form.planStyle === s}
                    onChange={() => setForm({ ...form, planStyle: s })} />
                  <label htmlFor={`ps-${s}`}>{t(`wizard.planStyle.${s}`)}</label>
                </div>
              ))}
            </div>
          </label>

          <label className="field">
            <span>{t('wizard.goal')} *</span>
            <div className="radio-cards cols-3">
              {['maintain', 'lose', 'gain'].map((g) => (
                <div className="radio-card" key={g}>
                  <input type="radio" id={`goal-${g}`} name="goal" checked={form.goal === g}
                    onChange={() => setForm({ ...form, goal: g })} />
                  <label htmlFor={`goal-${g}`}>{t(`wizard.goal.${g}`)}</label>
                </div>
              ))}
            </div>
          </label>

          {(!client.dob || !client.gender) && (
            <Alert kind="warn">Client date of birth and gender are required — edit the client profile first.</Alert>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="card">
          {inbodyList.length > 0 ? (
            <Field label={t('wizard.selectInbody')} hint={t('wizard.fromInbody')}>
              <select value={form.inbodyId} onChange={(e) => {
                const row = inbodyList.find((r) => r.id === e.target.value)
                if (row) applyInbody(row)
                else setForm({ ...form, inbodyId: '' })
              }}>
                <option value="">{t('wizard.noInbody')}</option>
                {inbodyList.map((r) => <option key={r.id} value={r.id}>{inbodyLabel(r)}</option>)}
              </select>
            </Field>
          ) : (
            <Alert kind="info">{t('wizard.noInbody')}</Alert>
          )}
          <div className="bodycomp-grid">
            <Field label={t('wizard.height')}><input type="number" step="0.1" min="50" max="300" value={form.height} onChange={setNum('height')} /></Field>
            <Field label={t('wizard.weight')}><input type="number" step="0.1" min="30" max="300" value={form.weight} onChange={setNum('weight')} /></Field>
            <Field label={t('wizard.muscle')}><input type="number" step="0.1" min="0" max="200" value={form.muscle} onChange={setNum('muscle')} /></Field>
            <Field label={t('wizard.fat')}><input type="number" step="0.1" min="0" max="200" value={form.fat} onChange={setNum('fat')} /></Field>
            <Field label={t('wizard.lbm')}><input type="number" step="0.1" min="0" max="300" value={form.lbm} onChange={setNum('lbm')} /></Field>
            <Field label={t('wizard.bmr')}><input type="number" step="1" min="0" max="10000" value={form.bmr} onChange={setNum('bmr')} /></Field>
          </div>
          <div style={{ maxWidth: 500, margin: '0 auto' }}>
            <Field label={t('wizard.calories')} required hint={t('wizard.caloriesHint')}>
              <input type="number" step="1" min="500" max="10000" value={form.calories} onChange={setNum('calories')} />
            </Field>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card">
          <div className="grid cols-2">
            <Field label={t('wizard.conditions')}>
              <div className="checkbox-list one-col">
                <label className="exclusive">
                  <input type="checkbox" checked={form.noConditions}
                    onChange={(e) => setForm({ ...form, noConditions: e.target.checked, conditionIds: [] })} />
                  {t('wizard.noConditions')}
                </label>
                {conditions.map((c) => (
                  <label key={c.conditionId}>
                    <input type="checkbox" checked={form.conditionIds.includes(c.conditionId)}
                      onChange={() => toggleList('conditionIds', c.conditionId, 'noConditions')} />
                    {restrictionLabel(c.conditionName, lang)}
                  </label>
                ))}
              </div>
            </Field>
            <Field label={t('wizard.allergies')}>
              <div className="checkbox-list one-col">
                <label className="exclusive">
                  <input type="checkbox" checked={form.noAllergies}
                    onChange={(e) => setForm({ ...form, noAllergies: e.target.checked, allergyIds: [] })} />
                  {t('wizard.noAllergies')}
                </label>
                {allergies.map((a) => (
                  <label key={a.allergyId}>
                    <input type="checkbox" checked={form.allergyIds.includes(a.allergyId)}
                      onChange={() => toggleList('allergyIds', a.allergyId, 'noAllergies')} />
                    {restrictionLabel(a.allergyName, lang)}
                  </label>
                ))}
              </div>
            </Field>
          </div>
        </div>
      )}

      <div className="row between">
        <button className="btn secondary" disabled={step === 1} onClick={() => setStep(step - 1)}>
          {t('common.previous')}
        </button>
        {step < 3 ? (
          <button className="btn" disabled={!stepValid[step]} onClick={() => setStep(step + 1)}>
            {t('common.next')}
          </button>
        ) : (
          <button className="btn" disabled={generating || !lookups} onClick={generate}>
            {generating ? <>{t('wizard.generating')} <Spinner /></> : t('wizard.generate')}
          </button>
        )}
      </div>
    </div>
  )
}
