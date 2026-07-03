import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { Field, Alert } from '../components/ui'
import { supabaseConfigured } from '../lib/supabase'

export default function Login() {
  const { signIn, signUp } = useAuth()
  const { t, lang, setLang } = useI18n()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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

  return (
    <div className="login-wrap">
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
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
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
      </div>
    </div>
  )
}
