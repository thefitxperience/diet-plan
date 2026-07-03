import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { Alert, Loading, Spinner, StatusBadge } from '../components/ui'
import DeepFitTemplate from '../components/DeepFitTemplate'
import { EventLog } from './PlanView'

export default function ApprovalDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [row, setRow] = useState(null)
  const [gym, setGym] = useState(null)
  const [lang2, setLang2] = useState('en')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    ;(async () => {
      const { data: p, error: e } = await supabase.from('plans').select('*').eq('id', id).single()
      if (e) { setError(e.message); return }
      setRow(p)
      const { data: g } = await supabase.from('gyms').select('*').eq('id', p.gym_id).maybeSingle()
      setGym(g)
    })()
  }, [id])

  if (error && !row) return <Alert kind="error">{error}</Alert>
  if (!row) return <Loading />

  async function act(action) {
    if (action === 'rejected' && !comment.trim()) {
      setError(t('approvals.commentRequired'))
      return
    }
    setBusy(action)
    setError(null)
    try {
      const { error: e } = await supabase.rpc('transition_plan', {
        p_plan_id: id, p_action: action, p_comment: comment,
      })
      if (e) throw e
      navigate('/approvals')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  const pending = row.status === 'NUTRITIONIST_APPROVED'

  return (
    <div>
      <div className="row between">
        <div className="row">
          <h1 style={{ margin: 0 }}>{row.plan_data?.header?.fullName} — v{row.version}</h1>
          <StatusBadge status={row.status} />
        </div>
        <button className="btn secondary sm" onClick={() => setLang2(lang2 === 'en' ? 'ar' : 'en')}>
          {lang2 === 'en' ? t('editor.arabic') : t('editor.english')}
        </button>
      </div>

      <Alert kind="error">{error}</Alert>

      {pending && (
        <div className="card">
          <div className="row">
            <button className="btn" disabled={!!busy} onClick={() => act('approved_gym')}>
              {busy === 'approved_gym' ? <Spinner /> : `✓ ${t('approvals.approve')}`}
            </button>
            <input
              type="text" style={{ flex: 1, minWidth: 220 }}
              placeholder={t('approvals.commentPlaceholder')}
              value={comment} onChange={(e) => setComment(e.target.value)}
            />
            <button className="btn danger" disabled={!!busy} onClick={() => act('rejected')}>
              {busy === 'rejected' ? <Spinner /> : t('approvals.requestChanges')}
            </button>
          </div>
        </div>
      )}

      <div className="editor-canvas" style={{ maxHeight: 'none', marginBottom: '1rem' }}>
        <DeepFitTemplate plan={row.plan_data} lang={lang2} gym={gym} />
      </div>

      <EventLog planId={id} />
    </div>
  )
}
