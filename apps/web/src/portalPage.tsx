/**
 * The customer portal on its own page under the public door (/p/portal/, built
 * by vite.portal.config.ts): only the portal's pages and its server client,
 * never the office's app. The same pages as /#/portal/ on the app's address.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './portalPage.css'
import { PortalRoot } from './CustomerPortalApp'

if (!window.location.hash.startsWith('#/portal/')) window.location.replace('#/portal/login')
createRoot(document.getElementById('root')!).render(<StrictMode><PortalRoot /></StrictMode>)
