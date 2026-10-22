/**
 * The customer portal's only way to the server (/api/portal/*).
 *
 * Signing in sets an httpOnly session cookie on the server's answer; this
 * file never sees, stores or sends a token. Every call goes with the cookie
 * (credentials: 'include'), and every change also sends X-Portal-Request: 1,
 * which the server requires on writes (lib/portalSession.ts). Nothing is kept
 * in the browser: what the pages show is read from the server each time.
 *
 * The office's side (invites, a customer's photos and messages) is
 * portalStaffApi.ts. This file and the portal pages never import staff code,
 * and a test (portalNoBrowserStorage.test.ts) fails if anything they load
 * touches the browser's storage.
 */

import { LOCAL_API_ORIGIN } from './apiOrigin'
import { onPublicPortalPage, PUBLIC_PORTAL_API } from './publicDoor'

function apiBase(): string {
  if (typeof window === 'undefined') return ''
  // The page under the public door talks to the server it came from.
  if (onPublicPortalPage()) return ''
  return window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : ''
}

/** The portal's API: /p/portal/api on the page under the public door (only /p reaches the internet), else /api/portal. */
function apiRoot(): string {
  return onPublicPortalPage() ? PUBLIC_PORTAL_API : `${apiBase()}/api/portal`
}

/** Signed out by the server (session ended or run out): the pages go to the sign in page. */
export const PORTAL_SIGNED_OUT_EVENT = 'ezbiz:portal:signed-out'

async function call(method: string, p: string, body?: unknown): Promise<{ status: number; json: any }> {
  const write = method !== 'GET'
  const headers: Record<string, string> = {}
  if (write) headers['X-Portal-Request'] = '1'
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${apiRoot()}${p}`, {
    method, credentials: 'include', headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (res.status === 401 && p !== '/login' && p !== '/me/password') {
    try { window.dispatchEvent(new CustomEvent(PORTAL_SIGNED_OUT_EVENT)) } catch { /* no window */ }
  }
  return { status: res.status, json }
}

const failed = (r: { status: number; json: any }) => (r.json?.error as string) || `HTTP ${r.status}`

// ── Sign in ──

export interface PortalUser {
  id: string
  email: string
  firstName: string
  lastName: string
  crmCustomerId: string
  customer: { firstName: string; lastName: string; phone: string; serviceAddress: string } | null
}

/** Who is signed in (from the server, by the cookie), or null. 'offline': the server could not be reached. */
export async function fetchMe(): Promise<PortalUser | null | 'offline'> {
  try {
    const r = await call('GET', '/me')
    if (r.status === 401) return null
    return r.json?.success ? (r.json.data as PortalUser) : 'offline'
  } catch { return 'offline' }
}

export async function login(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await call('POST', '/login', { email, password })
    return r.json?.success ? { ok: true } : { ok: false, error: r.json?.error || 'INVALID_CREDENTIALS' }
  } catch { return { ok: false, error: 'NETWORK' } }
}

/** Set a password on the invite link; the answer signs the customer in. */
export async function verifyAndActivate(rawToken: string, password: string, confirmPassword?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await call('POST', '/activate', { token: rawToken, password, confirmPassword: confirmPassword ?? password })
    return r.json?.success ? { ok: true } : { ok: false, error: r.json?.error || 'ACTIVATION_FAILED' }
  } catch { return { ok: false, error: 'NETWORK' } }
}

export async function logout(): Promise<void> {
  try { await call('POST', '/logout', {}) } catch { /* the cookie runs out by itself */ }
}

export async function resendPortalInvite(email: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await call('POST', '/resend-invite', { email })
    return r.json?.success ? { ok: true } : { ok: false, error: r.json?.error || failed(r) }
  } catch { return { ok: false, error: 'NETWORK' } }
}

export async function changePassword(currentPassword: string, password: string, confirmPassword: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await call('POST', '/me/password', { currentPassword, password, confirmPassword })
    return r.json?.success ? { ok: true } : { ok: false, error: r.json?.error || failed(r) }
  } catch { return { ok: false, error: 'NETWORK' } }
}

// ── The company (name, phone, the portal's color) ──

export interface PortalCompany {
  name: string; phone: string; email: string
  portal: { accentColor: string; supportEmail: string; supportPhone: string; welcomeMessage: string }
}

export async function fetchCompany(): Promise<PortalCompany | null> {
  try {
    const r = await call('GET', '/company')
    return r.json?.success ? (r.json.data as PortalCompany) : null
  } catch { return null }
}

// ── Quotes, projects, billing, papers (null: could not load) ──

/** A quote as the customer was sent it: the fence's plain name, the price, the proposal link; nothing of the office's. */
export interface PortalQuote {
  id: string; style: string; date: string; status: 'SENT' | 'SOLD' | 'LOST'
  priceCents: number
  shareToken: string | null
  hasPlan: boolean
  hasContract: boolean
}
export interface PortalProject { id: string; style: string; status: string; scheduledDate: string; address: string }
export interface PortalInvoice { id: string; invoiceNumber: string; title: string; status: string; dueDate: string; issuedDate: string; totalCents: number; amountPaidCents: number; balanceDueCents: number }
/** A job's payment schedule: the contract, each invoice with what is paid and due, each payment with its receipt. */
export interface PortalBilling {
  jobId: string; style: string
  signedCents: number; changeOrderCents: number; otherChangesCents: number; contractCents: number; paidCents: number; balanceCents: number
  invoices: Array<{ id: string; label: string; amountCents: number; paidCents: number; balanceCents: number; due: string; number: string | null }>
  payments: Array<{ id: string; amountCents: number; paidOn: string; paidOnText: string; method: string; receipt: { number: number; link: string; pdf: string } | null }>
}
export interface PortalPapers {
  /** The signed PDFs as they were stored at signing (contracts and change orders); `url` is a file link (fileHref). */
  signed?: Array<{ id: string; kind: 'contract' | 'change_order'; title: string; detail: string; signedOn: string; signedBy: string; quoteId: string; url: string }>
  /** `stored`: this quote's signed contract is in `signed`. */
  contracts: Array<{ quoteId: string; style: string; signedOn: string; url: string; stored?: boolean }>
  certificates: Array<{ jobId: string; style: string; completedOn: string; url: string }>
}

async function list<T>(p: string): Promise<T[] | null> {
  try {
    const r = await call('GET', p)
    return r.json?.success ? (r.json.data as T[]) : null
  } catch { return null }
}
export const listPortalQuotes = () => list<PortalQuote>('/quotes')
export const listPortalProjects = () => list<PortalProject>('/projects')
export const listPortalInvoices = () => list<PortalInvoice>('/invoices')
export const listPortalBilling = () => list<PortalBilling>('/billing')

export async function fetchPortalPapers(): Promise<PortalPapers | null> {
  try {
    const r = await call('GET', '/papers')
    return r.json?.success ? (r.json.data as PortalPapers) : null
  } catch { return null }
}

/** One of the portal API's own addresses (a site plan, a contract, a certificate: `site-plans/<id>.svg`) for an image or a link. */
export function portalApiHref(rel: string): string {
  return `${apiRoot()}/${rel}`
}

// ── Photos and documents ──

export interface PortalPhotoRow { id: string; fileUrl: string; name: string; mimeType: string; caption?: string | null; uploadedAt: string }
export interface PortalFileRow { id: string; fileUrl: string; name: string; size: number; mimeType: string; label?: string | null; uploadedAt: string; fromYou: boolean }
export interface PortalMediaRow { id: string; kind: 'photo' | 'video'; caption: string; category: string; takenAt: string; url: string; originalUrl: string; previewUrl: string | null; thumbUrl: string | null }

/** The id an upload is saved under: the same file again saves once. */
function fileRequestId(scope: string, file: File): string {
  const text = `${scope}|${file.name}|${file.size}|${file.lastModified}`
  let a = 0x811c9dc5, b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0
  }
  return `f-${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}${file.size.toString(16)}`
}

/** A file link from the server (signed for this file) as an address this browser can open. */
export function fileHref(fileUrl: string): string {
  if (!fileUrl) return ''
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl
  return `${apiBase()}${fileUrl}`
}

async function upload<T>(p: string, scope: string, file: File, extra: Record<string, string | undefined>): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const fd = new FormData()
    fd.append('clientId', fileRequestId(scope, file))
    fd.append('file', file)
    for (const [k, v] of Object.entries(extra)) if (v) fd.append(k, v)
    const r = await call('POST', p, fd)
    return r.json?.success ? { ok: true, data: r.json.data as T } : { ok: false, error: failed(r) }
  } catch { return { ok: false, error: 'Network error' } }
}

export const uploadPortalPhoto = (file: File, caption?: string) => upload<PortalPhotoRow>('/photos', 'portal-photo', file, { caption })
export const uploadPortalDocument = (file: File, label?: string) => upload<PortalFileRow>('/documents', 'portal-doc', file, { label })
export const listPortalPhotos = () => list<PortalPhotoRow>('/photos')
export const listPortalDocuments = () => list<PortalFileRow>('/documents')

/** Photos and video the company shared with this customer (marked Customer). */
export async function listPortalMedia(): Promise<PortalMediaRow[] | null> {
  const rows = await list<PortalMediaRow>('/media')
  if (!rows) return null
  const base = apiBase()
  return rows.map(m => ({ ...m, url: base + m.url, originalUrl: base + m.originalUrl, previewUrl: m.previewUrl && base + m.previewUrl, thumbUrl: m.thumbUrl && base + m.thumbUrl }))
}

// ── Messages ──

export interface PortalMessage { id: string; senderType: 'customer' | 'staff'; body: string; createdAt: string }

export async function listPortalMessages(): Promise<PortalMessage[] | null> {
  try {
    const r = await call('GET', '/messages')
    return r.json?.success ? (r.json.data.messages as PortalMessage[]) : null
  } catch { return null }
}

/** `requestId`: one per message typed (kept until it is sent), so sending it twice saves it once. */
export async function sendPortalMessage(body: string, requestId?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await call('POST', '/messages', { body, clientId: requestId })
    return r.json?.success ? { ok: true } : { ok: false, error: failed(r) }
  } catch { return { ok: false, error: 'Network error' } }
}

// ── Change orders (server lib/changeOrders.ts) ──

export interface PortalChangeOrder {
  id: string; number: number; status: 'sent' | 'approved' | 'void'; reason: string
  lines: Array<{ id: string; description: string; amountCents: number }>; totalCents: number
  sentAt: string | null; approvedAt: string | null; voidedAt: string | null; signedBy: string | null; signedAt: string | null
  quote: { fenceStyle: string; priceCents: number } | null
}

/** This customer's change orders: sent (to sign), approved and void (history). null: could not load. */
export const listPortalChangeOrders = () => list<PortalChangeOrder>('/change-orders')

/** Approve and sign one: the typed name and the drawn signature (PNG data URL). */
export async function signPortalChangeOrder(id: string, name: string, signature: string): Promise<{ ok: boolean; data?: PortalChangeOrder; error?: string }> {
  try {
    const r = await call('POST', `/change-orders/${encodeURIComponent(id)}/sign`, { name, signature })
    return r.json?.success ? { ok: true, data: r.json.data } : { ok: false, error: r.json?.error || 'Could not sign. Please try again.' }
  } catch { return { ok: false, error: 'No connection. Please try again.' } }
}
