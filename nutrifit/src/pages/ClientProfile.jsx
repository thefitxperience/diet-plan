import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { Loading, StatusBadge, BackButton, fmtDate, fmtDateTime } from '../components/ui'
import { arDigits } from '../lib/digits'
import { ClientForm } from './Clients'

const INBODY_METRICS = [
  ['weight', 'inbody.field.weight'], ['height', 'inbody.field.height'], ['bmr', 'inbody.field.bmr'],
  ['smm', 'inbody.field.smm'], ['fatMass', 'inbody.field.fatMass'], ['lbm', 'inbody.field.lbm'],
]

export default function ClientProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const { role, profile } = useAuth()
  const [client, setClient] = useState(null)
  const [inbody, setInbody] = useState([])
  const [plans, setPlans] = useState([])
  const [events, setEvents] = useState([])
  const [editing, setEditing] = useState(false)
  const canEdit = role === 'nutritionist' || role === 'platform_admin'

  async function load() {
    const [{ data: c }, { data: ib }, { data: pl }, { data: ev }] = await Promise.all([
      supabase.from('clients').select('*').eq('id', id).single(),
      supabase.from('inbody_results').select('*').eq('client_id', id).order('created_at', { ascending: false }),
      supabase.from('plans').select('id, status, version, updated_at').eq('client_id', id).order('created_at', { ascending: false }),
      supabase.from('plan_events')
        .select('*, profiles:actor(full_name), plans!inner(client_id, version)')
        .eq('plans.client_id', id)
        .order('created_at', { ascending: false }),
    ])
    setClient(c)
    setInbody(ib || [])
    setPlans(pl || [])
    setEvents(ev || [])
  }
  useEffect(() => { load() }, [id])

  if (!client) return <Loading />

  // history: what happened for this client — plan events + InBody scans, by date
  const timeline = [
    ...inbody.map((r) => ({ at: r.created_at, kind: 'inbody', row: r })),
    ...events.map((e) => ({ at: e.created_at, kind: 'event', row: e })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at))

  return (
    <div>
      <div className="row between" style={{ marginBottom: '1.25rem' }}>
        <div className="row">
          <BackButton />
          <h1 style={{ margin: 0 }}>{client.first_name} {client.last_name}</h1>
        </div>
        {canEdit && (
          <div className="row">
            <Link className="btn secondary" to={`/clients/${id}/inbody`}>{t('clients.uploadInbody')}</Link>
            <Link className="btn" to={`/clients/${id}/new-plan`}>{t('clients.newPlan')}</Link>
          </div>
        )}
      </div>

      {editing ? (
        <ClientForm initial={client} onSaved={(c) => { setClient(c); setEditing(false) }} onCancel={() => setEditing(false)} />
      ) : (
        <div className="card">
          <div className="grid cols-4">
            <div><div className="muted small">{t('clients.dob')}</div><b>{fmtDate(client.dob, lang) || '—'}</b></div>
            <div><div className="muted small">{t('clients.gender')}</div><b>{client.gender === 'F' ? t('clients.female') : t('clients.male')}</b></div>
            <div><div className="muted small">{t('clients.phone')}</div><b dir="ltr">{client.phone || '—'}</b></div>
            <div><div className="muted small">{t('clients.email')}</div><b>{client.email || '—'}</b></div>
          </div>
          {client.notes && <p className="muted" style={{ marginBottom: 0 }}>{client.notes}</p>}
          {canEdit && (
            <div className="row end">
              <button className="btn ghost sm" onClick={() => setEditing(true)}>{t('common.edit')}</button>
            </div>
          )}
        </div>
      )}

      {inbody.length > 0 && (
        <>
          <h2>{t('clients.inbodyResults')}</h2>
          {inbody.map((r) => {
            const v = r.confirmed || {}
            return (
              <div className="card" key={r.id}>
                <div className="row between" style={{ alignItems: 'center' }}>
                  <b>{fmtDate(r.test_date, lang) || fmtDate(r.created_at, lang)}</b>
                  <span className="muted small">{r.model}</span>
                </div>
                <div className="grid cols-4" style={{ marginTop: 8 }}>
                  {INBODY_METRICS.map(([k, lk]) => (
                    <div key={k}>
                      <div className="muted small">{t(lk)}</div>
                      <b>{v[k] != null && v[k] !== '' ? arDigits(v[k], lang) : '—'}</b>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </>
      )}

      {plans.length > 0 && (
        <>
          <h2>{t('nav.plans')}</h2>
          <table className="data">
            <thead>
              <tr>
                <th>{t('plans.version')}</th>
                <th>{t('common.status')}</th>
                <th>{t('plans.updated')}</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/plans/${p.id}`)}>
                  <td>v{arDigits(p.version, lang)}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td>{fmtDateTime(p.updated_at, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2 style={{ marginTop: '1rem' }}>{t('clients.history')}</h2>
      {timeline.length === 0 && <div className="card muted">{t('common.none')}</div>}
      <ul className="timeline">
        {timeline.map((item, i) => (
          <li key={i}>
            {item.kind === 'inbody' ? (
              <div>
                <b>InBody</b> · {fmtDate(item.row.test_date, lang)}
                <div className="muted small">{fmtDateTime(item.at, lang)}</div>
              </div>
            ) : (
              <div>
                {(!item.row.actor && item.row.action === 'generated') ? (
                  <><b>{client.first_name} {client.last_name}</b> {t('event.intake')}</>
                ) : (
                  <>
                    <b>{item.row.actor === profile?.id ? t('event.you') : (item.row.profiles?.full_name || '—')}</b>{' '}
                    {t(`${item.row.actor === profile?.id ? 'eventYou' : 'event'}.${item.row.action}`)}
                    {item.row.action === 'sent' ? ` ${t('event.toClient')}` : ''}
                    {item.row.comment && (
                      <div className="small" style={{ fontStyle: 'italic' }}>“{item.row.comment}”</div>
                    )}
                  </>
                )}
                <div className="muted small">
                  <Link to={`/plans/${item.row.plan_id}`}>{t('plans.title')} v{arDigits(item.row.plans?.version, lang)}</Link>
                  {' · '}{fmtDateTime(item.at, lang)}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
