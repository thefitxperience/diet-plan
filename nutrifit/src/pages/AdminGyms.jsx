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
      <table className="data">
        <thead><tr><th>{t('common.name')}</th><th>ID</th></tr></thead>
        <tbody>
          {gyms.map((g) => (
            <tr key={g.id}>
              <td><b>{g.name}</b></td>
              <td><code className="small">{g.id}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
