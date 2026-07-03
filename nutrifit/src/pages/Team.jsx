import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { useQuery } from '../lib/useQuery'
import { Loading, Alert, Spinner } from '../components/ui'

export default function Team() {
  const { t } = useI18n()
  const { profile } = useAuth()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const { data: members, refresh } = useQuery(`team:${profile.gym_id}`, async () => {
    const { data } = await supabase.from('profiles').select('*').eq('gym_id', profile.gym_id)
    return data || []
  }, [profile.gym_id])

  if (!members) return <Loading />

  const pending = members.filter((m) => m.status === 'pending')
  const active = members.filter((m) => m.status !== 'pending')

  async function review(id, action) {
    setBusy(id + action)
    setError(null)
    try {
      const { error: e } = await supabase.rpc(action === 'approve' ? 'approve_profile' : 'reject_profile', { p_profile_id: id })
      if (e) throw e
      await refresh()
    } catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  return (
    <div>
      <h1>{t('team.title')}</h1>
      <Alert kind="error">{error}</Alert>

      <h2>{t('team.pending')} {pending.length > 0 && <span className="badge IN_REVIEW">{pending.length}</span>}</h2>
      {pending.length === 0 ? (
        <div className="card muted">{t('team.noPending')}</div>
      ) : (
        <table className="data">
          <thead><tr><th>{t('common.name')}</th><th>{t('admin.role')}</th><th>{t('common.actions')}</th></tr></thead>
          <tbody>
            {pending.map((m) => (
              <tr key={m.id}>
                <td><b>{m.full_name}</b></td>
                <td>{m.role}</td>
                <td>
                  <div className="row">
                    <button className="btn sm" disabled={!!busy} onClick={() => review(m.id, 'approve')}>
                      {busy === m.id + 'approve' ? <Spinner /> : t('approvals.approve')}
                    </button>
                    <button className="btn danger sm" disabled={!!busy} onClick={() => review(m.id, 'reject')}>
                      {busy === m.id + 'reject' ? <Spinner /> : t('common.delete')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: '1.5rem' }}>{t('team.title')}</h2>
      <table className="data">
        <thead><tr><th>{t('common.name')}</th><th>{t('admin.role')}</th><th>{t('common.status')}</th></tr></thead>
        <tbody>
          {active.map((m) => (
            <tr key={m.id}>
              <td><b>{m.full_name}</b></td>
              <td>{m.role}</td>
              <td>{m.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
