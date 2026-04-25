/**
 * Customer Portal Accounts — auto-created when a customer has an email.
 *
 * Stores invite tokens + hashed passwords + portal sessions in localStorage.
 * In a future server migration these fields correspond 1:1 to Prisma
 * `PortalUser` + `PortalInvite` tables.
 */

const ACCOUNTS_KEY = 'fencepro_portal_accounts'
const SESSION_KEY = 'fencepro_portal_session'
const EVT = 'fencepro:portal:updated'

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)

// Cheap non-crypto hash for password storage in the browser — NOT suitable
// for real security, but we're running against a localStorage data plane and
// the whole portal is non-authoritative (the real auth system is in the
// portal sub-app). When a server migration lands, this hashing is replaced
// with bcrypt on the portal backend.
function weakHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) { h = ((h << 5) + h) + s.charCodeAt(i); h = h >>> 0 }
  return `wh_${h.toString(16)}_${s.length}`
}

export interface PortalAccount {
  id: string
  customerId: string
  email: string
  firstName: string
  lastName: string
  status: 'invited' | 'active' | 'disabled'
  passwordHash?: string
  mustChangePassword: boolean
  inviteTokenHash?: string
  inviteTokenExpiresAt?: string
  invitedAt?: string
  activatedAt?: string
  lastLoginAt?: string
  createdAt: string
  updatedAt: string
}

export interface PortalInviteLog {
  id: string
  accountId: string
  customerId: string
  email: string
  sentAt: string
  expiresAt: string
}

export function getAccounts(): PortalAccount[] {
  try { const r = localStorage.getItem(ACCOUNTS_KEY); return r ? JSON.parse(r) : [] } catch { return [] }
}
function saveAccounts(list: PortalAccount[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list))
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
}

export function getAccountByCustomerId(customerId: string): PortalAccount | null {
  return getAccounts().find(a => a.customerId === customerId) || null
}
export function getAccountByEmail(email: string): PortalAccount | null {
  const e = (email || '').toLowerCase()
  return getAccounts().find(a => a.email.toLowerCase() === e) || null
}
export function getAccountByTokenHash(tokenHash: string): PortalAccount | null {
  return getAccounts().find(a => a.inviteTokenHash === tokenHash) || null
}

function issueToken(): { raw: string; hash: string } {
  const raw = uid() + uid() + uid()  // ~48 chars
  return { raw, hash: weakHash(raw) }
}

function addInviteLog(account: PortalAccount): void {
  try {
    const key = 'fencepro_portal_invites'
    const raw = localStorage.getItem(key)
    const list: PortalInviteLog[] = raw ? JSON.parse(raw) : []
    list.unshift({
      id: uid(), accountId: account.id, customerId: account.customerId,
      email: account.email,
      sentAt: new Date().toISOString(),
      expiresAt: account.inviteTokenExpiresAt || new Date(Date.now() + 7 * 864e5).toISOString(),
    })
    localStorage.setItem(key, JSON.stringify(list.slice(0, 500)))
  } catch {}
}

/**
 * Ensure a portal account exists for this customer. If one exists, it is
 * returned unchanged. If the customer has no email, returns null. Returns
 * the account and the raw invite token so the caller can produce a link.
 */
export function ensurePortalAccount(customer: { id: string; firstName?: string; lastName?: string; email?: string }): { account: PortalAccount; rawToken?: string; created: boolean } | null {
  const email = (customer.email || '').trim()
  if (!email) return null

  const existing = getAccountByCustomerId(customer.id) || getAccountByEmail(email)
  if (existing) {
    // Link to this customer id if we matched by email only
    if (existing.customerId !== customer.id) {
      const all = getAccounts()
      const idx = all.findIndex(a => a.id === existing.id)
      if (idx >= 0) {
        all[idx] = { ...all[idx], customerId: customer.id, updatedAt: new Date().toISOString() }
        saveAccounts(all)
        return { account: all[idx], created: false }
      }
    }
    return { account: existing, created: false }
  }

  const now = new Date().toISOString()
  const expires = new Date(Date.now() + 7 * 864e5).toISOString()
  const { raw, hash } = issueToken()
  const account: PortalAccount = {
    id: uid(),
    customerId: customer.id,
    email,
    firstName: customer.firstName || '',
    lastName: customer.lastName || '',
    status: 'invited',
    mustChangePassword: true,
    inviteTokenHash: hash,
    inviteTokenExpiresAt: expires,
    invitedAt: now,
    createdAt: now,
    updatedAt: now,
  }
  const all = getAccounts()
  all.unshift(account)
  saveAccounts(all)
  addInviteLog(account)
  return { account, rawToken: raw, created: true }
}

export function resendInvite(customerId: string): { account: PortalAccount; rawToken: string } | null {
  const all = getAccounts()
  const idx = all.findIndex(a => a.customerId === customerId)
  if (idx < 0) return null
  const { raw, hash } = issueToken()
  const now = new Date().toISOString()
  const expires = new Date(Date.now() + 7 * 864e5).toISOString()
  all[idx] = {
    ...all[idx],
    inviteTokenHash: hash,
    inviteTokenExpiresAt: expires,
    invitedAt: now,
    updatedAt: now,
    status: all[idx].status === 'active' ? 'active' : 'invited',
  }
  saveAccounts(all)
  addInviteLog(all[idx])
  return { account: all[idx], rawToken: raw }
}

export function verifyAndActivate(rawToken: string, password: string): { ok: boolean; account?: PortalAccount; error?: string } {
  const hash = weakHash(rawToken)
  const account = getAccountByTokenHash(hash)
  if (!account) return { ok: false, error: 'Invalid activation link.' }
  if (account.inviteTokenExpiresAt && new Date(account.inviteTokenExpiresAt) < new Date()) {
    return { ok: false, error: 'This activation link has expired.' }
  }
  if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' }

  const all = getAccounts()
  const idx = all.findIndex(a => a.id === account.id)
  if (idx < 0) return { ok: false, error: 'Account not found.' }
  const now = new Date().toISOString()
  all[idx] = {
    ...all[idx],
    status: 'active',
    passwordHash: weakHash(password),
    mustChangePassword: false,
    inviteTokenHash: undefined,
    inviteTokenExpiresAt: undefined,
    activatedAt: now,
    lastLoginAt: now,
    updatedAt: now,
  }
  saveAccounts(all)
  setSession(all[idx])
  return { ok: true, account: all[idx] }
}

export function login(email: string, password: string): { ok: boolean; account?: PortalAccount; error?: string } {
  const account = getAccountByEmail(email)
  if (!account) return { ok: false, error: 'Invalid email or password.' }
  if (account.status === 'disabled') return { ok: false, error: 'Account disabled — please contact us.' }
  if (!account.passwordHash) return { ok: false, error: 'Your account is pending activation. Check your email for the invite link.' }
  if (weakHash(password) !== account.passwordHash) return { ok: false, error: 'Invalid email or password.' }
  const all = getAccounts()
  const idx = all.findIndex(a => a.id === account.id)
  if (idx >= 0) {
    all[idx] = { ...all[idx], lastLoginAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    saveAccounts(all)
    setSession(all[idx])
    return { ok: true, account: all[idx] }
  }
  return { ok: false, error: 'Account not found.' }
}

export function logout(): void {
  try { localStorage.removeItem(SESSION_KEY) } catch {}
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
}

function setSession(account: PortalAccount) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ accountId: account.id, at: new Date().toISOString() }))
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
}

export function getCurrentSession(): PortalAccount | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const { accountId } = JSON.parse(raw)
    return getAccounts().find(a => a.id === accountId && a.status === 'active') || null
  } catch { return null }
}

export function setPassword(accountId: string, newPassword: string): boolean {
  if (newPassword.length < 8) return false
  const all = getAccounts()
  const idx = all.findIndex(a => a.id === accountId)
  if (idx < 0) return false
  all[idx] = { ...all[idx], passwordHash: weakHash(newPassword), mustChangePassword: false, updatedAt: new Date().toISOString() }
  saveAccounts(all)
  return true
}

/** For the internal CRM customer profile Portal Access section. */
export interface PortalAccessStatus {
  state: 'none' | 'invited' | 'active'
  account?: PortalAccount
  lastLogin?: string
  invitedAt?: string
}

export function getPortalAccessStatus(customerId: string): PortalAccessStatus {
  const account = getAccountByCustomerId(customerId)
  if (!account) return { state: 'none' }
  if (account.status === 'active') return { state: 'active', account, lastLogin: account.lastLoginAt }
  return { state: 'invited', account, invitedAt: account.invitedAt }
}

/** Build the activation link. */
export function buildActivationLink(rawToken: string): string {
  if (typeof window === 'undefined') return `/#/portal/activate?token=${rawToken}`
  return `${window.location.origin}/#/portal/activate?token=${rawToken}`
}

/** Build the login link. */
export function buildLoginLink(): string {
  if (typeof window === 'undefined') return `/#/portal/login`
  return `${window.location.origin}/#/portal/login`
}

export const PORTAL_UPDATED_EVENT = EVT
