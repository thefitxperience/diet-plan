// Gym approval queue (plan §1 step 8): read-only preview + Approve /
// Request Changes (comment mandatory on reject).

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { Loading, StatusBadge, fmtDateTime } from '../components/ui'

export default function Approvals() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const [plans, setPlans] = useState(null)

  useEffect(() => {
    supabase.from('plans')
      .select('id, status, version, updated_at, clients(first_name, last_name)')
      .eq('status', 'NUTRITIONIST_APPROVED')
      .order('updated_at', { ascending: true })
      .then(({ data }) => setPlans(data || []))
  }, [])

  if (!plans) return <Loading />

  return (
    <div>
      <h1>{t('approvals.title')}</h1>
      {plans.length === 0 ? (
        <div className="card muted">{t('approvals.empty')}</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>{t('plans.client')}</th>
              <th>{t('plans.version')}</th>
              <th>{t('plans.updated')}</th>
              <th>{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => navigate(`/approvals/${p.id}`)}>
                <td><b>{p.clients?.first_name} {p.clients?.last_name}</b></td>
                <td>v{p.version}</td>
                <td>{fmtDateTime(p.updated_at, lang)}</td>
                <td><StatusBadge status={p.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
