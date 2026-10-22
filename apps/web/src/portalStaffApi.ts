/**
 * The office's side of the customer portal: invites, the portal logins list,
 * and each customer's portal photos, documents and messages. Sent with the
 * staff sign in (fetchWithAuth). Lists are kept in memory only.
 *
 * The customer's own side is portalApiClient.ts (cookie sign in, no staff
 * code), so a customer's browser never loads this file.
 */

import { portalPageUrl } from './publicDoor'
import { fetchWithAuth } from './crmAuth'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { plainError, plainThrown } from './plainError'

function apiBase(): string {
  if (typeof window === 'undefined') return ''
  return window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : ''
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/**
 * The id a file upload is saved under: the same file for the same place
 * gives the same id, so a double tap or a resend saves it once.
 */
export function fileRequestId(scope: string, file: File): string {
  const text = `${scope}|${file.name}|${file.size}|${file.lastModified}`
  let a = 0x811c9dc5, b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0
  }
  return `f-${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}${file.size.toString(16)}`
}

// ── Portal logins (invites) ──

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

/**
 * Create or refresh an invite for the given CRM customer. Always returns the
 * activation URL so the UI can copy it; the server emails it only when email
 * is set up (never from the dev copy).
 */
export async function sendPortalInvite(customer: { id: string; email: string; firstName?: string; lastName?: string }): Promise<{ ok: boolean; data?: InviteResult; error?: string }> {
  try {
    const res = await fetchWithAuth(`${apiBase()}/api/portal/invite`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ crmCustomerId: customer.id, email: customer.email, firstName: customer.firstName, lastName: customer.lastName }),
    })
    const json = await res.json()
    if (!res.ok || !json.success) return { ok: false, error: plainError(res.status, json?.error).message }
    accountsLoadedAt = 0
    return { ok: true, data: json.data as InviteResult }
  } catch (err: any) {
    return { ok: false, error: plainThrown(err).message }
  }
}

/** A fresh link to the customer's email (the same public step the sign in page offers). */
export async function resendPortalInvite(email: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  try {
    const res = await fetch(`${apiBase()}/api/portal/resend-invite`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ email }) })
    const json = await res.json()
    if (!res.ok || !json.success) return { ok: false, error: plainError(res.status, json?.error).message }
    accountsLoadedAt = 0
    return { ok: true, status: json.data?.status }
  } catch (err: any) {
    return { ok: false, error: plainThrown(err).message }
  }
}

/** The invite link: the portal's page through the public door (/p/portal/), so the customer can open it from anywhere. */
export function buildActivationLink(rawToken: string): string {
  if (typeof window === 'undefined') return `/p/portal/#/portal/activate?token=${rawToken}`
  return portalPageUrl(`#/portal/activate?token=${rawToken}`)
}

export interface PortalAccessStatus {
  state: 'none' | 'invited' | 'active' | 'suspended'
  account?: PortalAccount
  lastLogin?: string
  invitedAt?: string
  expiresAt?: string
}

// The logins list, in memory (read again after 30 seconds, or after an invite).
const ACCOUNTS_TTL_MS = 30_000
let accounts: PortalAccount[] = []
let accountsLoadedAt = 0
let accountsLoading: Promise<PortalAccount[]> | null = null

async function fetchAccounts(): Promise<PortalAccount[]> {
  if (accountsLoading) return accountsLoading
  if (accountsLoadedAt && Date.now() - accountsLoadedAt < ACCOUNTS_TTL_MS) return accounts
  accountsLoading = (async () => {
    try {
      const res = await fetchWithAuth(`${apiBase()}/api/portal/accounts`)
      const json = await res.json()
      if (res.ok && json.success) { accounts = json.data as PortalAccount[]; accountsLoadedAt = Date.now() }
    } catch { /* keep the last list */ }
    return accounts
  })().finally(() => { accountsLoading = null })
  return accountsLoading
}

/** The customer profile badge: from the list loadAccountsSoon() read ('none' until it has). */
export function getPortalAccessStatus(customerId: string): PortalAccessStatus {
  const a = accounts.find(x => x.crmCustomerId === customerId)
  if (!a) return { state: 'none' }
  if (a.status === 'active') return { state: 'active', account: a, lastLogin: a.lastLoginAt }
  if (a.status === 'suspended') return { state: 'suspended', account: a }
  return { state: 'invited', account: a, invitedAt: a.invitedAt, expiresAt: a.inviteTokenExpiresAt }
}

/** Read the logins list (again after 30 seconds). Safe to call often. */
export function loadAccountsSoon(): Promise<PortalAccount[]> {
  return fetchAccounts()
}

// ── Photos ──

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

export async function listCustomerPhotos(customerId: string): Promise<PortalPhotoRow[]> {
  try {
    const res = await fetchWithAuth(`${apiBase()}/api/portal/customer/${encodeURIComponent(customerId)}/photos`)
    const json = await res.json()
    return json.success ? json.data : []
  } catch { return [] }
}

export async function uploadStaffPhotoForCustomer(customerId: string, file: File, caption?: string, uploadedBy?: string): Promise<{ ok: boolean; data?: PortalPhotoRow; error?: string }> {
  try {
    const fd = new FormData()
    fd.append('clientId', fileRequestId(`photo:${customerId}`, file))
    fd.append('file', file)
    if (caption) fd.append('caption', caption)
    if (uploadedBy) fd.append('uploadedBy', uploadedBy)
    const res = await fetchWithAuth(`${apiBase()}/api/portal/customer/${encodeURIComponent(customerId)}/photos`, { method: 'POST', body: fd })
    const json = await res.json()
    if (!res.ok || !json.success) return { ok: false, error: json?.error || `HTTP ${res.status}` }
    return { ok: true, data: json.data }
  } catch (err: any) { return { ok: false, error: err?.message || 'Network error' } }
}

/** The office removes a photo (Delete permission). */
export async function deletePortalPhoto(id: string): Promise<boolean> {
  try {
    const res = await fetchWithAuth(`${apiBase()}/api/portal/photos/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return res.ok
  } catch { return false }
}

// ── Documents ──

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

export async function listCustomerDocuments(customerId: string): Promise<PortalFileRow[]> {
  try {
    const res = await fetchWithAuth(`${apiBase()}/api/portal/customer/${encodeURIComponent(customerId)}/documents`)
    const json = await res.json()
    return json.success ? json.data : []
  } catch { return [] }
}

export async function uploadStaffDocumentForCustomer(customerId: string, file: File, label?: string, uploadedBy?: string): Promise<{ ok: boolean; data?: PortalFileRow; error?: string }> {
  try {
    const fd = new FormData()
    fd.append('clientId', fileRequestId(`doc:${customerId}`, file))
    fd.append('file', file)
    if (label) fd.append('label', label)
    if (uploadedBy) fd.append('uploadedBy', uploadedBy)
    const res = await fetchWithAuth(`${apiBase()}/api/portal/customer/${encodeURIComponent(customerId)}/documents`, { method: 'POST', body: fd })
    const json = await res.json()
    if (!res.ok || !json.success) return { ok: false, error: json?.error || `HTTP ${res.status}` }
    return { ok: true, data: json.data }
  } catch (err: any) { return { ok: false, error: err?.message || 'Network error' } }
}

/** The office removes a document (Delete permission). */
export async function deletePortalDocument(id: string): Promise<boolean> {
  try {
    const res = await fetchWithAuth(`${apiBase()}/api/portal/documents/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return res.ok
  } catch { return false }
}

/** A file link from the server (already signed) as an address this browser can open. */
export function resolveFileUrl(fileUrl: string): string {
  if (!fileUrl) return ''
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl
  return `${apiBase()}${fileUrl}`
}

// ── Messages ──

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

export async function listCustomerMessages(customerId: string): Promise<PortalMessage[]> {
  try {
    const res = await fetchWithAuth(`${apiBase()}/api/portal/customer/${encodeURIComponent(customerId)}/messages`)
    const json = await res.json()
    return json.success ? json.data.messages : []
  } catch { return [] }
}

/** `requestId`: one per message typed (kept until it is sent), so sending it twice saves it once. */
export async function staffReplyToCustomer(customerId: string, body: string, sender?: string, requestId?: string): Promise<{ ok: boolean; data?: PortalMessage; error?: string }> {
  try {
    const res = await fetchWithAuth(`${apiBase()}/api/portal/customer/${encodeURIComponent(customerId)}/messages`, {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ body, sender, clientId: requestId }),
    })
    const json = await res.json()
    if (!res.ok || !json.success) return { ok: false, error: json?.error || `HTTP ${res.status}` }
    return { ok: true, data: json.data }
  } catch (err: any) { return { ok: false, error: err?.message || 'Network error' } }
}

export async function getMessagesInbox(): Promise<{ threads: InboxThread[]; totalUnread: number }> {
  try {
    const res = await fetchWithAuth(`${apiBase()}/api/portal/messages/inbox`)
    const json = await res.json()
    return json.success ? json.data : { threads: [], totalUnread: 0 }
  } catch { return { threads: [], totalUnread: 0 } }
}
