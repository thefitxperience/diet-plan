// Platform admin: approve pending gym admins (and anyone else pending), and
// manage existing users' role/gym. Accounts self-register via signup, so no
// manual SQL is needed anymore.
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useQuery } from '../lib/useQuery'
import { Alert, Loading, Spinner } from '../components/ui'

const ROLES = ['nutritionist', 'gym_admin', 'platform_admin']

export default function AdminUsers() {
  const { t } = useI18n()
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(null)

  const { data, setData, refresh } = useQuery('admin:users', async () => {
    const [u, g] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('gyms').select('id, name').order('name'),
    ])
    return { users: u.data || [], gyms: g.data || [] }
  })
  const users = data?.users
  const gyms = data?.gyms || []

  function gymName(id) { return gyms.find((g) => g.id === id)?.name }

  async function update(id, patch) {
    setError(null); setNotice(null)
    const { data: updated, error: err } = await supabase.from('profiles').update(patch).eq('id', id).select().single()
    if (err) { setError(err.message); return }
    setData({ ...data, users: users.map((u) => (u.id === id ? updated : u)) })
    setNotice(t('settings.saved'))
  }

  async function review(id, action) {
    setBusy(id + action); setError(null); setNotice(null)
    try {
      const { error: e } = await supabase.rpc(action === 'approve' ? 'approve_profile' : 'reject_profile', { p_profile_id: id })
      if (e) throw e
      await refresh()
    } catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  if (!users) return <Loading />

  const pending = users.filter((u) => u.status === 'pending')
  const active = users.filter((u) => u.status !== 'pending')

  return (
    <div>
      <h1>{t('admin.users')}</h1>
      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{notice}</Alert>

      <h2>{t('team.pending')} {pending.length > 0 && <span className="badge IN_REVIEW">{pending.length}</span>}</h2>
      {pending.length === 0 ? (
        <div className="card muted">{t('team.noPending')}</div>
      ) : (
        <table className="data">
          <thead><tr><th>{t('common.name')}</th><th>{t('admin.role')}</th><th>{t('admin.gym')}</th><th>{t('common.actions')}</th></tr></thead>
          <tbody>
            {pending.map((u) => (
              <tr key={u.id}>
                <td><b>{u.full_name}</b></td>
                <td>{t(`role.${u.role}`)}</td>
                <td>{u.gym_id ? gymName(u.gym_id) : (u.requested_gym_name ? `＋ ${u.requested_gym_name}` : '—')}</td>
                <td>
                  <div className="row">
                    <button className="btn sm" disabled={!!busy} onClick={() => review(u.id, 'approve')}>
                      {busy === u.id + 'approve' ? <Spinner /> : t('approvals.approve')}
                    </button>
                    <button className="btn danger sm" disabled={!!busy} onClick={() => review(u.id, 'reject')}>
                      {busy === u.id + 'reject' ? <Spinner /> : t('common.delete')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: '1.5rem' }}>{t('admin.users')}</h2>
      <table className="data">
        <thead>
          <tr><th>{t('common.name')}</th><th>{t('admin.role')}</th><th>{t('admin.gym')}</th></tr>
        </thead>
        <tbody>
          {active.map((u) => (
            <tr key={u.id}>
              <td><b>{u.full_name}</b><div className="muted small"><code>{u.id}</code></div></td>
              <td>
                <select value={u.role} onChange={(e) => update(u.id, { role: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                </select>
              </td>
              <td>
                <select value={u.gym_id || ''} onChange={(e) => update(u.id, { gym_id: e.target.value || null })}>
                  <option value="">—</option>
                  {gyms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
