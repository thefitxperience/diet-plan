// UDRA diet plan template — the client-facing PDF.
//
// Implements design_handoff_udra_diet_plan. This single component powers the
// editor canvas, the thumbnails, the approval preview and the PDF export, so
// what the dietitian edits is exactly what the client receives.
//
// Six fixed A4 pages (794 × 1123 px at 96 dpi):
//   1  identity, daily target, assessment summary, first meal
//   2+ one meal each
//   5  about the plan, hydration, protein intake
//   6  food groups, sleep & recovery, sign-off
//
// Pages are fixed boxes with overflow hidden — content that does not fit is
// clipped silently. `densityFor` steps a crowded meal page tighter rather than
// let that happen; see the density ladder below.
//
// props:
//   plan        — structured plan model (§5)
//   lang        — 'en' | 'ar'
//   gym         — { name, logo_url } for co-branding (optional)
//   selectable  — enable click-to-select of meal options (editor)
//   selection   — { mealId, optionId } currently selected
//   onSelect    — (mealId, optionId) => void
//   warnings    — Set of "mealId:optionId" keys to flag visually
//   pageRefs    — optional ref callback (index, el) for thumbnails/export
//   only        — render just this page index (thumbnails)

import { Fragment } from 'react'
import planAr from '../i18n/plan-ar.json'
import {
  DIET_TYPE_NOTE, KICKER,
  ABOUT_SECTION, ABOUT_BLOCKS, GUIDELINES_SECTION, GUIDELINES_INTRO,
  HYDRATION, PROTEIN, GROUPS_SECTION, GROUPS, VEG_FRUIT, SLEEP,
} from './deepfitGuidelines'
import { formatAmount, ingredientState } from '../lib/planModel'
import './deepfit.css'

const ASSET = (name) => `${import.meta.env.BASE_URL}assets/plan/${name}`

const UI = planAr.ui || {}
const PARA = planAr.paragraphs || {}
const ITEMS = planAr.listItems || {}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'

function arNums(str) {
  return String(str)
    .replace(/ g\b/g, ' غرام')
    .replace(/kcal/g, 'كيلو سعرة')
    .replace(/[0-9]/g, (d) => ARABIC_DIGITS[d])
}

function makeT(lang) {
  const isAr = lang === 'ar'
  return {
    isAr,
    ui: (key) => (isAr && UI[key] ? UI[key] : key),
    para: (text) => (isAr && PARA[text] ? PARA[text] : text),
    item: (text) => (isAr && ITEMS[text] ? ITEMS[text] : text),
    num: (val) => (isAr ? arNums(String(val)) : String(val)),
    // Content entries carry { key, en }: `key` is the Arabic dictionary lookup,
    // `en` the design's English presentation. See deepfitGuidelines.js.
    title: (entry) => (isAr && UI[entry.key] ? UI[entry.key] : entry.en || entry.key),
    // Same, for keys whose stored form ends in ": " (the old template printed
    // them inline). The design sets them as standalone labels.
    label: (entry) => (isAr && UI[entry.key] ? UI[entry.key].replace(/\s*[:：]\s*$/, '') : entry.en),
  }
}

function calcAge(dob) {
  if (!dob) return ''
  const birth = new Date(dob)
  if (isNaN(birth)) return ''
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d) ? iso : d.toLocaleDateString('en-GB')
}

// Design presentation over the existing Arabic dictionary keys.
const TH = {
  option: { key: 'Options', en: 'OPTION' },
  ingredients: { key: 'Ingredients', en: 'INGREDIENTS' },
  macros: { key: 'Nutritional Breakdown', en: 'MACROS' },
}
const MACRO = [
  { key: 'Protein: ', en: 'Protein', field: 'protein' },
  { key: 'Carbs: ', en: 'Carbs', field: 'carbs' },
  { key: 'Fats: ', en: 'Fats', field: 'fats' },
]

const Mono = ({ className = '', children }) => (
  <span className={`deepfit-mono ${className}`.trim()}>{children}</span>
)

/* ── Shared page furniture ─────────────────────────────────────────────────── */

function Masthead({ kicker, gym, t }) {
  return (
    <div className="deepfit-masthead">
      <div className="deepfit-masthead-text">
        <div className="deepfit-masthead-title">{t.ui('DIET PLAN')}</div>
        {kicker && <div className="deepfit-masthead-kicker">{kicker}</div>}
      </div>
      <div className="deepfit-masthead-marks">
        {gym?.logo_url && (
          <>
            <img src={gym.logo_url} className="deepfit-masthead-gym" alt={gym.name || 'Gym'} crossOrigin="anonymous" />
            <div className="deepfit-masthead-rule" />
          </>
        )}
        <img src={ASSET('udra-wordmark-white.png')} className="deepfit-masthead-logo" alt="UDRA" />
      </div>
    </div>
  )
}

const PAGE_LABEL = { key: 'Page {n} of {total}', en: 'PAGE {n} / {total}' }

function Footer({ t, page, total }) {
  const label = t.title(PAGE_LABEL)
    .split('{n}').join(t.num(page))
    .split('{total}').join(t.num(total))
  return (
    <div className="deepfit-footer">
      <div className="deepfit-footer-social">
        <img src={ASSET('icon-instagram.png')} className="deepfit-footer-icon" alt="Instagram" />
        <img src={ASSET('icon-facebook.png')} className="deepfit-footer-icon" alt="Facebook" />
        <div className="deepfit-footer-handle">udratech</div>
      </div>
      <Mono className="deepfit-footer-page">{label}</Mono>
      <div className="deepfit-footer-site">www.udratech.com</div>
    </div>
  )
}

const SectionTitle = ({ entry, t }) => (
  <div className="deepfit-section-title">{t.title(entry)}</div>
)

// One page: masthead + padded body + footer. Module scope on purpose — see the
// note in DeepFitTemplate about remounting.
function PlanPage({ pageRef, kicker, gym, t, page, total, cover, wide, children }) {
  return (
    <div className="deepfit-page" ref={pageRef}>
      <img src={ASSET('udra-watermark.png')} className="deepfit-watermark" alt="" aria-hidden="true" />
      <Masthead kicker={kicker} gym={gym} t={t} />
      <div className={`deepfit-body${cover ? ' is-cover' : ''}${wide ? ' is-wide' : ''}`}>
        {children}
      </div>
      <Footer t={t} page={page} total={total} />
    </div>
  )
}

/* ── Meal header + table ───────────────────────────────────────────────────── */

// Legacy icon keys are what MEAL_PRESENTATION and saved plans carry; the design
// ships its own normalised artwork, so map rather than rewrite stored plans.
const ICON_FILE = {
  'Breakfast.png': 'icon-breakfast.png',
  'Lunch.png': 'icon-lunch.png',
  'Dinner.png': 'icon-dinner.png',
  'Snack.png': 'icon-snack.png',
}
const iconFile = (name) => ICON_FILE[name] || ICON_FILE['Snack.png']

// 'MEAL 1: BREAKFAST' → 'MEAL 1 · Breakfast'. Only all-caps input is recased, so
// a dietitian's own "Post-Workout Shake" survives untouched.
export function displayTitle(main) {
  const recase = (s) => (s === s.toUpperCase()
    ? s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, p, c) => p + c.toUpperCase())
    : s)
  const i = main.indexOf(':')
  if (i === -1) return recase(main.trim())
  return `${main.slice(0, i).trim()} · ${recase(main.slice(i + 1).trim())}`
}

// '(Choose One)' → 'choose one'
export const displayPick = (sub) => sub.replace(/^\s*\(|\)\s*$/g, '').toLowerCase()

/* Density ladder, loosest → tightest. Row height is tuned per page so each
   table reaches roughly the same page fill WITHOUT being force-stretched: rows
   never get `flex: 1`, because stretched rows read as a layout bug. */
const LADDER = ['is-airy', 'is-normal', 'is-compact']

function densityFor(meal, isCover) {
  const isSnack = String(meal.id || '').includes('snack')
  // The cover shares its page with the identity row, target panels and
  // assessment summary, so it starts one step tighter than a full meal page.
  // Snacks list 2 ingredients against 4–5, so they start loosest.
  let i = isCover ? 2 : isSnack ? 0 : 1

  // Guards from the handoff: a crowded page steps down rather than overflow.
  const options = meal.options || []
  if (options.length > 7) i += 1
  if (options.some((o) => (o.ingredients || []).length > 5)) i += 1

  return LADDER[Math.min(i, LADDER.length - 1)]
}

function MealHeader({ meal, title, icon, t, isCover }) {
  const label = t.isAr ? t.ui(title.main) : displayTitle(title.main)
  const pick = title.sub ? (t.isAr ? t.ui(title.sub) : displayPick(title.sub)) : ''
  // targetKcal is the PER-OPTION target, so when the client picks more than one
  // (snacks) the chip says so rather than reading as the whole meal's budget.
  const each = /\btwo\b/i.test(title.sub || '')
  const kcal = t.isAr
    ? `${arNums(`~${meal.targetKcal} kcal`)}${each ? ` ${t.ui('EACH')}` : ''}`
    : `~${meal.targetKcal} KCAL${each ? ' EACH' : ''}`
  return (
    <div className={`deepfit-meal-header${isCover ? ' is-cover' : ''}`}>
      <img src={ASSET(iconFile(icon))} className="deepfit-meal-icon" alt="" />
      <div className="deepfit-meal-titles">
        <div className="deepfit-meal-title">{label}</div>
        {pick && <div className="deepfit-meal-pick">{pick}</div>}
      </div>
      {meal.targetKcal ? <Mono className="deepfit-meal-kcal">{kcal}</Mono> : null}
    </div>
  )
}

function MealTable({ meal, density, t, selectable, selection, onSelect, warnings, note }) {
  return (
    <div className={`deepfit-table ${density}`}>
      <div className="deepfit-thead">
        <div className="deepfit-th">{t.title(TH.option)}</div>
        <div className="deepfit-th">{t.title(TH.ingredients)}</div>
        <div className="deepfit-th is-macros">{t.title(TH.macros)}</div>
      </div>

      {meal.options.length === 0 && (
        <div className="deepfit-table-empty">{t.ui('No meal data available')}</div>
      )}

      {meal.options.map((opt) => {
        const key = `${meal.id}:${opt.id}`
        const selected = selection && selection.mealId === meal.id && selection.optionId === opt.id
        const name = t.isAr && opt.name_ar ? opt.name_ar : opt.name_en
        const desc = t.isAr && opt.desc_ar ? opt.desc_ar : opt.desc_en
        const cls = [
          'deepfit-row',
          selectable ? 'deepfit-row-selectable' : '',
          selected ? 'deepfit-row-selected' : '',
          warnings?.has(key) ? 'deepfit-row-warning' : '',
        ].filter(Boolean).join(' ')

        return (
          <div key={opt.id} className={cls}
               onClick={selectable ? () => onSelect(meal.id, opt.id) : undefined}>
            <div className="deepfit-cell is-option">
              <div className="deepfit-option-name">{name}</div>
              {desc && <div className="deepfit-option-desc">{desc}</div>}
            </div>
            <div className="deepfit-cell is-ingredients">
              {opt.ingredients.length === 0 && (
                <div className="deepfit-ingredient">{t.ui('No ingredients')}</div>
              )}
              {opt.ingredients.map((ing, i) => {
                const ingName = t.isAr && ing.name_ar ? ing.name_ar : ing.name_en
                // Say dry / raw / cooked right here for the foods where it
                // changes the portion materially, not only in the general notes.
                const st = ingredientState(ing.name_en)
                const shown = st ? `${ingName} (${t.ui(st)})` : ingName
                return (
                  <div className="deepfit-ingredient" key={i}>
                    {`${shown}: ${formatAmount(ing, t.isAr ? 'ar' : 'en')}`}
                  </div>
                )
              })}
            </div>
            <div className="deepfit-cell is-macros">
              {MACRO.map((m) => (
                <div className="deepfit-macro" key={m.field}>
                  <span className="deepfit-macro-label">{t.label(m)}</span>
                  <Mono className="deepfit-macro-value">
                    {opt.macros[m.field] != null ? t.num(`${opt.macros[m.field]} g`) : '—'}
                  </Mono>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {note && (
        <div className="deepfit-note-bar">
          <div className="deepfit-note-dot" />
          <div className="deepfit-note-text">{note}</div>
        </div>
      )}
    </div>
  )
}

/* ── Page 1 blocks ─────────────────────────────────────────────────────────── */

const ASSESS = {
  energy: 'Your body burns about {bmr} kcal a day at rest. Allowing for how active you are, holding your current weight takes roughly {maintenance} kcal a day.',
  energyShort: 'Based on your assessment, holding your current weight takes roughly {maintenance} kcal a day.',
  lose: 'Your goal is to lose weight, so your daily target works out to {target} kcal — about {shift} kcal below that level, a pace that protects muscle while body fat comes down.',
  gain: 'Your goal is to gain weight, so your daily target works out to {target} kcal — about {shift} kcal above that level, enough to build up gradually rather than all at once.',
  maintain: 'Your goal is to maintain your current weight, so your daily target works out to {target} kcal, in line with what your body uses.',
  adjusted: 'Your dietitian reviewed these figures against your full assessment and set your final daily target at {final} kcal.',
}

function AssessmentSummary({ assessment: a, dailyKcal, t }) {
  if (!a || (!a.maintenanceKcal && !a.bmr)) return null

  const kcal = (n) => t.num(Math.round(n).toLocaleString('en-US'))
  // The English sentence is itself the dictionary key (same convention as the
  // guidelines copy), so an untranslated string degrades to readable English.
  const tpl = (key, vals) => Object.entries(vals)
    .reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t.ui(key))

  const metrics = [
    a.weight && { label: 'Weight', value: `${t.num(a.weight)} ${t.ui('kg')}` },
    a.height && { label: 'Height', value: `${t.num(a.height)} ${t.ui('cm')}` },
    a.bodyFatPct && { label: 'Body Fat', value: `${t.num(a.bodyFatPct)}%` },
    a.muscleMass && { label: 'Muscle Mass', value: `${t.num(a.muscleMass)} ${t.ui('kg')}` },
  ].filter(Boolean)

  const final = Math.round(dailyKcal || 0) || a.recommendedKcal
  const adjusted = final !== a.recommendedKcal

  const energyLine = a.bmr && a.maintenanceKcal
    ? tpl(ASSESS.energy, { bmr: kcal(a.bmr), maintenance: kcal(a.maintenanceKcal) })
    : tpl(ASSESS.energyShort, { maintenance: kcal(a.maintenanceKcal || a.bmr) })

  const goalKey = a.goal === 'lose' ? ASSESS.lose : a.goal === 'gain' ? ASSESS.gain : ASSESS.maintain
  const goalLine = tpl(goalKey, {
    target: kcal(adjusted ? a.recommendedKcal : final),
    shift: kcal(Math.abs(a.goalShift)),
  })

  return (
    <div className="deepfit-assessment">
      <div className="deepfit-assessment-title">{t.ui('YOUR ASSESSMENT SUMMARY')}</div>
      {metrics.length > 0 && (
        <div className="deepfit-assessment-metrics">
          {metrics.map((m) => (
            <div className="deepfit-assessment-metric" key={m.label}>
              <span className="deepfit-assessment-metric-label">{t.ui(m.label)}</span>
              <span className="deepfit-assessment-metric-value">{m.value}</span>
            </div>
          ))}
        </div>
      )}
      <div className="deepfit-assessment-body">
        <p>{energyLine} {goalLine}</p>
        {adjusted && <p>{tpl(ASSESS.adjusted, { final: kcal(final) })}</p>}
      </div>
    </div>
  )
}

// "500 kcal below maintenance" — the one-line gloss under the daily target.
const TARGET_NOTE = {
  lose: '{shift} kcal below maintenance',
  gain: '{shift} kcal above maintenance',
  maintain: 'in line with maintenance',
}

function targetNote(a, t) {
  if (!a?.goal) return ''
  const key = TARGET_NOTE[a.goal] || TARGET_NOTE.maintain
  const shift = Math.abs(a.goalShift || 0)
  if (a.goal !== 'maintain' && !shift) return ''
  return t.ui(key).split('{shift}').join(t.num(shift))
}

// Daily protein range, derived from body weight at the rate the guidelines
// quote (1.2–1.6 g/kg). Not stored on the plan — it is presentation arithmetic.
function proteinRange(a, t) {
  if (!a?.weight) return ''
  const [lo, hi] = PROTEIN.gPerKg
  return t.num(`${Math.round(a.weight * lo)}–${Math.round(a.weight * hi)} g`)
}

const SNACK_NOTE = 'Two snacks a day sit inside your {kcal} kcal target, so spread them between meals rather than after dinner.'

/* ── Page structure ────────────────────────────────────────────────────────── */

// The page box, in CSS px (A4 portrait at 96 dpi). Exported so the editor's
// fit-to-width can scale against it — keep in step with .deepfit-page.
export const PAGE_WIDTH = 794
export const PAGE_HEIGHT = 1123

export const MEAL_PRESENTATION = {
  regular: {
    breakfast: { title: { main: 'MEAL 1: BREAKFAST', sub: '(Choose One)' }, icon: 'Breakfast.png' },
    lunch: { title: { main: 'MEAL 2: LUNCH', sub: '(Choose One)' }, icon: 'Lunch.png' },
    dinner: { title: { main: 'MEAL 3: DINNER', sub: '(Choose One)' }, icon: 'Dinner.png' },
    snack: { title: { main: 'SNACK', sub: '(Choose Two)' }, icon: 'Snack.png' },
  },
  if: {
    lunch: { title: { main: 'MEAL 1: LUNCH', sub: '(Choose One)' }, icon: 'Lunch.png' },
    dinner: { title: { main: 'MEAL 2: DINNER', sub: '(Choose One)' }, icon: 'Dinner.png' },
    snack: { title: { main: 'SNACK', sub: '(Choose One)' }, icon: 'Snack.png' },
  },
}

export function planPageList(plan) {
  // page 0 hosts the header info + first meal; remaining meals get own pages
  const mealIds = plan.meals.map((m) => m.id)
  return [
    { type: 'cover', mealId: mealIds[0], label: plan.isIF ? 'Lunch' : 'Breakfast' },
    ...mealIds.slice(1).map((id) => ({ type: 'meal', mealId: id, label: id })),
    { type: 'guidelines1', label: 'Guidelines' },
    { type: 'guidelines2', label: 'Guidelines 2' },
  ]
}

// The About panel's three blocks sit near their panel's limit at 1.7 leading.
// Past this much copy the design calls for losing the leading, not the type
// size — measured against the approved set, which totals ~1830 characters.
const ABOUT_TIGHT_THRESHOLD = 1900

export default function DeepFitTemplate({
  plan, lang = 'en', gym, selectable = false, selection, onSelect, warnings, pageRefs, only = null,
}) {
  if (!plan?.meals) return null
  const t = makeT(lang)
  const pres = MEAL_PRESENTATION[plan.isIF ? 'if' : 'regular']
  // A custom/renamed meal carries its own title/icon; otherwise fall back to the
  // fixed slot presentation, then a safe default so an added slot never crashes.
  const presFor = (meal) => {
    const base = pres[meal.id] || {}
    return {
      title: meal.title || base.title || { main: String(meal.id || '').toUpperCase(), sub: '' },
      icon: meal.icon || base.icon || 'Snack.png',
    }
  }

  const pages = planPageList(plan)
  const mealById = Object.fromEntries(plan.meals.map((m) => [m.id, m]))
  const h = plan.header
  const a = plan.assessment
  // submit() stamps the sign-off on the plan root; accept either position so a
  // plan saved under the older shape still renders it.
  const approval = plan.approval || h.approval

  // Pages grow rather than clip (see .deepfit-page), so nothing is lost — but a
  // page that runs past A4 is still worth knowing about while editing, since it
  // means the density ladder did not claw back enough room.
  const attachRef = (idx) => (el) => {
    pageRefs?.(idx, el)
    if (el && import.meta.env.DEV && el.offsetHeight > PAGE_HEIGHT) {
      console.warn(`[plan] page ${idx + 1} runs ${el.offsetHeight - PAGE_HEIGHT}px past A4`)
    }
  }

  const clientKicker = [h.fullName, t.ui(h.dietType)]
    .filter(Boolean)
    .map((s) => (t.isAr ? s : String(s).toUpperCase()))
    .join(' · ')

  const renderMeal = (meal, isCover) => {
    if (!meal) return null
    const { title, icon } = presFor(meal)
    const isSnack = String(meal.id || '').includes('snack')
    const note = isSnack && h.dailyKcal && !isCover
      ? t.ui(SNACK_NOTE).split('{kcal}').join(t.num(Math.round(h.dailyKcal).toLocaleString('en-US')))
      : null
    return (
      <>
        <MealHeader meal={meal} title={title} icon={icon} t={t} isCover={isCover} />
        <MealTable meal={meal} density={densityFor(meal, isCover)} t={t} note={note}
          selectable={selectable} selection={selection} onSelect={onSelect} warnings={warnings} />
      </>
    )
  }

  const field = (label, value, mono) => (
    <div className="deepfit-field" key={label}>
      <div className="deepfit-field-label">{t.ui(label)}</div>
      <div className={`deepfit-field-value${mono ? ' is-mono deepfit-mono' : ''}`}>{value}</div>
    </div>
  )

  const itemGrid = (items) => (
    <div className="deepfit-item-grid">
      {items.map((it, i) => (
        <div className="deepfit-item" key={i}>{it ? t.item(it) : ' '}</div>
      ))}
    </div>
  )

  const aboutLength = ABOUT_BLOCKS.reduce((n, b) => n + t.para(b.body).length, 0)

  return (
    <div
      className="deepfit-root"
      dir={t.isAr ? 'rtl' : 'ltr'}
      style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center' }}
    >
      {pages.map((page, idx) => {
        if (only != null && only !== idx) return null

        /* ── Page 1 ─────────────────────────────────────────────────────── */
        if (page.type === 'cover') {
          return (
            <PlanPage key={idx} pageRef={attachRef(idx)} page={idx + 1} total={pages.length}
                      kicker={t.ui(KICKER.cover)} gym={gym} t={t} cover>
              <div className="deepfit-identity">
                {field('CLIENT', h.fullName, false)}
                {field('AGE', t.num(calcAge(h.dob)), true)}
                {field('ISSUED', t.num(fmtDate(h.testDate)), true)}
                {field('NEXT CHECK-UP', h.nextCheckup ? t.num(fmtDate(h.nextCheckup)) : '—', true)}
              </div>

              <div className="deepfit-target-row">
                <div className="deepfit-diet-panel">
                  <div className="deepfit-panel-label">{t.ui('DIET TYPE')}</div>
                  <div className="deepfit-diet-name">{t.ui(h.dietType)}</div>
                  <div className="deepfit-diet-note">{t.para(DIET_TYPE_NOTE)}</div>
                </div>
                {h.dailyKcal ? (
                  <div className="deepfit-kcal-panel">
                    <div className="deepfit-panel-label">{t.ui('DAILY TARGET')}</div>
                    <div className="deepfit-kcal-figure-row">
                      <div className="deepfit-kcal-figure">
                        {t.num(Math.round(h.dailyKcal).toLocaleString('en-US'))}
                      </div>
                      <div className="deepfit-kcal-unit">{t.ui('kcal')}</div>
                    </div>
                    {targetNote(a, t) && (
                      <Mono className="deepfit-kcal-note">{targetNote(a, t)}</Mono>
                    )}
                  </div>
                ) : null}
              </div>

              <AssessmentSummary assessment={a} dailyKcal={h.dailyKcal} t={t} />
              {renderMeal(mealById[page.mealId], true)}
            </PlanPage>
          )
        }

        /* ── Pages 2–4 ──────────────────────────────────────────────────── */
        if (page.type === 'meal') {
          return (
            <PlanPage key={idx} pageRef={attachRef(idx)} page={idx + 1} total={pages.length}
                      kicker={clientKicker} gym={gym} t={t}>
              {renderMeal(mealById[page.mealId], false)}
            </PlanPage>
          )
        }

        /* ── Page 5 ─────────────────────────────────────────────────────── */
        if (page.type === 'guidelines1') {
          const range = proteinRange(a, t)
          const tight = aboutLength > ABOUT_TIGHT_THRESHOLD
          return (
            <PlanPage key={idx} pageRef={attachRef(idx)} page={idx + 1} total={pages.length}
                      kicker={t.ui(KICKER.guidelines1)} gym={gym} t={t} wide>
              <SectionTitle entry={ABOUT_SECTION} t={t} />
              <div className={`deepfit-about-panel${tight ? ' is-tight' : ''}`}>
                {ABOUT_BLOCKS.map((b, i) => (
                  <Fragment key={b.key}>
                    {i > 0 && <div className="deepfit-divider" />}
                    <div className="deepfit-about-block">
                      <div className="deepfit-block-title">{t.title(b)}</div>
                      <div className="deepfit-about-body">{t.para(b.body)}</div>
                    </div>
                  </Fragment>
                ))}
              </div>

              <SectionTitle entry={GUIDELINES_SECTION} t={t} />
              <div className="deepfit-guidelines-intro">
                {t.isAr && UI.guidelines_intro ? UI.guidelines_intro : GUIDELINES_INTRO}
              </div>

              <div className="deepfit-duo">
                <div className="deepfit-hydration">
                  <div className="deepfit-block-title">{t.title(HYDRATION)}</div>
                  <div className="deepfit-panel-note">{t.para(HYDRATION.note)}</div>
                  <div className="deepfit-steps">
                    {HYDRATION.steps.map((s, i) => (
                      <div className="deepfit-step" key={i}>
                        <Mono className="deepfit-step-index">
                          {t.num(String(i + 1).padStart(2, '0'))}
                        </Mono>
                        <div className="deepfit-step-text">{t.item(s)}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="deepfit-protein">
                  <div className="deepfit-block-title">{t.title(PROTEIN)}</div>
                  <div className="deepfit-protein-note">{t.para(PROTEIN.note)}</div>
                  {range && (
                    <div className="deepfit-protein-figure">
                      <Mono className="deepfit-figure-value">{range}</Mono>
                      <div className="deepfit-figure-caption">{t.ui('your daily range')}</div>
                    </div>
                  )}
                </div>
              </div>
            </PlanPage>
          )
        }

        /* ── Page 6 ─────────────────────────────────────────────────────── */
        const tightCards = GROUPS.some((g) => g.items.filter(Boolean).length > 8)
        return (
          <PlanPage key={idx} pageRef={attachRef(idx)} page={idx + 1} total={pages.length}
                      kicker={t.ui(KICKER.guidelines2)} gym={gym} t={t} wide>
            <SectionTitle entry={GROUPS_SECTION} t={t} />
            <div className="deepfit-group-grid">
              {GROUPS.map((g) => (
                <div className={`deepfit-card${tightCards ? ' is-tight' : ''}`} key={g.key}>
                  <div className="deepfit-card-title">{t.title(g)}</div>
                  <div className="deepfit-card-note">{t.para(g.note)}</div>
                  {itemGrid(g.items)}
                </div>
              ))}
            </div>

            <div className={`deepfit-card${tightCards ? ' is-tight' : ''}`}>
              <div className="deepfit-card-title">{t.title(VEG_FRUIT)}</div>
              <div className="deepfit-vegfruit-note">{t.para(VEG_FRUIT.note)}</div>
              <div className="deepfit-sublists">
                {VEG_FRUIT.columns.map((c) => (
                  <div className="deepfit-sublist" key={c.key}>
                    <div className="deepfit-sublist-label">{t.title(c)}</div>
                    {itemGrid(c.items)}
                  </div>
                ))}
              </div>
            </div>

            <div className="deepfit-sleep">
              <div className="deepfit-sleep-text">
                <div className="deepfit-block-title">{t.title(SLEEP)}</div>
                <div className="deepfit-sleep-note">{t.para(SLEEP.note)}</div>
              </div>
              <Mono className="deepfit-sleep-figure">
                {t.num(SLEEP.figure)} {t.title(SLEEP.figureUnit)}
              </Mono>
            </div>

            {approval?.name && (
              <div className="deepfit-signoff">
                <div className="deepfit-signoff-text">
                  <div className="deepfit-signoff-label">{t.ui('Reviewed & approved by')}</div>
                  <div className="deepfit-signoff-name">
                    {approval.name}
                    {approval.title ? `, ${approval.title}` : ''}
                    {approval.registration ? ` · ${approval.registration}` : ''}
                  </div>
                  {approval.date && (
                    <Mono className="deepfit-signoff-date">{t.num(fmtDate(approval.date))}</Mono>
                  )}
                  {approval.note && <div className="deepfit-signoff-note">{approval.note}</div>}
                </div>
                <img src={ASSET('udra-mark.png')} className="deepfit-signoff-mark" alt="" />
              </div>
            )}
          </PlanPage>
        )
      })}
    </div>
  )
}
