/**
 * Payments and receipts on the phone (server: apps/portal/src/server/lib/contractBilling.ts).
 *
 * The schedules come from the server (/api/payments) and are kept in memory
 * only. A payment is saved through the outbox (outbox.ts), like every other
 * change: it is on the phone the moment Save is tapped and goes to the
 * server as soon as there is signal, once (its id is the phone's; a resend
 * is the same payment).
 *
 * The receipt shows on screen right away, with no signal too: worked out on
 * the phone from the schedule on screen (predictReceipt, the same rules as
 * the server's lib/paymentMath.ts) and replaced by the server's own once the
 * payment is saved. With signal, the server gives it the next company number
 * (shown a moment later). With no signal, it takes one of the few numbers the
 * server keeps set aside for this login (topUpReceiptNumbers, memory only):
 * the same unused ones come back on every sign in, so the sequence has few
 * gaps, and a receipt made with no signal still has its real number. If the
 * app was opened with no signal and has none, the receipt says its number
 * comes with signal. Its link (/p/r/<token>) is made on the phone
 * too, so it can go in a text right away; it opens once the payment is saved.
 *
 * Emailing the receipt is an outbox change of its own that waits for its
 * payment (sent once, as soon as there is signal).
 */

import { registerKind, enqueue, reapply, allOps, hasPending, hasSignal, subscribe as onOutbox } from './outbox'
import { sendJson, API_ORIGIN } from './syncHttp'
import { fetchWithAuth } from './crmAuth'
import { newId } from './recordSync'
import { can } from './permissions'
import { getConfig } from './configStore'
import { refreshJobs } from './jobStore'

// ── What the server sends ───────────────────────────────────────────────────

export type Method = 'check' | 'cash' | 'zelle' | 'card' | 'other'
export const METHODS: Array<{ id: Method; label: string }> = [
  { id: 'check', label: 'Check' }, { id: 'cash', label: 'Cash' }, { id: 'zelle', label: 'Zelle' }, { id: 'card', label: 'Card' }, { id: 'other', label: 'Other' },
]

export interface ReceiptSnapshot {
  number: number | null
  paidOn: string
  company: { name: string; phone: string; email: string }
  customerName: string
  address: string
  phone: string
  email: string
  fenceStyle: string
  amountCents: number
  method: string
  methodText: string
  forItems: Array<{ label: string; cents: number }>
  forText: string
  signedCents: number
  changeOrderCents: number
  adjustmentCents: number
  contractCents: number
  paidToDateCents: number
  balanceCents: number
  paidInFull: boolean
  warrantyName: string | null
  lienRelease: boolean
  recordedBy: string
}

export interface ReceiptRow {
  id: string; number: number; token: string; voided: boolean; says: ReceiptSnapshot; lienRelease: boolean
  emailTo: string | null; emailStatus: string | null; emailedAt: string | null; textedTo: string | null; textedAt: string | null; filed: boolean
}
export interface InvoiceRow { id: string; key: string; kind: 'deposit' | 'progress' | 'final' | 'other'; label: string; amountCents: number; originalCents: number; contractCents: number; paidCents: number; balanceCents: number; dueOn: string; dueDate: string | null; legacyNumber: string | null }
export interface PaymentRow {
  id: string; amountCents: number; method: Method; checkNumber: string | null; reference: string | null; methodText: string; paidOn: string; note: string
  recordedBy: string; needsConfirm: boolean; confirmedAt: string | null; confirmedBy: string | null; voidedAt: string | null; voidedBy: string | null; voidReason: string | null
  hasPhoto: boolean; source: string; receipt: ReceiptRow | null
}
export interface Schedule {
  jobId: string; quoteId: string | null; customerId: string | null; customerName: string; address: string; phone: string; email: string; fenceStyle: string
  completedDate: string | null; depositPct: number; source: string; warrantyName: string | null
  signedCents: number; changeOrderCents: number; adjustmentCents: number; contractCents: number; paidCents: number; balanceCents: number; creditCents: number
  invoices: InvoiceRow[]; payments: PaymentRow[]
  adjustments: Array<{ id: string; amountCents: number; reason: string; byName: string; at: string }>
  log: Array<{ id: string; kind: string; text: string; byName: string; at: string }>
}
export interface WithoutSchedule { jobId: string; fenceStyle: string; address: string; contractCents: number }

// ── Money ────────────────────────────────────────────────────────────────────

export function money(cents: number): string {
  const neg = cents < 0
  const abs = Math.abs(Math.round(cents))
  return (neg ? '-' : '') + '$' + Math.floor(abs / 100).toLocaleString('en-US') + '.' + String(abs % 100).padStart(2, '0')
}
/** "4,457.00" or "4457" typed: cents, or null. */
export function centsOf(typed: string): number | null {
  const t = typed.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null
  const [d, c = ''] = t.split('.')
  return Number(d) * 100 + Number((c + '00').slice(0, 2))
}
const LABEL: Record<string, string> = { check: 'Check', cash: 'Cash', zelle: 'Zelle', card: 'Card', other: 'Other' }
export function methodText(method: string, checkNumber?: string | null, reference?: string | null): string {
  const base = LABEL[method] ?? 'Other'
  if (method === 'check' && checkNumber) return `Check #${checkNumber}${reference ? ` (${reference})` : ''}`
  return reference ? `${base} (${reference})` : base
}

/** YYYY-MM-DD today in Ocala. */
export function todayOcala(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

// ── Schedules ────────────────────────────────────────────────────────────────

const schedules = new Map<string, Schedule>()
const listeners = new Set<() => void>()
let version = 0
function emit() { version++; listeners.forEach(f => { try { f() } catch { /* a screen going away */ } }) }
export function subscribe(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f) } }
export function paymentsVersion() { return version }
export function scheduleOf(jobId: string): Schedule | null { return schedules.get(jobId) ?? null }

/** One job's schedule from the server. Null: none yet (with whether one can be made). Undefined: no signal (the copy on screen stays). */
export async function loadJob(jobId: string): Promise<{ schedule: Schedule | null; canMake: boolean } | undefined> {
  const r = await fetchWithAuth(`${API_ORIGIN}/api/payments/job/${encodeURIComponent(jobId)}`).catch(() => null)
  if (!r?.ok) return undefined
  const d = (await r.json().catch(() => null))?.data
  if (!d) return undefined
  if (d.schedule) schedules.set(jobId, d.schedule); else schedules.delete(jobId)
  emit()
  return d
}

/** A customer's schedules, and their signed jobs with none yet. */
export async function loadCustomer(customerId: string): Promise<{ schedules: Schedule[]; without: WithoutSchedule[] } | undefined> {
  const r = await fetchWithAuth(`${API_ORIGIN}/api/payments/customer/${encodeURIComponent(customerId)}`).catch(() => null)
  if (!r?.ok) return undefined
  const d = (await r.json().catch(() => null))?.data
  if (!d) return undefined
  for (const s of d.schedules as Schedule[]) schedules.set(s.jobId, s)
  emit()
  return d
}

function take(s: Schedule | null | undefined) { if (s) { schedules.set(s.jobId, s); emit() } }

export async function makeSchedule(jobId: string): Promise<{ ok: boolean; error?: string }> {
  const r = await sendJson('POST', `/api/payments/job/${encodeURIComponent(jobId)}/schedule`, {})
  if (!r.result.ok) return { ok: false, error: r.json?.error || 'Check the signal and try again.' }
  take(r.json.data)
  return { ok: true }
}

// ── Receipt numbers set aside for this phone ────────────────────────────────

let numbers: number[] = []
let topping: Promise<void> | null = null

/** The login's receipt numbers for no signal, from the server (its unused ones come back unchanged; memory only). */
export function topUpReceiptNumbers(): Promise<void> {
  if (!can('payments.record')) return Promise.resolve()
  return topping ??= (async () => {
    try {
      const r = await sendJson('POST', '/api/payments/receipt-numbers', { count: 5 })
      // Numbers on payments still waiting on this phone are taken already.
      if (r.result.ok && Array.isArray(r.json?.data?.numbers)) numbers = (r.json.data.numbers as number[]).filter(n => !usedNumbers().has(n))
    } finally { topping = null }
  })()
}
const usedNumbers = () => new Set(allOps().filter(o => o.kind === 'payment.create').map(o => (o.payload as PaymentOp).receiptNumber).filter((n): n is number => typeof n === 'number'))
export const receiptNumbersOnHand = () => numbers.length

// ── Links ────────────────────────────────────────────────────────────────────

/** The receipt's customer link (/p/r/<token>): the public door on a Tailscale address, the app's own address otherwise (as proposals). */
export function receiptUrl(token: string): string {
  const { protocol, hostname, origin } = window.location
  return hostname.endsWith('.ts.net') ? `${protocol}//${hostname}:8443/p/r/${token}` : `${origin}/p/r/${token}`
}
function newToken(): string {
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ── Recording a payment (outbox) ────────────────────────────────────────────

export interface PaymentInput {
  jobId: string
  amountCents: number
  method: Method
  checkNumber?: string
  reference?: string
  paidOn: string
  note?: string
  photo?: string | null
  lienRelease?: boolean
}

interface PaymentOp extends PaymentInput {
  id: string
  receiptNumber: number | null
  receiptToken: string
  /** The receipt as shown on the phone before the server has it. */
  shown: ReceiptSnapshot
}

/** What the screen shows for one payment's receipt. */
export interface ShownReceipt {
  paymentId: string
  jobId: string
  token: string
  link: string
  snapshot: ReceiptSnapshot
  /** The server's receipt, once the payment is saved. */
  receipt: ReceiptRow | null
  saved: boolean
}

const shown = new Map<string, ShownReceipt>()
export function shownReceipt(paymentId: string): ShownReceipt | null { return shown.get(paymentId) ?? null }

/**
 * The receipt worked out on the phone (no signal): the payment to the oldest
 * open invoice first, the rest carried; paid to date and the balance from the
 * schedule on screen and this phone's payments still waiting. The same rules
 * as the server's (lib/paymentMath.ts).
 */
export function predictReceipt(s: Schedule, p: PaymentInput, number: number | null, recordedBy: string): ReceiptSnapshot {
  const waiting = allOps().filter(o => o.kind === 'payment.create' && (o.payload as PaymentOp).jobId === s.jobId && !s.payments.some(x => x.id === (o.payload as PaymentOp).id))
    .reduce((t, o) => t + (o.payload as PaymentOp).amountCents, 0)
  let left = p.amountCents
  let carried = waiting
  const forItems: Array<{ label: string; cents: number }> = []
  for (const inv of s.invoices) {
    let open = Math.max(0, inv.balanceCents)
    const fromWaiting = Math.min(open, carried); open -= fromWaiting; carried -= fromWaiting
    if (left <= 0 || open <= 0) continue
    const take = Math.min(open, left)
    left -= take
    forItems.push({ label: inv.kind === 'final' ? (s.changeOrderCents ? 'Final payment (with change orders)' : 'Final payment') : inv.kind === 'deposit' ? 'Deposit' : inv.label, cents: take })
  }
  if (left > 0) forItems.push({ label: 'Credit (over the balance)', cents: left })
  const paidToDate = s.paidCents + waiting + p.amountCents
  const balance = s.contractCents - paidToDate
  const paidInFull = balance <= 0 && s.invoices.some(i => i.kind === 'final')
  const co = getConfig().company
  return {
    number, paidOn: p.paidOn, company: { name: co?.name || 'Getter Done Fence', phone: co?.phone || '', email: co?.email || '' },
    customerName: s.customerName, address: s.address, phone: s.phone, email: s.email, fenceStyle: s.fenceStyle,
    amountCents: p.amountCents, method: p.method, methodText: methodText(p.method, p.checkNumber, p.reference),
    forItems, forText: forItems.map(i => i.label).join(' and ') || 'Payment',
    signedCents: s.signedCents, changeOrderCents: s.changeOrderCents, adjustmentCents: s.adjustmentCents, contractCents: s.contractCents,
    paidToDateCents: paidToDate, balanceCents: balance, paidInFull, warrantyName: paidInFull ? s.warrantyName : null,
    lienRelease: !!p.lienRelease && paidInFull, recordedBy,
  }
}

/** Save a payment: on the phone now, on the server when there is signal. Returns its receipt for the screen. */
export async function recordPayment(p: PaymentInput, recordedBy: string): Promise<ShownReceipt> {
  const s = schedules.get(p.jobId)
  if (!s) throw new Error('This job has no payment schedule on screen. Reload with signal and try again.')
  const id = newId().replace(/[^A-Za-z0-9_-]/g, '')
  // With signal the server gives the next company number; a set aside one only with no signal.
  const number = hasSignal() ? null : numbers.shift() ?? null
  const token = newToken()
  const snapshot = predictReceipt(s, p, number, recordedBy)
  const op: PaymentOp = { ...p, id, receiptNumber: number, receiptToken: token, shown: snapshot }
  const r: ShownReceipt = { paymentId: id, jobId: p.jobId, token, link: receiptUrl(token), snapshot, receipt: null, saved: false }
  shown.set(id, r)
  await enqueue({ key: `payment:${id}`, kind: 'payment.create', payload: op, label: `${s.customerName}, payment ${money(p.amountCents)}` })
  emit()
  void topUpReceiptNumbers()
  return r
}

registerKind<PaymentOp>('payment.create', {
  what: () => 'This payment',
  send: op => {
    const { shown: _shown, ...body } = op.payload
    return sendJson('POST', '/api/payments', body, 60_000).then(r => r.result)
  },
  apply: op => {
    if (shown.has(op.payload.id)) return
    shown.set(op.payload.id, { paymentId: op.payload.id, jobId: op.payload.jobId, token: op.payload.receiptToken, link: receiptUrl(op.payload.receiptToken), snapshot: op.payload.shown, receipt: null, saved: false })
    emit()
  },
  confirmed: (op, data: any) => {
    const receipt: ReceiptRow | null = data?.receipt ?? null
    const was = shown.get(op.payload.id)
    if (receipt) shown.set(op.payload.id, { paymentId: op.payload.id, jobId: op.payload.jobId, token: receipt.token, link: receiptUrl(receipt.token), snapshot: receipt.says, receipt, saved: true })
    else if (was) shown.set(op.payload.id, { ...was, saved: true })
    take(data?.schedule)
    emit()
    // A payment can close the job out on the server (paid in full: Complete, then Paid): an open job window reads it again.
    void refreshJobs()
  },
})

/** Waiting payments of a job (on this phone, not on the server yet). */
export function waitingPayments(jobId: string): ShownReceipt[] {
  return allOps().filter(o => o.kind === 'payment.create' && (o.payload as PaymentOp).jobId === jobId).map(o => shown.get((o.payload as PaymentOp).id)).filter((x): x is ShownReceipt => !!x)
}
export const paymentWaiting = (paymentId: string) => hasPending(`payment:${paymentId}`)

// ── Sending the receipt ─────────────────────────────────────────────────────

interface EmailOp { paymentId: string; to: string; link: string }

export interface EmailResult { to: string; status: 'sent' | 'failed' | 'not_configured' | 'waiting'; error?: string }
const emailed = new Map<string, EmailResult>()
export const emailResultOf = (paymentId: string) => emailed.get(paymentId) ?? null

/** Email the receipt link: now, or as soon as the payment is saved and there is signal. Sent once. */
export async function emailReceipt(paymentId: string, to: string, link: string): Promise<void> {
  emailed.set(paymentId, { to, status: 'waiting' })
  emit()
  await enqueue({ key: `paymentEmail:${paymentId}:${to}`, kind: 'payment.email', payload: { paymentId, to, link }, label: `Receipt email to ${to}`, after: [`payment:${paymentId}`] })
}


registerKind<EmailOp>('payment.email', {
  what: () => 'This receipt email',
  send: op => sendJson('POST', `/api/payments/${encodeURIComponent(op.payload.paymentId)}/email`, { to: op.payload.to, link: op.payload.link, once: true }).then(r => r.result),
  apply: op => { emailed.set(op.payload.paymentId, { to: op.payload.to, status: 'waiting' }); emit() },
  confirmed: (op, data: any) => {
    emailed.set(op.payload.paymentId, { to: op.payload.to, status: data?.status ?? 'sent', error: data?.error })
    const jobId = shown.get(op.payload.paymentId)?.jobId
    if (jobId) void loadJob(jobId)
    emit()
  },
})

/** The text went to the phone's own texting app: kept on the receipt once it is on the server (nothing is sent by the server). */
export function noteTexted(paymentId: string, to: string): void {
  if (paymentWaiting(paymentId)) return
  void sendJson('POST', `/api/payments/${encodeURIComponent(paymentId)}/texted`, { to })
}

// ── Owner and office ────────────────────────────────────────────────────────

async function act(method: string, path: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const r = await sendJson(method, path, body)
  if (!r.result.ok) return { ok: false, error: r.json?.error || 'Check the signal and try again.' }
  take(r.json?.data?.schedule ?? (r.json?.data?.invoices ? r.json.data : null))
  // A void or an adjustment can change whether the job is paid in full (and close it out): read the jobs again.
  void refreshJobs()
  return { ok: true }
}
export const confirmPayment = (id: string) => act('POST', `/api/payments/${encodeURIComponent(id)}/confirm`, {})
export const voidPayment = (id: string, reason: string) => act('POST', `/api/payments/${encodeURIComponent(id)}/void`, { reason })
export const editInvoiceAmount = (id: string, amountCents: number, reason: string) => act('PATCH', `/api/payments/invoices/${encodeURIComponent(id)}`, { amountCents, reason })
export const adjustContract = (jobId: string, amountCents: number, reason: string) => act('POST', `/api/payments/job/${encodeURIComponent(jobId)}/adjustments`, { amountCents, reason })

export interface ToConfirm { id: string; jobId: string; customerId: string | null; customerName: string; address: string; amountCents: number; method: string; checkNumber: string | null; reference: string | null; paidOn: string; recordedBy: string; hasPhoto: boolean; receipt: ReceiptRow | null }
export async function loadToConfirm(): Promise<ToConfirm[] | null> {
  const r = await fetchWithAuth(`${API_ORIGIN}/api/payments/to-confirm`).catch(() => null)
  if (!r?.ok) return null
  return (await r.json().catch(() => null))?.data ?? null
}

/** Open a staff-only file (the receipt PDF, a check photo) in a new tab. */
export async function openStaffFile(path: string): Promise<boolean> {
  const tab = window.open('', '_blank')
  const r = await fetchWithAuth(`${API_ORIGIN}${path}`).catch(() => null)
  if (!r?.ok) { tab?.close(); return false }
  const u = URL.createObjectURL(await r.blob())
  if (tab) tab.location.href = u; else window.location.href = u
  return true
}

let me = ''
/** Who is signed in, for "Received by" on a receipt made on this phone. */
export const recorderName = () => me

/** At sign in: this phone's payments still waiting go back on screen, and receipt numbers are set aside. */
export function startPayments(name: string): void {
  me = name
  reapply('payment.')
  void topUpReceiptNumbers()
  if (typeof window !== 'undefined') window.addEventListener('online', () => { void topUpReceiptNumbers() })
}
onOutbox(() => emit())
