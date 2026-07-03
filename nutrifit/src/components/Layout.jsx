import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'

// Role-aware sidebar (plan §3)
const NAV = {
  nutritionist: [
    ['/', 'nav.dashboard'],
    ['/clients', 'nav.clients'],
    ['/plans', 'nav.plans'],
  ],
  gym_admin: [
    ['/', 'nav.dashboard'],
    ['/approvals', 'nav.approvals'],
    ['/clients', 'nav.clients'],
    ['/team', 'nav.team'],
    ['/settings', 'nav.settings'],
  ],
  platform_admin: [
    ['/', 'nav.dashboard'],
    ['/admin/gyms', 'nav.gyms'],
    ['/admin/users', 'nav.users'],
    ['/clients', 'nav.clients'],
    ['/plans', 'nav.plans'],
    ['/activity', 'nav.activity'],
  ],
}

export default function Layout() {
  const { profile, gym, role, signOut } = useAuth()
  const { t, lang, setLang } = useI18n()
  const links = NAV[role] || []

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img
            src={`${import.meta.env.BASE_URL}assets/fit-logo.png`}
            alt={t('app.name')}
            className="sidebar-logo"
          />
        </div>
        {profile?.full_name && (
          <div className={`sidebar-user${gym?.name ? '' : ' no-gym'}`}>{profile.full_name}</div>
        )}
        {gym?.name && <div className="sidebar-gym">{gym.name}</div>}
        <nav>
          {links.map(([to, key]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              {t(key)}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
            {lang === 'en' ? 'العربية' : 'English'}
          </button>
          <button onClick={signOut}>{t('nav.signout')}</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
