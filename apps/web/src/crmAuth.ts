/**
 * CRM Auth Client
 *
 * Manages JWT tokens for the CRM web app.
 * Talks to /api/crm-auth/ on the portal backend.
 */

const AUTH_API = (window.location.hostname === 'localhost' ? 'http://localhost:4000' : '') + '/api/crm-auth'

let accessToken: string | null = localStorage.getItem('crm_access_token')
let refreshToken: string | null = localStorage.getItem('crm_refresh_token')

export interface CrmUser {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  status: string
  mustChangePassword: boolean
  avatarUrl?: string
  lastLoginAt?: string
}

export function getAccessToken(): string | null { return accessToken }

export function setTokens(access: string, refresh: string): void {
  accessToken = access
  refreshToken = refresh
  localStorage.setItem('crm_access_token', access)
  localStorage.setItem('crm_refresh_token', refresh)
}

export function clearTokens(): void {
  accessToken = null
  refreshToken = null
  localStorage.removeItem('crm_access_token')
  localStorage.removeItem('crm_refresh_token')
}

export function isAuthenticated(): boolean {
  return !!accessToken
}

/** Pick up tokens another tab already refreshed. Refresh tokens rotate on
 *  use, so two tabs each refreshing with the same token would log one out. */
function adoptTokensFromStorage(): boolean {
  try {
    const a = localStorage.getItem('crm_access_token')
    const r = localStorage.getItem('crm_refresh_token')
    if (a && r && (a !== accessToken || r !== refreshToken)) {
      accessToken = a
      refreshToken = r
      return true
    }
  } catch { /* storage unavailable */ }
  return false
}

async function tryRefresh(): Promise<boolean> {
  if (adoptTokensFromStorage()) return true
  if (!refreshToken) return false
  try {
    const res = await fetch(`${AUTH_API}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) return false
    const data = await res.json()
    if (data.success && data.data) {
      setTokens(data.data.accessToken, data.data.refreshToken)
      return true
    }
    return false
  } catch { return false }
}

// One refresh at a time. Every store shares it, so ten saves that all hit an
// expired token trigger a single refresh instead of ten competing ones.
let refreshInFlight: Promise<boolean> | null = null
function refreshOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = tryRefresh().finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

/**
 * fetch() with the current access token. Access tokens last 15 minutes; when
 * the server answers 401 this refreshes the token once and retries, so a save
 * made after the token expired still lands instead of failing silently.
 *
 * Every data store must use this (not bare fetch) for authenticated calls.
 * Returns the raw Response. If the session cannot be refreshed the tokens are
 * cleared, the session expired handler fires, and the 401 response is returned.
 */
export async function fetchWithAuth(url: string, init: RequestInit = {}): Promise<Response> {
  const withToken = (): RequestInit => {
    const headers: Record<string, string> = { ...((init.headers as Record<string, string>) || {}) }
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
    return { ...init, headers }
  }
  let res = await fetch(url, withToken())
  if (res.status !== 401) return res
  if (!refreshToken && !adoptTokensFromStorage()) return res
  const refreshed = await refreshOnce()
  if (!refreshed) {
    clearTokens()
    sessionExpiredHandler?.()
    return res
  }
  res = await fetch(url, withToken())
  return res
}

type SessionExpiredHandler = () => void
let sessionExpiredHandler: SessionExpiredHandler | null = null
export function setSessionExpiredHandler(h: SessionExpiredHandler): void {
  sessionExpiredHandler = h
}

/** Authenticated fetch — auto-refreshes on 401, fires sessionExpiredHandler on refresh failure. */
export async function authFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string> || {}) }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(path, { ...options, headers })
  } catch (err) {
    throw new Error('Network error — check your connection and try again.')
  }

  if (res.status === 401) {
    if (refreshToken) {
      const refreshed = await refreshOnce()
      if (refreshed) {
        headers['Authorization'] = `Bearer ${accessToken}`
        res = await fetch(path, { ...options, headers })
      } else {
        clearTokens()
        sessionExpiredHandler?.()
        throw new Error('Your session has expired. Please log in again.')
      }
    } else {
      sessionExpiredHandler?.()
      throw new Error('Not authenticated — please log in.')
    }
  }

  let json: any
  try {
    json = await res.json()
  } catch {
    throw new Error(`Server returned non-JSON (status ${res.status})`)
  }
  if (!res.ok || !json.success) {
    throw new Error(json.error || `API error: ${res.status}`)
  }
  return json.data as T
}

export async function login(email: string, password: string): Promise<{ user: CrmUser }> {
  const res = await fetch(`${AUTH_API}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'Login failed')
  setTokens(data.data.accessToken, data.data.refreshToken)

  // Also store last email for convenience
  localStorage.setItem('crm_last_email', email)

  return { user: data.data.user }
}

export async function fetchCurrentUser(): Promise<CrmUser | null> {
  if (!accessToken) return null
  try {
    const res = await fetch(`${AUTH_API}/me`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      if (res.status === 401 && refreshToken) {
        const refreshed = await refreshOnce()
        if (refreshed) return fetchCurrentUser()
      }
      clearTokens()
      return null
    }
    const data = await res.json()
    return data.success ? data.data : null
  } catch {
    return null
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${AUTH_API}/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
  } catch { /* ignore */ }
  clearTokens()
}

export async function acceptInvite(token: string, email: string, password: string): Promise<{ user: CrmUser }> {
  const res = await fetch(`${AUTH_API}/accept-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, email, password }),
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'Failed to accept invite')
  setTokens(data.data.accessToken, data.data.refreshToken)
  return { user: data.data.user }
}

export async function forgotPassword(email: string): Promise<void> {
  await fetch(`${AUTH_API}/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
}

export async function resetPassword(token: string, email: string, password: string): Promise<void> {
  const res = await fetch(`${AUTH_API}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, email, password }),
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'Reset failed')
}

/** Change the logged in user's password. Other devices are signed out. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetchWithAuth(`${AUTH_API}/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
  const data = await res.json().catch(() => ({}))
  if (!data.success) throw new Error(data.error || 'Could not change password')
  setTokens(data.data.accessToken, data.data.refreshToken)
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
