import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './services/i18n'
import App from './App.jsx'
import { registerServiceWorker } from './services/serviceWorkerRegistration'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// Fire-and-forget: registration failure disables push but never blocks render.
registerServiceWorker()
