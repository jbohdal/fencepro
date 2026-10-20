import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const root = createRoot(document.getElementById('root')!)

// The customer portal (#/portal/...) is its own program: a customer's browser
// loads only the portal's pages and its server client, never the office's
// app, its stores or its sign in (portalNoBrowserStorage.test.ts checks this).
if (window.location.hash.startsWith('#/portal/')) {
  void import('./CustomerPortalApp').then(({ PortalRoot }) => {
    root.render(<StrictMode><PortalRoot /></StrictMode>)
  })
} else {
  void import('./App.tsx').then(({ default: App }) => {
    root.render(<StrictMode><App /></StrictMode>)
  })
  // A phone that keeps the app open takes a new version by itself, when nothing would be lost.
  if (import.meta.env.PROD) void import('./appUpdate').then(({ startUpdateCheck }) => startUpdateCheck())
}

// Installable app: keep the app's own files on the phone (never customer data).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })
}
