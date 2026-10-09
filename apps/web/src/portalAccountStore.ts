/**
 * Customer portal client — talks to the portal backend `/api/portal/*`.
 *
 * The backend owns the source of truth for portal accounts and invite tokens.
 * This module wraps the HTTP calls and keeps a local-session cache for the
 * currently logged-in portal user.
 */

import { fetchWithAuth } from './crmAuth'
import { LOCAL_API_ORIGIN } from './apiOrigin'

const SESSION_KEY = 'fencepro_portal_session'
const EVT = 'fencepro:portal:updated'

function apiBase(): string {
  if (typeof window === 'undefined') return ''
  return window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : ''
}

function staffAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    // The login token itself is attached (and refreshed) by fetchWithAuth.
    const token = localStorage.getItem('crm_access_token')
    if (token) headers['Authorization'] = `Bearer ${token}`
  } catch {}
  return headers
}

function portalAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (raw) {
      const s = JSON.parse(raw)
      if (s.accessToken) headers['Authorization'] = `Bearer ${s.accessToken}`
    }
  } catch {}
  return headers
}

// ── Public types ──

export type PortalStatus = 'invited' | 'active' | 'suspended'

export interface PortalAccount {
  id: string
  crmCustomerId: string
  email: string
  firstName: string | null
  lastName: string | null
  status: PortalStatus
  invitedAt?: string
  inviteTokenExpiresAt?: string
  activatedAt?: string
  lastLoginAt?: string
}

export interface InviteResult {
  accountId: string
  status: PortalStatus
  expiresAt: string
  activationUrl: string
  emailSent: boolean
  emailError?: string
}

// ── Invite management (staff-initiated) ──

/**
 * Create or refresh an invite for the given CRM customer. Always returns the
 * activation URL so the UI can optionally copy it to the clipboard or open an
 * email client as a fallback. Sends an email server-side if SendGrid is
 * configured.
 */
export async function sendPortalInvite(customer: { id: string; email: string; firstName?: string; lastName?: string }): Promise<{ ok: boolean; data?: InviteResult; error?: string }> {
  try {
    const res = await fetchWithAuth(`${apiBase()}/api/portal/invite`, {
      method: 'POST',
      headers: staffAuthHeaders(),
      body: JSON.stringify({
        crmCustomerId: customer.id,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
      }),
    })
    const json = await res.json()
    if (!res.ok || !json.success) return { ok: false, error: json?.error || `HTTP ${res.status}` }
    try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
    return { ok: true, data: json.data as InviteResult }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' }
  }
}

export async function resendPortalInvite(email: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  try {
    const res = await fetch(`${apiBase()}/api/portal/resend-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const json = await res.json()
    if (!res.ok || !json.success) return { ok: false, error: json?.error || `HTTP ${res.status}` }
    return { ok: true, status: json.data?.status }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' }
  }
}

// ── Activation + login + session ──

export interface ActivateResult {
  ok: boolean
  error?: string
  user?: { id: string; email: string; firstName: string | null; lastName: string | null; crmCustomerId: string }
}

export async function verifyAndActivate(rawToken: string, password: string, confirmPassword?: string): Promise<ActivateResult> {
  try {
    const res = await fetch(`${apiBase()}/api/portal/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: rawToken, password, confirmPassword: confirmPassword ?? password }),
    })
    const json = await res.json()
    if (!res.ok || !json.success) {
      return { ok: false, error: json?.error || `HTTP ${res.status}` }
    }
    // Persist session so the user lands on the dashboard logged in.
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      accountId: json.data.user.id,
      accessToken: json.data.accessToken,
      refreshToken: json.data.refreshToken,
      user: json.data.user,
      at: new Date().toISOString(),
    }))
    try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
    return { ok: true, user: json.data.user }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' }
  }
}

export async function login(email: string, password: string): Promise<ActivateResult> {
  try {
    const res = await fetch(`${apiBase()}/api/portal/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const json = await res.json()
    if (!res.ok || !json.success) {
      return { ok: false, error: json?.error || 'INVALID_CREDENTIALS' }
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      accountId: json.data.user.id,
      accessToken: json.data.accessToken,
      refreshToken: json.data.refreshToken,
      user: json.data.user,
      at: new Date().toISOString(),
    }))
    try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
    return { ok: true, user: json.data.user }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' }
  }
}

export function logout(): void {
  try { localStorage.removeItem(SESSION_KEY) } catch {}
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
}

export interface CurrentSession {
  id: string
  email: string
  firstName: string
  lastName: string
  crmCustomerId: string
  customerId: string  // alias for crmCustomerId — maintains compatibility with the legacy localStorage shape
  status: 'active'
}

export function getCurrentSession(): CurrentSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const { user } = JSON.parse(raw)
    if (!user?.id) return null
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      crmCustomerId: user.crmCustomerId,
      customerId: user.crmCustomerId,  // the portal pages read .customerId
      status: 'active',
    }
  } catch { return null }
}

// ── Customer-profile badge helpers ──

export interface PortalAccessStatus {
  state: 'none' | 'invited' | 'active' | 'suspended'
  account?: PortalAccount
  lastLogin?: string
  invitedAt?: string
  expiresAt?: string
}

// Staff-side list cache so we don't have to re-fetch on every badge render
const ACCOUNTS_CACHE_KEY = 'fencepro_portal_accounts_cache'
const CACHE_TTL_MS = 30_000
let cacheLoadedAt = 0
let cachePromise: Promise<PortalAccount[]> | null = null

async function fetchAccounts(): Promise<PortalAccount[]> {
  if (cachePromise && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return cachePromise
  cacheLoadedAt = Date.now()
  cachePromise = (async () => {
    try {
      const res = await fetchWithAuth(`${apiBase()}/api/portal/accounts`, { headers: staffAuthHeaders() })
      const json = await res.json()
      if (res.ok && json.success) {
        const list = json.data as PortalAccount[]
        try { localStorage.setItem(ACCOUNTS_CACHE_KEY, JSON.stringify(list)) } catch {}
        return list
      }
    } catch {}
    // Fall back to last-good cache
    try { const r = localStorage.getItem(ACCOUNTS_CACHE_KEY); return r ? JSON.parse(r) : [] } catch { return [] }
  })()
  return cachePromise
}

/**
 * Synchronous lookup for the customer profile badge. Reads from the cache
 * populated by loadAccountsSoon(). Returns 'none' when the cache is empty.
 */
export function getPortalAccessStatus(customerId: string): PortalAccessStatus {
  try {
    const r = localStorage.getItem(ACCOUNTS_CACHE_KEY)
    const list: PortalAccount[] = r ? JSON.parse(r) : []
    const a = list.find(x => x.crmCustomerId === customerId)
    if (!a) return { state: 'none' }
    if (a.status === 'active') return { state: 'active', account: a, lastLogin: a.lastLoginAt }
    if (a.status === 'suspended') return { state: 'suspended', account: a }
    return { state: 'invited', account: a, invitedAt: a.invitedAt, expiresAt: a.inviteTokenExpiresAt }
  } catch { return { state: 'none' } }
}

/** Kick off a background refresh of the accounts cache. Safe to call frequently. */
export function loadAccountsSoon(): Promise<PortalAccount[]> {
  return fetchAccounts()
}

export async function adminListAccounts(): Promise<PortalAccount[]> {
  cacheLoadedAt = 0
  cachePromise = null
  return fetchAccounts()
}

export async function adminForceActivate(accountId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchWithAuth(`${apiBase()}/api/portal/accounts/${accountId}/force-activate`, {
      method: 'POST', headers: staffAuthHeaders(),
    })
    const json = await res.json()
    cacheLoadedAt = 0; cachePromise = null
    return res.ok && json.success ? { ok: true } : { ok: false, error: json?.error }
  } catch (err: any) { return { ok: false, error: err?.message } }
}

export async function adminRevokeAccount(accountId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchWithAuth(`${apiBase()}/api/portal/accounts/${accountId}/revoke`, {
      method: 'POST', headers: staffAuthHeaders(),
    })
    const json = await res.json()
    cacheLoadedAt = 0; cachePromise = null
    return res.ok && json.success ? { ok: true } : { ok: false, error: json?.error }
  } catch (err: any) { return { ok: false, error: err?.message } }
}

// ── Legacy shims (maintain old imports) ──

export function ensurePortalAccount(_customer: { id: string; firstName?: string; lastName?: string; email?: string }):
  { account: PortalAccount; rawToken?: string; created: boolean } | null {
  // Legacy synchronous entry-point. The new backend-backed flow is async, so
  // this shim is retained only so older imports don't break. Real callers
  // should use sendPortalInvite() directly.
  return null
}

export function resendInvite(_customerId: string): { account: PortalAccount; rawToken: string } | null {
  return null
}

export function buildActivationLink(rawToken: string): string {
  if (typeof window === 'undefined') return `/#/portal/activate?token=${rawToken}`
  return `${window.location.origin}/#/portal/activate?token=${rawToken}`
}

export function buildLoginLink(): string {
  if (typeof window === 'undefined') return `/#/portal/login`
  return `${window.location.origin}/#/portal/login`
}

// ── Session helpers ──

export function setPassword(_accountId: string, _password: string): boolean {
  // TODO: add /api/portal/me/password endpoint. Returns false for now so the
  // Account page shows a friendly "Use Forgot Password" prompt.
  return false
}

export const PORTAL_UPDATED_EVENT = EVT
