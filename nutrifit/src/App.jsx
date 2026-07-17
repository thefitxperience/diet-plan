import { useEffect, useRef } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { Loading, Alert } from './components/ui'
import Layout from './components/Layout'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import AccountStatus from './pages/AccountStatus'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'
import ClientProfile from './pages/ClientProfile'
import InBodyUpload from './pages/InBodyUpload'
import NewPlan from './pages/NewPlan'
import Plans from './pages/Plans'
import SubmitQueue from './pages/SubmitQueue'
import PlanEditor from './pages/PlanEditor'
import PlanView from './pages/PlanView'
import Team from './pages/Team'
import GymSettings from './pages/GymSettings'
import AdminGyms from './pages/AdminGyms'
import AdminUsers from './pages/AdminUsers'
import ActivityLog from './pages/ActivityLog'
import Intake from './pages/Intake'
import PlanShare from './pages/PlanShare'

function RequireRole({ roles, children }) {
  const { role } = useAuth()
  if (!roles.includes(role)) return <Navigate to="/" replace />
  return children
}

export default function App() {
  const { session, profile, loading, profileError, needsOnboarding, status, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Public, no-login links — rendered before any auth gate. Note the trailing
  // slash on '/plan/' so it doesn't match the authenticated '/plans' list.
  // Clean, hash-free intake link (soft launch): /diet/<slug> is served to
  // index.html by an Apache rewrite, so we read the real path here.
  const cleanIntake = window.location.pathname.match(/^\/diet\/([^/]+)\/?$/i)
  const isIntake = location.pathname.startsWith('/intake')
  const isPublic = isIntake || location.pathname.startsWith('/plan/') || !!cleanIntake

  // Always land on the dashboard on sign-in. Keyed on the user id going
  // falsy→truthy, which fires on login and on a refresh that restores the
  // session, but NOT on tab-refocus (AuthProvider preserves the session ref
  // there, so the id is unchanged and in-progress screens survive a refocus).
  const userId = session?.user?.id
  const prevUserId = useRef(userId)
  useEffect(() => {
    if (!isPublic && !prevUserId.current && userId) navigate('/', { replace: true })
    prevUserId.current = userId
  }, [userId, navigate, isPublic])

  if (cleanIntake) {
    return <Intake slug={decodeURIComponent(cleanIntake[1])} />
  }
  if (isPublic) {
    return (
      <Routes>
        <Route path="/intake/:token" element={<Intake />} />
        <Route path="/plan/:token" element={<PlanShare />} />
      </Routes>
    )
  }

  if (loading) return <Loading />
  if (!session) return <Login />
  if (needsOnboarding) return <Onboarding />
  if (profileError || !profile) {
    return (
      <div className="center">
        <Alert kind="error">{profileError || 'No profile found for this account.'}</Alert>
        <button className="btn secondary" onClick={signOut}>Sign out</button>
      </div>
    )
  }
  // Self-registered accounts wait for approval before they can use the app.
  if (status === 'pending' || status === 'rejected') return <AccountStatus status={status} />

  const NUTRI = ['nutritionist', 'platform_admin']
  const GYM = ['gym_admin']
  const ADMIN = ['platform_admin']

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/:id" element={<ClientProfile />} />
        <Route path="/clients/:id/inbody" element={<RequireRole roles={NUTRI}><InBodyUpload /></RequireRole>} />
        <Route path="/clients/:id/new-plan" element={<RequireRole roles={NUTRI}><NewPlan /></RequireRole>} />
        <Route path="/plans" element={<Plans />} />
        <Route path="/to-submit" element={<RequireRole roles={NUTRI}><SubmitQueue /></RequireRole>} />
        <Route path="/plans/:id" element={<PlanView />} />
        <Route path="/plans/:id/edit" element={<RequireRole roles={NUTRI}><PlanEditor /></RequireRole>} />
        <Route path="/team" element={<RequireRole roles={[...GYM, ...ADMIN]}><Team /></RequireRole>} />
        <Route path="/settings" element={<RequireRole roles={GYM}><GymSettings /></RequireRole>} />
        <Route path="/admin/gyms" element={<RequireRole roles={ADMIN}><AdminGyms /></RequireRole>} />
        <Route path="/admin/users" element={<RequireRole roles={ADMIN}><AdminUsers /></RequireRole>} />
        <Route path="/activity" element={<RequireRole roles={ADMIN}><ActivityLog /></RequireRole>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
