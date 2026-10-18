import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startUpdateCheck } from './appUpdate'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Installable app: keep the app's own files on the phone (never customer data).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })
}

// A phone that keeps the app open takes a new version by itself, when nothing would be lost.
if (import.meta.env.PROD) startUpdateCheck()
