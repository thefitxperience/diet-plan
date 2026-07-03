// First-login registration: the user picks their role and gym. Creates a
// PENDING profile (via register_profile RPC) that an approver must accept.
// The very first user of the whole system is bootstrapped to platform_admin.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { Field, Alert, Spinner } from '../components/ui'

export default function Onboarding() {
  const { t } = useI18n()
  const { user, reloadProfile, signOut } = useAuth()
  const [role, setRole] = useState('nutritionist')
  const [gyms, setGyms] = useState(null)
  const [gymId, setGymId] = useState('')
  const [gymMode, setGymMode] = useState('new') // gym_admin: 'new' | 'existing'
  const [newGymName, setNewGymName] = useState('')
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name || '')
  const [firstUser, setFirstUser] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase.rpc('system_has_users').then(({ data }) => setFirstUser(data === false))
    supabase.rpc('list_gyms').then(({ data }) => setGyms(data || []))
  }, [])

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const args = { p_full_name: fullName }
      if (!firstUser) {
        args.p_role = role
        if (role === 'nutritionist') {
          if (!gymId) throw new Error(t('onboarding.pickGym'))
          args.p_gym_id = gymId
        } else if (gymMode === 'existing') {
          if (!gymId) throw new Error(t('onboarding.pickGym'))
          args.p_gym_id = gymId
        } else {
          if (!newGymName.trim()) throw new Error(t('onboarding.enterGym'))
          args.p_new_gym_name = newGymName.trim()
        }
      }
      const { error: rpcErr } = await supabase.rpc('register_profile', args)
      if (rpcErr) throw rpcErr
      reloadProfile()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const noGyms = gyms && gyms.length === 0

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ maxWidth: 460 }}>
        <h1>{t('onboarding.title')}</h1>
        <p className="muted small" style={{ marginTop: '-0.5rem' }}>{t('onboarding.subtitle')}</p>
        <Alert kind="error">{error}</Alert>

        {firstUser ? (
          <Alert kind="info">{t('onboarding.firstUser')}</Alert>
        ) : null}

        <form onSubmit={submit}>
          <Field label={t('auth.fullname')} required>
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </Field>

          {!firstUser && (
            <>
              <Field label={t('onboarding.role')} required>
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="nutritionist">{t('onboarding.nutritionist')}</option>
                  <option value="gym_admin">{t('onboarding.gymAdmin')}</option>
                </select>
              </Field>

              {role === 'nutritionist' && (
                <Field label={t('onboarding.yourGym')} required
                  hint={noGyms ? t('onboarding.noGyms') : undefined}>
                  <select value={gymId} onChange={(e) => setGymId(e.target.value)} disabled={noGyms}>
                    <option value="">—</option>
                    {(gyms || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </Field>
              )}

              {role === 'gym_admin' && (
                <>
                  <Field label={t('onboarding.gymSetup')}>
                    <select value={gymMode} onChange={(e) => setGymMode(e.target.value)}>
                      <option value="new">{t('onboarding.createGym')}</option>
                      <option value="existing">{t('onboarding.joinGym')}</option>
                    </select>
                  </Field>
                  {gymMode === 'new' ? (
                    <Field label={t('onboarding.gymName')} required>
                      <input type="text" value={newGymName} onChange={(e) => setNewGymName(e.target.value)} />
                    </Field>
                  ) : (
                    <Field label={t('onboarding.yourGym')} required hint={noGyms ? t('onboarding.noGyms') : undefined}>
                      <select value={gymId} onChange={(e) => setGymId(e.target.value)} disabled={noGyms}>
                        <option value="">—</option>
                        {(gyms || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </Field>
                  )}
                </>
              )}
            </>
          )}

          <button className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? <Spinner /> : t('onboarding.submit')}
          </button>
        </form>

        <div className="row end" style={{ marginTop: '0.75rem' }}>
          <button className="btn ghost sm" onClick={signOut}>{t('nav.signout')}</button>
        </div>
      </div>
    </div>
  )
}
