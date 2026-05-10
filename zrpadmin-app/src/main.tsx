// main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

// 👇 Import your AuthProvider
import { AuthProvider } from './context/AuthContext' 
import { OfficerProvider } from './context/OfficerContext'

import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      {/* 👇 Wrap with AuthProvider FIRST (since OfficerProvider may depend on auth) */}
      <AuthProvider>
        <OfficerProvider>
          <App />
        </OfficerProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)