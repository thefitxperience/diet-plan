import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { useQuery } from '../lib/useQuery'
import { Loading, StatusBadge, fmtDateTime } from '../components/ui'

function Stat({ num, label, to }) {
  const inner = (
    <div className="card stat">
      <div className="num">{num}</div>
      <div className="lbl">{label}</div>
    </div>
  )
  return to ? <Link to={to} style={{ textDecoration: 'none', color: 'inherit' }}>{inner}</Link> : inner
}

export default function Dashboard() {
  const { t, lang } = useI18n()
  const { role } = useAuth()

  const { data } = useQuery('dashboard', async () => {
    const [plans, clients, nutritionists, gyms, events] = await Promise.all([
      supabase.from('plans').select('id, status, version, updated_at, clients(first_name, last_name)').order('updated_at', { ascending: false }).limit(1000),
      supabase.from('clients').select('id', { count: 'exact', head: true }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'nutritionist').eq('status', 'active'),
      supabase.from('gyms').select('id', { count: 'exact', head: true }),
      supabase.from('plan_events')
        .select('*, profiles:actor(full_name), plans(clients(first_name, last_name)), gyms:gym_id(name)')
        .order('created_at', { ascending: false }).limit(12),
    ])
    return {
      plans: plans.data || [],
      clientCount: clients.count || 0,
      nutritionistCount: nutritionists.count || 0,
      gymCount: gyms.count || 0,
      events: events.data || [],
    }
  })

  if (!data) return <Loading />

  const byStatus = (statuses) => data.plans.filter((p) => statuses.includes(p.status))
  const inProgress = byStatus(['DRAFT', 'GENERATED', 'IN_REVIEW'])
  const draftGen = byStatus(['DRAFT', 'GENERATED'])
  const inReview = byStatus(['IN_REVIEW'])
  const returned = byStatus(['CHANGES_REQUESTED'])
  const pending = byStatus(['NUTRITIONIST_APPROVED'])
  const sent = byStatus(['SENT'])

  return (
    <div>
      <h1>{t('dashboard.title')}</h1>

      <div className="grid stat-grid">
        {role === 'gym_admin' && (
          <>
            <Stat num={pending.length} label={t('dashboard.pendingApprovals')} to="/approvals" />
            <Stat num={data.nutritionistCount} label={t('dashboard.nutritionists')} to="/team" />
            <Stat num={data.clientCount} label={t('dashboard.clients')} to="/clients" />
            <Stat num={data.plans.length} label={t('dashboard.plansTotal')} />
          </>
        )}
        {role === 'platform_admin' && (
          <>
            <Stat num={draftGen.length} label={t('dashboard.inProgress')} to="/plans" />
            <Stat num={returned.length} label={t('dashboard.returned')} to="/plans" />
            <Stat num={pending.length} label={t('dashboard.waitingGym')} to="/plans" />
            <Stat num={data.clientCount} label={t('dashboard.clients')} to="/clients" />
            <Stat num={data.gymCount} label={t('dashboard.totalGyms')} to="/admin/gyms" />
            <Stat num={data.nutritionistCount} label={t('dashboard.totalNutritionists')} to="/admin/users" />
            <Stat num={sent.length} label={t('dashboard.totalPlansSent')} to="/plans" />
            <Stat num={inReview.length} label={t('dashboard.waitingNutritionist')} to="/plans" />
          </>
        )}
        {role === 'nutritionist' && (
          <>
            <Stat num={inProgress.length} label={t('dashboard.inProgress')} to="/plans" />
            <Stat num={returned.length} label={t('dashboard.returned')} to="/plans" />
            <Stat num={sent.length} label={t('dashboard.recentlySent')} to="/plans" />
            <Stat num={data.clientCount} label={t('dashboard.clients')} to="/clients" />
          </>
        )}
      </div>

      {returned.length > 0 && role !== 'gym_admin' && (
        <>
          <h2>{t('approvals.toFix')}</h2>
          <table className="data" style={{ marginBottom: '1.75rem' }}>
            <tbody>
              {returned.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.clients?.first_name} {p.clients?.last_name}</b></td>
                  <td><StatusBadge status={p.status} /></td>
                  <td>{fmtDateTime(p.updated_at, lang)}</td>
                  <td><Link className="btn sm" to={`/plans/${p.id}/edit`}>{t('common.edit')}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {role === 'gym_admin' && pending.length > 0 && (
        <>
          <h2>{t('dashboard.pendingApprovals')}</h2>
          <table className="data" style={{ marginBottom: '1.75rem' }}>
            <tbody>
              {pending.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.clients?.first_name} {p.clients?.last_name}</b></td>
                  <td>v{p.version}</td>
                  <td>{fmtDateTime(p.updated_at, lang)}</td>
                  <td><Link className="btn sm" to={`/approvals/${p.id}`}>{t('plans.open')}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>{t('dashboard.recentActivity')}</h2>
      {data.events.length === 0 ? (
        <div className="card muted">{t('common.none')}</div>
      ) : (
        <ul className="timeline">
          {data.events.map((ev) => {
            const c = ev.plans?.clients
            const clientName = c ? `${c.first_name} ${c.last_name}` : null
            return (
              <li key={ev.id}>
                <b>{ev.profiles?.full_name || '—'}</b> {t(`event.${ev.action}`)}
                {clientName ? ` ${t('event.for', { name: clientName })}` : ''}
                {role === 'platform_admin' && ev.gyms?.name ? <span className="muted"> ({ev.gyms.name})</span> : ''}
                {ev.comment && ev.action === 'rejected' && <span className="small"> — “{ev.comment}”</span>}
                <div className="muted small">{fmtDateTime(ev.created_at, lang)}</div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
