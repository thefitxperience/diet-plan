// Client food-preference input (review §4.2), shared by the self-service intake
// and the nutritionist wizard.
//
// Dislikes are stored as exact catalog ingredient names so generateCatalogPlan
// can rank dishes containing them out of the plan. They are a preference, not a
// safety rule — a disliked dish sinks to last resort rather than being dropped,
// so a long list can never leave a meal empty.

import { useEffect, useRef, useState } from 'react'
import { KNOWN_INGREDIENTS } from '../lib/planModel'
import { AVOID_GROUPS, avoidGroup } from '../lib/dietaryRules'
import { useI18n } from '../lib/i18n'

/** Display name of a stored dislike: a food group ("All fish") or an ingredient. */
export function dislikeLabel(name, lang) {
  const group = avoidGroup(name)
  if (group) return lang === 'ar' ? group.ar : group.id
  const hit = KNOWN_INGREDIENTS.find((i) => i.name_en === name)
  return lang === 'ar' && hit?.name_ar ? hit.name_ar : name
}

// On a phone the keyboard covers the bottom half of the screen, and this box
// sits low on the intake's last step. The browser already scrolls a focused box
// into view above the keyboard, so the list adapts to where the box ended up
// instead of moving the page: it opens below when there's room, otherwise
// upward into the space above the box, never taller than the room it has.
//
// It must never scroll the page itself. On iPhone, Safari's toolbar grows and
// shrinks as the page scrolls, which resizes the visible area; scrolling in
// response to that resize looped, and the page bounced without stopping.
// Opening upward also keeps the page height fixed while typing: a list hanging
// below the last field changed the page height with every letter, and the
// browser shifted the page each time.
const LIST_MAX = 280
const LIST_MIN = 120
// Safari's toolbar can sit over the bottom of the visible area, just above the
// keyboard; keep the list clear of it.
const TOOLBAR_ROOM = 56
function useListPlacement(active, inputRef) {
  const [place, setPlace] = useState({ up: false, max: LIST_MAX })
  useEffect(() => {
    if (!active) return undefined
    const vv = window.visualViewport
    const touch = window.matchMedia?.('(pointer: coarse)').matches
    let frame = 0
    const measure = () => {
      frame = 0
      const el = inputRef.current
      if (!el) return
      const top = vv ? vv.offsetTop : 0
      const bottom = top + (vv ? vv.height : window.innerHeight) - (touch ? TOOLBAR_ROOM : 8)
      const r = el.getBoundingClientRect()
      const below = bottom - r.bottom - 4
      const above = r.top - top - 8
      const up = below < Math.min(LIST_MAX, 220) && above > below
      const max = Math.max(LIST_MIN, Math.min(LIST_MAX, up ? above : below))
      setPlace((p) => (p.up === up && p.max === max ? p : { up, max }))
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    measure()
    // the keyboard slides up over a few hundred ms after focus
    const timers = [150, 400, 800].map((ms) => setTimeout(schedule, ms))
    vv?.addEventListener('resize', schedule)
    vv?.addEventListener('scroll', schedule)
    window.addEventListener('scroll', schedule, { passive: true })
    return () => {
      timers.forEach(clearTimeout)
      if (frame) cancelAnimationFrame(frame)
      vv?.removeEventListener('resize', schedule)
      vv?.removeEventListener('scroll', schedule)
      window.removeEventListener('scroll', schedule)
    }
  }, [active, inputRef])
  return place
}

// Searchable, because a flat list of every known ingredient is unusable on a
// phone. Values stored are English catalog names so the generator can match them.
// Single foods come first, so "turkey" picks turkey, not all poultry; a food
// group ("All fish") is added at the end when the search names the group itself.
export function DislikePicker({ value = [], onChange }) {
  const { t, lang } = useI18n()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef(null)
  const [focused, setFocused] = useState(false)
  const listPlace = useListPlacement(focused, inputRef)
  const query = q.trim().toLowerCase()
  const picked = value.map(avoidGroup).filter(Boolean)
  const coveredByGroup = (name) => picked.some((g) => g.match.test(name.toLowerCase()))
  const groupHit = (g) => g.id.toLowerCase().includes(query) || g.ar.includes(q.trim())
  const groups = AVOID_GROUPS.filter((g) => query && !value.includes(g.id) && groupHit(g))
    .map((g) => ({ value: g.id, label: lang === 'ar' ? g.ar : g.id, hint: lang === 'ar' ? g.hintAr : g.hint }))
  const foods = query
    ? KNOWN_INGREDIENTS
      .filter((i) => !value.includes(i.name_en) && !coveredByGroup(i.name_en))
      .filter((i) => i.name_en.toLowerCase().includes(query) || (i.name_ar || '').includes(q.trim()))
      .map((i) => ({ value: i.name_en, label: lang === 'ar' && i.name_ar ? i.name_ar : i.name_en }))
    : []
  const matches = [...foods.slice(0, 8 - groups.length), ...groups]

  // Picking a group drops the single foods it already covers.
  const add = (name) => {
    const group = avoidGroup(name)
    const rest = group ? value.filter((v) => avoidGroup(v) || !group.match.test(v.toLowerCase())) : value
    onChange([...rest, name]); setQ(''); setOpen(false)
  }

  return (
    <div>
      <div className="ingredient-add">
        <input
          ref={inputRef}
          type="text" value={q} placeholder={t('pref.dislikesPlaceholder')}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => { setOpen(true); setFocused(true) }}
          onBlur={() => { setFocused(false); setTimeout(() => setOpen(false), 120) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query && matches.length) { e.preventDefault(); add(matches[0].value) }
            if (e.key === 'Escape') setOpen(false)
          }}
        />
        {open && matches.length > 0 && (
          <ul className={`ingredient-dropdown${listPlace.up ? ' is-up' : ''}`} style={{ maxHeight: listPlace.max }}>
            {matches.map((m) => (
              <li key={m.value}>
                <button type="button" className={`ingredient-dropdown-item${m.hint ? ' is-group' : ''}`}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => add(m.value)}>
                  {m.label}
                  {m.hint && <span className="ingredient-dropdown-hint">{m.hint}</span>}
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
              {dislikeLabel(name, lang)}
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
