// Gym filter shown only to platform admins (who span all gyms). Other roles
// are already scoped to their own gym by RLS, so it renders nothing for them.
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { useQuery } from '../lib/useQuery'
import { supabase } from '../lib/supabase'

export function useGymList() {
  const { role } = useAuth()
  const { data } = useQuery(role === 'platform_admin' ? 'gyms-list' : null, async () => {
    const { data } = await supabase.from('gyms').select('id, name').order('name')
    return data || []
  })
  return data || []
}

export default function GymFilter({ value, onChange }) {
  const { role } = useAuth()
  const { t } = useI18n()
  const gyms = useGymList()
  if (role !== 'platform_admin') return null
  return (
    <select style={{ width: 'auto' }} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('filter.allGyms')}</option>
      {gyms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
    </select>
  )
}
