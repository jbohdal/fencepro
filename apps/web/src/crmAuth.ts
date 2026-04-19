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

async function tryRefresh(): Promise<boolean> {
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

/** Authenticated fetch — auto-refreshes on 401 */
export async function authFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string> || {}) }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json'

  let res = await fetch(path, { ...options, headers })

  if (res.status === 401 && refreshToken) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`
      res = await fetch(path, { ...options, headers })
    }
  }

  const json = await res.json()
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
        const refreshed = await tryRefresh()
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
