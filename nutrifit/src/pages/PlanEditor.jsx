// Plan editor (plan §5): canvas of true-proportion pages, thumbnail rail,
// contextual inspector. Structured editing — edits mutate the plan model,
// the template re-renders.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { Field, Alert, Loading, Spinner, StatusBadge, BackButton } from '../components/ui'
import DeepFitTemplate, { planPageList } from '../components/DeepFitTemplate'
import {
  blankOption, optionFromCatalog, scaleOptionToKcal, mealTargetKcal,
  optionWeight, MEAL_WEIGHT_CAP, kcalWarning, allergenWarnings, MAX_OPTIONS_PER_MEAL, formatAmount,
  goalAdjustedKcal,
} from '../lib/planModel'
import { canonicalTokens, processOption } from '../lib/dietaryRules'
import mealCatalog from '../data/mealCatalog.json'
import { arDigits } from '../lib/digits'
import { generateCatalogPlan } from '../lib/planGenerator'
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
  const [picker, setPicker] = useState(null) // mealId currently choosing a meal for
  const [previewLang, setPreviewLang] = useState('en')
  const [busy, setBusy] = useState(null) // 'save' | 'submit' | 'regen' | 'pdf'
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
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

  if (error && !row) return <Alert kind="error">{error}</Alert>
  if (!row || !plan) return <Loading />
  if (!EDITABLE.includes(row.status)) {
    return (
      <div>
        <BackButton />
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

  // Add an option to a meal — a fully-built option (safe-swapped catalog dish),
  // or a blank one for manual entry.
  function addOption(mealId, option) {
    mutate((p) => {
      const m = p.meals.find((x) => x.id === mealId)
      if (!m || m.options.length >= MAX_OPTIONS_PER_MEAL) return
      m.options.push(option || blankOption())
    })
    setPicker(null)
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
      // Replace the (now locked) editor entry so "back" from the plan/delivery
      // page returns to the approvals list, not the locked-editor screen.
      navigate(`/plans/${id}`, { replace: true })
    } catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  async function regenerate() {
    if (!window.confirm(t('editor.regenerateConfirm'))) return
    setBusy('regen')
    setError(null)
    try {
      // strip UI-only fields stored alongside the questionnaire payload
      const { goal, planStyle, allergyNames, conditionNames, ...q } = row.questionnaire
      q.conditionIdSet = []
      q.allergyIdSet = []
      // Catalog generator (same as NewPlan): meals are scaled to per-meal targets
      // that sum to the goal-adjusted daily total, and restrictions are applied
      // via ingredient swaps — so the header always matches the meal totals.
      const { plan: model, apiResponse, substitutions } = await generateCatalogPlan(q, {
        allergyNames: row.questionnaire?.allergyNames || [],
        conditionNames: row.questionnaire?.conditionNames || [],
      }, {
        fullName: plan.header.fullName,
        dob: plan.header.dob,
        dailyKcal: goalAdjustedKcal(q.kilocalorieNeeded, goal),
        goalText: plan.header.dietType,
      })
      model.header.nextCheckup = plan.header.nextCheckup
      model.dietary = { substitutions } // silent audit trail
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
    <div className="editor-page">
      <div className="editor-toolbar row between">
        <div className="row">
          <BackButton />
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
          {/* per-meal add buttons */}
          <div className="card">
            {plan.meals.map((meal) => (
              <div className="row between" key={meal.id} style={{ marginBottom: 6 }}>
                <b>{t(`meal.${meal.id}`)}</b>
                <div className="row">
                  <input type="number" style={{ width: 90 }} value={meal.targetKcal ?? ''}
                    placeholder={t('editor.mealTargetKcal')}
                    onChange={(e) => mutate((p) => {
                      p.meals.find((m) => m.id === meal.id).targetKcal = parseInt(e.target.value) || null
                    })} />
                  <button className="btn ghost sm"
                    disabled={meal.options.length >= MAX_OPTIONS_PER_MEAL}
                    onClick={() => setPicker(meal.id)}>
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
              lang={previewLang}
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

      {picker && (
        <MealPicker
          mealLabel={t(`meal.${picker}`)}
          slot={picker}
          diet={row.questionnaire?.dietaryTypeId || ''}
          targetKcal={plan.meals.find((m) => m.id === picker)?.targetKcal || mealTargetKcal(picker, plan.header?.dailyKcal)}
          used={new Set(plan.meals.flatMap((m) => m.options.map((o) => (o.name_en || '').trim().toLowerCase())))}
          allergyNames={row.questionnaire?.allergyNames || []}
          conditionNames={row.questionnaire?.conditionNames || []}
          onPick={(opt) => addOption(picker, opt)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}

// Searchable catalog of the gym's real meals (src/data/mealCatalog.json).
// Picking one inserts a fully-populated option; "blank" starts a manual one.
function MealPicker({ mealLabel, slot, diet, targetKcal, used, allergyNames, conditionNames, onPick, onClose }) {
  const { t, lang } = useI18n() // follow the site language, not the plan-preview toggle
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()

  // Vet every catalog meal against the client's conditions/allergies: build the
  // option, scale its quantities/macros to this meal's calorie target (like the
  // API does), apply safe ingredient swaps, and drop any dish that still has an
  // unsuitable ingredient with no safe alternative. `opt` is the final result.
  const vetted = useMemo(() => {
    const tokens = canonicalTokens([...(allergyNames || []), ...(conditionNames || [])])
    return mealCatalog.map((entry) => {
      const opt = scaleOptionToKcal(optionFromCatalog(entry), targetKcal)
      const { swaps, conflicts } = tokens.size ? processOption(opt, tokens) : { swaps: [], conflicts: [] }
      return { entry, opt, swaps, safe: conflicts.length === 0 }
    })
  }, [allergyNames, conditionNames, targetKcal])

  // Show only meals valid for this slot AND the client's dietary type (empty
  // categories/diets = allowed anywhere, until harvested); hide unfixable meals
  // and ones already in the plan.
  const available = vetted.filter((v) =>
    v.safe &&
    !used?.has((v.entry.name_en || '').trim().toLowerCase()) &&
    (!v.entry.categories?.length || v.entry.categories.includes(slot)) &&
    (!diet || !v.entry.diets?.length || v.entry.diets.includes(diet)))
  // Realistic portions first: dishes whose scaled serving fits the weight cap
  // keep alphabetical order; oversized ones (for this meal's calories) sink down.
  available.sort((a, b) => {
    const oa = optionWeight(a.opt) > MEAL_WEIGHT_CAP, ob = optionWeight(b.opt) > MEAL_WEIGHT_CAP
    if (oa !== ob) return oa ? 1 : -1
    if (oa) return optionWeight(a.opt) - optionWeight(b.opt)
    return 0
  })
  const results = query
    ? available.filter(({ entry }) =>
        entry.name_en.toLowerCase().includes(query) || (entry.name_ar || '').includes(q.trim()))
    : available
  const g = (v) => `${arDigits(v, lang)}${lang === 'ar' ? ' غرام' : 'g'}`
  const macroLine = (mac) => [
    mac.protein != null && `${t('editor.protein')} ${g(mac.protein)}`,
    mac.carbs != null && `${t('editor.carbs')} ${g(mac.carbs)}`,
    mac.fats != null && `${t('editor.fats')} ${g(mac.fats)}`,
  ].filter(Boolean).join(' · ')

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card meal-picker" onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>{t('editor.pickMealFor', { meal: mealLabel })}</h2>
          <button className="btn ghost sm" onClick={onClose}>✕</button>
        </div>
        <input type="text" autoFocus placeholder={t('editor.searchMeals')}
          value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: '0.75rem' }} />
        <div className="meal-picker-list">
          {results.length === 0 && <div className="muted small">{t('editor.noMealsFound')}</div>}
          {results.map(({ entry: m, opt, swaps }) => {
            const name = lang === 'ar' && m.name_ar ? m.name_ar : m.name_en
            return (
              <button key={m.id} className="meal-picker-item" onClick={() => onPick(opt)}>
                <div className="row between">
                  <b>{name}</b>
                  <span className="muted small">{arDigits(opt.kcal, lang)} {lang === 'ar' ? 'كيلو سعرة' : 'kcal'}</span>
                </div>
                <div className="muted small">
                  {t('editor.ingredientsCount', { count: arDigits(m.ingredientCount, lang) })}
                  {macroLine(opt.macros) ? ` · ${macroLine(opt.macros)}` : ''}
                  {swaps.length > 0 && <span> · {t('editor.autoAdjusted')}</span>}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Single-page render for thumbnails: the template renders only the requested
// page (pages can exceed 842px, so margin-based slicing was unreliable).
function ThumbPage({ plan, pageIndex, lang, gym }) {
  return <DeepFitTemplate plan={plan} lang={lang} gym={gym} only={pageIndex} />
}

function OptionInspector({ t, lang, meal, option, kcalWarn, updateOption, mutate, selection, setSelection }) {
  const idx = meal.options.findIndex((o) => o.id === option.id)
  // Edit only the currently-previewed language's fields (the other language is
  // preserved untouched behind the scenes).
  const ar = lang === 'ar'
  const nameKey = ar ? 'name_ar' : 'name_en'
  const descKey = ar ? 'desc_ar' : 'desc_en'
  const ingKey = ar ? 'name_ar' : 'name_en'
  const dir = ar ? 'rtl' : 'ltr'

  const move = (dir) => mutate((p) => {
    const m = p.meals.find((x) => x.id === meal.id)
    const i = m.options.findIndex((o) => o.id === option.id)
    const j = i + dir
    if (j < 0 || j >= m.options.length) return
    ;[m.options[i], m.options[j]] = [m.options[j], m.options[i]]
  })

  const num = (n) => arDigits(Math.round(n ?? 0), lang)
  // Re-portion the whole option: scale grams + macros + kcal by one factor so
  // they stay consistent (macros are stored per dish, not per ingredient, so a
  // single scale is the only accurate way to change the serving size).
  const rescale = (mult) => updateOption((o) => {
    const target = Math.max(50, Math.round((o.kcal || 0) * mult))
    const s = scaleOptionToKcal(o, target)
    o.ingredients = s.ingredients
    o.macros = s.macros
    o.kcal = s.kcal
  })

  return (
    <div className="card">
      <div className="row between">
        <h3>{t(`meal.${meal.id}`)} · {t('editor.option')} {idx + 1}</h3>
        <div className="row">
          <button className="btn ghost sm" title={t('editor.moveUp')} onClick={() => move(-1)}>↑</button>
          <button className="btn ghost sm" title={t('editor.moveDown')} onClick={() => move(1)}>↓</button>
        </div>
      </div>

      {kcalWarn && (
        <Alert kind="warn">{t('editor.kcalWarning', { est: kcalWarn.estimated, stated: kcalWarn.stated })}</Alert>
      )}

      {/* Name and description are read-only too — they come from the meal
          database; the nutritionist picks and portions, they don't rewrite. */}
      <Field label={t('editor.optionName')}>
        <p className="readonly-text" dir={dir}>{option[nameKey] || option.name_en || '—'}</p>
      </Field>
      {(option[descKey] || option.desc_en) && (
        <Field label={t('editor.optionDesc')}>
          <p className="readonly-text muted" dir={dir}>{option[descKey] || option.desc_en}</p>
        </Field>
      )}

      {/* Portion: scale the whole option (grams + macros + kcal move together by
          a single factor — the only accurate way to re-portion, since macros are
          stored per dish, not per ingredient). */}
      <h3 style={{ marginTop: '0.9rem' }}>{t('editor.portion')}</h3>
      <div className="portion-control">
        <button className="btn ghost sm" title={t('editor.smaller')}
          disabled={!option.kcal} onClick={() => rescale(0.9)}>−</button>
        <span className="portion-kcal">{num(option.kcal)} {t('editor.kcal')}</span>
        <button className="btn ghost sm" title={t('editor.larger')}
          disabled={!option.kcal} onClick={() => rescale(1.1)}>＋</button>
      </div>

      {/* Ingredients and macros are read-only — they come from the meal database
          and are kept consistent by the portion scaler above. */}
      <h3 style={{ marginTop: '0.9rem' }}>{t('editor.ingredients')}</h3>
      <ul className="readonly-list" dir={dir}>
        {option.ingredients.map((ing, i) => (
          <li key={i}><span>{ing[ingKey] || ing.name_en}</span><span className="muted">{formatAmount(ing, lang)}</span></li>
        ))}
      </ul>

      <h3 style={{ marginTop: '0.9rem' }}>{t('editor.macros')}</h3>
      <div className="readonly-macros">
        {[['protein', 'editor.protein'], ['carbs', 'editor.carbs'], ['fats', 'editor.fats']].map(([k, lk]) => (
          <div key={k}><span className="muted small">{t(lk)}</span><b>{option.macros[k] != null ? `${num(option.macros[k])} ${t('editor.grams')}` : '—'}</b></div>
        ))}
      </div>

      <div className="row end" style={{ marginTop: '1rem' }}>
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
