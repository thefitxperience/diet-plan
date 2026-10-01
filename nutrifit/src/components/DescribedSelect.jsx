// Single-choice dropdown whose options carry a one-line description under the
// name — a native <select> can only show plain text. Follows the WAI-ARIA
// "select-only combobox" pattern: focus stays on the trigger and the
// highlighted option is announced via aria-activedescendant.
//
// On phones (CSS breakpoint in app.css) the list opens as a bottom sheet over a
// backdrop, sized to show every option at once; on wider screens it is a
// popover that flips above the trigger when there is no room below.
//
// options: [{ id, label, desc? }]

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

// Matches the exit animations in app.css (dsel-*-out).
const CLOSE_MS = 200

export default function DescribedSelect({ value, onChange, options, placeholder, labelledBy, title }) {
  // 'closed' → 'open' → 'closing' (exit animation still on screen) → 'closed'
  const [phase, setPhase] = useState('closed')
  const open = phase === 'open'
  const [up, setUp] = useState(false)
  const [active, setActive] = useState(-1)
  const rootRef = useRef()
  const triggerRef = useRef()
  const popRef = useRef()
  const listRef = useRef()
  const closeTimer = useRef()
  const id = useId()
  const selected = options.find((o) => o.id === value)

  // Close on a tap/click anywhere outside.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) dismiss() }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  // Place the list before paint. Sheet mode (position: fixed) locks the page
  // behind it; popover mode opens upward when the space below is too short.
  useLayoutEffect(() => {
    if (!open) return
    const pop = popRef.current
    if (getComputedStyle(pop).position === 'fixed') {
      const html = document.documentElement
      const prev = html.style.overflow
      html.style.overflow = 'hidden'
      return () => { html.style.overflow = prev }
    }
    const r = triggerRef.current.getBoundingClientRect()
    const below = window.innerHeight - r.bottom
    setUp(pop.offsetHeight > below && r.top > below)
  }, [open])

  // Keep the highlighted option visible while arrowing through a long list.
  useEffect(() => {
    if (open && active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  function openList() {
    clearTimeout(closeTimer.current)
    setActive(Math.max(0, options.findIndex((o) => o.id === value)))
    setPhase('open')
  }

  // Play the exit animation, then unmount.
  function dismiss() {
    setPhase('closing')
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setPhase('closed'), CLOSE_MS)
  }

  function close() {
    dismiss()
    triggerRef.current?.focus({ preventScroll: true })
  }

  function choose(i) {
    onChange(options[i].id)
    close()
  }

  function onKeyDown(e) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList() }
      return
    }
    const last = options.length - 1
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive((i) => Math.min(last, i + 1)); break
      case 'ArrowUp': e.preventDefault(); setActive((i) => Math.max(0, i - 1)); break
      case 'Home': e.preventDefault(); setActive(0); break
      case 'End': e.preventDefault(); setActive(last); break
      case 'Enter':
      case ' ': e.preventDefault(); if (active >= 0) choose(active); break
      case 'Escape': e.preventDefault(); close(); break
      case 'Tab': dismiss(); break
      default:
    }
  }

  return (
    <div className={`dsel ${open ? 'open' : ''} ${phase === 'closing' ? 'closing' : ''} ${up ? 'up' : ''}`} ref={rootRef}>
      <div
        ref={triggerRef}
        className="dsel-trigger"
        role="combobox"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-labelledby={labelledBy}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        onClick={() => (open ? dismiss() : openList())}
        onKeyDown={onKeyDown}
      >
        {selected ? (
          <span className="dsel-text">
            <span className="dsel-label">{selected.label}</span>
            {selected.desc && <span className="dsel-desc">{selected.desc}</span>}
          </span>
        ) : (
          <span className="dsel-text dsel-placeholder">{placeholder}</span>
        )}
        <span className="dsel-caret" aria-hidden="true" />
      </div>

      {phase !== 'closed' && (
        <>
          <div className="dsel-backdrop" onClick={close} aria-hidden="true" />
          <div className="dsel-pop" ref={popRef}>
            {title && <div className="dsel-sheet-title" aria-hidden="true">{title}</div>}
            <ul className="dsel-list" role="listbox" id={`${id}-list`} ref={listRef} aria-labelledby={labelledBy}>
              {options.map((o, i) => (
                <li
                  key={o.id}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={o.id === value}
                  className={`dsel-option ${i === active ? 'active' : ''} ${o.id === value ? 'selected' : ''}`}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => choose(i)}
                >
                  <span className="dsel-text">
                    <span className="dsel-label">{o.label}</span>
                    {o.desc && <span className="dsel-desc">{o.desc}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
