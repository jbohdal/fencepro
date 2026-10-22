/**
 * Customer links through the public door. On the Tailscale address only port
 * 8443 (Tailscale Funnel) reaches the internet, and only for /p, /api/quoting
 * and /api/intake/retell (GO_LIVE.md section 12); everywhere else (localhost,
 * the dev folder) the app's own address. `path` starts with /p/.
 *
 * Nothing here touches the browser's storage (the customer portal loads it:
 * portalNoBrowserStorage.test.ts).
 */
export function publicDoorUrl(path: string): string {
  const { protocol, hostname, origin } = window.location
  return hostname.endsWith('.ts.net') ? `${protocol}//${hostname}:8443${path}` : `${origin}${path}`
}

/** The customer portal's page through the public door (/p/portal/, the server's routes/portalPublic.ts). */
export const PUBLIC_PORTAL_PAGE = '/p/portal/'
/** Its API through the public door: the customer routes of /api/portal only. */
export const PUBLIC_PORTAL_API = '/p/portal/api'

/** A customer portal page (`#/portal/login`, `#/portal/activate?token=...`) through the public door. */
export function portalPageUrl(hash: string): string {
  return publicDoorUrl(`${PUBLIC_PORTAL_PAGE}${hash}`)
}

/** The portal page was opened through the public door (its API is then under /p/portal/api). */
export function onPublicPortalPage(): boolean {
  return typeof window !== 'undefined' && window.location.pathname.startsWith('/p/portal')
}
