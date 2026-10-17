/**
 * Where the API is when the app is opened on localhost.
 *
 * The server that sends the page also answers the API (live on 4000, the dev
 * folder on 4001), so the page talks to wherever it came from. That keeps a
 * dev browser from ever talking to the live server, and lets a test put a
 * proxy in front (bad signal on purpose, e2e/signal.mjs).
 *
 * Only the Vite dev server (5173) serves pages without the API; it uses
 * VITE_API_PORT from apps/web/.env.local. See GO_LIVE.md, "Live and dev are
 * separate".
 */
const VITE_DEV_PORT = '5173'
export const LOCAL_API_ORIGIN = typeof window !== 'undefined' && window.location.port !== VITE_DEV_PORT
  ? window.location.origin
  : `http://localhost:${import.meta.env.VITE_API_PORT || '4001'}`
