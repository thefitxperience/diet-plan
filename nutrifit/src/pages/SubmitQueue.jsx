// Nutritionist "Approvals" tab: plans awaiting the nutritionist's approval —
// anything generated/in-review/draft that hasn't been approved or sent yet.

import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useQuery } from '../lib/useQuery'
import { Loading, StatusBadge, fmtDateTime } from '../components/ui'

const TO_SUBMIT = ['IN_REVIEW', 'GENERATED', 'DRAFT']

export default function SubmitQueue() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()

  const { data: plans } = useQuery('submit-queue', async () => {
    const { data } = await supabase.from('plans')
      .select('id, status, version, updated_at, clients(first_name, last_name)')
      .in('status', TO_SUBMIT)
      .order('updated_at', { ascending: false })
    return data || []
  })

  if (!plans) return <Loading />

  return (
    <div>
      <h1 style={{ marginBottom: '1rem' }}>{t('nav.approvals')}</h1>
      {plans.length === 0 ? (
        <div className="card muted">{t('submit.empty')}</div>
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
              <tr key={p.id} className="clickable" onClick={() => navigate(`/plans/${p.id}/edit`)}>
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
