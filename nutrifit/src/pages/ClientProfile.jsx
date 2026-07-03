import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { Loading, fmtDate, fmtDateTime } from '../components/ui'
import { ClientForm } from './Clients'

export default function ClientProfile() {
  const { id } = useParams()
  const { t, lang } = useI18n()
  const { role } = useAuth()
  const [client, setClient] = useState(null)
  const [inbody, setInbody] = useState([])
  const [events, setEvents] = useState([])
  const [editing, setEditing] = useState(false)
  const canEdit = role === 'nutritionist' || role === 'platform_admin'

  async function load() {
    const [{ data: c }, { data: ib }, { data: ev }] = await Promise.all([
      supabase.from('clients').select('*').eq('id', id).single(),
      supabase.from('inbody_results').select('*').eq('client_id', id).order('created_at', { ascending: false }),
      supabase.from('plan_events')
        .select('*, profiles:actor(full_name), plans!inner(client_id, version)')
        .eq('plans.client_id', id)
        .order('created_at', { ascending: false }),
    ])
    setClient(c)
    setInbody(ib || [])
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
        <h1 style={{ margin: 0 }}>{client.first_name} {client.last_name}</h1>
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

      <h2>{t('clients.history')}</h2>
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
                <b>{item.row.profiles?.full_name || '—'}</b>{' '}
                {t(`event.${item.row.action}`)}
                {item.row.action === 'sent' ? ` ${t('event.toClient')}` : ''}
                {item.row.comment && (
                  <div className="small" style={{ fontStyle: 'italic' }}>“{item.row.comment}”</div>
                )}
                <div className="muted small">
                  <Link to={`/plans/${item.row.plan_id}`}>{t('plans.title')} v{item.row.plans?.version}</Link>
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
