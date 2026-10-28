/**
 * "Send feedback": the words and rules shared by the server (routes/feedback.ts,
 * scripts/feedback-report.ts) and the app (web/src/feedback.ts, FeedbackPage).
 * No imports: plain data and pure functions.
 *
 * Statuses. The stored values `seen` and `done` are kept from the first
 * version (live has rows with them); only their words changed.
 */

export const FEEDBACK_STATUSES = ['new', 'seen', 'done', 'needs_jonathan'] as const
export type FeedbackStatusValue = (typeof FEEDBACK_STATUSES)[number]

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatusValue, string> = {
  new: 'New',
  seen: 'Looked at',
  done: 'Fixed',
  needs_jonathan: 'Needs Jonathan',
}

export const isFeedbackStatus = (s: unknown): s is FeedbackStatusValue =>
  typeof s === 'string' && (FEEDBACK_STATUSES as readonly string[]).includes(s)

/** The kinds of record a screen can be on. */
export type FeedbackRecordType = 'customer' | 'card' | 'quote' | 'job' | 'change_order' | 'service_ticket'

export const FEEDBACK_RECORD_LABEL: Record<FeedbackRecordType, string> = {
  customer: 'Customer',
  card: 'Pipeline card',
  quote: 'Quote',
  job: 'Job',
  change_order: 'Change order',
  service_ticket: 'Service request',
}

export interface FeedbackRecordRef { type: FeedbackRecordType; id: string }

const ID = /^[A-Za-z0-9_.:-]{1,120}$/

/**
 * The record a page address is on: the window open on top first (a change
 * order, a quote, a job, a pipeline card, a service request), then the screen
 * itself (a customer's page). Null when the address names none.
 *
 *   /operations?job=abc&co=def   -> change order def
 *   /quotes?qv=abc               -> quote abc
 *   /customers/abc?tab=photos    -> customer abc
 */
export function recordFromAddress(address: string): FeedbackRecordRef | null {
  let url: URL
  try { url = new URL(address || '/', 'http://x') } catch { return null }
  const p = url.searchParams
  const pick = (key: string): string | null => {
    const v = p.get(key)
    return v && ID.test(v) ? v : null
  }
  const co = pick('co')
  if (co) return { type: 'change_order', id: co }
  const quote = pick('qv') ?? pick('quote')
  if (quote) return { type: 'quote', id: quote }
  const job = pick('job')
  if (job) return { type: 'job', id: job }
  const card = pick('card')
  if (card) return { type: 'card', id: card }
  const ticket = pick('ticket')
  if (ticket) return { type: 'service_ticket', id: ticket }
  const m = url.pathname.match(/^\/customers\/([^/?#]+)/)
  if (m) {
    const id = decodeURIComponent(m[1])
    if (id !== 'new' && ID.test(id)) return { type: 'customer', id }
  }
  return null
}

/** "Quote: Dana Smith" / "Job" when no name is known. */
export function recordText(type: string | null | undefined, name: string | null | undefined): string {
  if (!type) return ''
  const label = FEEDBACK_RECORD_LABEL[type as FeedbackRecordType] ?? type
  return name ? `${label}: ${name}` : label
}

/** "iPhone, Safari" from the browser's description of itself. */
export function deviceText(ua: string): string {
  const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Unknown device'
  const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser'
  return `${dev}, ${br}`
}

export const FEEDBACK_ROLE_LABEL: Record<string, string> = {
  super_admin: 'Owner', admin: 'Admin', manager: 'Manager', sales_rep: 'Salesman', office_staff: 'Office', field_crew: 'Installer',
}

/**
 * A role as people read it ("Installer", never "field crew"): the invite emails and anywhere the server writes a role
 * in words (review Oct 28 2026: an Installer's invite said "as field crew"). A customer login reads "Customer".
 */
export const roleDisplayName = (role: string | null | undefined): string =>
  (role && FEEDBACK_ROLE_LABEL[role]) || (role === 'customer' ? 'Customer' : String(role ?? '').replace(/_/g, ' '))
