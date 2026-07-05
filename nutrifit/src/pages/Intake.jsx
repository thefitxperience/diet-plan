// Public, no-login client intake (shared link /#/intake/<token>).
// Step 1: InBody upload — parsed automatically, the client is NOT asked to
// review/edit the numbers. Step 2: personal details + questionnaire.
// On submit we generate a restriction-safe plan client-side and hand everything
// to the submit_intake RPC, which creates the client + a GENERATED plan that
// lands in the nutritionist's approval queue. No auth involved.

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { Field, Alert, Spinner } from '../components/ui'
import { extractFromPdf, extractFromImage, parseInBodyText } from '../lib/inbodyParser'
import {
  fetchLookups, activityDisplayName, sortActivities, activityMultiplier,
  dietaryDisplayName, EXCLUDED_CONDITIONS, EXCLUDED_ALLERGIES,
  GOAL_KEYWORDS, GOAL_LABELS, PLAN_STYLE_KEYWORDS, matchTypeId, calcAge,
} from '../lib/fitApi'
import { generateSafePlan } from '../lib/planGenerator'
import { restrictionLabel } from '../lib/restrictionNames'
import { arDigits } from '../lib/digits'

// Mifflin–St Jeor fallback when the InBody sheet has no BMR.
function estimateBmr({ weight, height, age, gender }) {
  const w = parseFloat(weight), h = parseFloat(height), a = parseFloat(age) || 30
  if (!w || !h) return 0
  const base = 10 * w + 6.25 * h - 5 * a
  return Math.round(gender === 'F' ? base - 161 : base + 5)
}

export default function Intake() {
  const { token } = useParams()
  const { t, lang, setLang } = useI18n()

  const [gym, setGym] = useState(null)
  const [gymError, setGymError] = useState(false)
  const [lookups, setLookups] = useState(null)
  const [step, setStep] = useState(1)

  // InBody (parsed silently — no client-facing review)
  const [parsing, setParsing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [sourceType, setSourceType] = useState('pdf_text')
  const [model, setModel] = useState('InBody270')
  const [extracted, setExtracted] = useState(null)
  const [values, setValues] = useState(null)
  const [testDate, setTestDate] = useState('')
  const inbodyDone = !!values
  const inputRef = useRef()

  // Details + questionnaire
  const [form, setForm] = useState({
    firstName: '', lastName: '', dob: '', gender: '', phone: '', email: '', consent: false,
    goal: 'maintain', planStyle: 'normal', activityId: '', dietaryTypeId: '',
    conditionIds: [], allergyIds: [], noConditions: false, noAllergies: false,
  })

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  // iOS Safari tints the status bar / toolbar from the BODY background color,
  // so set a solid brand color while this page is mounted (an overlay behind
  // the content doesn't affect what Safari samples). Reverted on unmount.
  useEffect(() => {
    document.body.classList.add('intake-active')
    document.documentElement.classList.add('intake-active')
    return () => {
      document.body.classList.remove('intake-active')
      document.documentElement.classList.remove('intake-active')
    }
  }, [])

  useEffect(() => {
    supabase.rpc('get_intake_gym', { p_token: token }).then(({ data, error }) => {
      const g = Array.isArray(data) ? data[0] : data
      if (error || !g) { setGymError(true); return }
      setGym(g)
    })
    fetchLookups().then(setLookups).catch(() => setLookups(null))
  }, [token])

  const activities = lookups ? sortActivities(lookups.activities) : []
  const conditions = (lookups?.conditions || []).filter((c) => !EXCLUDED_CONDITIONS.includes(c.conditionName))
  const allergies = (lookups?.allergies || []).filter((a) => !EXCLUDED_ALLERGIES.includes(a.allergyName))

  async function handleFile(f) {
    if (!f) return
    setError(null); setParsing(true)
    try {
      const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      let text
      if (isPdf) { text = await extractFromPdf(f); setSourceType('pdf_text') }
      else { text = await extractFromImage(f, setProgress); setSourceType('ocr') }
      const result = parseInBodyText(text)
      const fields = result.fields || {}
      // The scan must give us at least weight + height. We don't make the client
      // verify numbers — if the read is too poor, ask for a clearer file instead.
      if (!fields.weight || !fields.height) {
        setError(t('intake.scanFailed'))
        return
      }
      setModel(result.model)
      setExtracted({ ...fields, _text_sample: text.slice(0, 2000) })
      setValues({ ...fields })
      setTestDate(fields.testDate || '')
      setStep(2) // straight to details — no review step
    } catch {
      setError(t('intake.scanFailed'))
    } finally { setParsing(false) }
  }

  function reupload() {
    setValues(null); setExtracted(null); setError(null)
    inputRef.current?.click()
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  function toggleList(k, id, noneKey) {
    const list = form[k].includes(id) ? form[k].filter((x) => x !== id) : [...form[k], id]
    setForm({ ...form, [k]: list, [noneKey]: false })
  }

  const step2Valid = form.firstName && form.lastName && form.dob && form.gender &&
    form.phone && form.activityId && form.dietaryTypeId && form.consent

  async function submit() {
    setSubmitting(true); setError(null)
    try {
      if (!lookups) throw new Error('Could not reach the plan service. Please try again.')
      const typeId = matchTypeId(lookups.planTypes, GOAL_KEYWORDS[form.goal], 'typeId')
      const secondaryTypeId = matchTypeId(lookups.planSecondaryTypes, PLAN_STYLE_KEYWORDS[form.planStyle], 'secondaryTypeId')
      if (!typeId || !secondaryTypeId) throw new Error('Could not resolve plan options — please contact your gym.')

      const age = calcAge(form.dob)
      const confirmed = { ...values }; delete confirmed._text_sample
      const bmr = parseFloat(values.bmr) || estimateBmr({ weight: values.weight, height: values.height, age, gender: form.gender })
      const act = lookups.activities.find((a) => a.enumId === form.activityId)
      const mult = activityMultiplier(act) || 1.2
      const calories = Math.round(bmr * mult)

      const payload = {
        firstName: form.firstName, lastName: form.lastName, gender: form.gender,
        dateOfBirth: form.dob, age,
        activityLevelTypeEnumId: form.activityId, dietaryTypeId: form.dietaryTypeId,
        typeId, secondaryTypeId,
        height: parseFloat(values.height) || 0, weight: parseFloat(values.weight) || 0,
        muscleMass: parseFloat(values.smm) || 0, fatMass: parseFloat(values.fatMass) || 0,
        bmr: String(bmr || '0'), lbm: String(values.lbm || '0'),
        kilocalorieNeeded: calories,
        conditionIdSet: [], conditionNote: '', allergyIdSet: [], // restrictions handled our side
      }

      const selectedConditionIds = form.noConditions ? [] : form.conditionIds
      const selectedAllergyIds = form.noAllergies ? [] : form.allergyIds
      const allergyNames = allergies.filter((a) => selectedAllergyIds.includes(a.allergyId)).map((a) => a.allergyName)
      const conditionNames = conditions.filter((c) => selectedConditionIds.includes(c.conditionId)).map((c) => c.conditionName)

      const { plan, apiResponse, substitutions } = await generateSafePlan(
        payload,
        { allergyNames, conditionNames },
        { fullName: `${form.firstName} ${form.lastName}`, dob: form.dob, dailyKcal: calories, goalText: GOAL_LABELS[form.goal] },
      )
      plan.dietary = { substitutions }

      const { error: rpcErr } = await supabase.rpc('submit_intake', {
        p_token: token,
        p_client: {
          first_name: form.firstName, last_name: form.lastName, dob: form.dob,
          gender: form.gender, phone: form.phone, email: form.email, consent: form.consent, notes: '',
        },
        p_inbody: { source_type: sourceType, model, extracted: extracted || {}, confirmed, test_date: testDate || null },
        p_questionnaire: { ...payload, goal: form.goal, planStyle: form.planStyle, allergyNames, conditionNames },
        p_plan_data: plan,
        p_api_response: apiResponse,
      })
      if (rpcErr) throw rpcErr
      setDone(true)
    } catch (e) {
      setError(e.message)
    } finally { setSubmitting(false) }
  }

  // ── render ──────────────────────────────────────────────────────────
  if (gymError) {
    return (
      <div className="intake-page">
        <div className="intake-card" style={{ textAlign: 'center' }}>
          <h2>{t('intake.invalidLink')}</h2>
        </div>
      </div>
    )
  }
  if (!gym) {
    return (
      <div className="intake-page">
        <div className="intake-card center"><Spinner /> {t('intake.loading')}</div>
      </div>
    )
  }

  return (
    <div className="intake-page">
      <div className="intake-card">
        <div className="row between intake-head">
          {gym.logo_url
            ? <img src={gym.logo_url} alt={gym.name} style={{ height: 44 }} />
            : <b style={{ fontSize: '1.1rem' }}>{gym.name}</b>}
          <button className="btn ghost sm" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
            {lang === 'en' ? 'العربية' : 'English'}
          </button>
        </div>

        {done ? (
          <div className="intake-body" style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ fontSize: '2.5rem' }}>🎉</div>
            <h2>{t('intake.doneTitle')}</h2>
            <p className="muted">{t('intake.doneBody')}</p>
          </div>
        ) : (
          <div className="intake-body">
            <h1>{t('intake.title')}</h1>
            <p className="muted small">{t('intake.subtitle')}</p>

            <div className="step-progress">
              <div className="step-progress-line" style={{ width: `${((step - 1) / 1) * 100}%` }} />
              {[1, 2].map((n) => (
                <div key={n} className={`step-item ${step === n ? 'active' : ''} ${step > n ? 'completed' : ''}`}>
                  <div className="step-circle">{arDigits(n, lang)}</div>
                  <div className="step-label">{t(`intake.step${n}`)}</div>
                </div>
              ))}
            </div>

            <Alert kind="error">{error}</Alert>

            {step === 1 && (
              <div>
                <p className="muted small">{t('intake.inbodyIntro')}</p>
                <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => handleFile(e.target.files[0])} />
                {parsing ? (
                  <div className="card center" style={{ minHeight: 160 }}>
                    <Spinner />
                    <div className="muted">{t('intake.scanning')} {sourceType === 'ocr' && progress > 0 && `${Math.round(progress * 100)}%`}</div>
                  </div>
                ) : inbodyDone ? (
                  <>
                    <div className="card center" style={{ minHeight: 160 }}>
                      <div style={{ fontSize: '2rem' }}>✅</div>
                      <div><b>{t('intake.inbodyReceived')}</b></div>
                      <button className="btn ghost sm" onClick={reupload}>{t('intake.reupload')}</button>
                    </div>
                    <div className="row end" style={{ marginTop: '1rem' }}>
                      <button className="btn" onClick={() => setStep(2)}>{t('common.next')}</button>
                    </div>
                  </>
                ) : (
                  <div className="card center" style={{ cursor: 'pointer', borderStyle: 'dashed', minHeight: 160 }}
                    onClick={() => inputRef.current.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}>
                    <div className="muted">{t('intake.dropHint')}</div>
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div>
                <p className="muted small">{t('intake.detailsIntro')}</p>
                <div className="grid cols-2">
                  <Field label={t('clients.firstName')} required>
                    <input type="text" value={form.firstName} onChange={set('firstName')} />
                  </Field>
                  <Field label={t('clients.lastName')} required>
                    <input type="text" value={form.lastName} onChange={set('lastName')} />
                  </Field>
                  <Field label={t('clients.dob')} required>
                    <input type="date" value={form.dob} onChange={set('dob')} />
                  </Field>
                  <Field label={t('clients.gender')} required>
                    <select value={form.gender} onChange={set('gender')}>
                      <option value="">{t('intake.selectGender')}</option>
                      <option value="M">{t('clients.male')}</option>
                      <option value="F">{t('clients.female')}</option>
                    </select>
                  </Field>
                  <Field label={t('clients.phone')} required>
                    <input type="tel" value={form.phone} onChange={set('phone')} style={{ direction: 'ltr' }} />
                  </Field>
                  <Field label={t('clients.email')}>
                    <input type="email" value={form.email} onChange={set('email')} />
                  </Field>
                  <Field label={t('wizard.activity')} required>
                    <select value={form.activityId} onChange={set('activityId')}>
                      <option value="">{t('wizard.selectActivity')}</option>
                      {activities.map((a) => <option key={a.enumId} value={a.enumId}>{activityDisplayName(a.description, lang)}</option>)}
                    </select>
                  </Field>
                  <Field label={t('wizard.dietaryType')} required>
                    <select value={form.dietaryTypeId} onChange={set('dietaryTypeId')}>
                      <option value="">{t('wizard.selectDietary')}</option>
                      {(lookups?.dietaryTypes || []).map((d) => <option key={d.dietaryTypeId} value={d.dietaryTypeId}>{dietaryDisplayName(d.dietaryTypeName, lang)}</option>)}
                    </select>
                  </Field>
                </div>

                <label className="field">
                  <span>{t('wizard.goal')} *</span>
                  <div className="radio-cards cols-3">
                    {['maintain', 'lose', 'gain'].map((g) => (
                      <div className="radio-card" key={g}>
                        <input type="radio" id={`goal-${g}`} name="goal" checked={form.goal === g} onChange={() => setForm({ ...form, goal: g })} />
                        <label htmlFor={`goal-${g}`}>{t(`wizard.goal.${g}`)}</label>
                      </div>
                    ))}
                  </div>
                </label>

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

                <label className="checkbox-list" style={{ marginTop: 8 }}>
                  <label>
                    <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
                    {t('intake.consent')} *
                  </label>
                </label>

                <div className="row between" style={{ marginTop: '1rem' }}>
                  <button className="btn secondary" onClick={() => setStep(1)}>{t('common.previous')}</button>
                  <button className="btn" disabled={submitting || !step2Valid} onClick={submit}>
                    {submitting ? <>{t('intake.submitting')} <Spinner /></> : t('intake.submit')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
