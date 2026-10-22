/**
 * The customer portal through the public door (Jonathan, Oct 21 2026: "serve
 * them through the public door like proposals. No DNS change needed for that.").
 *
 * Only /p, /api/quoting and /api/intake/retell reach the internet (Tailscale
 * Funnel on port 8443, GO_LIVE.md section 12), so the portal's invite and sign
 * in links did not open for a customer. Served here under /p, the Funnel rule
 * already covers it:
 *
 *   /p/portal/            the portal's page (apps/web/dist/customer-portal,
 *                         built by `vite build --config vite.portal.config.ts`)
 *   /p/portal/api/...     the portal's API: the same routes (routes/portal.ts)
 *                         as /api/portal, ONLY the ones a customer uses
 *                         (CUSTOMER_ROUTES); every staff route answers 404
 *   /p/portal/api/media/f/<id>/<variant>   a signed photo or video link (routes/media.ts)
 *
 * The sign in is exactly as at /api/portal: an httpOnly session cookie
 * (lib/portalSession.ts), its Path the door it was made on (/p/portal/api
 * here), SameSite=Strict, writes need X-Portal-Request: 1. File and media
 * links in the answers are given as addresses under this door. The old
 * addresses (/#/portal/... and /api/portal) keep working as they did.
 */

import express, { Router, type Request, type Response, type NextFunction } from 'express'
import fs from 'fs'
import path from 'path'
import rateLimit from 'express-rate-limit'
import portalRoutes from './portal.js'
import { serveSignedMedia } from './media.js'
import { PUBLIC_PORTAL_API } from '../lib/portalSession.js'

/** What a customer's portal calls (routes/portal.ts), and nothing else. */
export const CUSTOMER_ROUTES: ReadonlyArray<readonly [string, RegExp]> = [
  ['POST', /^\/(login|logout|activate|resend-invite)$/],
  ['GET', /^\/(me|company|quotes|projects|billing|invoices|papers|change-orders|photos|documents|media|messages)$/],
  ['GET', /^\/site-plans\/[^/]+\.svg$/],
  ['GET', /^\/(contracts|certificates)\/[^/]+\.pdf$/],
  ['POST', /^\/me\/password$/],
  ['POST', /^\/change-orders\/[^/]+\/sign$/],
  ['POST', /^\/(photos|documents|messages)$/],
  ['GET', /^\/files\/.+$/],
]

export function customerRoute(method: string, p: string): boolean {
  const m = method === 'HEAD' ? 'GET' : method
  return CUSTOMER_ROUTES.some(([want, re]) => want === m && re.test(p))
}

/** File and media links in an answer, as addresses under the public door. */
export function throughDoor(v: unknown): unknown {
  if (typeof v === 'string') {
    if (v.startsWith('/api/portal/files/')) return PUBLIC_PORTAL_API + v.slice('/api/portal'.length)
    if (v.startsWith('/api/media/f/')) return PUBLIC_PORTAL_API + v.slice('/api'.length)
    return v
  }
  if (Array.isArray(v)) return v.map(throughDoor)
  if (v && typeof v === 'object' && !(v instanceof Date)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, throughDoor(x)]))
  return v
}

const limit = (windowMs: number, max: number, error: string, skipSuccessfulRequests = false) =>
  rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests, message: { success: false, error } })

// ── The API ──
export const portalPublicApi = Router()
portalPublicApi.use(limit(60_000, 300, 'Too many requests. Wait a moment and try again.'))
// Failed sign ins and invite links, as at /api/portal (index.ts loginLimiter).
portalPublicApi.use(['/login', '/activate'], limit(15 * 60_000, 10, 'Too many login attempts. Try again in 15 minutes.', true))
portalPublicApi.get('/media/f/:id/:variant', (req, res) => serveSignedMedia(req, res))
portalPublicApi.use((req: Request, res: Response, next: NextFunction) => {
  if (!customerRoute(req.method, req.path)) { res.status(404).json({ success: false, error: 'Not found' }); return }
  const json = res.json.bind(res)
  res.json = (body: any) => json(throughDoor(body))
  next()
})
portalPublicApi.use(portalRoutes)
portalPublicApi.use((_req, res) => { res.status(404).json({ success: false, error: 'Not found' }) })

// ── The page ──
export const portalPublicPage = Router()
const root = process.env.WEB_DIST_DIR ? path.resolve(process.env.WEB_DIST_DIR, 'customer-portal') : null
portalPublicPage.use((_req, res, next) => {
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Robots-Tag', 'noindex')
  next()
})
if (root) {
  portalPublicPage.use('/assets', express.static(path.join(root, 'assets'), { index: false, setHeaders: r => r.setHeader('Cache-Control', 'public, max-age=31536000, immutable') }))
  portalPublicPage.get(['/', '/index.html'], (req, res) => {
    // Always with the slash, so the page's own files load from /p/portal/assets.
    if (req.originalUrl.split('?')[0] === '/p/portal') { res.redirect(301, '/p/portal/'); return }
    if (!fs.existsSync(path.join(root, 'index.html'))) { res.status(503).type('text/plain').send('The customer portal is not built on this server.'); return }
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile('index.html', { root })
  })
}
portalPublicPage.use((_req, res) => { res.status(404).type('text/plain').send('Not found') })
