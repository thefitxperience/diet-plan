import { useI18n } from '../lib/i18n'

export function StatusBadge({ status }) {
  const { t } = useI18n()
  return <span className={`badge ${status}`}>{t(`status.${status}`)}</span>
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

export function fmtDateTime(iso, lang = 'en') {
  if (!iso) return ''
  return new Date(iso).toLocaleString(lang === 'ar' ? 'ar' : 'en-GB', {
    dateStyle: 'medium', timeStyle: 'short',
  })
}

export function fmtDate(iso, lang = 'en') {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(lang === 'ar' ? 'ar' : 'en-GB')
}
