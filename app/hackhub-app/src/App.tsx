import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import { LoadingOverlay } from '@mantine/core'
import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { useAuthStore } from './store/authStore'
import { RealtimeProvider } from './contexts/RealtimeContext'
import { DigitalPioneerOverview } from './pages/DigitalPioneerOverview'
import { LandingPage } from './pages/LandingPage'
import { useAwardAccess } from './hooks/useAwardAccess'
import { loginDestination } from './lib/loginDestination'
import { HackathonAccess } from './components/HackathonAccess'

let preloadedAwardManagement: ComponentType | undefined
const loadAwardManagement = () => import('./pages/AwardManagement').then((module) => {
  preloadedAwardManagement = module.AwardManagement
  return { default: module.AwardManagement }
})
const LazyAwardManagement = lazy(loadAwardManagement)
function AwardManagement() {
  // An already downloaded page can mount without another Suspense fallback.
  const [Page] = useState(() => preloadedAwardManagement ?? LazyAwardManagement)
  return <Page />
}
const CreateHackathon = lazy(() => import('./pages/CreateHackathon'))
const HackathonEdit = lazy(() => import('./pages/HackathonEdit').then((module) => ({ default: module.HackathonEdit })))
const ProjectShowcase = lazy(() => import('./pages/ProjectShowcase').then((module) => ({ default: module.ProjectShowcase })))
const NominationApprovals = lazy(() => import('./pages/NominationApprovals').then((module) => ({ default: module.NominationApprovals })))
const Profile = lazy(() => import('./pages/Profile').then((module) => ({ default: module.Profile })))
const Login = lazy(() => import('./pages/Login').then((module) => ({ default: module.Login })))
const Register = lazy(() => import('./pages/Register').then((module) => ({ default: module.Register })))
const AdminUsers = lazy(() => import('./pages/AdminUsers').then((module) => ({ default: module.AdminUsers })))
const JudgingPanel = lazy(() => import('./pages/JudgingPanel').then((module) => ({ default: module.JudgingPanel })))
const Leaderboard = lazy(() => import('./pages/Leaderboard').then((module) => ({ default: module.Leaderboard })))
const AcceptInvitation = lazy(() => import('./pages/AcceptInvitation').then((module) => ({ default: module.AcceptInvitation })))

function ReviewAccess({ children }: { children: ReactNode }) {
  const { hackathonId, id } = useParams()
  if (hackathonId || id) return <HackathonAccess permission="canReview">{children}</HackathonAccess>
  return <ReviewModuleAccess>{children}</ReviewModuleAccess>
}

function ReviewModuleAccess({ children }: { children: ReactNode }) {
  const { canReview, loading } = useAwardAccess()
  if (loading) return <LoadingOverlay visible />
  return canReview ? children : <Navigate to="/projects" replace />
}

function App() {
  const location = useLocation()
  const { user, loading, initialized, initialize } = useAuthStore()

  // Initialize auth on app start
  useEffect(() => {
    if (!initialized) {
      initialize()
    }
  }, [initialized, initialize])

  // Download the award page alongside session restoration; access checks still gate rendering.
  useEffect(() => {
    if (/^\/(awards(?:\/[^/]+)?|committee|hackathons)$/.test(location.pathname)) {
      void loadAwardManagement().catch(() => { /* The lazy route handles import failures when rendered. */ })
    }
  }, [location.pathname])

  // Keep the login form mounted while submitting so failed attempts retain their input.
  if (!initialized || (loading && location.pathname !== '/login')) {
    return <LoadingOverlay visible />
  }

  if (!user) {
    return (
      <Suspense fallback={<LoadingOverlay visible />}>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/organization/setup" element={<Navigate to="/login" replace />} />
          <Route path="/invite/:token" element={<AcceptInvitation />} />
          <Route path="*" element={<Navigate to={`/login?redirect=${encodeURIComponent(location.pathname + location.search + location.hash)}`} replace />} />
        </Routes>
      </Suspense>
    )
  }

  // Website sections share the original layout after authentication.
  if (['/', '/overview', '/nominate', '/projects'].includes(location.pathname)) {
    return <RealtimeProvider><LandingPage>
      <Suspense fallback={<LoadingOverlay visible />}>
        {location.pathname === '/nominate' ? <ProjectShowcase nominationMode />
          : location.pathname === '/projects' ? <ProjectShowcase />
          : <DigitalPioneerOverview />}
      </Suspense>
    </LandingPage></RealtimeProvider>
  }

  const isParticipant = !['admin', 'manager'].includes(user.role)

  return (
    <RealtimeProvider>
      <LandingPage>
        <Suspense fallback={<LoadingOverlay visible />}>
          <Routes>
            <Route path="/overview" element={<DigitalPioneerOverview />} />
            <Route path="/committee" element={<ReviewAccess><AwardManagement /></ReviewAccess>} />
            <Route path="/awards" element={<ReviewAccess><AwardManagement /></ReviewAccess>} />
            <Route path="/awards/:id" element={<ReviewAccess><AwardManagement /></ReviewAccess>} />
            <Route path="/hackathons" element={isParticipant ? <Navigate to="/" replace /> : <AwardManagement />} />
            <Route path="/hackathons/create" element={isParticipant ? <Navigate to="/" replace /> : <CreateHackathon />} />
            <Route path="/hackathons/:id" element={isParticipant ? <Navigate to="/" replace /> : <HackathonAccess><AwardManagement /></HackathonAccess>} />
            <Route path="/hackathons/:id/edit" element={isParticipant ? <Navigate to="/" replace /> : <HackathonAccess><HackathonEdit /></HackathonAccess>} />
            <Route path="/hackathons/:id/teams" element={<Navigate to="/projects" replace />} />
            <Route path="/organizations/:orgId/hackathons/:id/teams" element={<Navigate to="/projects" replace />} />
            <Route path="/teams" element={<Navigate to="/projects" replace />} />
            <Route path="/teams/:id" element={<Navigate to="/projects" replace />} />
            <Route path="/ideas" element={<Navigate to="/projects" replace />} />
            <Route path="/hackathons/:id/ideas" element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<ProjectShowcase />} />
            <Route path="/nominate" element={<ProjectShowcase nominationMode />} />
            <Route path="/my-nominations" element={<NominationApprovals />} />
            <Route path="/nomination-approvals" element={<NominationApprovals reviewMode />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/organization/setup" element={<Navigate to="/" replace />} />
            <Route path="/organizations" element={<Navigate to="/" replace />} />
            <Route path="/organizations/new" element={<Navigate to="/" replace />} />
            <Route path="/organizations/:id" element={<Navigate to="/" replace />} />
            <Route path="/admin/users" element={isParticipant ? <Navigate to="/overview" replace /> : <AdminUsers />} />
            <Route path="/admin/nominees" element={user.role === 'admin' ? <ProjectShowcase managementMode /> : <Navigate to="/projects" replace />} />
            <Route path="/admin/organizations" element={<Navigate to="/" replace />} />
            <Route path="/hackathons/:hackathonId/judge" element={<ReviewAccess><JudgingPanel /></ReviewAccess>} />
            <Route path="/hackathons/:hackathonId/leaderboard" element={<ReviewAccess><Leaderboard /></ReviewAccess>} />
            <Route path="/invite/:token" element={<AcceptInvitation />} />
            <Route path="/login" element={<Navigate to={loginDestination(location.search)} replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </LandingPage>
    </RealtimeProvider>
  )
}

export default App
