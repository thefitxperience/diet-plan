// Gym settings: name + the client intake link. (Brand color/logo intentionally
// hidden for now.)
import { useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { Field, Alert, Spinner } from '../components/ui'

export default function GymSettings() {
  const { t } = useI18n()
  const { gym, setGym, profile } = useAuth()
  const [name, setName] = useState(gym?.name || '')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const [qrBusy, setQrBusy] = useState(false)

  const intakeUrl = gym?.intake_token
    ? `${window.location.origin}${import.meta.env.BASE_URL}#/intake/${gym.intake_token}`
    : null

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const { data: updated, error: e } = await supabase.from('gyms')
        .update({ name })
        .eq('id', profile.gym_id).select().single()
      if (e) throw e
      setGym(updated)
      setNotice(t('settings.saved'))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  // Generate a print-quality QR of the intake link and download it as a PNG.
  async function downloadQr() {
    if (!intakeUrl) return
    setQrBusy(true)
    setError(null)
    try {
      const dataUrl = await QRCode.toDataURL(intakeUrl, {
        width: 1024, margin: 2, errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      })
      const slug = (gym?.name || 'gym').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `${slug || 'gym'}-intake-qr.png`
      a.click()
    } catch (e) { setError(e.message) } finally { setQrBusy(false) }
  }

  return (
    <div>
      <h1>{t('settings.title')}</h1>
      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{notice}</Alert>
      <div className="card" style={{ maxWidth: 480 }}>
        <Field label={t('settings.gymName')}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <button className="btn" onClick={save} disabled={busy}>
          {busy ? <Spinner /> : t('common.save')}
        </button>
      </div>

      {intakeUrl && (
        <div className="card" style={{ maxWidth: 480, marginTop: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>{t('settings.intakeTitle')}</h2>
          <p className="muted small">{t('settings.intakeHint')}</p>
          <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
            <input type="text" readOnly value={intakeUrl} onFocus={(e) => e.target.select()} style={{ flex: 1, direction: 'ltr' }} />
            <button className="btn secondary" style={{ whiteSpace: 'nowrap' }} onClick={() => {
              navigator.clipboard?.writeText(intakeUrl)
              setCopied(true); setTimeout(() => setCopied(false), 2000)
            }}>
              {copied ? t('settings.copied') : t('settings.copyLink')}
            </button>
            <button className="btn secondary" style={{ whiteSpace: 'nowrap' }} onClick={downloadQr} disabled={qrBusy}>
              {qrBusy ? <Spinner /> : t('settings.qrCode')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
