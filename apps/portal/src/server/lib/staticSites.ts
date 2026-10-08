/**
 * Serve the built front ends from this server, so one process answers the
 * whole domain (no nginx in front).
 *
 *   WEB_DIST_DIR     the CRM web app build (apps/web/dist), served at /
 *   PORTAL_DIST_DIR  the customer portal build (apps/portal/dist/client),
 *                    served at /portal/. Build it with: vite build --base=/portal/
 *
 * Leave both unset and nothing changes: the server answers /api only.
 *
 * Call this after every /api route is mounted. Anything under /api that no
 * route claimed gets a JSON 404 here, so the web app's index.html can never
 * answer an API call.
 */
import express from 'express'
import fs from 'fs'
import path from 'path'

export interface StaticSiteOptions {
  webDistDir?: string
  portalDistDir?: string
}

// Vite puts a content hash in every file name under assets/, so these never
// change. A new build produces new names.
const ASSET_CACHE = 'public, max-age=31536000, immutable'
// index.html must be checked on every load, or a browser keeps running old
// code after an update.
const NO_CACHE = 'no-cache'

function resolveSite(label: string, dir: string | undefined): string | null {
  if (!dir) return null
  const root = path.resolve(dir)
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    console.warn(`[static] ${label}: no index.html in ${root}. Not serving it. Build it first.`)
    return null
  }
  return root
}

function mountSite(app: express.Express, prefix: '' | '/portal', root: string): void {
  const notFound = (_req: express.Request, res: express.Response) => { res.status(404).type('text/plain').send('Not found') }
  const sendIndex = (_req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', NO_CACHE)
    res.sendFile('index.html', { root })
  }

  // A missing asset is a 404, never index.html: a browser asking for a script
  // must not be handed a page.
  app.use(
    `${prefix}/assets`,
    express.static(path.join(root, 'assets'), { index: false, setHeaders: res => res.setHeader('Cache-Control', ASSET_CACHE) }),
    notFound,
  )
  // Other real files in the build (favicon, icons).
  app.use(prefix || '/', express.static(root, { index: false, setHeaders: res => res.setHeader('Cache-Control', NO_CACHE) }))
  // Everything else is the single page app.
  app.use(prefix || '/', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    sendIndex(req, res)
  })
}

export function mountStaticSites(app: express.Express, opts: StaticSiteOptions): void {
  const web = resolveSite('WEB_DIST_DIR', opts.webDistDir)
  const portal = resolveSite('PORTAL_DIST_DIR', opts.portalDistDir)
  if (!web && !portal) return

  app.use('/api', (_req, res) => { res.status(404).json({ success: false, error: 'Not found' }) })

  // The portal goes first: the web app claims every other path.
  if (portal) {
    mountSite(app, '/portal', portal)
    console.log(`[static] customer portal at /portal/ from ${portal}`)
  }
  if (web) {
    mountSite(app, '', web)
    console.log(`[static] web app at / from ${web}`)
  }
}
