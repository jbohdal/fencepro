const BASE = '/api'

let accessToken: string | null = localStorage.getItem('portal_access_token')
let refreshToken: string | null = localStorage.getItem('portal_refresh_token')

export function setTokens(access: string, refresh: string) {
  accessToken = access
  refreshToken = refresh
  localStorage.setItem('portal_access_token', access)
  localStorage.setItem('portal_refresh_token', refresh)
}

export function clearTokens() {
  accessToken = null
  refreshToken = null
  localStorage.removeItem('portal_access_token')
  localStorage.removeItem('portal_refresh_token')
}

export function getAccessToken() { return accessToken }

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
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

export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string> || {}) }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json'

  let res = await fetch(`${BASE}${path}`, { ...options, headers })

  // Auto-refresh on 401
  if (res.status === 401 && refreshToken) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`
      res = await fetch(`${BASE}${path}`, { ...options, headers })
    }
  }

  const json = await res.json()
  if (!res.ok || !json.success) {
    throw new Error(json.error || `API error: ${res.status}`)
  }
  return json.data as T
}

/** Authenticated fetch that returns a Blob — retries once after token refresh on 401 */
export async function apiFetchBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {}
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  let res = await fetch(`${BASE}${path}`, { headers })

  if (res.status === 401 && refreshToken) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`
      res = await fetch(`${BASE}${path}`, { headers })
    }
  }

  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  return res.blob()
}

// Convenience methods
export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => apiFetch<T>(path, { method: 'POST', body: formData }),
}
