import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { useQuery } from '../lib/useQuery'
import { Loading, Alert } from '../components/ui'

export default function Team() {
  const { t } = useI18n()
  const { profile } = useAuth()

  const { data: members } = useQuery(`team:${profile.gym_id}`, async () => {
    const { data } = await supabase.from('profiles').select('*').eq('gym_id', profile.gym_id)
    return data || []
  }, [profile.gym_id])

  if (!members) return <Loading />

  return (
    <div>
      <h1>{t('team.title')}</h1>
      <Alert kind="info">
        <b>{t('team.invite')}:</b> {t('team.inviteHint')}
        <div className="small" style={{ marginTop: 4 }}>Gym ID: <code>{profile.gym_id}</code></div>
      </Alert>
      <table className="data">
        <thead>
          <tr><th>{t('common.name')}</th><th>{t('admin.role')}</th></tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td><b>{m.full_name}</b></td>
              <td>{m.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
