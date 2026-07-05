// InBody upload → parse (pdf.js / Tesseract) → side-by-side confirmation
// panel → save to inbody_results (plan §6). Extraction is never trusted
// blindly: every value is editable next to the document preview.

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { Field, Alert, Loading, Spinner, BackButton } from '../components/ui'
import { extractFromPdf, extractFromImage, renderPdfFirstPage, parseInBodyText, crossCheckClient } from '../lib/inbodyParser'

const FIELDS = [
  ['weight', 'inbody.field.weight'],
  ['height', 'inbody.field.height'],
  ['age', 'inbody.field.age'],
  ['smm', 'inbody.field.smm'],
  ['fatMass', 'inbody.field.fatMass'],
  ['lbm', 'inbody.field.lbm'],
  ['bmr', 'inbody.field.bmr'],
  ['pbf', 'inbody.field.pbf'],
  ['bmi', 'inbody.field.bmi'],
  ['score', 'inbody.field.score'],
]

export default function InBodyUpload() {
  const { id: clientId } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const { profile } = useAuth()
  const [client, setClient] = useState(null)
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [sourceType, setSourceType] = useState('pdf_text')
  const [model, setModel] = useState('InBody270')
  const [extracted, setExtracted] = useState(null) // raw parser output (kept verbatim)
  const [values, setValues] = useState(null)       // editable confirmed values
  const [testDate, setTestDate] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef()

  useEffect(() => {
    supabase.from('clients').select('*').eq('id', clientId).single().then(({ data }) => setClient(data))
  }, [clientId])

  // Only object URLs (image uploads) need revoking; PDF previews are data URLs.
  useEffect(() => () => { if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  async function handleFile(f) {
    if (!f) return
    setFile(f)
    setError(null)
    setParsing(true)
    try {
      const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      let text
      if (isPdf) {
        text = await extractFromPdf(f)
        setSourceType('pdf_text')
        // Clean image preview of the first page — no PDF-viewer chrome.
        setPreviewUrl(await renderPdfFirstPage(f))
      } else {
        setPreviewUrl(URL.createObjectURL(f))
        text = await extractFromImage(f, setProgress)
        setSourceType('ocr')
      }
      const result = parseInBodyText(text)
      setModel(result.model)
      setExtracted({ ...result.fields, _text_sample: text.slice(0, 2000) })
      setValues({ ...result.fields })
      setTestDate(result.fields.testDate || '')
    } catch (err) {
      setError(`Extraction failed (${err.message}). Enter values manually below.`)
      setExtracted({})
      setValues({})
      setSourceType('manual')
    } finally {
      setParsing(false)
    }
  }

  function startManual() {
    setExtracted({})
    setValues({})
    setSourceType('manual')
  }

  const mismatches = values && client ? crossCheckClient(values, client) : {}

  async function save() {
    setBusy(true)
    setError(null)
    try {
      let filePath = null
      if (file) {
        filePath = `${profile.gym_id}/${clientId}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`
        const { error: upErr } = await supabase.storage.from('inbody').upload(filePath, file)
        if (upErr) throw upErr
      }
      const confirmed = { ...values }
      delete confirmed._text_sample
      const { error: insErr } = await supabase.from('inbody_results').insert({
        gym_id: profile.gym_id,
        client_id: clientId,
        created_by: profile.id,
        file_path: filePath,
        source_type: sourceType,
        model,
        extracted: extracted || {},
        confirmed,
        test_date: testDate || null,
      })
      if (insErr) throw insErr
      navigate(`/clients/${clientId}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!client) return <Loading />

  return (
    <div>
      <div className="row" style={{ marginBottom: '1rem' }}>
        <BackButton />
        <h1 style={{ margin: 0 }}>{t('inbody.title')} — {client.first_name} {client.last_name}</h1>
      </div>
      <Alert kind="error">{error}</Alert>

      {!values && !parsing && (
        <div
          className="card center"
          style={{ cursor: 'pointer', borderStyle: 'dashed', minHeight: 200 }}
          onClick={() => inputRef.current.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}
        >
          <div className="muted">{t('inbody.dropHint')}</div>
          <button className="btn secondary sm" onClick={(e) => { e.stopPropagation(); startManual() }}>
            {t('inbody.manual')}
          </button>
          <input
            ref={inputRef} type="file" accept=".pdf,image/*" hidden
            onChange={(e) => handleFile(e.target.files[0])}
          />
        </div>
      )}

      {parsing && (
        <div className="card center">
          <Spinner />
          <div className="muted">
            {t('inbody.parsing')} {sourceType === 'ocr' && progress > 0 && `${Math.round(progress * 100)}%`}
          </div>
        </div>
      )}

      {values && !parsing && (
        <div className="grid cols-2" style={{ gridTemplateColumns: previewUrl ? '1fr 1fr' : '1fr', alignItems: 'start' }}>
          {previewUrl && (
            <div className="card" style={{ position: 'sticky', top: '1rem' }}>
              <img src={previewUrl} alt="InBody" style={{ width: '100%', display: 'block' }} />
            </div>
          )}
          <div className="card">
            <h2>{t('inbody.reviewTitle')}</h2>
            <p className="muted small">{t('inbody.reviewHint')}</p>
            {sourceType === 'ocr' && <Alert kind="warn">{t('inbody.lowConfidence')}</Alert>}
            <div className="grid cols-2">
              {FIELDS.map(([key, labelKey]) => (
                <Field key={key} label={t(labelKey)}
                  hint={mismatches[key] ? `⚠ ${t('inbody.mismatch')} — ${mismatches[key]}` : undefined}>
                  <input
                    type="number" step="0.1"
                    className={mismatches[key] ? 'invalid' : (values[key] == null || values[key] === '') ? 'ar-missing' : ''}
                    value={values[key] ?? ''}
                    onChange={(e) => setValues({ ...values, [key]: e.target.value === '' ? null : parseFloat(e.target.value) })}
                  />
                </Field>
              ))}
              <Field label={t('inbody.field.testDate')}>
                <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} />
              </Field>
            </div>
            <div className="row end">
              <button className="btn secondary" onClick={() => { setValues(null); setExtracted(null); setFile(null); setPreviewUrl(null) }}>
                {t('common.back')}
              </button>
              <button className="btn" onClick={save} disabled={busy}>
                {busy ? <Spinner /> : t('inbody.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
