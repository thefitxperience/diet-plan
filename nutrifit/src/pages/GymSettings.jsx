// Gym branding: name, logo (co-branded PDFs, plan §0 decision 6), color.
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { Field, Alert, Spinner } from '../components/ui'

// Public URLs look like ".../storage/v1/object/public/branding/<path>" — pull
// <path> back out so the old file can be cleaned up on replace/remove.
function storagePathFromUrl(url) {
  if (!url) return null
  const marker = '/object/public/branding/'
  const i = url.indexOf(marker)
  return i === -1 ? null : url.slice(i + marker.length)
}

export default function GymSettings() {
  const { t } = useI18n()
  const { gym, setGym, profile } = useAuth()
  const [name, setName] = useState(gym?.name || '')
  const [color, setColor] = useState(gym?.brand_colors?.primary || '#5B9FA4')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)

  async function uploadLogo(file) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const oldPath = storagePathFromUrl(gym?.logo_url)
      const path = `${profile.gym_id}/logo-${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`
      const { error: upErr } = await supabase.storage.from('branding').upload(path, file)
      if (upErr) throw upErr
      const { data } = supabase.storage.from('branding').getPublicUrl(path)
      const { data: updated, error: e } = await supabase.from('gyms')
        .update({ logo_url: data.publicUrl }).eq('id', profile.gym_id).select().single()
      if (e) throw e
      setGym(updated)
      if (oldPath) await supabase.storage.from('branding').remove([oldPath])
      setNotice(t('settings.saved'))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function removeLogo() {
    setBusy(true)
    setError(null)
    try {
      const path = storagePathFromUrl(gym?.logo_url)
      const { data: updated, error: e } = await supabase.from('gyms')
        .update({ logo_url: null }).eq('id', profile.gym_id).select().single()
      if (e) throw e
      setGym(updated)
      if (path) await supabase.storage.from('branding').remove([path])
      setNotice(t('settings.saved'))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const { data: updated, error: e } = await supabase.from('gyms')
        .update({ name, brand_colors: { primary: color } })
        .eq('id', profile.gym_id).select().single()
      if (e) throw e
      setGym(updated)
      setNotice(t('settings.saved'))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
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
        <Field label={t('settings.brandColor')}>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 40, padding: 2 }} />
        </Field>
        <Field label={t('settings.logo')}>
          {gym?.logo_url && (
            <div className="row" style={{ marginBottom: 8 }}>
              <img src={gym.logo_url} alt="logo" style={{ height: 60, display: 'block' }} />
              <button type="button" className="btn danger sm" onClick={removeLogo} disabled={busy}>
                {t('settings.removeLogo')}
              </button>
            </div>
          )}
          <input type="file" accept="image/*" onChange={(e) => uploadLogo(e.target.files[0])} />
        </Field>
        <button className="btn" onClick={save} disabled={busy}>
          {busy ? <Spinner /> : t('common.save')}
        </button>
      </div>
    </div>
  )
}
