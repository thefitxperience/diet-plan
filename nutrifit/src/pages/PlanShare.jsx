// Public, no-login plan viewer (shared link /#/plan/<delivery_id>).
// Resolves the delivery's stored PDF URL via the get_shared_plan RPC, fetches
// the bytes once, and renders every page into a scrollable viewer with pdf.js.
// Download saves the real PDF file; Share shares the file itself (Web Share
// Level 2) where the device supports it. This is the short link we put in the
// WhatsApp message instead of a giant signed URL.

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { Spinner } from '../components/ui'

export default function PlanShare() {
  const { token } = useParams()
  const { t } = useI18n()
  const [row, setRow] = useState(undefined) // undefined = loading, null = not found
  const [blob, setBlob] = useState(null)
  const [fallback, setFallback] = useState(false) // blob fetch failed → iframe
  const [rendering, setRendering] = useState(true)
  const viewerRef = useRef(null)

  useEffect(() => {
    document.body.classList.add('intake-active')
    supabase.rpc('get_shared_plan', { p_token: token })
      .then(({ data }) => setRow(data?.[0] || null))
      .catch(() => setRow(null))
    return () => document.body.classList.remove('intake-active')
  }, [token])

  // Grab the PDF bytes once — needed for scroll-rendering, real file download,
  // and file sharing. If it fails (e.g. CORS), fall back to an iframe.
  useEffect(() => {
    if (!row?.pdf_url) return
    let cancelled = false
    fetch(row.pdf_url)
      .then((r) => { if (!r.ok) throw new Error('fetch'); return r.blob() })
      .then((b) => { if (!cancelled) setBlob(b) })
      .catch(() => { if (!cancelled) { setFallback(true); setRendering(false) } })
    return () => { cancelled = true }
  }, [row])

  // Render every page into the scroll container.
  useEffect(() => {
    if (!blob || !viewerRef.current) return
    let cancelled = false
    setRendering(true)
    ;(async () => {
      const pdfjs = await import('pdfjs-dist')
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      const data = await blob.arrayBuffer()
      const doc = await pdfjs.getDocument({ data }).promise
      if (cancelled) return
      const container = viewerRef.current
      container.innerHTML = ''
      // Render at a high fixed resolution rather than scaling to the (often
      // narrow) container, so pages stay crisp on hi-DPI phones and when the
      // user pinch-zooms. Capped so we don't exceed iOS's canvas memory limit.
      const dpr = window.devicePixelRatio || 1
      const cssWidth = Math.min(container.clientWidth || 800, 900)
      const targetWidth = Math.min(Math.max(cssWidth * dpr, 1600), 2200)
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        const vp = page.getViewport({ scale: targetWidth / base.width })
        const canvas = document.createElement('canvas')
        canvas.className = 'plan-share-page'
        canvas.width = vp.width
        canvas.height = vp.height
        container.appendChild(canvas)
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
      }
      if (!cancelled) setRendering(false)
    })().catch(() => { if (!cancelled) { setFallback(true); setRendering(false) } })
    return () => { cancelled = true }
  }, [blob])

  const fileName = `${(row?.client_name || 'Diet Plan').trim()} - ${t('share.title')}.pdf`

  function download() {
    if (!blob) { window.open(row.pdf_url, '_blank'); return }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  async function share() {
    // Share the actual PDF file where supported (mobile), else fall back.
    if (blob && navigator.canShare) {
      const file = new File([blob], fileName, { type: 'application/pdf' })
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: t('share.title') }) } catch { /* cancelled */ }
        return
      }
    }
    if (navigator.share) {
      try { await navigator.share({ title: t('share.title'), url: row.pdf_url }) } catch { /* cancelled */ }
      return
    }
    try { await navigator.clipboard.writeText(row.pdf_url); alert(t('share.copied')) } catch { download() }
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
          <button className="btn" onClick={download}>{t('share.download')}</button>
          <button className="btn secondary" onClick={share}>{t('share.share')}</button>
        </div>
      </div>
      {fallback ? (
        <iframe className="plan-share-frame" src={row.pdf_url} title={t('share.title')} />
      ) : (
        <>
          <div className="plan-share-viewer" ref={viewerRef} />
          {rendering && <div className="plan-share-loading"><Spinner /></div>}
        </>
      )}
    </div>
  )
}
