// Plan editor (plan §5): canvas of true-proportion pages, thumbnail rail,
// contextual inspector. Structured editing — edits mutate the plan model,
// the template re-renders.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { Field, Alert, Loading, Spinner, StatusBadge } from '../components/ui'
import DeepFitTemplate, { planPageList } from '../components/DeepFitTemplate'
import {
  blankOption, duplicateOption, kcalWarning, allergenWarnings,
  missingTranslations, autofillArabic, MAX_OPTIONS_PER_MEAL,
} from '../lib/planModel'
import { generatePlan } from '../lib/fitApi'
import { buildPlanModel } from '../lib/planModel'
import { renderPlanPdf, downloadBlob } from '../lib/pdfExport'

const EDITABLE = ['DRAFT', 'GENERATED', 'IN_REVIEW', 'CHANGES_REQUESTED']

export default function PlanEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [row, setRow] = useState(null)
  const [gym, setGym] = useState(null)
  const [plan, setPlan] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [selection, setSelection] = useState(null) // { mealId, optionId }
  const [previewLang, setPreviewLang] = useState('en')
  const [busy, setBusy] = useState(null) // 'save' | 'submit' | 'regen' | 'pdf'
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [rejection, setRejection] = useState(null)
  const canvasRef = useRef()
  const pageEls = useRef({})

  useEffect(() => {
    ;(async () => {
      const { data: p, error: e } = await supabase.from('plans')
        .select('*, clients(first_name, last_name, dob)')
        .eq('id', id).single()
      if (e) { setError(e.message); return }
      setRow(p)
      setPlan(JSON.parse(JSON.stringify(p.plan_data)))
      const { data: g } = await supabase.from('gyms').select('*').eq('id', p.gym_id).maybeSingle()
      setGym(g)
      if (p.status === 'CHANGES_REQUESTED') {
        const { data: ev } = await supabase.from('plan_events')
          .select('comment, created_at').eq('plan_id', id).eq('action', 'rejected')
          .order('created_at', { ascending: false }).limit(1)
        if (ev?.length) setRejection(ev[0])
      }
    })()
  }, [id])

  const warnings = useMemo(() => {
    if (!plan) return { kcal: [], allergen: [], keys: new Set() }
    const kcal = []
    for (const meal of plan.meals) {
      for (const opt of meal.options) {
        const w = kcalWarning(opt)
        if (w) kcal.push({ mealId: meal.id, optionId: opt.id, ...w })
      }
    }
    const allergen = allergenWarnings(plan, row?.questionnaire?.allergyNames || [])
    const keys = new Set([...kcal, ...allergen].map((w) => `${w.mealId}:${w.optionId}`))
    return { kcal, allergen, keys }
  }, [plan, row])

  const missingAr = useMemo(() => plan ? missingTranslations(plan) : [], [plan])

  if (error && !row) return <Alert kind="error">{error}</Alert>
  if (!row || !plan) return <Loading />
  if (!EDITABLE.includes(row.status)) {
    return (
      <div>
        <Alert kind="info">
          This plan is <StatusBadge status={row.status} /> and locked for editing.{' '}
          <Link to={`/plans/${id}`}>Open the read-only view</Link>.
        </Alert>
      </div>
    )
  }

  const mutate = (fn) => {
    setPlan((prev) => {
      const next = JSON.parse(JSON.stringify(prev))
      fn(next)
      return next
    })
    setDirty(true)
    setNotice(null)
  }

  const selMeal = selection ? plan.meals.find((m) => m.id === selection.mealId) : null
  const selOption = selMeal?.options.find((o) => o.id === selection.optionId) || null

  function updateOption(fn) {
    mutate((p) => {
      const meal = p.meals.find((m) => m.id === selection.mealId)
      const opt = meal?.options.find((o) => o.id === selection.optionId)
      if (opt) fn(opt, meal)
    })
  }

  async function saveDraft() {
    setBusy('save')
    setError(null)
    try {
      const { error: e } = await supabase.from('plans').update({ plan_data: plan }).eq('id', id)
      if (e) throw e
      if (row.status !== 'IN_REVIEW') {
        await supabase.rpc('transition_plan', { p_plan_id: id, p_action: 'edited' })
        setRow({ ...row, status: 'IN_REVIEW', plan_data: plan })
      } else {
        await supabase.rpc('log_plan_event', { p_plan_id: id, p_action: 'edited', p_comment: 'saved draft' })
        setRow({ ...row, plan_data: plan })
      }
      setDirty(false)
      setNotice(t('editor.saved'))
    } catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  async function submit() {
    setBusy('submit')
    setError(null)
    try {
      const { error: e } = await supabase.from('plans').update({ plan_data: plan }).eq('id', id)
      if (e) throw e
      const { error: e2 } = await supabase.rpc('transition_plan', { p_plan_id: id, p_action: 'submitted' })
      if (e2) throw e2
      navigate(`/plans/${id}`)
    } catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  async function regenerate() {
    if (!window.confirm(t('editor.regenerateConfirm'))) return
    setBusy('regen')
    setError(null)
    try {
      // strip UI-only fields stored alongside the API payload
      const { goal, planStyle, allergyNames, conditionNames, ...q } = row.questionnaire
      const apiResponse = await generatePlan(q)
      const model = autofillArabic(buildPlanModel(apiResponse, {
        fullName: plan.header.fullName,
        dob: plan.header.dob,
        dailyKcal: q.kilocalorieNeeded,
        goalText: plan.header.dietType,
      }))
      model.header.nextCheckup = plan.header.nextCheckup
      const { error: e } = await supabase.from('plans')
        .update({ plan_data: model, api_response: apiResponse }).eq('id', id)
      if (e) throw e
      await supabase.rpc('transition_plan', { p_plan_id: id, p_action: 'generated' })
      setPlan(model)
      setRow({ ...row, status: 'GENERATED' })
      setSelection(null)
      setDirty(false)
    } catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  async function previewPdf() {
    setBusy('pdf')
    try {
      const blob = await renderPlanPdf(canvasRef.current)
      downloadBlob(blob, `${plan.header.fullName || 'Client'} - Diet Plan.pdf`)
    } catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  const pages = planPageList(plan)

  return (
    <div>
      <div className="row between" style={{ marginBottom: '0.75rem' }}>
        <div className="row">
          <h1 style={{ margin: 0 }}>{t('editor.title')}</h1>
          <StatusBadge status={row.status} />
          {dirty && <span className="muted small">●</span>}
        </div>
        <div className="row">
          <button className="btn secondary sm" onClick={() => setPreviewLang(previewLang === 'en' ? 'ar' : 'en')}>
            {previewLang === 'en' ? t('editor.arabic') : t('editor.english')}
          </button>
          <button className="btn secondary sm" onClick={regenerate} disabled={!!busy}>
            {busy === 'regen' ? <Spinner /> : t('editor.regenerate')}
          </button>
          <button className="btn secondary sm" onClick={previewPdf} disabled={!!busy}>
            {busy === 'pdf' ? <Spinner /> : t('editor.previewPdf')}
          </button>
          <button className="btn secondary sm" onClick={saveDraft} disabled={!!busy || !dirty}>
            {busy === 'save' ? <Spinner /> : t('editor.saveDraft')}
          </button>
          <button className="btn sm" onClick={submit} disabled={!!busy}>
            {busy === 'submit' ? <Spinner /> : t('editor.submit')}
          </button>
        </div>
      </div>

      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{notice}</Alert>
      {rejection && (
        <Alert kind="warn"><b>{t('editor.rejectionComment')}:</b> {rejection.comment}</Alert>
      )}
      {warnings.allergen.map((w, i) => (
        <Alert kind="warn" key={`a${i}`}>
          {t('editor.allergenWarning', { ingredient: w.ingredient, allergy: w.allergy })}
        </Alert>
      ))}

      <div className="editor-shell">
        {/* thumbnails */}
        <div className="editor-thumbs">
          {pages.map((p, idx) => (
            <div key={idx} className="editor-thumb" onClick={() => pageEls.current[idx]?.scrollIntoView({ behavior: 'smooth' })}>
              <div className="thumb-scale">
                <ThumbPage plan={plan} pageIndex={idx} lang={previewLang} gym={gym} />
              </div>
              <div className="thumb-label">{p.label}</div>
            </div>
          ))}
        </div>

        {/* canvas */}
        <div className="editor-canvas" ref={canvasRef}>
          <DeepFitTemplate
            plan={plan}
            lang={previewLang}
            gym={gym}
            selectable
            selection={selection}
            onSelect={(mealId, optionId) => setSelection({ mealId, optionId })}
            warnings={warnings.keys}
            pageRefs={(i, el) => { pageEls.current[i] = el }}
          />
        </div>

        {/* inspector */}
        <div className="editor-inspector">
          <div className="card">
            <h3>{t('editor.header')}</h3>
            <Field label={t('editor.fullName')}>
              <input type="text" value={plan.header.fullName}
                onChange={(e) => mutate((p) => { p.header.fullName = e.target.value })} />
            </Field>
            <div className="grid cols-2">
              <Field label={t('editor.testDate')}>
                <input type="date" value={plan.header.testDate?.slice(0, 10) || ''}
                  onChange={(e) => mutate((p) => { p.header.testDate = e.target.value })} />
              </Field>
              <Field label={t('editor.nextCheckup')}>
                <input type="date" value={plan.header.nextCheckup?.slice(0, 10) || ''}
                  onChange={(e) => mutate((p) => { p.header.nextCheckup = e.target.value })} />
              </Field>
              <Field label={t('editor.dailyKcal')}>
                <input type="number" value={plan.header.dailyKcal || ''}
                  onChange={(e) => mutate((p) => { p.header.dailyKcal = parseInt(e.target.value) || 0 })} />
              </Field>
              <Field label={t('editor.dietType')}>
                <input type="text" value={plan.header.dietType}
                  onChange={(e) => mutate((p) => { p.header.dietType = e.target.value })} />
              </Field>
            </div>
            {missingAr.length > 0 && (
              <div className="row between">
                <span className="small" style={{ color: 'var(--warn)' }}>
                  ⚠ {t('editor.missingAr')} ×{missingAr.length}
                </span>
                <button className="btn ghost sm" onClick={() => mutate((p) => autofillArabic(p))}>
                  {t('editor.autofillAr')}
                </button>
              </div>
            )}
          </div>

          {/* per-meal add buttons */}
          <div className="card">
            {plan.meals.map((meal) => (
              <div className="row between" key={meal.id} style={{ marginBottom: 6 }}>
                <b style={{ textTransform: 'capitalize' }}>{meal.id}</b>
                <div className="row">
                  <input type="number" style={{ width: 90 }} value={meal.targetKcal ?? ''}
                    placeholder={t('editor.mealTargetKcal')}
                    onChange={(e) => mutate((p) => {
                      p.meals.find((m) => m.id === meal.id).targetKcal = parseInt(e.target.value) || null
                    })} />
                  <button className="btn ghost sm"
                    disabled={meal.options.length >= MAX_OPTIONS_PER_MEAL}
                    onClick={() => mutate((p) => {
                      const m = p.meals.find((x) => x.id === meal.id)
                      const opt = blankOption()
                      m.options.push(opt)
                    })}>
                    + {t('editor.addOption')}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {!selOption ? (
            <div className="card muted small">{t('editor.clickToEdit')}</div>
          ) : (
            <OptionInspector
              t={t}
              meal={selMeal}
              option={selOption}
              kcalWarn={kcalWarning(selOption)}
              updateOption={updateOption}
              mutate={mutate}
              selection={selection}
              setSelection={setSelection}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// Single-page render for thumbnails: reuses the template but slices to a page.
function ThumbPage({ plan, pageIndex, lang, gym }) {
  // Cheap approach: render the full template; CSS scaling keeps it light for ≤6 pages.
  // Slice: hide all but the requested page via a wrapper.
  return (
    <div style={{ height: 842, overflow: 'hidden' }}>
      <div style={{ marginTop: pageIndex * -(842 + 20) }}>
        <DeepFitTemplate plan={plan} lang={lang} gym={gym} />
      </div>
    </div>
  )
}

function OptionInspector({ t, meal, option, kcalWarn, updateOption, mutate, selection, setSelection }) {
  const idx = meal.options.findIndex((o) => o.id === option.id)

  const move = (dir) => mutate((p) => {
    const m = p.meals.find((x) => x.id === meal.id)
    const i = m.options.findIndex((o) => o.id === option.id)
    const j = i + dir
    if (j < 0 || j >= m.options.length) return
    ;[m.options[i], m.options[j]] = [m.options[j], m.options[i]]
  })

  return (
    <div className="card">
      <div className="row between">
        <h3 style={{ textTransform: 'capitalize' }}>{meal.id} · {t('editor.option')} {idx + 1}</h3>
        <div className="row">
          <button className="btn ghost sm" title={t('editor.moveUp')} onClick={() => move(-1)}>↑</button>
          <button className="btn ghost sm" title={t('editor.moveDown')} onClick={() => move(1)}>↓</button>
        </div>
      </div>

      {kcalWarn && (
        <Alert kind="warn">{t('editor.kcalWarning', { est: kcalWarn.estimated, stated: kcalWarn.stated })}</Alert>
      )}

      <div className="inspector-bilingual">
        <Field label={`${t('editor.optionName')} (EN)`}>
          <input type="text" value={option.name_en} onChange={(e) => updateOption((o) => { o.name_en = e.target.value })} />
        </Field>
        <Field label={`${t('editor.optionName')} (AR)`}>
          <input type="text" dir="rtl" className={option.name_en && !option.name_ar ? 'ar-missing' : ''}
            value={option.name_ar} onChange={(e) => updateOption((o) => { o.name_ar = e.target.value })} />
        </Field>
        <Field label={`${t('editor.optionDesc')} (EN)`}>
          <textarea rows={2} value={option.desc_en} onChange={(e) => updateOption((o) => { o.desc_en = e.target.value })} />
        </Field>
        <Field label={`${t('editor.optionDesc')} (AR)`}>
          <textarea rows={2} dir="rtl" className={option.desc_en && !option.desc_ar ? 'ar-missing' : ''}
            value={option.desc_ar} onChange={(e) => updateOption((o) => { o.desc_ar = e.target.value })} />
        </Field>
      </div>

      <h3>{t('editor.ingredients')}</h3>
      {option.ingredients.map((ing, i) => (
        <div className="ingredient-row" key={i}>
          <input type="text" placeholder="EN" value={ing.name_en}
            onChange={(e) => updateOption((o) => { o.ingredients[i].name_en = e.target.value })} />
          <input type="text" dir="rtl" placeholder="AR" className={ing.name_en && !ing.name_ar ? 'ar-missing' : ''}
            value={ing.name_ar}
            onChange={(e) => updateOption((o) => { o.ingredients[i].name_ar = e.target.value })} />
          <input type="number" placeholder={t('editor.grams')} value={ing.grams}
            onChange={(e) => updateOption((o) => { o.ingredients[i].grams = parseFloat(e.target.value) || 0 })} />
          <button title={t('common.delete')} onClick={() => updateOption((o) => { o.ingredients.splice(i, 1) })}>✕</button>
        </div>
      ))}
      <button className="btn ghost sm" onClick={() => updateOption((o) => {
        o.ingredients.push({ name_en: '', name_ar: '', grams: 0, uom: 'g' })
      })}>
        + {t('editor.addIngredient')}
      </button>

      <h3 style={{ marginTop: '0.9rem' }}>{t('editor.macros')}</h3>
      <div className="grid cols-4">
        {[['protein', 'editor.protein'], ['carbs', 'editor.carbs'], ['fats', 'editor.fats']].map(([k, lk]) => (
          <Field key={k} label={`${t(lk)} (g)`}>
            <input type="number" step="0.1" value={option.macros[k] ?? ''}
              onChange={(e) => updateOption((o) => { o.macros[k] = e.target.value === '' ? null : parseFloat(e.target.value) })} />
          </Field>
        ))}
        <Field label={t('editor.kcal')}>
          <input type="number" value={option.kcal || ''}
            onChange={(e) => updateOption((o) => { o.kcal = parseInt(e.target.value) || 0 })} />
        </Field>
      </div>

      <div className="row end">
        <button className="btn secondary sm" onClick={() => mutate((p) => {
          const m = p.meals.find((x) => x.id === meal.id)
          if (m.options.length >= MAX_OPTIONS_PER_MEAL) return
          const i = m.options.findIndex((o) => o.id === option.id)
          m.options.splice(i + 1, 0, duplicateOption(m.options[i]))
        })}>
          {t('editor.duplicateOption')}
        </button>
        <button className="btn danger sm" onClick={() => {
          mutate((p) => {
            const m = p.meals.find((x) => x.id === meal.id)
            m.options = m.options.filter((o) => o.id !== option.id)
          })
          setSelection(null)
        }}>
          {t('editor.removeOption')}
        </button>
      </div>
    </div>
  )
}
