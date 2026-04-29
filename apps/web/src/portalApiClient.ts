/**
 * HTTP wrappers for the portal data plane (photos / documents / messages).
 * Used by both the customer-facing portal pages (with portal JWT) and the
 * CRM staff side (with X-API-Key for sync auth).
 */

function apiBase(): string {
  if (typeof window === 'undefined') return ''
  return window.location.hostname === 'localhost' ? 'http://localhost:4000' : ''
}

function portalAuthHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem('fencepro_portal_session')
    if (raw) {
      const s = JSON.parse(raw)
      if (s.accessToken) return { Authorization: `Bearer ${s.accessToken}` }
    }
  } catch {}
  return {}
}

function staffAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  try {
    const token = localStorage.getItem('crm_access_token')
    headers['X-API-Key'] = token || 'dev-sync-key'
    if (token) headers['Authorization'] = `Bearer ${token}`
  } catch {}
  return headers
}

// ── Photos (portal-side, customer-authed) ──────────────────────────

export interface PortalPhotoRow {
  id: string
  customerId: string
  fileKey: string
  fileUrl: string
  name: string
  size: number
  mimeType: string
  caption?: string | null
  source: 'portal_customer' | 'crm_staff' | 'system_generated' | 'companycam'
  uploadedAt: string
}

export async function uploadPortalPhoto(file: File, caption?: string): Promise<{ ok: boolean; data?: PortalPhotoRow; error?: string }> {
  try {
    const fd = new FormData()
    fd.append('file', file)
    if (caption) fd.append('caption', caption)
    const res = await fetch(`${apiBase()}/api/portal/photos`, {
      method: 'POST', headers: portalAuthHeaders(), body: fd,
    })
    const json = await res.json()
    if (!res.ok || !json.success) return { ok: false, error: json?.error || `HTTP ${res.status}` }
    return { ok: true, data: json.data }
  } catch (err: any) { return { ok: false, error: err?.message || 'Network error' } }
}

export async function listPortalPhotos(): Promise<PortalPhotoRow[]> {
  try {
    const res = await fetch(`${apiBase()}/api/portal/photos`, { headers: portalAuthHeaders() })
    const json = await res.json()
    return json.success ? (json.data as PortalPhotoRow[]) : []
  } catch { return [] }
}

export async function deletePortalPhoto(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase()}/api/portal/photos/${id}`, {
      method: 'DELETE', headers: portalAuthHeaders(),
    })
    return res.ok
  } catch { return false }
}

// ── Photos (staff-side, by customer id) ────────────────────────────

export async function listCustomerPhotos(customerId: string): Promise<PortalPhotoRow[]> {
  try {
    const res = await fetch(`${apiBase()}/api/portal/customer/${encodeURIComponent(customerId)}/photos`, {
      headers: staffAuthHeaders(),
    })
    const json = await res.json()
    return json.success ? json.data : []
  } catch { return [] }
}

export async function uploadStaffPhotoForCustomer(customerId: string, file: File, caption?: string, uploadedBy?: string): Promise<{ ok: boolean; data?: PortalPhotoRow; error?: string }> {
  try {
    const fd = new FormData()
    fd.append('file', file)
    if (caption) fd.append('caption', caption)
    if (uploadedBy) fd.append('uploadedBy', uploadedBy)
    const res = await fetch(`${apiBase()}/api/portal/customer/${encodeURIComponent(customerId)}/photos`, {
      method: 'POST', headers: staffAuthHeaders(), body: fd,
    })
    const json = await res.json()
    if (!res.ok || !json.success) return { ok: false, error: json?.error || `HTTP ${res.status}` }
    return { ok: true, data: json.data }
  } catch (err: any) { return { ok: false, error: err?.message || 'Network error' } }
}

// ── Documents ──────────────────────────────────────────────────────

export interface PortalFileRow {
  id: string
  customerId: string
  fileKey: string
  fileUrl: string
  name: string
  size: number
  mimeType: string
  fileKind: 'photo' | 'document' | 'site_plan' | 'contract' | 'permit' | 'warranty' | 'other'
  source: 'portal_customer' | 'crm_staff' | 'system_generated' | 'companycam'
  label?: string | null
  isVisibleToCustomer: boolean
  uploadedAt: string
  uploadedBy: string
}

export async function uploadPortalDocument(file: File, label?: string): Promise<{ ok: boolean; data?: PortalFileRow; error?: string }> {
  try {
    const fd = new FormData()
    fd.append('file', file)
    if (label) fd.append('label', label)
    const res = await fetch(`${apiBase()}/api/portal/documents`, {
      method: 'POST', headers: portalAuthHeaders(), body: fd,
    })
    const json = await res.json()
    if (!res.ok || !json.success) return { ok: false, error: json?.error || `HTTP ${res.status}` }
    return { ok: true, data: json.data }
  } catch (err: any) { return { ok: false, error: err?.message || 'Network error' } }
}

export async function listPortalDocuments(): Promise<PortalFileRow[]> {
  try {
    const res = await fetch(`${apiBase()}/api/portal/documents`, { headers: portalAuthHeaders() })
    const json = await res.json()
    return json.success ? json.data : []
  } catch { return [] }
}

export async function listCustomerDocuments(customerId: string): Promise<PortalFileRow[]> {
  try {
    const res = await fetch(`${apiBase()}/api/portal/customer/${encodeURIComponent(customerId)}/documents`, {
      headers: staffAuthHeaders(),
    })
    const json = await res.json()
    return json.success ? json.data : []
  } catch { return [] }
}

export async function uploadStaffDocumentForCustomer(customerId: string, file: File, label?: string, uploadedBy?: string): Promise<{ ok: boolean; data?: PortalFileRow; error?: string }> {
  try {
    const fd = new FormData()
    fd.append('file', file)
    if (label) fd.append('label', label)
    if (uploadedBy) fd.append('uploadedBy', uploadedBy)
    const res = await fetch(`${apiBase()}/api/portal/customer/${encodeURIComponent(customerId)}/documents`, {
      method: 'POST', headers: staffAuthHeaders(), body: fd,
    })
    const json = await res.json()
    if (!res.ok || !json.success) return { ok: false, error: json?.error || `HTTP ${res.status}` }
    return { ok: true, data: json.data }
  } catch (err: any) { return { ok: false, error: err?.message || 'Network error' } }
}

export async function deletePortalDocument(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase()}/api/portal/documents/${id}`, {
      method: 'DELETE', headers: portalAuthHeaders(),
    })
    return res.ok
  } catch { return false }
}

// Resolve a fileUrl onto an absolute URL the staff/customer browser can fetch
export function resolveFileUrl(fileUrl: string): string {
  if (!fileUrl) return ''
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl
  return `${apiBase()}${fileUrl}`
}

// ── Messages ───────────────────────────────────────────────────────

export interface PortalMessage {
  id: string
  customerId: string
  senderType: 'customer' | 'staff'
  senderUser?: string | null
  body: string
  isReadByStaff: boolean
  isReadByCustomer: boolean
  createdAt: string
}

export interface InboxThread {
  crmCustomerId: string
  lastAt: string
  lastBody: string
  lastSender: 'customer' | 'staff'
  unreadCustomerCount: number
}

export async function sendPortalMessage(body: string): Promise<{ ok: boolean; data?: PortalMessage; error?: string }> {
  try {
    const res = await fetch(`${apiBase()}/api/portal/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...portalAuthHeaders() },
      body: JSON.stringify({ body }),
    })
    const json = await res.json()
    if (!res.ok || !json.success) return { ok: false, error: json?.error || `HTTP ${res.status}` }
    return { ok: true, data: json.data }
  } catch (err: any) { return { ok: false, error: err?.message || 'Network error' } }
}

export async function listPortalMessages(): Promise<{ messages: PortalMessage[]; unreadByCustomer: number }> {
  try {
    const res = await fetch(`${apiBase()}/api/portal/messages`, { headers: portalAuthHeaders() })
    const json = await res.json()
    return json.success ? json.data : { messages: [], unreadByCustomer: 0 }
  } catch { return { messages: [], unreadByCustomer: 0 } }
}

export async function listCustomerMessages(customerId: string): Promise<PortalMessage[]> {
  try {
    const res = await fetch(`${apiBase()}/api/portal/customer/${encodeURIComponent(customerId)}/messages`, {
      headers: staffAuthHeaders(),
    })
    const json = await res.json()
    return json.success ? json.data.messages : []
  } catch { return [] }
}

export async function staffReplyToCustomer(customerId: string, body: string, sender?: string): Promise<{ ok: boolean; data?: PortalMessage; error?: string }> {
  try {
    const res = await fetch(`${apiBase()}/api/portal/customer/${encodeURIComponent(customerId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...staffAuthHeaders() },
      body: JSON.stringify({ body, sender }),
    })
    const json = await res.json()
    if (!res.ok || !json.success) return { ok: false, error: json?.error || `HTTP ${res.status}` }
    return { ok: true, data: json.data }
  } catch (err: any) { return { ok: false, error: err?.message || 'Network error' } }
}

export async function getMessagesInbox(): Promise<{ threads: InboxThread[]; totalUnread: number }> {
  try {
    const res = await fetch(`${apiBase()}/api/portal/messages/inbox`, { headers: staffAuthHeaders() })
    const json = await res.json()
    return json.success ? json.data : { threads: [], totalUnread: 0 }
  } catch { return { threads: [], totalUnread: 0 } }
}
