import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { useQuery } from '../lib/useQuery'
import GymFilter from '../components/GymFilter'
import { Field, Alert, Loading, fmtDate } from '../components/ui'

export function ClientForm({ initial, onSaved, onCancel }) {
  const { t } = useI18n()
  const { profile } = useAuth()
  const [form, setForm] = useState(initial || {
    first_name: '', last_name: '', dob: '', gender: 'M',
    phone: '', email: '', notes: '', consent: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [errors, setErrors] = useState({})

  const set = (k) => (e) => {
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
    setErrors((x) => ({ ...x, [k]: false }))
  }
  // Phone: keep digits and phone punctuation only — block letters entirely.
  const setPhone = (e) => {
    setForm({ ...form, phone: e.target.value.replace(/[^\d+\-\s()]/g, '') })
    setErrors((x) => ({ ...x, phone: false }))
  }

  const today = new Date().toISOString().slice(0, 10)

  function validate() {
    const errs = {}
    if (!form.first_name.trim()) errs.first_name = t('common.required')
    if (!form.last_name.trim()) errs.last_name = t('common.required')
    if (!form.dob) {
      errs.dob = t('common.required')
    } else {
      const d = new Date(form.dob)
      if (isNaN(d) || d > new Date() || d < new Date('1900-01-01')) errs.dob = t('clients.dobInvalid')
    }
    if ((form.phone || '').replace(/\D/g, '').length < 7) errs.phone = t('clients.phoneInvalid')
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = t('clients.emailInvalid')
    return errs
  }

  async function save(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setBusy(true)
    setError(null)
    try {
      const row = { ...form, dob: form.dob || null }
      let res
      if (initial?.id) {
        res = await supabase.from('clients').update(row).eq('id', initial.id).select().single()
      } else {
        res = await supabase.from('clients')
          .insert({ ...row, gym_id: profile.gym_id, created_by: profile.id })
          .select().single()
      }
      if (res.error) throw res.error
      onSaved(res.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="card" noValidate>
      <Alert kind="error">{error}</Alert>
      <div className="grid cols-2">
        <Field label={t('clients.firstName')} required error={errors.first_name} hint={errors.first_name}>
          <input type="text" className={errors.first_name ? 'invalid' : ''} value={form.first_name} onChange={set('first_name')} />
        </Field>
        <Field label={t('clients.lastName')} required error={errors.last_name} hint={errors.last_name}>
          <input type="text" className={errors.last_name ? 'invalid' : ''} value={form.last_name} onChange={set('last_name')} />
        </Field>
        <Field label={t('clients.dob')} required error={errors.dob} hint={errors.dob}>
          <input type="date" className={errors.dob ? 'invalid' : ''} value={form.dob || ''} onChange={set('dob')} min="1900-01-01" max={today} />
        </Field>
        <Field label={t('clients.gender')} required>
          <select value={form.gender || 'M'} onChange={set('gender')}>
            <option value="M">{t('clients.male')}</option>
            <option value="F">{t('clients.female')}</option>
          </select>
        </Field>
        <Field label={t('clients.phone')} required error={errors.phone} hint={errors.phone}>
          <input type="tel" inputMode="tel" className={errors.phone ? 'invalid' : ''}
            value={form.phone || ''} onChange={setPhone} />
        </Field>
        <Field label={`${t('clients.email')} (${t('common.optional')})`} error={errors.email} hint={errors.email}>
          <input type="email" className={errors.email ? 'invalid' : ''} value={form.email || ''} onChange={set('email')} />
        </Field>
      </div>
      <Field label={t('clients.notes')}>
        <textarea rows={2} value={form.notes || ''} onChange={set('notes')} />
      </Field>
      <label className="field" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <input type="checkbox" checked={!!form.consent} onChange={set('consent')} style={{ width: 'auto', marginTop: 3 }} />
        <span style={{ fontWeight: 400 }}>{t('clients.consent')}*</span>
      </label>
      <div className="row end">
        {onCancel && <button type="button" className="btn secondary" onClick={onCancel}>{t('common.cancel')}</button>}
        <button className="btn" disabled={busy || !form.consent}>{t('common.save')}</button>
      </div>
    </form>
  )
}

export default function Clients() {
  const { t } = useI18n()
  const { role } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [gymFilter, setGymFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const canEdit = role === 'nutritionist' || role === 'platform_admin'

  const showGym = role === 'platform_admin' && !gymFilter

  const { data: clients, refresh } = useQuery(`clients:${gymFilter || 'all'}`, async () => {
    let q = supabase.from('clients').select('*, gyms:gym_id(name)').order('created_at', { ascending: false })
    if (gymFilter) q = q.eq('gym_id', gymFilter)
    const { data } = await q
    return data || []
  }, [gymFilter])

  if (!clients) return <Loading />

  const filtered = clients.filter((c) =>
    `${c.first_name} ${c.last_name} ${c.phone || ''} ${c.email || ''}`.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div>
      <div className="row between" style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>{t('clients.title')}</h1>
        <div className="row">
          <GymFilter value={gymFilter} onChange={setGymFilter} />
          {canEdit && (
            <button className="btn" onClick={() => setShowForm(!showForm)}>
              + {t('clients.new')}
            </button>
          )}
        </div>
      </div>
      {showForm && (
        <ClientForm
          onSaved={(c) => { setShowForm(false); refresh(); navigate(`/clients/${c.id}`) }}
          onCancel={() => setShowForm(false)}
        />
      )}
      <div className="card">
        <input type="text" placeholder={t('common.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {filtered.length === 0 ? (
        <div className="card muted">{t('clients.empty')}</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              {showGym && <th>{t('admin.gym')}</th>}
              <th>{t('common.name')}</th>
              <th>{t('clients.dob')}</th>
              <th>{t('clients.phone')}</th>
              <th>{t('clients.email')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => navigate(`/clients/${c.id}`)}>
                {showGym && <td>{c.gyms?.name || '—'}</td>}
                <td><b>{c.first_name} {c.last_name}</b></td>
                <td>{fmtDate(c.dob)}</td>
                <td dir="ltr">{c.phone}</td>
                <td>{c.email}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
