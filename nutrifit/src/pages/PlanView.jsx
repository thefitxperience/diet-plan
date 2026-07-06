// Read-only plan view: full preview + event log; delivery panel appears once
// the plan is approved by the nutritionist (NUTRITIONIST_APPROVED).

import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { Alert, Loading, Spinner, StatusBadge, BackButton, fmtDateTime } from '../components/ui'
import DeepFitTemplate from '../components/DeepFitTemplate'
import { renderPlanPdf, downloadBlob } from '../lib/pdfExport'
import { waLink, sendEmail, emailConfigured, uploadPdfSnapshot, recordDelivery, signedPdfUrl, blobToBase64, planShareUrl } from '../lib/delivery'

export function EventLog({ planId, refresh }) {
  const { t, lang } = useI18n()
  const { profile } = useAuth()
  const [events, setEvents] = useState([])
  useEffect(() => {
    supabase.from('plan_events')
      .select('*, profiles:actor(full_name)')
      .eq('plan_id', planId).order('created_at', { ascending: false })
      .then(({ data }) => setEvents(data || []))
  }, [planId, refresh])
  if (!events.length) return null
  return (
    <div className="card">
      <h2>{t('dashboard.recentActivity')}</h2>
      <ul className="timeline">
        {events.map((ev) => {
          const isIntake = !ev.actor && ev.action === 'generated'
          return (
            <li key={ev.id}>
              {isIntake
                ? <b>{t('event.intakeShort')}</b>
                : <><b>{ev.actor === profile?.id ? t('event.you') : (ev.profiles?.full_name || '—')}</b> {t(`${ev.actor === profile?.id ? 'eventYou' : 'event'}.${ev.action}`)}</>}
              {ev.comment && !isIntake && <div className="small" style={{ fontStyle: 'italic' }}>“{ev.comment}”</div>}
              <div className="muted small">{fmtDateTime(ev.created_at, lang)}</div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function PlanView() {
  const { id } = useParams()
  const { t, lang } = useI18n()
  const { profile, role, gym } = useAuth()
  const [row, setRow] = useState(null)
  const [client, setClient] = useState(null)
  const [planGym, setPlanGym] = useState(null)
  const [lang2, setLang2] = useState('en')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [deliveries, setDeliveries] = useState([])
  const [refresh, setRefresh] = useState(0)
  const canvasRef = useRef()

  async function load() {
    const { data: p, error: e } = await supabase.from('plans').select('*').eq('id', id).single()
    if (e) { setError(e.message); return }
    setRow(p)
    const [{ data: c }, { data: g }, { data: d }] = await Promise.all([
      supabase.from('clients').select('*').eq('id', p.client_id).single(),
      supabase.from('gyms').select('*').eq('id', p.gym_id).maybeSingle(),
      supabase.from('deliveries').select('*').eq('plan_id', id).order('created_at', { ascending: false }),
    ])
    setClient(c)
    setPlanGym(g)
    setDeliveries(d || [])
  }
  useEffect(() => { load() }, [id])

  if (error && !row) return <Alert kind="error">{error}</Alert>
  if (!row || !client) return <Loading />

  const canDeliver = ['gym_admin', 'platform_admin', 'nutritionist'].includes(role) &&
    ['NUTRITIONIST_APPROVED', 'GYM_APPROVED', 'SENT'].includes(row.status)
  const editable = ['DRAFT', 'GENERATED', 'IN_REVIEW', 'CHANGES_REQUESTED'].includes(row.status) &&
    (role === 'nutritionist' || role === 'platform_admin')

  async function makePdf() {
    const blob = await renderPlanPdf(canvasRef.current)
    return blob
  }

  async function deliver(channel) {
    setBusy(channel)
    setError(null)
    setNotice(null)
    try {
      const blob = await makePdf()
      const pdfPath = await uploadPdfSnapshot(row.gym_id, row.id, blob, lang2)
      const fileName = `${row.plan_data.header.fullName || 'Client'} - Diet Plan.pdf`
      const recipient = channel === 'whatsapp_link' ? (client.phone || '')
        : channel === 'email' ? (client.email || '') : ''
      if (channel === 'email' && !recipient) throw new Error('Client has no email address')

      // Shared channels get a long-lived signed URL, stored on the delivery so the
      // public /plan/<id> viewer page can serve it via the short link.
      const pdfUrl = (channel === 'whatsapp_link' || channel === 'email') ? await signedPdfUrl(pdfPath) : null

      // Record first — we need the delivery id to build the share link.
      const deliveryId = await recordDelivery({
        gymId: row.gym_id, planId: row.id, actorId: profile.id,
        channel, recipient, language: lang2, pdfPath, pdfUrl,
      })

      if (channel === 'download') {
        downloadBlob(blob, fileName)
      } else if (channel === 'whatsapp_link') {
        // Short link to the viewer page (opens the PDF with download/share) —
        // no giant signed URL in the message, no manual attach.
        const shareUrl = planShareUrl(deliveryId)
        const msg = `${t('delivery.messageLink', { name: client.first_name, gym: planGym?.name || 'your gym' })}\n${shareUrl}`
        window.open(waLink(client.phone, msg), '_blank')
      } else if (channel === 'email') {
        const pdfBase64 = await blobToBase64(blob)
        await sendEmail({
          toEmail: recipient,
          toName: `${client.first_name} ${client.last_name}`,
          subject: t('delivery.emailSubject', { gym: planGym?.name || 'FIT' }),
          message: t('delivery.message', { name: client.first_name, gym: planGym?.name || 'your gym' }),
          pdfBase64,
          filename: fileName,
          pdfUrl,
        })
      }

      if (row.status !== 'SENT') {
        const { error: trErr } = await supabase.rpc('transition_plan', { p_plan_id: row.id, p_action: 'sent' })
        if (trErr) throw trErr
        setRow({ ...row, status: 'SENT' })
      }
      setNotice(t('delivery.recorded'))
      setRefresh((r) => r + 1)
      const { data: d } = await supabase.from('deliveries').select('*').eq('plan_id', id).order('created_at', { ascending: false })
      setDeliveries(d || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: '1rem' }}>
        <div className="row">
          <BackButton />
          <h1 style={{ margin: 0 }}>
            {row.plan_data?.header?.fullName} — v{row.version}
          </h1>
          <StatusBadge status={row.status} />
        </div>
        {editable && <Link className="btn sm" to={`/plans/${id}/edit`}>{t('common.edit')}</Link>}
      </div>

      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{notice}</Alert>

      {canDeliver && (
        <div className="card">
          <h2>{t('delivery.title')}</h2>
          <div className="row between" style={{ alignItems: 'center' }}>
            <label className="row" style={{ gap: 8, fontWeight: 600, margin: 0 }}>
              {t('delivery.language')}
              <select style={{ width: 'auto' }} value={lang2} onChange={(e) => setLang2(e.target.value)}>
                <option value="en">{t('delivery.lang.en')}</option>
                <option value="ar">{t('delivery.lang.ar')}</option>
              </select>
            </label>
            <div className="row">
              <button className="btn secondary" disabled={!!busy} onClick={() => deliver('download')}>
                {busy === 'download' ? <Spinner /> : t('delivery.download')}
              </button>
              <button className="btn" disabled={!!busy || !client.phone} onClick={() => deliver('whatsapp_link')}>
                {busy === 'whatsapp_link' ? <Spinner /> : t('delivery.whatsapp')}
              </button>
              <button className="btn secondary" disabled={!!busy || !emailConfigured} onClick={() => deliver('email')}
                title={emailConfigured ? '' : t('delivery.emailNotConfigured')}>
                {busy === 'email' ? <Spinner /> : t('delivery.email')}
              </button>
            </div>
          </div>
          {deliveries.length > 0 && (
            <>
              <h3>{t('delivery.history')}</h3>
              <ul className="small">
                {deliveries.map((d) => (
                  <li key={d.id}>
                    {[
                      t(`delivery.channel.${d.channel}`),
                      t(`delivery.lang.${d.language}`),
                      d.recipient,
                      fmtDateTime(d.created_at, lang),
                    ].filter(Boolean).join(' · ')}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="editor-canvas" ref={canvasRef} style={{ maxHeight: 'none', marginBottom: '1rem' }}>
        <DeepFitTemplate plan={row.plan_data} lang={lang2} gym={planGym} />
      </div>

      <EventLog planId={id} refresh={refresh} />
    </div>
  )
}
