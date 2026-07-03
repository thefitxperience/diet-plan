import { Routes, Route, Navigate } from 'react-router-dom'
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
import PlanEditor from './pages/PlanEditor'
import Approvals from './pages/Approvals'
import ApprovalDetail from './pages/ApprovalDetail'
import PlanView from './pages/PlanView'
import Team from './pages/Team'
import GymSettings from './pages/GymSettings'
import AdminGyms from './pages/AdminGyms'
import AdminUsers from './pages/AdminUsers'
import ActivityLog from './pages/ActivityLog'

function RequireRole({ roles, children }) {
  const { role } = useAuth()
  if (!roles.includes(role)) return <Navigate to="/" replace />
  return children
}

export default function App() {
  const { session, profile, loading, profileError, needsOnboarding, status, signOut } = useAuth()

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
        <Route path="/plans/:id" element={<PlanView />} />
        <Route path="/plans/:id/edit" element={<RequireRole roles={NUTRI}><PlanEditor /></RequireRole>} />
        <Route path="/approvals" element={<RequireRole roles={GYM}><Approvals /></RequireRole>} />
        <Route path="/approvals/:id" element={<RequireRole roles={GYM}><ApprovalDetail /></RequireRole>} />
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
