import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { useQuery } from '../lib/useQuery'
import GymFilter from '../components/GymFilter'
import { Loading, StatusBadge, fmtDateTime } from '../components/ui'

const STATUSES = ['', 'DRAFT', 'GENERATED', 'IN_REVIEW', 'NUTRITIONIST_APPROVED', 'SENT']

export default function Plans() {
  const { t, lang } = useI18n()
  const { role } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState('')
  const [gymFilter, setGymFilter] = useState('')

  const showGym = role === 'platform_admin' && !gymFilter

  const { data: plans } = useQuery(`plans:${status || 'all'}:${gymFilter || 'all'}`, async () => {
    let q = supabase.from('plans')
      .select('id, status, version, updated_at, clients(first_name, last_name), gyms:gym_id(name)')
      .order('updated_at', { ascending: false })
    if (status) q = q.eq('status', status)
    if (gymFilter) q = q.eq('gym_id', gymFilter)
    const { data } = await q
    return data || []
  }, [status, gymFilter])

  if (!plans) return <Loading />

  const openPlan = (p) => {
    const editable = ['DRAFT', 'GENERATED', 'IN_REVIEW', 'CHANGES_REQUESTED'].includes(p.status)
    navigate(editable && (role === 'nutritionist' || role === 'platform_admin')
      ? `/plans/${p.id}/edit` : `/plans/${p.id}`)
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>{t('plans.title')}</h1>
        <div className="row">
          <GymFilter value={gymFilter} onChange={setGymFilter} />
          <select style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s ? t(`status.${s}`) : t('common.status')}</option>
            ))}
          </select>
        </div>
      </div>
      {plans.length === 0 ? (
        <div className="card muted">{t('plans.empty')}</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              {showGym && <th>{t('admin.gym')}</th>}
              <th>{t('plans.client')}</th>
              <th>{t('common.status')}</th>
              <th>{t('plans.version')}</th>
              <th>{t('plans.updated')}</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => openPlan(p)}>
                {showGym && <td>{p.gyms?.name || '—'}</td>}
                <td><b>{p.clients?.first_name} {p.clients?.last_name}</b></td>
                <td><StatusBadge status={p.status} /></td>
                <td>v{p.version}</td>
                <td>{fmtDateTime(p.updated_at, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
