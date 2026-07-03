import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { Field, Alert } from '../components/ui'
import { supabaseConfigured } from '../lib/supabase'

const DEMO_ACCOUNTS = [
  { key: 'nutritionist', email: 'nutritionist@demo.thefitxperience.com' },
  { key: 'gym_admin', email: 'gymadmin@demo.thefitxperience.com' },
  { key: 'fit_admin', label: 'FIT Admin', email: 'fitadmin@demo.thefitxperience.com' },
]
const DEMO_PASSWORD = 'FITdemo2026!'

export default function Login() {
  const { signIn, signUp } = useAuth()
  const { t, lang, setLang } = useI18n()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'signup') {
        const { error } = await signUp(email, password, fullName)
        if (error) throw error
        setNotice('Account created. If email confirmation is enabled, check your inbox, then sign in.')
        setMode('signin')
      } else {
        const { error } = await signIn(email, password)
        if (error) throw error
      }
    } catch (err) {
      setError(err.message || t('auth.error'))
    } finally {
      setBusy(false)
    }
  }

  async function demoLogin(acct) {
    setBusy(true)
    setError(null)
    try {
      const { error } = await signIn(acct.email, DEMO_PASSWORD)
      if (error) throw error
    } catch (err) {
      setError(err.message || t('auth.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-bg" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}assets/background.png)` }} />
      <div className="login-card">
        <h1>{t('app.name')}</h1>
        {!supabaseConfigured && (
          <Alert kind="error">
            Supabase is not configured — copy <code>.env.example</code> to <code>.env.local</code> and
            set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, then restart.
          </Alert>
        )}
        <Alert kind="error">{error}</Alert>
        <Alert kind="ok">{notice}</Alert>
        <form onSubmit={submit}>
          {mode === 'signup' && (
            <Field label={t('auth.fullname')} required>
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </Field>
          )}
          <Field label={t('auth.email')} required>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </Field>
          <Field label={t('auth.password')} required>
            <div className="input-with-icon">
              <input type={showPassword ? 'text' : 'password'} value={password}
                onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
              <button type="button" className="input-icon-btn" onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </Field>
          <button className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={busy || !supabaseConfigured}>
            {busy ? t('auth.signingIn') : (mode === 'signup' ? t('auth.signup') : t('auth.signin'))}
          </button>
        </form>
        <div className="row between" style={{ marginTop: '1rem' }}>
          <button className="btn ghost sm" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? t('auth.createAccount') : t('auth.haveAccount')}
          </button>
          <button className="btn ghost sm" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
            {lang === 'en' ? 'العربية' : 'English'}
          </button>
        </div>

        <div className="demo-accounts">
          <div className="demo-divider"><span>{t('auth.demoAccounts')}</span></div>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            {DEMO_ACCOUNTS.map((d) => (
              <button key={d.key} type="button" className="btn secondary sm" style={{ flex: 1, justifyContent: 'center' }}
                disabled={busy || !supabaseConfigured} onClick={() => demoLogin(d)}>
                {d.label || t(`role.${d.key}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
