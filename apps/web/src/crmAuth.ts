/**
 * Staff sign in for the CRM web app (and the installed phone app).
 *
 * Signed in by the cookie `ezbiz_staff` (plan of Oct 20, 2026): the server
 * sets it on sign in, the page's script never sees it (HttpOnly), and the
 * browser sends it with every call to /api. Nothing about the sign in is kept
 * in the browser's storage: who is signed in is asked of the server on every
 * start (/api/crm-auth/me) and held in memory only.
 *
 * Every call that changes something carries `X-Staff-Request: 1`, which a page
 * on another site cannot send (the server refuses a cookie save without it).
 * fetchWithAuth and authFetch add it, and the cookie, to every call; every
 * store must use one of them (not bare fetch) for the API.
 *
 * Moving over (until stage D): a phone signed in before the switch has the old
 * tokens in its storage. On its first start after the deploy they are swapped
 * for a cookie once (one tab at a time), then deleted. See moveOverOldSignIn.
 */

import { LOCAL_API_ORIGIN } from './apiOrigin'
import { noteDocVersions } from './docVersions'
import { peekMoved, noteMoved } from './movedNotice'

const AUTH_API = (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '') + '/api/crm-auth'

/** The header every staff call carries: "this came from our app" (lib/staffSession.ts on the server). */
export const APP_HEADER = 'X-Staff-Request'

export interface CrmUser {
  id: string
  email: string
  firstName: string
  lastName: string
  /** Direct phone (10 digits): {rep_phone} in appointment texts. */
  phone?: string | null
  role: string
  status: string
  mustChangePassword: boolean
  avatarUrl?: string
  lastLoginAt?: string
  signedInBy?: 'cookie' | 'token'
  readOnly?: boolean
}

/** Who is signed in, as the server last said. In memory only. */
let signedInUser: CrmUser | null = null

/** True once the server said who is signed in on this device (and until a 401 or sign out). */
export function isSignedIn(): boolean { return !!signedInUser }
export function signedInUserId(): string | null { return signedInUser?.id ?? null }
/** The signed in person (name, role), as the server said. */
export function currentUser(): CrmUser | null { return signedInUser }

/** The request with the cookie and the app header. */
function withApp(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers || {})
  headers.set(APP_HEADER, '1')
  return { ...init, headers, credentials: 'include' }
}

type SessionExpiredHandler = () => void
let sessionExpiredHandler: SessionExpiredHandler | null = null
export function setSessionExpiredHandler(h: SessionExpiredHandler): void {
  sessionExpiredHandler = h
}

function signedOutNow(): void {
  const was = !!signedInUser
  signedInUser = null
  if (was) sessionExpiredHandler?.()
}

/**
 * fetch() with the sign in cookie and the app header. A 401 means this device
 * is not signed in any more (signed out elsewhere, ended in Team, run out):
 * the signed out handler fires and the 401 is returned. No signal throws, as
 * fetch does, so what is waiting is tried again later.
 */
export async function fetchWithAuth(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, withApp(init))
  if (res.status === 401) signedOutNow()
  // A save's answer says where the board and the business record are now (docVersions.ts).
  noteDocVersions(res.headers?.get?.('X-Doc-Versions'))
  // A Salesman's record the owner moved to someone else: said once by the app (movedNotice.ts).
  peekMoved(res)
  return res
}

/** fetchWithAuth for JSON answers: the data, or a plain error. */
export async function authFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {})
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  let res: Response
  try {
    res = await fetch(path, withApp({ ...options, headers }))
  } catch {
    throw new Error('No signal right now. Try again when there is signal.')
  }
  noteDocVersions(res.headers?.get?.('X-Doc-Versions'))
  if (res.status === 401) {
    signedOutNow()
    throw new Error('Your sign in has ended. Please sign in again.')
  }
  let json: any
  try {
    json = await res.json()
  } catch {
    throw new Error(`Server returned non-JSON (status ${res.status})`)
  }
  if (!res.ok || !json.success) {
    noteMoved(json)
    throw new Error(json.error || `API error: ${res.status}`)
  }
  return json.data as T
}

export async function login(email: string, password: string): Promise<{ user: CrmUser }> {
  const res = await fetch(`${AUTH_API}/login`, withApp({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, cookie: true }),
  }))
  const data = await res.json().catch(() => ({ success: false, error: `Sign in failed (${res.status})` }))
  if (!data.success) throw new Error(data.error || 'Login failed')
  signedInUser = data.data.user
  return { user: data.data.user }
}

/** Save my own Direct phone ('' clears it). The server checks it is 10 digits. */
export async function saveMyPhone(phone: string): Promise<string | null> {
  const data = await authFetch<{ phone: string | null }>(`${AUTH_API}/me`, { method: 'PATCH', body: JSON.stringify({ phone }) })
  if (signedInUser) signedInUser = { ...signedInUser, phone: data.phone }
  return data.phone
}

/**
 * Who is signed in: the person the app's start already asked the server for
 * (checkSession, held in memory), else asked now. A screen opening no longer
 * asks again each time (audit #17: 4 of them on one quote). A sign in that has
 * ended is caught by the next request's 401 (setSessionExpiredHandler).
 */
export async function fetchCurrentUser(): Promise<CrmUser | null> {
  if (signedInUser) return signedInUser
  const s = await checkSession()
  return s.kind === 'user' ? s.user : null
}

// ── Moving over from the old stored sign in (until stage D) ──────────────────

/** The old sign in's keys. Read and deleted here only; nothing writes them any more. */
const OLD_KEYS = ['crm_access_token', 'crm_refresh_token'] as const

function oldStored(): { access: string | null; refresh: string | null } {
  try { return { access: localStorage.getItem(OLD_KEYS[0]), refresh: localStorage.getItem(OLD_KEYS[1]) } } catch { return { access: null, refresh: null } }
}
function forgetOld(): void {
  for (const k of OLD_KEYS) { try { localStorage.removeItem(k) } catch { /* storage unavailable */ } }
}
/** Whose the old token is (its `sub`), read without checking: the server checks it. */
function subOf(token: string | null): string | null {
  if (!token) return null
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub ?? null } catch { return null }
}

export type MoveOver = 'none' | 'moved' | 'offline' | 'sign-in'

/**
 * The old stored sign in becomes a cookie, once, then its keys are deleted.
 *   - Only one tab does it at a time (Web Locks); a tab that finds the keys
 *     already gone has nothing to do.
 *   - Already signed in by cookie as the same person: the keys are just deleted.
 *   - No signal: nothing changes; it is tried again (the No signal screen tries every 15 s).
 *   - The old sign in had run out: the keys are deleted and the sign in page
 *     shows (that person types the password once). What waits in the outbox
 *     stays and goes after the same person signs in again.
 */
export async function moveOverOldSignIn(): Promise<MoveOver> {
  if (!oldStored().access && !oldStored().refresh) return 'none'
  const locks = (navigator as any).locks
  const run = async (): Promise<MoveOver> => {
    const { access, refresh } = oldStored()
    if (!access && !refresh) return 'none'
    let me: Response
    try { me = await fetch(`${AUTH_API}/me`, withApp()) } catch { return 'offline' }
    if (me.ok) {
      const user = (await me.json().catch(() => null))?.data as CrmUser | undefined
      const sub = subOf(access)
      if (user && (!sub || sub === user.id)) { forgetOld(); return 'moved' }
    } else if (me.status !== 401 && me.status !== 403) return 'offline'
    let r: Response
    try {
      r = await fetch(`${AUTH_API}/move-over`, withApp({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: `Bearer ${access}` } : {}) },
        body: JSON.stringify({ refreshToken: refresh ?? undefined }),
      }))
    } catch { return 'offline' }
    if (r.ok) { forgetOld(); return 'moved' }
    if (r.status === 401 || r.status === 403 || r.status === 410) { forgetOld(); return 'sign-in' }
    return 'offline'
  }
  try {
    if (locks?.request) return await locks.request('ezbiz-staff-move-over', run)
  } catch { /* no locks here: go on without */ }
  return run()
}

/**
 * Who is signed in. Only a real "not signed in" answer shows the sign in page;
 * no signal, or the server restarting, keeps everything waiting to be sent for
 * when it can be reached again.
 */
export async function checkSession(): Promise<{ kind: 'user'; user: CrmUser } | { kind: 'signed-out' } | { kind: 'offline'; busy?: boolean }> {
  const moved = await moveOverOldSignIn()
  if (moved === 'offline') return { kind: 'offline' }
  try {
    const res = await fetch(`${AUTH_API}/me`, withApp())
    if (res.status === 401 || res.status === 403) { signedInUser = null; return { kind: 'signed-out' } }
    // Reached, but too busy (429) or restarting (5xx): not a signal problem, and it tries again by itself.
    if (!res.ok) return { kind: 'offline', busy: res.status === 429 || res.status >= 500 }
    const data = await res.json()
    if (!data.success) return { kind: 'offline' }
    signedInUser = data.data
    return { kind: 'user', user: data.data }
  } catch {
    return { kind: 'offline' }
  }
}

/** Signs this device out: the server ends the session and clears the cookie. */
export async function logout(): Promise<void> {
  try {
    await fetch(`${AUTH_API}/logout`, withApp({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))
  } catch { /* no signal: the cookie is cleared by the server next time; the page reloads */ }
  signedInUser = null
}

export async function acceptInvite(token: string, email: string, password: string): Promise<{ user: CrmUser }> {
  const res = await fetch(`${AUTH_API}/accept-invite`, withApp({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, email, password, cookie: true }),
  }))
  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'Failed to accept invite')
  signedInUser = data.data.user
  return { user: data.data.user }
}

/** Asks for a reset email. Throws when nothing can be sent (no email on the server). */
export async function forgotPassword(email: string): Promise<void> {
  const res = await fetch(`${AUTH_API}/forgot-password`, withApp({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }))
  const data = await res.json().catch(() => null)
  if (data && data.success === false) throw new Error(data.error || 'The reset email could not be sent.')
}

export async function resetPassword(token: string, email: string, password: string): Promise<void> {
  const res = await fetch(`${AUTH_API}/reset-password`, withApp({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, email, password }),
  }))
  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'Reset failed')
}

/** Change the signed in user's password. Every other device is signed out; this one stays signed in. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetchWithAuth(`${AUTH_API}/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
  const data = await res.json().catch(() => ({}))
  if (!data.success) throw new Error(data.error || 'Could not change password')
}

// Permission check for UI
const ROLE_FEATURES: Record<string, string[]> = {
  super_admin: ['*'],
  admin: ['users', 'admin', 'api_keys', 'integrations', 'pipeline', 'contacts', 'jobs', 'schedule', 'invoices', 'reports', 'settings', 'automations', 'inventory'],
  manager: ['pipeline', 'contacts', 'jobs', 'schedule', 'invoices', 'reports', 'automations', 'inventory', 'integrations'],
  sales_rep: ['pipeline', 'contacts', 'jobs', 'schedule', 'invoices', 'reports', 'inventory'],
  field_crew: ['jobs', 'schedule', 'inventory'],
  office_staff: ['pipeline', 'contacts', 'jobs', 'schedule', 'invoices', 'reports', 'inventory'],
  customer: ['jobs', 'invoices', 'contacts'],
}

export function canAccess(role: string, feature: string): boolean {
  const features = ROLE_FEATURES[role]
  if (!features) return false
  return features.includes('*') || features.includes(feature)
}
