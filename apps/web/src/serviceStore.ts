/**
 * Warranty and service requests on the screens: the server's answers
 * (apps/portal/src/server/routes/serviceTickets.ts), held in memory only while
 * the app is open (never in the browser's storage), and the events that open
 * the request form and a ticket from anywhere.
 *
 *   past customer badges   one ask for the whole company, again after 30 s
 *   open tickets           the company's open requests (Today, Follow ups,
 *                          the schedule), loaded again whenever one changes
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { sendJson } from './syncHttp'
import { badgeText, type PastCustomerBadge, type Issue, type Stage, type Hint } from '../../portal/src/server/lib/serviceTicketModel'

export type { PastCustomerBadge, Issue, Stage, Hint }

export interface ServerMediaItem { id: string; kind: 'photo' | 'video'; url: string; thumbUrl: string | null; previewUrl: string | null; markupUrl: string | null; caption: string; takenBy: string | null; takenAt: string; source: string; visibility: string; status: string }
export interface HistoryEntry { at: string; by: string; kind: string; text: string }
export interface CostView {
  fixedOn: string; crew: Array<{ name: string; hours: number }>; hours: number; hourlyCostCents: number; hourlySource: string; laborCents: number
  materials: Array<{ inventoryItemId: string | null; part: string; qty: number; unitCents: number; totalCents: number; source: string }>; materialCents: number; totalCents: number; enteredBy: string
}

export interface Ticket {
  id: string; version: number; jobId: string; customerId: string | null; quoteId: string | null
  customerName: string; firstName: string; phone: string; address: string; fenceStyle: string; installer: string
  issue: Issue; issueLabel: string; notes: string; stage: Stage; stageLabel: string; open: boolean
  warranty: { id: string | null; name: string; text: string; term: string; years: number | null; installDate: string | null; end: string | null }
  hint: Hint; hintLabel: string; hintWhy: string
  decision: 'covered' | 'not_covered' | null; decisionReason: string; decisionBy: string | null; decisionAt: string | null; decisionShared: boolean
  appointment: { id: string; startAt: string | null; endAt: string | null; status: string; assignedTo: string } | null
  appointmentId: string | null
  repairQuote: { id: string; status: string; finalPrice: number; date: string } | null
  link: { path: string; expiresAt: string | null; open: boolean } | null
  photosRequestedAt: string | null; photosReceivedAt: string | null; scheduledAt: string | null; fixedAt: string | null; closedAt: string | null
  photos?: ServerMediaItem[]; photoCount?: number
  cost: CostView | null
  textConsent: { state: 'yes' | 'no' | 'unknown'; words: string }
  history: HistoryEntry[]
  createdBy: string; createdAt: string; updatedAt: string
}

export interface JobContext {
  jobId: string; customerId: string | null; customerName: string; firstName: string; phone: string; address: string; fenceStyle: string; completed: boolean
  warranty: { id: string | null; name: string; text: string; term: string; years: number | null } | null
  installDate: string | null; end: string | null; endText: string; kind: string
  hints: Record<Issue, { hint: Hint; label: string; why: string }>
  textConsent: { state: 'yes' | 'no' | 'unknown'; words: string }
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number }

async function call<T>(method: string, path: string, body?: unknown): Promise<Result<T>> {
  const r = await sendJson(method, `/api/service-tickets${path}`, body)
  if (r.result.ok) return { ok: true, data: r.result.data as T }
  return { ok: false, status: r.status, error: r.result.error || (r.status === 0 ? 'No connection. Check the signal and try again.' : 'Not saved. Try again.') }
}

// ── Changes: every screen showing tickets loads them again ──

export const TICKETS_CHANGED = 'ezbiz:service-tickets'
function changed() { window.dispatchEvent(new Event(TICKETS_CHANGED)); void loadOpen(true) }

/** A ticket change came back from the server: tell the screens. */
async function saved(r: Result<Ticket>): Promise<Result<Ticket>> { if (r.ok) changed(); return r }

export const getContext = (jobId: string) => call<JobContext>('GET', `/context?jobId=${encodeURIComponent(jobId)}`)
export const getTicket = (id: string) => call<Ticket>('GET', `/${encodeURIComponent(id)}`)
export const listTickets = (q: { customerId?: string; jobId?: string; all?: boolean }) => {
  const p = new URLSearchParams()
  if (q.customerId) p.set('customerId', q.customerId)
  if (q.jobId) p.set('jobId', q.jobId)
  if (q.all) p.set('all', '1')
  return call<Ticket[]>('GET', `/?${p}`)
}
export const createTicket = (b: { id: string; jobId: string; issue: Issue; notes: string }) => call<Ticket>('POST', '', b).then(saved)
export const askForPhotos = (id: string) => call<Ticket>('POST', `/${encodeURIComponent(id)}/photo-link`).then(saved)
export const setStage = (id: string, stage: Stage, note = '') => call<Ticket>('POST', `/${encodeURIComponent(id)}/stage`, { stage, note }).then(saved)
export const decide = (id: string, b: { decision: 'covered' | 'not_covered' | null; reason: string; shared: boolean }) => call<Ticket>('POST', `/${encodeURIComponent(id)}/decision`, b).then(saved)
export const linkAppointment = (id: string, appointmentId: string) => call<Ticket>('POST', `/${encodeURIComponent(id)}/appointment`, { appointmentId }).then(saved)
export const markFixed = (id: string, b: { fixedOn: string; crew?: Array<{ name: string; hours: number }>; materials?: Array<{ inventoryItemId?: string | null; part: string; qty: number; unitCents?: number | null }> }) =>
  call<Ticket>('POST', `/${encodeURIComponent(id)}/fixed`, b).then(saved)
export const removeTicket = (id: string) => call<unknown>('DELETE', `/${encodeURIComponent(id)}`).then(r => { if (r.ok) changed(); return r })

export interface ServiceReportData {
  from: string; to: string
  totals: { tickets: number; covered: number; notCovered: number; undecided: number; open: number; coveredCostCents: number; costed: number }
  byMonth: Array<{ month: string; tickets: number; covered: number; notCovered: number; undecided: number; coveredCostCents: number }>
  byStyle: Array<{ key: string; tickets: number; costed: number; costCents: number; laborCents: number; materialCents: number; averageCents: number }>
  byInstaller: Array<{ key: string; tickets: number; costed: number; costCents: number; laborCents: number; materialCents: number; averageCents: number }>
}
export const loadServiceReport = (from: string, to: string) => call<ServiceReportData>('GET', `/report?from=${from}&to=${to}`)

// ── Past customer badges ──

let badges: Map<string, PastCustomerBadge> | null = null
let badgesAt = 0
let badgesLoading: Promise<void> | null = null
let badgeTries = 0
const badgeListeners = new Set<() => void>()
let badgeVersion = 0

/** Ask the server for every past customer's badge (at most every 30 s unless `force`). */
export function loadBadges(force = false): Promise<void> {
  if (!force && badges && Date.now() - badgesAt < 30_000) return Promise.resolve()
  if (badgesLoading) return badgesLoading
  badgesLoading = call<PastCustomerBadge[]>('GET', '/badges').then(r => {
    if (r.ok) { badges = new Map(r.data.map(b => [b.customerId, b])); badgesAt = Date.now(); badgeVersion++; badgeListeners.forEach(f => f()); badgeTries = 0 }
    // No signal or the server busy: try again shortly (a few times), so the badges still arrive.
    else if (badgeTries++ < 4) setTimeout(() => { void loadBadges(true) }, 4000)
  }).finally(() => { badgesLoading = null })
  return badgesLoading
}

/** The badge as loaded (null: not a past customer, or not loaded yet). */
export const badgeFor = (customerId: string | null | undefined): PastCustomerBadge | null => (customerId && badges?.get(customerId)) || null
export const badgeWords = (b: PastCustomerBadge) => badgeText(b)

/** Re-render when the badges arrive; loads them when first used. */
export function useBadges(): number {
  useEffect(() => { void loadBadges() }, [])
  return useSyncExternalStore(f => { badgeListeners.add(f); return () => { badgeListeners.delete(f) } }, () => badgeVersion, () => badgeVersion)
}

// ── The company's open tickets (Today, Follow ups, the schedule) ──

let open: Ticket[] | null = null
let openAt = 0
let openLoading: Promise<void> | null = null
const openListeners = new Set<() => void>()
let openVersion = 0

export function loadOpen(force = false): Promise<void> {
  if (!force && open && Date.now() - openAt < 30_000) return Promise.resolve()
  if (openLoading && !force) return openLoading
  const p = listTickets({}).then(r => {
    if (r.ok) { open = r.data; openAt = Date.now(); openVersion++; openListeners.forEach(f => f()) }
  }).finally(() => { if (openLoading === p) openLoading = null })
  openLoading = p
  return p
}

/** The open tickets (null until loaded). */
export function useOpenTickets(): Ticket[] | null {
  useEffect(() => { void loadOpen() }, [])
  useSyncExternalStore(f => { openListeners.add(f); return () => { openListeners.delete(f) } }, () => openVersion, () => openVersion)
  return open
}

/** A list of tickets that loads again when any ticket changes. */
export function useTickets(q: { customerId?: string; jobId?: string; all?: boolean }): { list: Ticket[] | null; error: string; reload: () => void } {
  const [list, setList] = useState<Ticket[] | null>(null)
  const [error, setError] = useState('')
  const [n, setN] = useState(0)
  const key = JSON.stringify(q)
  useEffect(() => {
    let live = true
    listTickets(q).then(r => { if (!live) return; if (r.ok) { setList(r.data); setError('') } else setError(r.error) })
    return () => { live = false }
  }, [key, n])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = () => setN(x => x + 1)
    window.addEventListener(TICKETS_CHANGED, h)
    return () => window.removeEventListener(TICKETS_CHANGED, h)
  }, [])
  return { list, error, reload: () => setN(x => x + 1) }
}

// ── Opening the form and a ticket from anywhere ──

export const OPEN_REQUEST_EVENT = 'ezbiz:service-request'
export const OPEN_TICKET_EVENT = 'ezbiz:service-ticket'
/** The request form, for a customer (their jobs to pick from) or a job. */
export function openServiceRequest(req: { customerId?: string; jobId?: string }) { window.dispatchEvent(new CustomEvent(OPEN_REQUEST_EVENT, { detail: req })) }
export function openTicket(id: string) { window.dispatchEvent(new CustomEvent(OPEN_TICKET_EVENT, { detail: { id } })) }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Oct 20, 2026" from YYYY-MM-DD or an ISO time (Ocala). */
export function dayWords(v: string | null | undefined): string {
  if (!v) return ''
  const d = v.length === 10 ? v : new Date(v).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const [y, m, dd] = d.split('-').map(Number)
  return `${MONTHS[m - 1]} ${dd}, ${y}`
}
export const usd = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
