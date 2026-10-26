/**
 * "Send feedback": a picture of what is on screen, what the person wrote, and
 * where they were, sent through the save queue (outbox.ts) so it reaches the
 * server on weak signal, once.
 *
 * The picture is drawn in the browser from the page itself (modern-screenshot,
 * free and open source): the part of the page that is on screen, including
 * what is scrolled inside it. Pictures from other sites that do not allow it
 * (some map tiles, photos on another server) and embedded pages (iframes) come
 * out blank; if the picture cannot be made at all, the feedback is sent
 * without it and the form says so.
 *
 * Page errors since the app was opened are kept in memory (the last 10) and
 * go with the feedback. Nothing here is kept in browser storage except the
 * queued send itself, which the save queue deletes once the server has it.
 */

import { registerKind, enqueue, whenSaved } from './outbox'
import { sendJson, API_ORIGIN } from './syncHttp'
import { fetchWithAuth } from './crmAuth'
import { newId } from './recordSync'
import { runningAppFile } from './appUpdate'
import { recordFromAddress, type FeedbackStatusValue, type FeedbackRecordType } from '../../portal/src/server/lib/feedbackModel'
export { recordFromAddress, recordText, deviceText, FEEDBACK_STATUS_LABEL, FEEDBACK_RECORD_LABEL, FEEDBACK_ROLE_LABEL } from '../../portal/src/server/lib/feedbackModel'

/** The app's version: the git commit it was built from and when (vite.config.ts). */
export const APP_VERSION: string = String(import.meta.env.VITE_APP_VERSION || 'dev')

// ── Page errors since load ───────────────────────────────────────────────────

export interface PageError { at: string; message: string }
const errors: PageError[] = []
function note(message: string) {
  const m = message.trim().slice(0, 500)
  if (!m) return
  errors.push({ at: new Date().toISOString(), message: m })
  if (errors.length > 10) errors.shift()
}
if (typeof window !== 'undefined') {
  window.addEventListener('error', e => note(e.message || String(e.error ?? '')))
  window.addEventListener('unhandledrejection', e => note(`Unhandled: ${String((e.reason as Error)?.message ?? e.reason ?? '')}`))
}
export const recentErrors = (): PageError[] => errors.slice(-5)

// ── Screenshot ───────────────────────────────────────────────────────────────

const MAX_WIDTH = 1600

/** A JPEG of what is on screen now (data URL), or null when it cannot be made. */
export async function captureScreen(timeoutMs = 20_000): Promise<string | null> {
  try {
    const { domToJpeg } = await import('modern-screenshot')
    const w = window.innerWidth, h = window.innerHeight
    const seen = new WeakMap<Element, boolean>()
    const offScreen = (el: Element): boolean => {
      let off = seen.get(el)
      if (off === undefined) {
        const r = el.getBoundingClientRect()
        off = (r.width > 0 || r.height > 0) && (r.bottom < 0 || r.top > h || r.right < 0 || r.left > w)
        seen.set(el, off)
      }
      return off
    }
    const scale = Math.max(0.5, Math.min(window.devicePixelRatio || 1, MAX_WIDTH / w))
    const shot = domToJpeg(document.body, {
      width: w, height: h, scale, quality: 0.72, backgroundColor: '#ffffff', timeout: 6000,
      // The page as scrolled; the feedback button is left out.
      style: window.scrollX || window.scrollY ? { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)` } : undefined,
      filter: n => {
        // The feedback button, its form, and pop up messages (a "Feedback sent" from the last one) are left out.
        if (n instanceof Element && (n.hasAttribute('data-feedback-skip') || n.hasAttribute('data-toasts'))) return false
        // A long list is thousands of rows: only what is on screen is drawn. A
        // box wholly off screen keeps its size (so the rest stays in place) but
        // not what is inside it.
        const parent = n.parentElement
        return !(parent && parent !== document.body && parent !== document.documentElement && offScreen(parent))
      },
      fetch: { requestInit: { mode: 'cors', credentials: 'omit' } },
    })
    const url = await Promise.race([shot, new Promise<null>(res => setTimeout(() => res(null), timeoutMs))])
    if (typeof url === 'string' && url.startsWith('data:image/jpeg') && url.length > 1000) return url
    // Goes with the feedback, so it is known why there is no picture.
    note(url === null ? `Screenshot: not made within ${timeoutMs / 1000} s` : 'Screenshot: came out empty')
    return null
  } catch (err) {
    note(`Screenshot failed: ${String((err as Error)?.message ?? err)}`)
    console.warn('[feedback] screenshot failed:', err)
    return null
  }
}

/** "390x844 @3x" */
export function screenText(): string {
  const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100
  return `${window.innerWidth}x${window.innerHeight} @${dpr}x (screen ${window.screen?.width ?? '?'}x${window.screen?.height ?? '?'})`
}

// ── Send ─────────────────────────────────────────────────────────────────────

export interface FeedbackPayload {
  id: string
  text: string
  path: string
  screen: string
  userAgent: string
  appFile: string | null
  screenshot: string | null
  errors: PageError[]
  /** The screen's name as the app shows it ("Customers"). */
  screenTitle: string
  appVersion: string
}

registerKind<FeedbackPayload>('feedback.create', {
  what: () => 'This feedback',
  send: op => sendJson('POST', '/api/feedback', op.payload, 60_000).then(r => r.result),
})

export const feedbackKey = (id: string) => `feedback:${id}`

/** Queue it (on the phone before this resolves). Resolves true when the server has it within `waitMs`. */
export async function sendFeedback(input: { text: string; screenshot: string | null; path: string; screenTitle?: string }, waitMs = 8000): Promise<{ id: string; sent: boolean }> {
  const payload: FeedbackPayload = {
    id: newId(), text: input.text.trim(), path: input.path, screen: screenText(), userAgent: navigator.userAgent,
    appFile: runningAppFile(), screenshot: input.screenshot, errors: recentErrors(),
    screenTitle: (input.screenTitle ?? '').trim(), appVersion: APP_VERSION,
  }
  const key = feedbackKey(payload.id)
  await enqueue({ key, kind: 'feedback.create', payload, label: 'Feedback' })
  return { id: payload.id, sent: await whenSaved(key, waitMs) }
}

// ── The list (owner and admins) ──────────────────────────────────────────────

export type FeedbackStatus = FeedbackStatusValue
export interface FeedbackItem {
  id: string; userId: string; userName: string; role: string; path: string; screen: string; userAgent: string
  appFile: string; text: string; errors: PageError[]; status: FeedbackStatus; statusAt: string | null; statusBy: string | null
  createdAt: string; hasScreenshot: boolean
  screenTitle: string; recordType: FeedbackRecordType | ''; recordId: string; recordName: string; appVersion: string
}

/** What the form says will go with the feedback about where it was sent from. */
export function whereText(screenTitle: string, address: string): string {
  const rec = recordFromAddress(address)
  const screen = screenTitle || address.split('?')[0]
  return rec ? `${screen}, the ${rec.type === 'change_order' ? 'change order' : rec.type === 'service_ticket' ? 'service request' : rec.type === 'card' ? 'pipeline card' : rec.type} open` : screen
}

export async function loadFeedback(): Promise<{ ok: true; items: FeedbackItem[] } | { ok: false; error: string }> {
  try {
    const r = await sendJson('GET', '/api/feedback')
    if (r.result.ok) return { ok: true, items: (r.json?.data ?? []) as FeedbackItem[] }
    return { ok: false, error: r.json?.error || (r.status === 0 ? 'No signal right now.' : `Could not load feedback (${r.status}).`) }
  } catch { return { ok: false, error: 'No signal right now.' } }
}

export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<FeedbackItem | null> {
  const r = await sendJson('PATCH', `/api/feedback/${encodeURIComponent(id)}`, { status })
  return r.result.ok ? (r.json?.data as FeedbackItem) : null
}

/** The screenshot as a blob URL (it needs the sign in, so an <img src> to the API would not do). */
const shotUrls = new Map<string, Promise<string | null>>()
export function screenshotUrl(id: string): Promise<string | null> {
  let p = shotUrls.get(id)
  if (!p) {
    p = fetchWithAuth(`${API_ORIGIN}/api/feedback/${encodeURIComponent(id)}/screenshot`)
      .then(async r => (r.ok ? URL.createObjectURL(await r.blob()) : null))
      .catch(() => null)
      .then(u => { if (!u) shotUrls.delete(id); return u })
    shotUrls.set(id, p)
  }
  return p
}
