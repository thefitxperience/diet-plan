// Platform admin: assign roles/gyms to profiles. Auth users are created via
// Supabase (sign-up or dashboard invite); this page manages their profile row.
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useQuery } from '../lib/useQuery'
import { Alert, Loading } from '../components/ui'

const ROLES = ['nutritionist', 'gym_admin', 'platform_admin']

export default function AdminUsers() {
  const { t } = useI18n()
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const { data, setData } = useQuery('admin:users', async () => {
    const [u, g] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('gyms').select('id, name').order('name'),
    ])
    return { users: u.data || [], gyms: g.data || [] }
  })
  const users = data?.users
  const gyms = data?.gyms || []

  async function update(id, patch) {
    setError(null)
    setNotice(null)
    const { data: updated, error: err } = await supabase.from('profiles').update(patch).eq('id', id).select().single()
    if (err) { setError(err.message); return }
    setData({ ...data, users: users.map((u) => (u.id === id ? updated : u)) })
    setNotice('Updated')
  }

  if (!users) return <Loading />

  return (
    <div>
      <h1>{t('admin.users')}</h1>
      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{notice}</Alert>
      <Alert kind="info">
        New teammates: have them sign up on the login page (their sign-in will say “no profile
        provisioned”), then set their role & gym here. Rows appear after an admin inserts the
        profile — see README §Team for the SQL one-liner.
      </Alert>
      <table className="data">
        <thead>
          <tr><th>{t('common.name')}</th><th>{t('admin.role')}</th><th>{t('admin.gym')}</th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td><b>{u.full_name}</b><div className="muted small"><code>{u.id}</code></div></td>
              <td>
                <select value={u.role} onChange={(e) => update(u.id, { role: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
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
