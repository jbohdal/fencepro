/**
 * A phone that keeps the app open never reloads, so it would keep running the
 * version it opened with, for days, after a new one is on the Mac (that is how
 * a phone still on the Oct 16 version made doubled pipeline cards on Oct 17).
 *
 * When the app comes back to the screen, when signal returns, and every 5
 * minutes, the page on the server is read (a few hundred bytes) and its app
 * file compared with the one running. When they differ, the app reloads by
 * itself as soon as it is safe: nothing waiting to be sent and no editor with
 * unsaved work. Until then "Update" shows at the top.
 */

import { allOps, subscribe } from './outbox'

const EVT = 'ezbiz:update-ready'
const CHECK_EVERY_MS = 5 * 60_000
/** Editors with unsaved work register here (useLeaveWarning does it). */
const editors = new Set<() => boolean>()
let ready = false

export function registerUnsaved(dirty: () => boolean): () => void {
  editors.add(dirty)
  return () => { editors.delete(dirty) }
}

/** The app file this page runs, as named in the built page (/assets/index-<hash>.js). */
export function runningAppFile(doc: Document = document): string | null {
  const s = [...doc.querySelectorAll('script[type="module"][src]')].map(e => e.getAttribute('src') || '').find(src => /\/assets\/index-[\w-]+\.js$/.test(src))
  return s ?? null
}

/** The app file named in a page's HTML. */
export function appFileIn(html: string): string | null {
  return html.match(/<script[^>]+type="module"[^>]+src="([^"]*\/assets\/index-[\w-]+\.js)"/)?.[1]
    ?? html.match(/src="([^"]*\/assets\/index-[\w-]+\.js)"[^>]*type="module"/)?.[1]
    ?? null
}

export function isUpdateReady(): boolean { return ready }

function safeToReload(): boolean {
  if (allOps().length > 0) return false
  for (const dirty of editors) { try { if (dirty()) return false } catch { return false } }
  return true
}

/** Reload now if a new version is waiting and nothing would be lost. */
export function reloadIfSafe(): boolean {
  if (!ready || !safeToReload()) return false
  location.reload()
  return true
}

async function check(): Promise<void> {
  const mine = runningAppFile()
  if (!mine || ready) return
  try {
    const r = await fetch('/', { cache: 'no-store', credentials: 'same-origin' })
    if (!r.ok) return
    const theirs = appFileIn(await r.text())
    if (!theirs || theirs === mine) return
    ready = true
    try { window.dispatchEvent(new CustomEvent(EVT)) } catch { /* no window */ }
    // Back on screen or idle with nothing waiting: take it now.
    reloadIfSafe()
  } catch { /* no signal: try again later */ }
}

let started = false
export function startUpdateCheck(): void {
  if (started || !runningAppFile()) return
  started = true
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check().then(() => reloadIfSafe()) })
  window.addEventListener('online', () => { void check() })
  setInterval(() => { void check() }, CHECK_EVERY_MS)
  // Waiting changes sent: a version that was held back can go in now.
  subscribe(() => { if (ready && document.visibilityState === 'hidden') reloadIfSafe() })
  void check()
}

export const UPDATE_READY_EVENT = EVT
