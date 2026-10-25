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
  // The last line of defence: never a blank page (ScreenErrorBoundary.tsx). Each screen and window has its own too.
  void Promise.all([import('./App.tsx'), import('./ScreenErrorBoundary')]).then(([{ default: App }, { default: ScreenErrorBoundary }]) => {
    root.render(<StrictMode><ScreenErrorBoundary name="EZ Biz"><App /></ScreenErrorBoundary></StrictMode>)
  })
  // A phone that keeps the app open takes a new version by itself, when nothing would be lost.
  if (import.meta.env.PROD) void import('./appUpdate').then(({ startUpdateCheck }) => startUpdateCheck())
}

// Installable app: keep the app's own files on the phone (never customer data).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })
}
