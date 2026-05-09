import { Routes, Route } from 'react-router-dom'

// Page imports
import Welcome from './pages/Welcome'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import ServerScreen from './pages/ServerScreen'
import ProtectedRoute from './components/ProtectedRoutes'

function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Welcome />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      
      {/* Protected routes */}
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<Dashboard />}>
          <Route index element={<h2>📊 Admin Overview</h2>} />
          <Route path="servers" element={<ServerScreen />} />
          <Route path="logs" element={<h2>📋 Activity Logs</h2>} />
          <Route path="settings" element={<h2>⚙️ Settings</h2>} />
        </Route>
      </Route>
      
      {/* 404 fallback */}
      <Route path="*" element={<h2>404 - Page Not Found</h2>} />
    </Routes>
  )
}

export default App