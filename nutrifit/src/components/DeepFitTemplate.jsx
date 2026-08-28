// deepFIT plan template (plan §5, ported from the demo). Renders the
// structured plan model at true page proportions — this single component
// powers the editor canvas, approval preview, and PDF export.
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

import planAr from '../i18n/plan-ar.json'
import {
  DIET_INTRO, GUIDELINES_TITLE, GUIDELINES_INTRO,
  GUIDELINES_PAGE_1, GUIDELINES_PAGE_2, ABOUT_TITLE, ABOUT_SECTIONS,
} from './deepfitGuidelines'
import { formatAmount, ingredientState } from '../lib/planModel'
import './deepfit.css'

const ASSET = (name) => `${import.meta.env.BASE_URL}assets/deep-fit/${name}`

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

function Header({ gym, t }) {
  return (
    <div className="deepfit-header">
      <div className="deepfit-header-title">{t.ui('DIET PLAN')}</div>
      <img src={ASSET('Arrow.png')} className="deepfit-header-arrow" alt="" />
      <img src={ASSET('deep-fit-logo.png')} className="deepfit-header-logo" alt="DEEP FIT" />
      {gym?.logo_url && (
        <img src={gym.logo_url} className="deepfit-header-gym-logo" alt={gym.name || 'Gym'} crossOrigin="anonymous" />
      )}
    </div>
  )
}

// `page` / `total` drive "Page X of Y" (dietitian review §6) — centred between
// the existing corner marks, so the branded footer is unchanged otherwise.
function Footer({ t, page, total }) {
  const label = t && page && total
    ? t.ui('Page {n} of {total}').split('{n}').join(t.num(page)).split('{total}').join(t.num(total))
    : ''
  return (
    <div className="deepfit-footer">
      <div className="deepfit-footer-left">
        <img src={ASSET('Arrow-foot-left.png')} className="deepfit-footer-arrow" alt="" />
        <div className="deepfit-footer-left-content">
          <img src={ASSET('Icon-instagram.png')} className="deepfit-footer-icon" alt="Instagram" />
          <img src={ASSET('Logo-Facebook.png')} className="deepfit-footer-icon" alt="Facebook" />
          <span>mydeepfit</span>
        </div>
      </div>
      {label && <div className="deepfit-footer-page">{label}</div>}
      <div className="deepfit-footer-right">
        <span>www.mydeepfit.com</span>
        <img src={ASSET('Arrow-foot-right.png')} className="deepfit-footer-arrow" alt="" />
      </div>
    </div>
  )
}

function Wave({ variant }) {
  const d = variant === 'low'
    ? 'M0,280 Q250,180 500,280 L500,400 L0,400 Z'
    : 'M0,250 Q200,150 400,250 T800,250 L800,400 L0,400 Z'
  return (
    <svg className="deepfit-wave" viewBox="0 0 595 400" preserveAspectRatio="none">
      <path d={d} fill="#e0e0e0" opacity="0.3" />
    </svg>
  )
}

function MealTable({ meal, title, icon, t, selectable, selection, onSelect, warnings }) {
  const kcalLabelEn = meal.targetKcal ? `( ~${meal.targetKcal} kcal)` : ''
  const kcalLabel = t.isAr ? arNums(kcalLabelEn) : kcalLabelEn
  return (
    <>
      <div className="deepfit-meal-header">
        <img src={ASSET(icon)} className="deepfit-meal-icon" alt="" />
        <div className="deepfit-meal-header-content">
          <div className="deepfit-meal-title-row">
            <div className="deepfit-meal-title">
              {t.ui(title.main)} <small>{t.ui(title.sub)}</small>
            </div>
          </div>
          <img src={ASSET('arrow-small.png')} className="deepfit-meal-underline" alt="" />
        </div>
      </div>
      <table className="deepfit-table">
        <thead>
          <tr>
            <th style={{ width: '36%' }}>
              {t.ui('Options')} {meal.targetKcal ? <span className="deepfit-kcal">{kcalLabel}</span> : null}
            </th>
            <th style={{ width: '36%' }}>{t.ui('Ingredients')}</th>
            <th style={{ width: '28%' }}>{t.ui('Nutritional Breakdown')}</th>
          </tr>
        </thead>
        <tbody>
          {meal.options.length === 0 && (
            <tr><td colSpan={3} style={{ textAlign: 'center' }}>{t.ui('No meal data available')}</td></tr>
          )}
          {meal.options.map((opt) => {
            const key = `${meal.id}:${opt.id}`
            const selected = selection && selection.mealId === meal.id && selection.optionId === opt.id
            const name = t.isAr && opt.name_ar ? opt.name_ar : opt.name_en
            const desc = t.isAr && opt.desc_ar ? opt.desc_ar : opt.desc_en
            const rowClass = [
              selectable ? 'deepfit-row-selectable' : '',
              selected ? 'deepfit-row-selected' : '',
              warnings?.has(key) ? 'deepfit-row-warning' : '',
            ].filter(Boolean).join(' ')
            return (
              <tr key={opt.id} className={rowClass}
                  onClick={selectable ? () => onSelect(meal.id, opt.id) : undefined}>
                <td>
                  <span className="deepfit-option-name">{name}</span>
                  {desc && <span className="deepfit-option-desc">{desc}</span>}
                </td>
                <td>
                  <ul>
                    {opt.ingredients.length === 0 && <li>{t.isAr ? `• ${t.ui('No ingredients')}` : t.ui('No ingredients')}</li>}
                    {opt.ingredients.map((ing, i) => {
                      const ingName = t.isAr && ing.name_ar ? ing.name_ar : ing.name_en
                      // Say dry / raw / cooked right here for the foods where it
                      // changes the portion materially, not only in the general notes.
                      const st = ingredientState(ing.name_en)
                      const shown = st ? `${ingName} (${t.ui(st)})` : ingName
                      const line = `${shown}: ${formatAmount(ing, t.isAr ? 'ar' : 'en')}`
                      return <li key={i}>{t.isAr ? `• ${line}` : line}</li>
                    })}
                  </ul>
                </td>
                <td>
                  <ul>
                    {/* This option's OWN calories, not just the meal's approximate
                        target — the client needs to see what they are choosing. */}
                    {opt.kcal ? (
                      <li className="deepfit-option-kcal">
                        {t.isAr
                          ? `• ${arNums(`${t.ui('Calories: ')}${opt.kcal} kcal`)}`
                          : `${t.ui('Calories: ')}${opt.kcal} kcal`}
                      </li>
                    ) : null}
                    {[['Protein: ', opt.macros.protein], ['Carbs: ', opt.macros.carbs], ['Fats: ', opt.macros.fats]].map(([label, val], i) => {
                      const line = `${t.ui(label)}${val ?? '-'}${val != null ? ' g' : ''}`
                      return <li key={i}>{t.isAr ? `• ${arNums(line)}` : line}</li>
                    })}
                  </ul>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

function GuidelinesSection({ section, t }) {
  return (
    <div className="deepfit-guidelines-section">
      {section.heading && <h3>{t.ui(section.heading)}</h3>}
      {(section.paragraphs || []).map((p, i) => (
        <p key={i} style={i === 0 && section.orderedList ? { marginBottom: 5 } : undefined}>
          {t.isAr ? arNums(t.para(p)) : p}
        </p>
      ))}
      {section.orderedList && (
        <ol style={t.isAr ? { listStyle: 'none', padding: 0 } : undefined}>
          {section.orderedList.map((li, i) => (
            <li key={i}>
              {t.isAr ? `${arNums(String(i + 1))}. ${arNums(t.item(li))}` : li}
            </li>
          ))}
        </ol>
      )}
      {section.items && (
        <ul>
          {section.items.map((li, i) => <li key={i}>{t.isAr ? arNums(t.item(li)) : li}</li>)}
        </ul>
      )}
      {section.columns && (
        <div className="deepfit-two-column">
          {section.columns.map((col, i) => (
            <div className="deepfit-column" key={i}>
              <h4>{t.ui(col.heading)}</h4>
              {(col.paragraphs || []).map((p, k) => (
                <p key={k}>{t.isAr ? arNums(t.para(p)) : p}</p>
              ))}
              <ul>
                {col.items.map((li, j) => <li key={j}>{t.item(li)}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Client-facing assessment summary (§4.4): what the plan was calculated from,
// in plain language — the body-composition findings, the estimated energy
// needs, the goal, and how those produce the daily target. Renders only when
// the plan carries an assessment (plans generated before this existed simply
// omit the block) and only for figures that were actually measured.
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
  // Values are localized individually and substituted in.
  const tpl = (key, vals) => Object.entries(vals)
    .reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t.ui(key))

  const metrics = [
    a.weight && { label: 'Weight', value: `${t.num(a.weight)} ${t.ui('kg')}` },
    a.height && { label: 'Height', value: `${t.num(a.height)} ${t.ui('cm')}` },
    a.bodyFatPct && { label: 'Body Fat', value: `${t.num(a.bodyFatPct)}%` },
    a.muscleMass && { label: 'Muscle Mass', value: `${t.num(a.muscleMass)} ${t.ui('kg')}` },
  ].filter(Boolean)

  // The dietitian's approved target can differ from the calculated one; when it
  // does, state the calculated figure and then the final decision.
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
        {adjusted && (
          <p className="deepfit-assessment-note">
            {tpl(ASSESS.adjusted, { final: kcal(final) })}
          </p>
        )}
      </div>
    </div>
  )
}

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

export default function DeepFitTemplate({
  plan, lang = 'en', gym, selectable = false, selection, onSelect, warnings, pageRefs, only = null,
}) {
  if (!plan?.meals) return null
  const t = makeT(lang)
  const pres = MEAL_PRESENTATION[plan.isIF ? 'if' : 'regular']
  // Presentation for a meal: a custom/renamed meal carries its own title/icon;
  // otherwise fall back to the fixed slot presentation, then a safe default so an
  // added slot never crashes the render.
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
  // submit() stamps the sign-off on the plan root; accept either position so a
  // plan saved under the older shape still renders it.
  const approval = plan.approval || h.approval

  const infoRow = (
    <div className="deepfit-info-row">
      <div className="deepfit-info-left">
        <div><span className="deepfit-info-label">{t.ui('Name:')}</span> {h.fullName}</div>
        <div><span className="deepfit-info-label">{t.ui('Age:')}</span> {t.num(calcAge(h.dob))}</div>
        <div><span className="deepfit-info-label">{t.ui('Date:')}</span> {t.num(fmtDate(h.testDate))}</div>
      </div>
      <div className="deepfit-info-right">
        <div><span className="deepfit-info-label">{t.ui('Next Check up:')}</span> {t.num(h.nextCheckup ? fmtDate(h.nextCheckup) : '')}</div>
        <div><span className="deepfit-info-label">{t.ui('Daily Calories:')}</span> {h.dailyKcal ? t.num(h.dailyKcal) : ''}</div>
      </div>
    </div>
  )

  const bgStyle = { '--deepfit-bg': `url(${ASSET('logo-background.png')})` }

  return (
    <div
      className="deepfit-root"
      dir={t.isAr ? 'rtl' : 'ltr'}
      style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center' }}
    >
      {pages.map((page, idx) => {
        if (only != null && only !== idx) return null
        const ref = pageRefs ? (el) => pageRefs(idx, el) : undefined
        if (page.type === 'cover') {
          const meal = mealById[page.mealId]
          return (
            <div className="deepfit-page" key={idx} ref={ref} style={bgStyle}>
              <Header gym={gym} t={t} />
              <div className="deepfit-content">
                {infoRow}
                <div className="deepfit-diet-type">
                  <b>{t.ui('DIET TYPE:')}</b> {t.ui(h.dietType)}
                </div>
                <div className="deepfit-diet-intro">{t.isAr && UI.diet_intro ? UI.diet_intro : DIET_INTRO}</div>
                <AssessmentSummary assessment={plan.assessment} dailyKcal={h.dailyKcal} t={t} />
                {meal && (
                  <MealTable meal={meal} title={presFor(meal).title} icon={presFor(meal).icon}
                    t={t} selectable={selectable} selection={selection} onSelect={onSelect} warnings={warnings} />
                )}
                <Wave />
              </div>
              <Footer t={t} page={idx + 1} total={pages.length} />
            </div>
          )
        }
        if (page.type === 'meal') {
          const meal = mealById[page.mealId]
          return (
            <div className="deepfit-page" key={idx} ref={ref} style={bgStyle}>
              <Header gym={gym} t={t} />
              <div className="deepfit-content deepfit-meal-page">
                <MealTable meal={meal} title={presFor(meal).title} icon={presFor(meal).icon}
                  t={t} selectable={selectable} selection={selection} onSelect={onSelect} warnings={warnings} />
                <Wave variant="low" />
              </div>
              <Footer t={t} page={idx + 1} total={pages.length} />
            </div>
          )
        }
        const sections = page.type === 'guidelines1' ? GUIDELINES_PAGE_1 : GUIDELINES_PAGE_2
        return (
          <div className="deepfit-page" key={idx} ref={ref} style={bgStyle}>
            <Header gym={gym} t={t} />
            <div className="deepfit-content">
              {page.type === 'guidelines1' && (
                <>
                  <div className="deepfit-guidelines-title">{t.ui(ABOUT_TITLE)}</div>
                  {ABOUT_SECTIONS.map((s, i) => <GuidelinesSection section={s} t={t} key={`about${i}`} />)}
                </>
              )}
              <div className="deepfit-guidelines-title">{t.ui(GUIDELINES_TITLE)}</div>
              {page.type === 'guidelines1' && (
                <p className="deepfit-diet-intro" style={{ fontSize: 12 }}>
                  {t.isAr && UI.guidelines_intro ? UI.guidelines_intro : GUIDELINES_INTRO}
                </p>
              )}
              {sections.map((s, i) => <GuidelinesSection section={s} t={t} key={i} />)}
              {page.type === 'guidelines2' && approval?.name && (
                <div className="deepfit-signoff">
                  <div className="deepfit-signoff-label">{t.ui('Reviewed & approved by')}</div>
                  <div className="deepfit-signoff-name">
                    {approval.name}
                    {approval.title ? `, ${approval.title}` : ''}
                    {approval.registration ? ` · ${approval.registration}` : ''}
                  </div>
                  {approval.date && (
                    <div className="deepfit-signoff-date">{t.ui('Date')}: {t.num(fmtDate(approval.date))}</div>
                  )}
                  {approval.note && <div className="deepfit-signoff-note">{approval.note}</div>}
                </div>
              )}
              <Wave variant={page.type === 'guidelines1' ? 'low' : undefined} />
            </div>
            <Footer t={t} page={idx + 1} total={pages.length} />
          </div>
        )
      })}
    </div>
  )
}
