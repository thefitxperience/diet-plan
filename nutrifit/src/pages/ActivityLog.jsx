import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { useQuery } from '../lib/useQuery'
import GymFilter from '../components/GymFilter'
import { Loading, fmtDateTime } from '../components/ui'

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
          const isIntake = !ev.actor && ev.action === 'generated'
          const you = ev.actor === profile?.id
          return (
            <li key={ev.id}>
              {isIntake ? (
                <><b>{clientName || t('event.newClient')}</b> {t('event.intake')}</>
              ) : (
                <>
                  <b>{you ? t('event.you') : (ev.profiles?.full_name || '—')}</b>{' '}
                  {t(`${you ? 'eventYou' : 'event'}.${ev.action}`)}
                  {clientName ? ` ${t('event.for', { name: clientName })}` : ''}
                </>
              )}
              {!gymFilter && ev.gyms?.name ? <span className="muted"> ({ev.gyms.name})</span> : ''}
              {ev.comment && !isIntake && <div className="small" style={{ fontStyle: 'italic' }}>“{ev.comment}”</div>}
              <div className="muted small">{fmtDateTime(ev.created_at, lang)}</div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
