// Public, no-login plan viewer (shared link /#/plan/<delivery_id>).
// Resolves the delivery's stored PDF URL via the get_shared_plan RPC and shows
// it in a viewer with Download + Share actions — the short link we put in the
// WhatsApp message instead of a giant signed URL.

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { Spinner } from '../components/ui'

export default function PlanShare() {
  const { token } = useParams()
  const { t } = useI18n()
  const [row, setRow] = useState(undefined) // undefined = loading, null = not found

  useEffect(() => {
    document.body.classList.add('intake-active')
    supabase.rpc('get_shared_plan', { p_token: token })
      .then(({ data }) => setRow(data?.[0] || null))
      .catch(() => setRow(null))
    return () => document.body.classList.remove('intake-active')
  }, [token])

  async function share() {
    const url = row.pdf_url
    if (navigator.share) {
      try { await navigator.share({ title: t('share.title'), url }) } catch { /* cancelled */ }
    } else {
      try { await navigator.clipboard.writeText(url); alert(t('share.copied')) } catch { window.open(url, '_blank') }
    }
  }

  if (row === undefined) {
    return <div className="intake-page center"><Spinner /></div>
  }
  if (!row) {
    return (
      <div className="intake-page center">
        <div className="intake-card center">
          <div style={{ fontSize: '2rem' }}>🔗</div>
          <p className="muted">{t('share.notFound')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="intake-page plan-share">
      <div className="plan-share-bar">
        <div>
          {row.gym_logo && <img src={row.gym_logo} alt={row.gym_name || ''} className="plan-share-logo" crossOrigin="anonymous" />}
          <div className="plan-share-title">{t('share.title')}</div>
          <div className="plan-share-sub">{t('share.for', { name: row.client_name })}</div>
        </div>
        <div className="plan-share-actions">
          <a className="btn" href={row.pdf_url} target="_blank" rel="noreferrer">{t('share.open')}</a>
          <button className="btn secondary" onClick={share}>{t('share.share')}</button>
        </div>
      </div>
      <iframe className="plan-share-frame" src={row.pdf_url} title={t('share.title')} />
    </div>
  )
}
