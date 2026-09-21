import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useQuery } from '../lib/useQuery'
import { Alert, Loading } from '../components/ui'

export default function AdminGyms() {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [error, setError] = useState(null)

  const { data: gyms, refresh } = useQuery('admin:gyms', async () => {
    const { data } = await supabase.from('gyms').select('*').order('created_at')
    return data || []
  })

  // Platform admins only — a DB trigger (017) enforces the same rule, because
  // RLS is row-level and gym admins can already update their own gym row.
  async function setAutoApprove(gym, enabled) {
    setError(null)
    const { data, error: err } = await supabase.from('gyms')
      .update({ auto_approve_enabled: enabled })
      .eq('id', gym.id).select('id')
    if (err) { setError(`${t('admin.autoApproveFailed')}: ${err.message}`); return }
    if (!data?.length) { setError(t('admin.autoApproveFailed')); return }
    refresh()
  }

  async function create(e) {
    e.preventDefault()
    setError(null)
    const { error: err } = await supabase.from('gyms').insert({ name })
    if (err) { setError(err.message); return }
    setName('')
    refresh()
  }

  if (!gyms) return <Loading />

  return (
    <div>
      <h1>{t('admin.gyms')}</h1>
      <Alert kind="error">{error}</Alert>
      <form className="card" onSubmit={create}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>{t('admin.newGym')}</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required style={{ minWidth: 240 }} />
          </label>
          <button className="btn">{t('common.add')}</button>
        </div>
      </form>
      <p className="muted small" style={{ maxWidth: '68ch' }}>{t('admin.autoApproveHelp')}</p>
      <table className="data">
        <thead>
          <tr>
            <th>{t('common.name')}</th>
            <th>{t('admin.autoApprove')}</th>
            <th>ID</th>
          </tr>
        </thead>
        <tbody>
          {gyms.map((g) => {
            const on = !!g.auto_approve_enabled
            return (
              <tr key={g.id}>
                <td><b>{g.name}</b></td>
                <td>
                  <button type="button"
                    className={`switch${on ? ' on' : ''}`}
                    role="switch" aria-checked={on}
                    aria-label={t('admin.autoApproveToggle', {
                      state: on ? t('admin.autoApproveOff') : t('admin.autoApproveOn'), gym: g.name,
                    })}
                    onClick={() => setAutoApprove(g, !on)}>
                    <span className="switch-track"><span className="switch-thumb" /></span>
                    <span className="switch-label">
                      {on ? t('admin.autoApproveOn') : t('admin.autoApproveOff')}
                    </span>
                  </button>
                </td>
                <td><code className="small">{g.id}</code></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
