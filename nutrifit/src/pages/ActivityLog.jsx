import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useQuery } from '../lib/useQuery'
import { Loading, fmtDateTime } from '../components/ui'

export default function ActivityLog() {
  const { t, lang } = useI18n()

  const { data: events } = useQuery('activity', async () => {
    const { data } = await supabase.from('plan_events')
      .select('*, profiles:actor(full_name), plans(clients(first_name, last_name))')
      .order('created_at', { ascending: false }).limit(200)
    return data || []
  })

  if (!events) return <Loading />

  return (
    <div>
      <h1>{t('nav.activity')}</h1>
      <ul className="timeline">
        {events.map((ev) => (
          <li key={ev.id}>
            <b>{ev.profiles?.full_name || '—'}</b> {t(`event.${ev.action}`)}
            {ev.plans?.clients && <span className="muted"> · {ev.plans.clients.first_name} {ev.plans.clients.last_name}</span>}
            {ev.comment && <div className="small" style={{ fontStyle: 'italic' }}>“{ev.comment}”</div>}
            <div className="muted small">{fmtDateTime(ev.created_at, lang)}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}
