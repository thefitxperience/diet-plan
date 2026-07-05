import { useNavigate } from 'react-router-dom'
import { useI18n } from '../lib/i18n'

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

export function fmtDate(iso, lang = 'en') {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(lang === 'ar' ? AR_LOCALE : 'en-GB')
}
