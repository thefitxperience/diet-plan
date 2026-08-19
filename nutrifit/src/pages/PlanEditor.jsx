// Plan editor (plan §5): canvas of true-proportion pages, thumbnail rail,
// contextual inspector. Structured editing — edits mutate the plan model,
// the template re-renders.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { Field, Alert, Loading, Spinner, StatusBadge, BackButton } from '../components/ui'
import DeepFitTemplate, { planPageList, MEAL_PRESENTATION } from '../components/DeepFitTemplate'
import {
  blankOption, optionFromCatalog, scaleOptionToKcal, mealTargetKcal,
  optionWeight, MEAL_WEIGHT_CAP, kcalWarning, allergenWarnings, MAX_OPTIONS_PER_MEAL,
  goalAdjustedKcal, recomputeOptionNutrition, ingredientHasMeta, KNOWN_INGREDIENTS,
  mealTargetsFor, validatePlan, GOAL_KCAL_SHIFT, planCalorieWarnings, MIN_SAFE_KCAL,
  stampPlanChecks,
} from '../lib/planModel'
import { canonicalTokens, processOption } from '../lib/dietaryRules'
import { GOAL_LABELS, activityDisplayName } from '../lib/fitApi'
import mealCatalog from '../data/mealCatalog.json'
import { arDigits } from '../lib/digits'
import { generateCatalogPlan } from '../lib/planGenerator'
import { renderPlanPdf, downloadBlob } from '../lib/pdfExport'
import { useAuth } from '../auth/AuthProvider'
import { listCustomMeals, saveCustomMeal } from '../lib/customMeals'

const EDITABLE = ['DRAFT', 'GENERATED', 'IN_REVIEW', 'CHANGES_REQUESTED']

export default function PlanEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const { profile } = useAuth()
  const [row, setRow] = useState(null)
  const [gym, setGym] = useState(null)
  const [plan, setPlan] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [selection, setSelection] = useState(null) // { mealId, optionId }
  const [picker, setPicker] = useState(null) // mealId currently choosing a meal for
  const [previewLang, setPreviewLang] = useState('en')
  const [busy, setBusy] = useState(null) // 'save' | 'submit' | 'regen' | 'pdf'
  const [notice, setNotice] = useState(null)
  // Success messages ("Meals rebalanced…", "Saved") are confirmations, not things
  // to act on, so they clear themselves. Errors and the review panel stay put.
  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(id)
  }, [notice])
  const [error, setError] = useState(null)
  const [customMeals, setCustomMeals] = useState([]) // gym's reusable saved meals
  const [savedIds, setSavedIds] = useState(() => new Set()) // options saved this session
  const [approving, setApproving] = useState(false) // sign-off dialog open
  const [noticesOpen, setNoticesOpen] = useState(true) // review panel collapsed?
  const [approval, setApproval] = useState({ name: '', title: '', registration: '', note: '' })
  // Practitioner's own minimum target (dietitian review item 11). NULL on the
  // profile means fall back to the application default.
  const [floorKcal, setFloorKcal] = useState(MIN_SAFE_KCAL)
  useEffect(() => { setFloorKcal(profile?.min_kcal || MIN_SAFE_KCAL) }, [profile])
  async function saveFloor(v) {
    const n = parseInt(v, 10)
    if (!Number.isFinite(n)) return
    const clamped = Math.min(4000, Math.max(800, n))
    setFloorKcal(clamped)
    // Best-effort: the warning threshold is a preference, so a failure here must
    // not block plan editing.
    await supabase.from('profiles').update({ min_kcal: clamped }).eq('id', profile.id)
  }
  // ── Preview scale and pane visibility (dietitian review §3) ──────────────
  // The preview used to render a 595px A4 page inside a ~500px column, so it
  // needed horizontal scrolling; and all three panes had their own overflow,
  // giving three competing scrollbars. Now: fit-to-width by default, one
  // document scroll, and both side panes collapsible (choice remembered).
  const PREVIEW_SCALE = 1.25
  const pref = (k, d) => {
    try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d }
  }
  const [showThumbs, setShowThumbs] = useState(() => pref('nf.editor.thumbs', false))
  const [showInspector, setShowInspector] = useState(() => pref('nf.editor.inspector', true))
  const [fitScale, setFitScale] = useState(1)
  const [exporting, setExporting] = useState(false)
  useEffect(() => { try { localStorage.setItem('nf.editor.thumbs', JSON.stringify(showThumbs)) } catch {} }, [showThumbs])
  useEffect(() => { try { localStorage.setItem('nf.editor.inspector', JSON.stringify(showInspector)) } catch {} }, [showInspector])

  // Measure the preview column so "Fit width" tracks pane collapse and resizing.
  const canvasRef = useRef()
  useEffect(() => {
    const el = canvasRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      // clientWidth includes the canvas padding, so take it off — otherwise
      // "fit width" overshoots by 40px and reintroduces horizontal scrolling.
      const cs = getComputedStyle(el)
      const w = el.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0)
      if (w > 0) setFitScale(Math.min(1.5, Math.max(0.5, w / 595)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [showThumbs, showInspector])
  // Fixed 125% preview. Capped by the measured width so a narrower window can't
  // push the page wider than the column and bring back horizontal scrolling.
  // Never scale during export — html2canvas would capture the rendered size.
  const scale = exporting ? 1 : Math.min(PREVIEW_SCALE, fitScale)
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
      // Load the gym's saved custom meals for the picker (table may not exist yet
      // until migration 012 is applied — fail soft so the editor still works).
      try { setCustomMeals(await listCustomMeals(p.gym_id)) } catch { /* no-op */ }
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

  // Pre-export sanity checks (header vs meal totals, option spread, macros,
  // units). Non-blocking — shown as a panel and echoed in the sign-off dialog.
  const validation = useMemo(() => (plan ? validatePlan(plan) : []), [plan])

  // Clinical sanity checks on the calorie target itself. These previously only
  // ran in the new-plan wizard, so a target below the safe floor reached approval
  // with nothing flagged — which is how a 1,195 kcal plan got through.
  const calorieWarnings = useMemo(() => {
    if (!plan) return []
    const a = plan.assessment || {}
    const goal = a.goal
      || Object.keys(GOAL_LABELS).find((k) => GOAL_LABELS[k] === plan.header?.dietType)
      || 'maintain'
    return planCalorieWarnings({
      bmr: a.bmr || 0,
      multiplier: a.activityMultiplier || 0,
      goal,
      targetKcal: plan.header?.dailyKcal || 0,
      maintenanceKcal: a.maintenanceKcal || 0,
      floor: floorKcal,
    })
  }, [plan, floorKcal])

  const belowFloor = calorieWarnings.some((w) => w.code === 'belowFloor')

  // Bring the selected meal's page into view only when it isn't already — with
  // block:'nearest' this is a no-op if visible, so the preview never jumps.
  useEffect(() => {
    if (!selection || !plan) return
    const idx = planPageList(plan).findIndex((pg) => pg.mealId === selection.mealId)
    if (idx >= 0) pageEls.current[idx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    // only react to which meal is selected, not to every option click
  }, [selection?.mealId])

  // Everything needing attention, as one list. Each allergen and each calorie
  // warning used to render its own panel, so a plan with a few issues stacked
  // five or six boxes above the preview. Grouped, ordered most serious first.
  const notices = [
    ...warnings.allergen.map((w) => ({
      group: 'safety',
      text: t('editor.allergenWarning', { ingredient: w.ingredient, allergy: w.allergy }),
    })),
    ...calorieWarnings.map((w) => ({ group: 'calories', text: t(`wizard.warn.${w.code}`, w) })),
    ...validation.map((v) => ({ group: 'checks', text: t(`editor.check.${v.code}`, v) })),
  ]

  // If a new problem appears while the panel is collapsed, open it again — a
  // clinical warning must never be hidden by an earlier collapse.
  const noticeCount = notices.length
  const prevNoticeCount = useRef(0)
  useEffect(() => {
    if (noticeCount > prevNoticeCount.current) setNoticesOpen(true)
    prevNoticeCount.current = noticeCount
  }, [noticeCount])


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

  // Save the edited option as a reusable meal for this gym (custom_meals table).
  async function saveCustom(option, mealId) {
    setError(null)
    try {
      const entry = await saveCustomMeal({
        gymId: row.gym_id,
        createdBy: profile?.id,
        slot: mealId,
        option,
        diets: row.questionnaire?.dietaryTypeId ? [row.questionnaire.dietaryTypeId] : [],
      })
      setCustomMeals((prev) => [entry, ...prev])
      setSavedIds((prev) => new Set(prev).add(option.id))
      setNotice(t('editor.mealSaved'))
    } catch (e) { setError(e.message) }
  }

  const setHeader = (key, val) => mutate((p) => { p.header[key] = val })

  // Item 13 — keep an audit trail of the calorie decision. The first time the
  // target is changed we stash what the system originally recommended, so the
  // plan always carries both figures plus who changed it and when.
  function setDailyTarget(val) {
    mutate((p) => {
      const before = p.header.dailyKcal || 0
      if (val === before) return
      p.calorieAudit = {
        recommended: p.calorieAudit?.recommended ?? (p.assessment?.recommendedKcal || before),
        approved: val,
        changedBy: profile?.full_name || '',
        changedAt: new Date().toISOString().slice(0, 10),
        note: p.calorieAudit?.note || '',
      }
      p.header.dailyKcal = val
    })
  }

  // Recompute every meal's per-option target from the daily total and rescale all
  // options to it, so the plan re-balances to the header calories in one action.
  function applyDistribution() {
    mutate((p) => {
      const targets = mealTargetsFor(p.meals, p.header.dailyKcal || 0)
      for (const m of p.meals) {
        const tgt = targets[m.id] || m.targetKcal || 0
        m.targetKcal = tgt
        if (tgt) m.options = m.options.map((o) => scaleOptionToKcal(o, tgt))
      }
    })
    setNotice(t('editor.distributed'))
  }

  // Item 12 — after the target changes the dietitian must choose explicitly:
  // rebalance every meal, or keep their manual allocations and adjust by hand.
  const targetOutOfSync = (() => {
    const d = plan?.header?.dailyKcal || 0
    if (!d || !plan?.meals?.length) return false
    const sum = plan.meals.reduce((acc, m) => acc + ((m.options[0]?.kcal || 0) * (m.id === 'snack' ? 2 : 1)), 0)
    return Math.abs(sum - d) > Math.max(60, d * 0.05)
  })()

  function addMeal() {
    mutate((p) => {
      const n = p.meals.filter((m) => String(m.id).startsWith('custom_')).length + 1
      p.meals.push({
        id: `custom_${n}_${Math.random().toString(36).slice(2, 6)}`,
        title: { main: t('editor.newMealTitle', { n }), sub: t('editor.chooseOne') },
        icon: 'Snack.png',
        targetKcal: mealTargetKcal('snack', p.header.dailyKcal || 0) || null,
        options: [],
      })
    })
  }

  function removeMeal(mealId) {
    if (!window.confirm(t('editor.removeMealConfirm'))) return
    mutate((p) => { p.meals = p.meals.filter((m) => m.id !== mealId) })
    if (selection?.mealId === mealId) setSelection(null)
  }

  const renameMeal = (mealId, part, val) => mutate((p) => {
    const m = p.meals.find((x) => x.id === mealId)
    if (!m) return
    // Seed from the current effective title (existing override, else the preset
    // default) so editing one part never wipes the other's default value.
    const preset = MEAL_PRESENTATION[p.isIF ? 'if' : 'regular'][mealId] || {}
    const base = m.title || { main: preset.title?.main || t(`meal.${mealId}`), sub: preset.title?.sub || '' }
    m.title = { ...base, [part]: val }
  })

  async function saveDraft() {
    setBusy('save')
    setError(null)
    try {
      // Re-stamp the verdict: an edit can introduce or clear an issue, and the
      // auto-approval job trusts this stamp.
      const toSave = stampPlanChecks(JSON.parse(JSON.stringify(plan)), row.questionnaire?.allergyNames || [])
      const { data: saved, error: e } = await supabase.from('plans')
        .update({ plan_data: toSave }).eq('id', id).select('id')
      if (e) throw e
      if (!saved?.length) throw new Error(t('editor.saveRejected'))
      if (row.status !== 'IN_REVIEW') {
        const { error: e2 } = await supabase.rpc('transition_plan', { p_plan_id: id, p_action: 'edited' })
        if (e2) throw e2
        setRow({ ...row, status: 'IN_REVIEW', plan_data: plan })
      } else {
        await supabase.rpc('log_plan_event', { p_plan_id: id, p_action: 'edited', p_comment: 'saved draft' })
        setRow({ ...row, plan_data: plan })
      }
      setDirty(false)
      setNotice(t('editor.saved'))
    } catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  // Open the sign-off dialog, prefilling the dietitian's name from their profile.
  function openApproval() {
    setApproval({
      name: plan.approval?.name || profile?.full_name || '',
      title: plan.approval?.title || '',
      registration: plan.approval?.registration || '',
      note: plan.approval?.note || '',
    })
    setApproving(true)
  }

  async function submit() {
    setBusy('submit')
    setError(null)
    try {
      // Stamp the dietitian sign-off (name/title/registration/note + today's date).
      const stamped = JSON.parse(JSON.stringify(plan))
      stamped.approval = { ...approval, date: new Date().toISOString().slice(0, 10) }
      // Keep the clinical rationale with the calorie decision, not only the sign-off.
      if (stamped.calorieAudit) stamped.calorieAudit.note = approval.note || ''
      stampPlanChecks(stamped, row.questionnaire?.allergyNames || [])
      // .select() so an RLS-rejected write (zero rows, no error) can't leave the
      // plan approved and deliverable with no sign-off block on the PDF.
      const { data: saved, error: e } = await supabase.from('plans')
        .update({ plan_data: stamped }).eq('id', id).select('id')
      if (e) throw e
      if (!saved?.length) throw new Error(t('editor.saveRejected'))
      const { error: e2 } = await supabase.rpc('transition_plan', { p_plan_id: id, p_action: 'submitted' })
      if (e2) throw e2
      // Replace the (now locked) editor entry so "back" from the plan/delivery
      // page returns to the approvals list, not the locked-editor screen.
      navigate(`/plans/${id}`, { replace: true })
    } catch (e) { setError(e.message); setBusy(null); setApproving(false) }
  }

  async function regenerate() {
    if (!window.confirm(t('editor.regenerateConfirm'))) return
    setBusy('regen')
    setError(null)
    try {
      // strip UI-only fields stored alongside the questionnaire payload
      const { goal: qGoal, planStyle, allergyNames, conditionNames, ...q } = row.questionnaire || {}
      q.conditionIdSet = []
      q.allergyIdSet = []

      // Older and seeded plans stored only allergy/condition names, so the goal
      // and calorie target are missing. Recover them from the plan on screen
      // rather than regenerating against a target of 0 — which silently yields a
      // plan with no daily total and minimum-size portions.
      const goal = qGoal || plan.assessment?.goal ||
        Object.keys(GOAL_LABELS).find((k) => GOAL_LABELS[k] === plan.header.dietType) || 'maintain'
      if (!q.kilocalorieNeeded) {
        // header.dailyKcal is already goal-adjusted; undo the shift to recover
        // the maintenance figure the generator expects.
        const daily = plan.assessment?.maintenanceKcal ||
          (plan.header.dailyKcal ? plan.header.dailyKcal - (GOAL_KCAL_SHIFT[goal] || 0) : 0)
        q.kilocalorieNeeded = daily
      }
      if (!q.kilocalorieNeeded) throw new Error(t('editor.regenerateNoTarget'))
      if (!q.dietaryTypeId) q.dietaryTypeId = ''            // no diet filter
      if (!q.secondaryTypeId) q.secondaryTypeId = plan.isIF ? 'IntermittentFasting' : 'Regular'
      // Catalog generator (same as NewPlan): meals are scaled to per-meal targets
      // that sum to the goal-adjusted daily total, and restrictions are applied
      // via ingredient swaps — so the header always matches the meal totals.
      const { plan: model, apiResponse, substitutions } = await generateCatalogPlan(q, {
        allergyNames: row.questionnaire?.allergyNames || [],
        conditionNames: row.questionnaire?.conditionNames || [],
        dislikedIngredients: row.questionnaire?.dislikes || [],
      }, {
        fullName: plan.header.fullName,
        dob: plan.header.dob,
        dailyKcal: goalAdjustedKcal(q.kilocalorieNeeded, goal),
        goalText: plan.header.dietType || GOAL_LABELS[goal],
        goal,
        // The activity lookups aren't loaded here; carry forward the factor the
        // plan was first generated with so the assessment summary survives.
        activityMultiplier: plan.assessment?.activityMultiplier || 0,
        // Advance the rotation so this produces a different selection than the
        // plan currently on screen — generation is otherwise deterministic.
        variant: (plan.variant || 0) + 1,
      })
      model.header.nextCheckup = plan.header.nextCheckup
      model.dietary = { substitutions } // silent audit trail
      stampPlanChecks(model, row.questionnaire?.allergyNames || [])
      // .select() so a write that matched no rows (blocked by RLS — wrong role,
      // another gym, or a status that is no longer editable) is not mistaken for
      // success and silently discarded.
      const { data: saved, error: e } = await supabase.from('plans')
        .update({ plan_data: model, api_response: apiResponse }).eq('id', id).select('id')
      if (e) throw e
      if (!saved?.length) throw new Error(t('editor.saveRejected'))
      const { error: e2 } = await supabase.rpc('transition_plan', { p_plan_id: id, p_action: 'generated' })
      if (e2) throw e2
      setPlan(model)
      setRow({ ...row, status: 'GENERATED' })
      setSelection(null)
      setDirty(false)
    } catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  async function previewPdf() {
    setBusy('pdf')
    // Capture at 1:1 — html2canvas reads the rendered size, so a zoomed preview
    // would otherwise be baked into the PDF.
    setExporting(true)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    try {
      const blob = await renderPlanPdf(canvasRef.current)
      downloadBlob(blob, `${plan.header.fullName || 'Client'} - Diet Plan.pdf`)
    } catch (e) { setError(e.message) } finally { setExporting(false); setBusy(null) }
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
          {/* View controls: pane toggles + preview scale. */}
          <div className="editor-view-controls">
            <button className={`btn ghost sm${showThumbs ? ' on' : ''}`} onClick={() => setShowThumbs(!showThumbs)}
              title={t('editor.togglePages')}>{t('editor.pagesShort')}</button>
            <button className={`btn ghost sm${showInspector ? ' on' : ''}`} onClick={() => setShowInspector(!showInspector)}
              title={t('editor.toggleEditor')}>{t('editor.editorShort')}</button>
          </div>
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
          <button className="btn sm" onClick={openApproval} disabled={!!busy}>
            {busy === 'submit' ? <Spinner /> : t('editor.submit')}
          </button>
        </div>
      </div>

      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{notice}</Alert>
      {notices.length > 0 && (
        <Alert kind="warn">
          <div className="notice-head">
            <b>{t('editor.noticesTitle', { count: notices.length })}</b>
            <button type="button" className={`notice-toggle${noticesOpen ? ' open' : ''}`}
              onClick={() => setNoticesOpen(!noticesOpen)}
              aria-expanded={noticesOpen}
              title={t(noticesOpen ? 'editor.hideNotices' : 'editor.showNotices')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
          {noticesOpen && ['safety', 'calories', 'checks'].map((g) => {
            const items = notices.filter((n) => n.group === g)
            if (!items.length) return null
            const shown = items.slice(0, 6)
            return (
              <div className="notice-group" key={g}>
                <span className="notice-group-label">{t(`editor.noticeGroup.${g}`)}</span>
                <ul>
                  {shown.map((n, i) => <li key={i}>{n.text}</li>)}
                  {items.length > shown.length && (
                    <li className="muted">{t('editor.checkMore', { n: items.length - shown.length })}</li>
                  )}
                </ul>
              </div>
            )
          })}
        </Alert>
      )}


      <div className="editor-shell" style={{
        gridTemplateColumns: `${showThumbs ? '117px ' : ''}minmax(0, 1fr)${showInspector ? ' 340px' : ''}`,
      }}>
        {/* thumbnails — collapsed by default; the pages scroll continuously so
            this is an optional navigation aid, not the primary way to move. */}
        {showThumbs && (
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
        )}

        {/* canvas — no scroll container of its own: the page scrolls as one */}
        <div className="editor-canvas" ref={canvasRef}>
          <div className="editor-pages" style={{ zoom: scale }}>
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
        </div>

        {/* inspector */}
        {showInspector && (
        <div className="editor-inspector">
          <ClientCard t={t} q={row.questionnaire || {}} />
          <PlanSettings
            t={t} plan={plan} setHeader={setHeader} applyDistribution={applyDistribution}
            addMeal={addMeal} removeMeal={removeMeal} renameMeal={renameMeal}
            setDailyTarget={setDailyTarget} floorKcal={floorKcal} saveFloor={saveFloor}
            targetOutOfSync={targetOutOfSync}
            mutate={mutate} setPicker={setPicker}
          />

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
              setSelection={setSelection}
              onSaveCustom={saveCustom}
              saved={savedIds.has(selOption.id)}
            />
          )}
        </div>
        )}
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
          customMeals={customMeals}
          onPick={(opt) => addOption(picker, opt)}
          onClose={() => setPicker(null)}
        />
      )}

      {approving && (
        <div className="modal-overlay" onClick={() => !busy && setApproving(false)}>
          <div className="modal-card approval-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="approval-head">
              <div>
                <h2 style={{ margin: 0 }}>{t('editor.approveTitle')}</h2>
                <p className="muted small" style={{ margin: '2px 0 0' }}>{t('editor.approveSubtitle')}</p>
              </div>
              <button className="btn ghost sm" onClick={() => setApproving(false)}>✕</button>
            </div>

            <div className="approval-body">
              {validation.length > 0 && (
                <Alert kind="warn">{t('editor.approveChecks', { count: validation.length })}</Alert>
              )}
              {/* Item 11 — a target under the practitioner's own minimum must be
                  shown here and can only be approved with a written reason. */}
              {belowFloor && (
                <Alert kind="warn">
                  {t('editor.belowFloorApprove', { target: plan.header.dailyKcal, floor: floorKcal })}
                </Alert>
              )}
              <Field label={t('editor.approverName')}>
                <input type="text" autoFocus value={approval.name}
                  onChange={(e) => setApproval({ ...approval, name: e.target.value })} />
              </Field>
              <div className="grid cols-2">
                <Field label={t('editor.approverTitle')}>
                  <input type="text" value={approval.title} placeholder={t('editor.approverTitleHint')}
                    onChange={(e) => setApproval({ ...approval, title: e.target.value })} />
                </Field>
                <Field label={t('editor.approverReg')}>
                  <input type="text" value={approval.registration}
                    onChange={(e) => setApproval({ ...approval, registration: e.target.value })} />
                </Field>
              </div>
              <Field label={belowFloor ? t('editor.overrideReason') : t('editor.approverNote')}
                hint={belowFloor ? t('editor.overrideReasonHint') : undefined}>
                <textarea rows={2} value={approval.note}
                  onChange={(e) => setApproval({ ...approval, note: e.target.value })} />
              </Field>
              <p className="muted small approval-date-note">
                {t('editor.approveDateNote', { date: new Date().toISOString().slice(0, 10) })}
              </p>
            </div>

            <div className="approval-foot">
              <button className="btn secondary" onClick={() => setApproving(false)} disabled={!!busy}>{t('common.cancel')}</button>
              <button className="btn" onClick={submit}
                disabled={!!busy || !approval.name.trim() || (belowFloor && !approval.note.trim())}>
                {busy === 'submit' ? <Spinner /> : t('editor.approveSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Client questionnaire + a prominent conditions/allergies highlight so the
// dietitian can verify the inputs the plan was generated from (review §4.1, §5).
function ClientCard({ t, q }) {
  const { lang } = useI18n()
  const conditions = q.conditionNames || []
  const allergies = q.allergyNames || []
  const flagged = conditions.length > 0 || allergies.length > 0
  // FIT enum ids arrive as e.g. "AltModeratelyActive": split the camel case and
  // drop the API's "Alt" prefix so they read as words.
  const pretty = (s) => String(s || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^alt\s+/i, '')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
  // Show the same wording the dietitian picked in the wizard, so the
  // questionnaire can actually be checked against what was selected.
  const activity = () => {
    const words = pretty(q.activityLevelTypeEnumId)
    return words ? activityDisplayName(words, lang) : ''
  }
  const rows = [
    ['qGoal', GOAL_LABELS[q.goal] || pretty(q.goal)],
    ['qDiet', [q.dietaryTypeId, q.secondaryTypeId === 'IntermittentFasting' ? t('editor.if') : ''].filter(Boolean).join(' · ')],
    ['qActivity', activity()],
    ['qAgeGender', [q.age, pretty(q.gender)].filter((v) => v || v === 0).join(' · ')],
    ['qDislikes', (q.dislikes || []).join(' · ')],
    ['qBmr', q.bmr ? `${q.bmr} kcal` : ''],
    ['qTdee', q.kilocalorieNeeded ? `${q.kilocalorieNeeded} kcal` : ''],
  ].filter(([, v]) => v)

  return (
    <div className="card client-card">
      <div className={`client-flags${flagged ? ' has-flags' : ''}`}>
        <div><span className="muted small">{t('editor.reportedConditions')}: </span>{conditions.length ? conditions.join(', ') : t('editor.noneReported')}</div>
        <div><span className="muted small">{t('editor.reportedAllergies')}: </span>{allergies.length ? allergies.join(', ') : t('editor.noneReported')}</div>
      </div>
      <details className="client-details">
        <summary>{t('editor.questionnaire')}</summary>
        <div className="client-grid">
          {rows.map(([k, v]) => (
            <div key={k}><span className="muted small">{t(`editor.${k}`)}</span><span>{v}</span></div>
          ))}
        </div>
      </details>
    </div>
  )
}

// Site-styled ingredient autocomplete (replaces the native <datalist>). Filters
// the known-ingredient list; Enter or click adds it.
function AddIngredient({ t, onAdd }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const query = q.trim().toLowerCase()
  const matches = query
    ? KNOWN_INGREDIENTS.filter((k) => k.name_en.toLowerCase().includes(query)).slice(0, 8)
    : []
  const add = (name) => { onAdd(name); setQ(''); setOpen(false); setHi(0) }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); add(open && matches[hi] ? matches[hi].name_en : q) }
    else if (e.key === 'Escape') setOpen(false)
  }
  return (
    <div className="ingredient-add">
      <div className="row" style={{ gap: 6 }}>
        <input type="text" placeholder={t('editor.addIngredient')} value={q} style={{ flex: 1 }}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey} />
        <button className="btn ghost sm" onClick={() => add(q)}>＋</button>
      </div>
      {open && matches.length > 0 && (
        <ul className="ingredient-dropdown">
          {matches.map((k, i) => (
            <li key={k.name_en}>
              <button type="button" className={`ingredient-dropdown-item${i === hi ? ' active' : ''}`}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => { e.preventDefault(); add(k.name_en) }}>
                {k.name_en}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Plan-level controls: daily target + redistribution, follow-up date, and meal
// management (rename / target / add option / remove / add meal).
function PlanSettings({ t, plan, setHeader, setDailyTarget, applyDistribution, addMeal, removeMeal, renameMeal, mutate, setPicker, floorKcal, saveFloor, targetOutOfSync }) {
  const daily = plan.header.dailyKcal || 0

  // Both calorie boxes keep a local draft while typing. Committing on blur (not
  // per keystroke) means a half-typed or cleared value is never rejected mid-edit
  // and never written to the plan — the previous number is restored instead.
  const [dailyDraft, setDailyDraft] = useState(String(daily || ''))
  const [floorDraft, setFloorDraft] = useState(String(floorKcal || ''))
  useEffect(() => { setDailyDraft(String(plan.header.dailyKcal || '')) }, [plan.header.dailyKcal])
  useEffect(() => { setFloorDraft(String(floorKcal || '')) }, [floorKcal])
  const digits = (v) => v.replace(/[^0-9]/g, '')

  function commitDaily() {
    const n = parseInt(dailyDraft, 10)
    if (!Number.isFinite(n) || n <= 0) { setDailyDraft(String(daily || '')); return }
    setDailyTarget(n)
  }
  function commitFloor() {
    const n = parseInt(floorDraft, 10)
    if (!Number.isFinite(n)) { setFloorDraft(String(floorKcal || '')); return }
    const clamped = Math.min(4000, Math.max(800, n))
    setFloorDraft(String(clamped))
    saveFloor(clamped)
  }

  // What the client can actually land on depending on which options they pick
  // (review §2.4 / §11): recommended = first option per meal, min/max = the
  // lightest/heaviest, snacks counted twice.
  const range = plan.meals.reduce((acc, m) => {
    if (!m.options.length) return acc
    const mult = m.id === 'snack' ? 2 : 1
    const kcals = m.options.map((o) => o.kcal || 0)
    acc.exp += (m.options[0].kcal || 0) * mult
    acc.min += Math.min(...kcals) * mult
    acc.max += Math.max(...kcals) * mult
    return acc
  }, { exp: 0, min: 0, max: 0 })

  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t('editor.planSettings')}</h3>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={t('editor.dailyTarget')}>
            <input type="text" inputMode="numeric" style={{ width: 120 }} value={dailyDraft}
              onChange={(e) => setDailyDraft(digits(e.target.value))}
              onBlur={commitDaily}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitDaily() } }} />
          </Field>
          <Field label={t('editor.myMinimum')}>
            <input type="text" inputMode="numeric" style={{ width: 110 }} value={floorDraft}
              onChange={(e) => setFloorDraft(digits(e.target.value))}
              onBlur={commitFloor}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitFloor() } }} />
          </Field>
          <Field label={t('editor.nextCheckup')}>
            <input type="date" value={plan.header.nextCheckup || ''}
              onChange={(e) => setHeader('nextCheckup', e.target.value)} />
          </Field>
        </div>
        {/* Item 12 — an explicit choice once the target no longer matches the meals. */}
        {targetOutOfSync ? (
          <div className="target-resync">
            <span className="small">{t('editor.targetChanged')}</span>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn sm" onClick={applyDistribution}>{t('editor.rebalanceAll')}</button>
              <button className="btn secondary sm" onClick={() => {}} title={t('editor.keepManualHint')}>
                {t('editor.keepManual')}
              </button>
            </div>
          </div>
        ) : (
          <div className="row" style={{ gap: 10, alignItems: 'center', marginTop: 8 }}>
            <button className="btn secondary sm" onClick={applyDistribution}>{t('editor.applyDistribution')}</button>
            <span className="muted small">{t('editor.applyDistributionHint')}</span>
          </div>
        )}
        {/* Item 13 — show both figures once the target has been changed. */}
        {plan.calorieAudit && plan.calorieAudit.recommended !== plan.calorieAudit.approved && (
          <p className="muted small" style={{ margin: '8px 0 0' }}>
            {t('editor.calorieAudit', {
              recommended: plan.calorieAudit.recommended,
              approved: plan.calorieAudit.approved,
              who: plan.calorieAudit.changedBy || '—',
              when: plan.calorieAudit.changedAt || '—',
            })}
          </p>
        )}
        {range.exp > 0 && (
          <p className="muted small intake-range">
            {t('editor.intakeRange')}: <b>{Math.round(range.exp)}</b> {t('editor.kcal')}
            {range.min !== range.max && <> · {t('editor.intakeSpread', { min: Math.round(range.min), max: Math.round(range.max) })}</>}
          </p>
        )}
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}>
          <h3 style={{ margin: 0 }}>{t('editor.meals')}</h3>
          <button className="btn ghost sm" onClick={addMeal}>＋ {t('editor.addMeal')}</button>
        </div>
        {plan.meals.map((meal) => {
          // Prefill from the current override, else the template's default title
          // for this slot (e.g. "MEAL 1: BREAKFAST" / "(Choose One)") so the boxes
          // show what actually prints.
          const preset = MEAL_PRESENTATION[plan.isIF ? 'if' : 'regular'][meal.id]?.title || {}
          const mainVal = meal.title?.main ?? preset.main ?? t(`meal.${meal.id}`)
          const subVal = meal.title?.sub ?? preset.sub ?? ''
          const isCustom = String(meal.id).startsWith('custom_')
          return (
            <div key={meal.id} className="meal-row" style={{ marginBottom: 8, borderBottom: '1px solid var(--border, #eee)', paddingBottom: 6 }}>
              <div className="row between" style={{ gap: 6 }}>
                <input type="text" style={{ flex: 1, fontWeight: 600 }} value={mainVal}
                  onChange={(e) => renameMeal(meal.id, 'main', e.target.value)} />
                <input type="number" style={{ width: 80 }} value={meal.targetKcal ?? ''} placeholder={t('editor.mealTargetKcal')}
                  onChange={(e) => mutate((p) => { p.meals.find((m) => m.id === meal.id).targetKcal = parseInt(e.target.value, 10) || null })} />
              </div>
              <div className="row between" style={{ gap: 6, marginTop: 4 }}>
                <input type="text" className="small" style={{ flex: 1 }} value={subVal}
                  placeholder={t('editor.subtitle')} onChange={(e) => renameMeal(meal.id, 'sub', e.target.value)} />
                <button className="btn ghost sm" disabled={meal.options.length >= MAX_OPTIONS_PER_MEAL}
                  onClick={() => setPicker(meal.id)}>＋ {t('editor.addOption')}</button>
                <button className="btn ghost sm icon-btn" title={t('editor.removeMeal')} onClick={() => removeMeal(meal.id)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
              </div>
              {isCustom && <span className="badge sm">{t('editor.customMealBadge')}</span>}
            </div>
          )
        })}
      </div>
    </>
  )
}

// Searchable catalog of the gym's real meals (src/data/mealCatalog.json).
// Picking one inserts a fully-populated option; "blank" starts a manual one.
function MealPicker({ mealLabel, slot, diet, targetKcal, used, allergyNames, conditionNames, customMeals = [], onPick, onClose }) {
  const { t, lang } = useI18n() // follow the site language, not the plan-preview toggle
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()

  // Vet every catalog meal (plus the gym's saved custom meals) against the
  // client's conditions/allergies: build the option, scale its quantities/macros
  // to this meal's calorie target, apply safe ingredient swaps, and drop any dish
  // that still has an unsuitable ingredient with no safe alternative.
  const vetted = useMemo(() => {
    const tokens = canonicalTokens([...(allergyNames || []), ...(conditionNames || [])])
    return [...customMeals, ...mealCatalog].map((entry) => {
      const opt = scaleOptionToKcal(optionFromCatalog(entry), targetKcal)
      const { swaps, conflicts } = tokens.size ? processOption(opt, tokens) : { swaps: [], conflicts: [] }
      return { entry, opt, swaps, safe: conflicts.length === 0 }
    })
  }, [allergyNames, conditionNames, targetKcal, customMeals])

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
                  <b>{name}{m.isCustom ? <span className="badge sm" style={{ marginInlineStart: 6 }}>{t('editor.customBadge')}</span> : ''}</b>
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

function OptionInspector({ t, lang, meal, option, kcalWarn, updateOption, mutate, setSelection, onSaveCustom, saved }) {
  const idx = meal.options.findIndex((o) => o.id === option.id)
  // Edit the currently-previewed language's text; the other language is kept.
  const ar = lang === 'ar'
  const nameKey = ar ? 'name_ar' : 'name_en'
  const descKey = ar ? 'desc_ar' : 'desc_en'
  const ingKey = ar ? 'name_ar' : 'name_en'
  const dir = ar ? 'rtl' : 'ltr'
  const move = (d) => mutate((p) => {
    const m = p.meals.find((x) => x.id === meal.id)
    const i = m.options.findIndex((o) => o.id === option.id)
    const j = i + d
    if (j < 0 || j >= m.options.length) return
    ;[m.options[i], m.options[j]] = [m.options[j], m.options[i]]
  })

  const num = (n) => arDigits(Math.round(n ?? 0), lang)
  // Recompute macros/kcal from the current ingredient grams after any edit.
  const recompute = (o) => { const r = recomputeOptionNutrition(o); o.macros = r.macros; o.kcal = r.kcal }

  // Whole-option re-portion (grams + macros + kcal scale together, clamped to
  // realistic servings by the engine).
  const rescaleTo = (targetKcal) => updateOption((o) => {
    const s = scaleOptionToKcal(o, Math.max(50, Math.round(targetKcal)))
    o.ingredients = s.ingredients; o.macros = s.macros; o.kcal = s.kcal
  })

  const setGrams = (i, val) => updateOption((o) => {
    o.ingredients[i].grams = Math.max(0, parseInt(val, 10) || 0)
    recompute(o)
  })
  const removeIng = (i) => updateOption((o) => { o.ingredients.splice(i, 1); recompute(o) })
  // Manual macro override: kcal follows the macros (4/4/9) so they stay in sync.
  // (Editing an ingredient recomputes both again — last edit wins.)
  const setMacro = (k, val) => updateOption((o) => {
    o.macros = { ...o.macros, [k]: Math.max(0, parseInt(val, 10) || 0) }
    o.kcal = Math.round((o.macros.protein || 0) * 4 + (o.macros.carbs || 0) * 4 + (o.macros.fats || 0) * 9)
  })
  const addIng = (name) => {
    const clean = (name || '').trim()
    if (!clean) return
    const known = KNOWN_INGREDIENTS.find((k) => k.name_en.toLowerCase() === clean.toLowerCase())
    updateOption((o) => {
      o.ingredients.push({
        name_en: known ? known.name_en : clean,
        name_ar: known ? known.name_ar : '',
        grams: 50,
      })
      recompute(o)
    })
  }

  return (
    <div className="card">
      <div className="row between">
        {/* Added/renamed meals carry their own title; the slot key only exists
            for the four standard meals, so fall back to it last. */}
        <h3>{meal.title?.main || t(`meal.${meal.id}`)} · {t('editor.option')} {idx + 1}</h3>
        <div className="row">
          <button className="btn ghost sm" title={t('editor.moveUp')} onClick={() => move(-1)}>↑</button>
          <button className="btn ghost sm" title={t('editor.moveDown')} onClick={() => move(1)}>↓</button>
        </div>
      </div>

      {kcalWarn && (
        <Alert kind="warn">{t('editor.kcalWarning', { est: kcalWarn.estimated, stated: kcalWarn.stated })}</Alert>
      )}

      <Field label={t('editor.optionName')}>
        <input type="text" dir={dir} value={option[nameKey] || ''}
          onChange={(e) => updateOption((o) => { o[nameKey] = e.target.value })} />
      </Field>
      <Field label={t('editor.optionDesc')}>
        <textarea rows={2} dir={dir} value={option[descKey] || ''}
          onChange={(e) => updateOption((o) => { o[descKey] = e.target.value })} />
      </Field>

      {/* Portion: type a target calorie value; the engine re-portions the whole
          plate to it (clamped to realistic servings). */}
      <Field label={t('editor.portion')} hint={t('editor.portionHint')}>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <input type="number" style={{ width: 100 }} min="50" step="10"
            key={option.kcal} defaultValue={option.kcal || ''}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
            onBlur={(e) => { const v = parseInt(e.target.value, 10); if (v && v !== option.kcal) rescaleTo(v) }} />
          <span className="muted small">{t('editor.kcal')}</span>
        </div>
      </Field>

      {/* Editable ingredients — grams drive the recomputed macros/kcal above. */}
      <h3 style={{ marginTop: '0.9rem' }}>{t('editor.ingredients')}</h3>
      <ul className="ingredient-edit-list" dir={dir}>
        {option.ingredients.map((ing, i) => {
          const noMeta = !ingredientHasMeta(ing)
          return (
            <li key={i} className="row between" style={{ gap: 6 }}>
              <span className="ing-name" title={noMeta ? t('editor.noNutrition') : ''}>
                {ing[ingKey] || ing.name_en}{noMeta ? ' ⚠︎' : ''}
              </span>
              <span className="row" style={{ gap: 4 }}>
                <input type="number" min="0" step="5" style={{ width: 70 }} placeholder="0" value={ing.grams ? ing.grams : ''}
                  onChange={(e) => setGrams(i, e.target.value)} />
                <button className="btn ghost sm" title={t('editor.removeIngredient')} onClick={() => removeIng(i)}>✕</button>
              </span>
            </li>
          )
        })}
      </ul>
      <AddIngredient t={t} onAdd={addIng} />

      <h3 style={{ marginTop: '0.9rem' }}>{t('editor.macros')}</h3>
      <div className="macro-edit">
        {[['protein', 'editor.protein'], ['carbs', 'editor.carbs'], ['fats', 'editor.fats']].map(([k, lk]) => (
          <label key={k} className="macro-edit-item">
            <span className="muted small">{t(lk)}</span>
            <span className="macro-edit-input">
              <input type="number" min="0" step="1" placeholder="0" value={option.macros[k] ? option.macros[k] : ''}
                onChange={(e) => setMacro(k, e.target.value)} />
              <span className="muted small">{t('editor.grams')}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="row between" style={{ marginTop: '1rem' }}>
        <button className="btn secondary sm" disabled={saved} onClick={() => onSaveCustom(option, meal.id)}>
          {saved ? t('editor.savedMeal') : t('editor.saveMeal')}
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
