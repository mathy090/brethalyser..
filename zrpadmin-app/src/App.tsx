import { Routes, Route, Navigate } from 'react-router-dom'
import Welcome from './pages/Welcome'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import ServerScreen from './pages/ServerScreen'
import VpnBlockedScreen from './pages/VpnBlockedScreen'
import SessionInterruptedScreen from './pages/SessionInterruptedScreen'
import ProtectedRoute from './components/ProtectedRoutes'

function App() {
  // ✅ NO useEffect auto-redirects here. Login handles ALL navigation.
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Welcome />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/vpn-blocked" element={<VpnBlockedScreen />} />
      <Route path="/session-interrupted" element={<SessionInterruptedScreen />} />

      {/* Protected routes */}
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<Dashboard />}>
          <Route index element={<h2>📊 Admin Overview</h2>} />
          <Route path="servers" element={<ServerScreen />} />
          <Route path="logs" element={<h2>📋 Activity Logs</h2>} />
          <Route path="settings" element={<h2>⚙️ Settings</h2>} />
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

export default App