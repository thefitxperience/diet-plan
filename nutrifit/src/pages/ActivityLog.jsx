import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { useQuery } from '../lib/useQuery'
import GymFilter from '../components/GymFilter'
import { Loading, fmtDateTime } from '../components/ui'
import { describeEvent } from '../lib/planEvents'

export default function ActivityLog() {
  const { t, lang } = useI18n()
  const { profile } = useAuth()
  const [gymFilter, setGymFilter] = useState('')

  const { data: events } = useQuery(`activity:${gymFilter || 'all'}`, async () => {
    let q = supabase.from('plan_events')
      .select('*, profiles:actor(full_name), plans(clients(first_name, last_name)), gyms:gym_id(name)')
      .order('created_at', { ascending: false }).limit(200)
    if (gymFilter) q = q.eq('gym_id', gymFilter)
    const { data } = await q
    return data || []
  }, [gymFilter])

  if (!events) return <Loading />

  return (
    <div>
      <div className="row between">
        <h1>{t('nav.activity')}</h1>
        <GymFilter value={gymFilter} onChange={setGymFilter} />
      </div>
      <ul className="timeline">
        {events.map((ev) => {
          const c = ev.plans?.clients
          const clientName = c ? `${c.first_name} ${c.last_name}` : null
          const d = describeEvent(ev, { t, profileId: profile?.id })
          return (
            <li key={ev.id} className={d.auto ? 'is-auto' : undefined}>
              {d.kind === 'intake' ? (
                <><b>{clientName || t('event.newClient')}</b> {d.what}</>
              ) : (
                <>
                  <b>{d.who}</b>{' '}
                  {d.what}
                  {clientName ? ` ${t('event.for', { name: clientName })}` : ''}
                  {d.auto && <span className="auto-badge">{t('event.autoBadge')}</span>}
                </>
              )}
              {!gymFilter && ev.gyms?.name ? <span className="muted"> ({ev.gyms.name})</span> : ''}
              {d.auto && <div className="small muted">{t('event.autoApprovedNote')}</div>}
              {ev.comment && d.kind !== 'intake' && !d.auto && (
                <div className="small" style={{ fontStyle: 'italic' }}>“{ev.comment}”</div>
              )}
              <div className="muted small">{fmtDateTime(ev.created_at, lang)}</div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
