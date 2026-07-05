import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { arDigits } from '../lib/digits'

// Plans awaiting the nutritionist's review/approval (matches the Approvals queue).
const APPROVAL_STATES = ['IN_REVIEW', 'GENERATED', 'DRAFT']

// Role-aware sidebar (plan §3)
const NAV = {
  nutritionist: [
    ['/', 'nav.dashboard'],
    ['/to-submit', 'nav.approvals'],
    ['/clients', 'nav.clients'],
    ['/plans', 'nav.plans'],
  ],
  gym_admin: [
    ['/', 'nav.dashboard'],
    ['/plans', 'nav.plans'],
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
  const location = useLocation()
  const links = NAV[role] || []

  // Count of plans awaiting approval → red badge on the nutritionist's Approvals tab.
  const [approvalCount, setApprovalCount] = useState(0)
  useEffect(() => {
    if (role !== 'nutritionist') return
    let cancelled = false
    supabase.from('plans').select('id', { count: 'exact', head: true })
      .in('status', APPROVAL_STATES)
      .then(({ count }) => { if (!cancelled) setApprovalCount(count || 0) })
    return () => { cancelled = true }
  }, [role, location.pathname])

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
              {to === '/to-submit' && approvalCount > 0 && (
                <span className="nav-badge">{arDigits(approvalCount, lang)}</span>
              )}
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
