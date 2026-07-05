// Shown while a self-registered account is pending approval or was rejected.
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'

export default function AccountStatus({ status }) {
  const { t } = useI18n()
  const { profile, reloadProfile, signOut } = useAuth()
  const rejected = status === 'rejected'

  return (
    <div className="login-wrap">
      <div className="login-bg" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}assets/background.png)` }} />
      <div className="login-card" style={{ textAlign: 'center' }}>
        <h1>{t('app.name')}</h1>
        <div style={{ fontSize: '2.5rem', margin: '0.5rem 0' }}>{rejected ? '⛔' : '⏳'}</div>
        <h2>{rejected ? t('pending.rejectedTitle') : t('pending.title')}</h2>
        <p className="muted">
          {rejected
            ? t('pending.rejectedBody')
            : profile?.role === 'gym_admin'
              ? t('pending.bodyGymAdmin')
              : t('pending.bodyNutritionist')}
        </p>
        <div className="row" style={{ justifyContent: 'center', marginTop: '1rem' }}>
          {!rejected && (
            <button className="btn secondary" onClick={reloadProfile}>{t('pending.refresh')}</button>
          )}
          <button className="btn ghost" onClick={signOut}>{t('nav.signout')}</button>
        </div>
      </div>
    </div>
  )
}
