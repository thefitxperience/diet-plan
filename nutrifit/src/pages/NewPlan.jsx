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
  fetchLookups, generatePlan, activityDisplayName, sortActivities, activityMultiplier,
  dietaryDisplayName, EXCLUDED_CONDITIONS, EXCLUDED_ALLERGIES,
  GOAL_KEYWORDS, GOAL_LABELS, PLAN_STYLE_KEYWORDS, matchTypeId, calcAge,
} from '../lib/fitApi'
import { buildPlanModel, autofillArabic } from '../lib/planModel'

export default function NewPlan() {
  const { id: clientId } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
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
    2: form.height && form.weight && form.muscle && form.fat && form.lbm && form.bmr && form.calories,
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
        conditionIdSet: form.noConditions ? [] : form.conditionIds,
        conditionNote: '',
        allergyIdSet: form.noAllergies ? [] : form.allergyIds,
      }

      const apiResponse = await generatePlan(payload)

      const allergyNames = allergies.filter((a) => payload.allergyIdSet.includes(a.allergyId)).map((a) => a.allergyName)
      const conditionNames = conditions.filter((c) => payload.conditionIdSet.includes(c.conditionId)).map((c) => c.conditionName)

      const planModel = autofillArabic(buildPlanModel(apiResponse, {
        fullName: `${client.first_name} ${client.last_name}`,
        dob: client.dob,
        dailyKcal: payload.kilocalorieNeeded,
        goalText: GOAL_LABELS[form.goal],
      }))

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

      <div className="row" style={{ marginBottom: '1rem' }}>
        {[1, 2, 3].map((n) => (
          <span key={n} className="badge" style={{
            background: step === n ? 'var(--grad)' : 'var(--border)',
            color: step === n ? 'white' : 'var(--muted)',
          }}>
            {n}. {t(`wizard.step${n}`)}
          </span>
        ))}
      </div>

      {step === 1 && (
        <div className="card">
          {!lookups && <Alert kind="warn">Lookups not loaded — check the network / proxy.</Alert>}
          <div className="grid cols-2">
            <Field label={t('wizard.goal')} required>
              <select value={form.goal} onChange={set('goal')}>
                {['maintain', 'lose', 'gain'].map((g) => <option key={g} value={g}>{t(`wizard.goal.${g}`)}</option>)}
              </select>
            </Field>
            <Field label={t('wizard.planStyle')} required>
              <select value={form.planStyle} onChange={set('planStyle')}>
                <option value="normal">{t('wizard.planStyle.normal')}</option>
                <option value="if">{t('wizard.planStyle.if')}</option>
              </select>
            </Field>
            <Field label={t('wizard.activity')} required>
              <select value={form.activityId} onChange={set('activityId')}>
                <option value="">—</option>
                {activities.map((a) => (
                  <option key={a.enumId} value={a.enumId}>{activityDisplayName(a.description)}</option>
                ))}
              </select>
            </Field>
            <Field label={t('wizard.dietaryType')} required>
              <select value={form.dietaryTypeId} onChange={set('dietaryTypeId')}>
                <option value="">—</option>
                {(lookups?.dietaryTypes || []).map((d) => (
                  <option key={d.dietaryTypeId} value={d.dietaryTypeId}>{dietaryDisplayName(d.dietaryTypeName)}</option>
                ))}
              </select>
            </Field>
          </div>
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
          <div className="grid cols-3">
            <Field label={t('wizard.height')} required><input type="number" step="0.1" min="50" max="300" value={form.height} onChange={setNum('height')} /></Field>
            <Field label={t('wizard.weight')} required><input type="number" step="0.1" min="30" max="300" value={form.weight} onChange={setNum('weight')} /></Field>
            <Field label={t('wizard.muscle')} required><input type="number" step="0.1" min="0" max="200" value={form.muscle} onChange={setNum('muscle')} /></Field>
            <Field label={t('wizard.fat')} required><input type="number" step="0.1" min="0" max="200" value={form.fat} onChange={setNum('fat')} /></Field>
            <Field label={t('wizard.lbm')} required><input type="number" step="0.1" min="0" max="300" value={form.lbm} onChange={setNum('lbm')} /></Field>
            <Field label={t('wizard.bmr')} required><input type="number" step="1" min="0" max="10000" value={form.bmr} onChange={setNum('bmr')} /></Field>
          </div>
          <Field label={t('wizard.calories')} required hint={t('wizard.caloriesHint')}>
            <input type="number" step="1" min="500" max="10000" value={form.calories} onChange={setNum('calories')} />
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="card">
          <Field label={t('wizard.conditions')}>
            <div className="checkbox-list">
              <label className="exclusive">
                <input type="checkbox" checked={form.noConditions}
                  onChange={(e) => setForm({ ...form, noConditions: e.target.checked, conditionIds: [] })} />
                {t('wizard.noConditions')}
              </label>
              {conditions.map((c) => (
                <label key={c.conditionId}>
                  <input type="checkbox" checked={form.conditionIds.includes(c.conditionId)}
                    onChange={() => toggleList('conditionIds', c.conditionId, 'noConditions')} />
                  {c.conditionName}
                </label>
              ))}
            </div>
          </Field>
          <Field label={t('wizard.allergies')}>
            <div className="checkbox-list">
              <label className="exclusive">
                <input type="checkbox" checked={form.noAllergies}
                  onChange={(e) => setForm({ ...form, noAllergies: e.target.checked, allergyIds: [] })} />
                {t('wizard.noAllergies')}
              </label>
              {allergies.map((a) => (
                <label key={a.allergyId}>
                  <input type="checkbox" checked={form.allergyIds.includes(a.allergyId)}
                    onChange={() => toggleList('allergyIds', a.allergyId, 'noAllergies')} />
                  {a.allergyName}
                </label>
              ))}
            </div>
          </Field>
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
