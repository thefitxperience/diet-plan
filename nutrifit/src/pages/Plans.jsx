import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { Loading, StatusBadge, fmtDateTime } from '../components/ui'

const STATUSES = ['', 'DRAFT', 'GENERATED', 'IN_REVIEW', 'NUTRITIONIST_APPROVED', 'CHANGES_REQUESTED', 'GYM_APPROVED', 'SENT']

export default function Plans() {
  const { t, lang } = useI18n()
  const { role } = useAuth()
  const navigate = useNavigate()
  const [plans, setPlans] = useState(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    let q = supabase.from('plans')
      .select('id, status, version, updated_at, clients(first_name, last_name)')
      .order('updated_at', { ascending: false })
    if (status) q = q.eq('status', status)
    q.then(({ data }) => setPlans(data || []))
  }, [status])

  if (!plans) return <Loading />

  const openPlan = (p) => {
    const editable = ['DRAFT', 'GENERATED', 'IN_REVIEW', 'CHANGES_REQUESTED'].includes(p.status)
    navigate(editable && (role === 'nutritionist' || role === 'platform_admin')
      ? `/plans/${p.id}/edit` : `/plans/${p.id}`)
  }

  return (
    <div>
      <div className="row between">
        <h1>{t('plans.title')}</h1>
        <select style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s ? t(`status.${s}`) : t('common.status')}</option>
          ))}
        </select>
      </div>
      {plans.length === 0 ? (
        <div className="card muted">{t('plans.empty')}</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>{t('plans.client')}</th>
              <th>{t('common.status')}</th>
              <th>{t('plans.version')}</th>
              <th>{t('plans.updated')}</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => openPlan(p)}>
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
