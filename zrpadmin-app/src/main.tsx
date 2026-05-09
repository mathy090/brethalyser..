import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { OfficerProvider } from './context/OfficerContext' // ← Add provider
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <OfficerProvider> {/* ← Wrap app */}
        <App />
      </OfficerProvider>
    </BrowserRouter>
  </StrictMode>,
)