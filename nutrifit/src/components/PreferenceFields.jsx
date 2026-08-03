// Client food-preference input (review §4.2), shared by the self-service intake
// and the nutritionist wizard.
//
// Dislikes are stored as exact catalog ingredient names so generateCatalogPlan
// can rank dishes containing them out of the plan. They are a preference, not a
// safety rule — a disliked dish sinks to last resort rather than being dropped,
// so a long list can never leave a meal empty.

import { useState } from 'react'
import { KNOWN_INGREDIENTS } from '../lib/planModel'
import { useI18n } from '../lib/i18n'

// Searchable, because a flat list of every known ingredient is unusable on a
// phone. Values stored are English catalog names so the generator can match them.
export function DislikePicker({ value = [], onChange }) {
  const { t, lang } = useI18n()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const label = (name) => {
    const hit = KNOWN_INGREDIENTS.find((i) => i.name_en === name)
    return lang === 'ar' && hit?.name_ar ? hit.name_ar : name
  }
  const query = q.trim().toLowerCase()
  const matches = query
    ? KNOWN_INGREDIENTS
      .filter((i) => !value.includes(i.name_en))
      .filter((i) => i.name_en.toLowerCase().includes(query) || (i.name_ar || '').includes(q.trim()))
      .slice(0, 8)
    : []

  const add = (name) => { onChange([...value, name]); setQ(''); setOpen(false) }

  return (
    <div>
      <div className="ingredient-add">
        <input
          type="text" value={q} placeholder={t('pref.dislikesPlaceholder')}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches.length) { e.preventDefault(); add(matches[0].name_en) }
            if (e.key === 'Escape') setOpen(false)
          }}
        />
        {open && matches.length > 0 && (
          <ul className="ingredient-dropdown">
            {matches.map((i) => (
              <li key={i.name_en}>
                <button type="button" className="ingredient-dropdown-item"
                  onMouseDown={(e) => e.preventDefault()} onClick={() => add(i.name_en)}>
                  {lang === 'ar' && i.name_ar ? i.name_ar : i.name_en}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* Selections sit BELOW the search box — that's where the eye already is
          after picking one, so they're not missed. */}
      {value.length > 0 && (
        <div className="pref-chips">
          {value.map((name) => (
            <span className="pref-chip" key={name}>
              {label(name)}
              <button
                type="button" title={t('common.delete')} aria-label={t('common.delete')}
                // this lives inside a <label>, so a plain click would also focus
                // the search input — suppress that, we only want the removal
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChange(value.filter((x) => x !== name))}
              >×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
