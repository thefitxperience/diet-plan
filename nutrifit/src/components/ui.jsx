import { useNavigate } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { arDigits } from '../lib/digits'

export function StatusBadge({ status }) {
  const { t } = useI18n()
  return <span className={`badge ${status}`}>{t(`status.${status}`)}</span>
}

// Back chevron for pages opened from a list — sits left of the title, goes back one page.
export function BackButton() {
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  return (
    <button className="back-btn" onClick={() => navigate(-1)} aria-label={t('common.back')} title={t('common.back')}>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        style={{ transform: lang === 'ar' ? 'scaleX(-1)' : 'none' }}>
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </button>
  )
}

export function Spinner() {
  return <span className="spinner" aria-label="loading" />
}

export function Loading() {
  const { t } = useI18n()
  return (
    <div className="center">
      <Spinner />
      <div className="muted">{t('common.loading')}</div>
    </div>
  )
}

export function Field({ label, hint, required, error, children, className }) {
  return (
    <label className={`field ${className || ''}`}>
      <span style={error ? { color: 'var(--danger)' } : undefined}>{label}{required && ' *'}</span>
      {children}
      {hint && <div className="hint" style={error ? { color: 'var(--danger)' } : undefined}>{hint}</div>}
    </label>
  )
}

// Numbered wizard progress (intake, New Plan). The track runs from the first
// circle's centre to the last one's and the fill stops exactly on the current
// step — both derived from the step count, so any number of steps lines up.
export function StepProgress({ step, labels }) {
  const { lang } = useI18n()
  const n = labels.length
  return (
    <div className="stepper" style={{ '--steps': n, '--progress': n > 1 ? (step - 1) / (n - 1) : 0 }}>
      <div className="stepper-track" aria-hidden="true"><div className="stepper-fill" /></div>
      <ol className="stepper-steps">
        {labels.map((label, i) => {
          const s = i + 1
          const state = s < step ? 'done' : s === step ? 'current' : 'todo'
          return (
            <li key={s} className={`stepper-step ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="stepper-dot">
                {state === 'done'
                  ? <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  : arDigits(s, lang)}
              </span>
              <span className="stepper-label">{label}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export function Alert({ kind = 'info', children }) {
  if (!children) return null
  return <div className={`alert ${kind}`}>{children}</div>
}

// Arabic locale forced to Gregorian calendar + Arabic-Indic digits so dates
// render consistently (some devices default 'ar' to the Hijri calendar).
const AR_LOCALE = 'ar-u-ca-gregory-nu-arab'

export function fmtDateTime(iso, lang = 'en') {
  if (!iso) return ''
  return new Date(iso).toLocaleString(lang === 'ar' ? AR_LOCALE : 'en-GB', {
    dateStyle: 'medium', timeStyle: 'short',
  })
}

export function fmtDate(iso, lang = 'en', opts) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(lang === 'ar' ? AR_LOCALE : 'en-GB', opts)
}
