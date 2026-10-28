/**
 * Change orders on signed quotes (server: /api/change-orders, lib/changeOrders.ts).
 *
 * A signed quote is locked (its price stays as signed); added or removed
 * fence, gates or a style change go on a change order: lines with a
 * description and an amount (cents; a credit is negative), a status
 * (draft, sent, approved, void) and a version. Approved ones are added to the
 * job's contract value by the server. A Salesman makes and sends them; the
 * owner and office approve (prices only: a change order holds no cost).
 *
 * Oct 22 2026 (Jonathan): easy to find ("Change order" on the job page, the
 * pipeline card window and the customer page: from the yard drawing, or typed
 * lines), signed by the customer on this phone in person, in the portal or on
 * their link, or "approved verbally" by the owner or office with a reason
 * (the customer's copy stays unsigned until they sign). Once approved,
 * everything follows on the server: contract revision, payment schedule,
 * pull sheet revision, install packet, job costing, crew days, warranty,
 * history. A change from the yard drawing sends the new work; the server
 * prices it and keeps it (lib/changeOrderWork.ts).
 */
import { customerText } from '../../portal/src/server/lib/customerText'
import { svgDataUrl } from '../../portal/src/server/lib/planSvg'
import { phoneWords } from '../../portal/src/server/lib/installDays'
import { useEffect, useRef, useState } from 'react'
import { useBackLayer, useNav } from './nav'
import { can } from './permissions'
import { sendJson } from './syncHttp'
import { newId } from './recordSync'
import { toast } from './toast'
import { refreshJobs } from './jobStore'
import { getQuotes } from './quoteStore'
import { smsLink } from './appointmentLogic'
import { getConfig } from './configStore'
import { wholeDollarCents } from './pricingEngine'
import { SignaturePad } from './SignaturePad'
import { LIVE_REFRESH_EVENT } from './liveRefresh'
import type { SavedQuote } from './QuotesPage'

/* ───────── types ───────── */

export interface ChangeOrderLine {
  id: string
  description: string
  /** Positive adds to the contract, negative is a credit. */
  amountCents: number
  /** Picked from the pick list: how many. */
  qty?: number
  /** Picked from the pick list: where it came from (kept for history). */
  source?: ChangeOrderLineSource | null
}

/** "repair:<key>[:walk|double]" (the Repair price list) or "catalog:<Inventory item id>", the style it was priced for and the price the list gave. */
export interface ChangeOrderLineSource { kind: 'repair' | 'catalog'; ref: string; label: string; fenceStyle?: string; listCents?: number }

/** needs_ok: a Salesman's, waiting for the owner's or the office's OK before it goes to the customer. */
export type ChangeOrderStatus = 'needs_ok' | 'draft' | 'sent' | 'approved' | 'void'

/** What the change does to the work (differences), from the quote builder. */
export interface ChangeOrderScope {
  footageFt?: number
  walkGates?: number
  dblGates?: number
  sections?: number
  fromStyle?: string
  toStyle?: string
}

/** The work after the change (quantities only, never a cost), from the yard drawing. */
export interface ChangeOrderWork {
  fenceStyle: string
  runs: number[]
  runRails?: Array<'auto' | '6ft' | '8ft'>
  corners: number
  ends: number
  walkGates: number
  dblGates: number
  tearOutSections: number
  tearOutGates: number
  sections: number
  footage: number
  layout: SavedQuote['layout'] | null
  planSvg: string | null
  pullSheet: Array<{ item: string; qty: number }>
}

export interface ChangeOrder {
  id: string
  quoteId: string
  number: number
  status: ChangeOrderStatus
  reason: string
  lines: ChangeOrderLine[]
  totalCents: number
  scope: ChangeOrderScope | null
  createdBy: string | null
  sentAt: string | null
  approvedAt: string | null
  approvedBy: string | null
  voidedAt: string | null
  /** Signed by the customer (customer portal, the change order's link, or in person on a staff phone). */
  signedBy?: string | null
  signedAt?: string | null
  signedVia?: 'portal' | 'link' | 'in_person' | null
  /** Approved verbally by the owner or office: who, when, why. */
  verbalBy?: string | null
  verbalAt?: string | null
  verbalReason?: string | null
  /** The contract revision it made when approved (rev 1 = as signed). */
  contractRev?: number | null
  /** The work after it (a change from the yard drawing). */
  work?: ChangeOrderWork | null
  /** The job's work after it, when its change was put on another change order's (server rebuildJobWork). */
  jobWork?: ChangeOrderWork | null
  /** Its own change side by side, from its drawing ("Left side 40 ft → 50 ft"; server ownChangeWords). */
  change?: string | null
  /** The other change orders whose change its drawing also shows (open when it was drawn). */
  alsoInDrawing?: Array<{ number: number; status: ChangeOrderStatus; signed: boolean; change: string | null }>
  warrantyBefore?: { name: string; text: string } | null
  warrantyAfter?: { name: string; text: string } | null
  /** Owner and office only: what it does to the quoted cost, in cents. */
  costDelta?: { materialCents: number; laborCents: number; tearOutCents: number; totalCents: number } | null
  /** A customer link was made for it. */
  hasLink?: boolean
  version: number
  createdAt: string
}

/** The yard drawing's new work: the quote builder's inputs (the server prices them), the drawing and its plan. */
export interface ChangeOrderWorkInput {
  request: Record<string, unknown>
  layout?: SavedQuote['layout'] | null
  planSvg?: string | null
}

/** A change order filled in from what was changed on a signed quote. */
export interface ChangeOrderPrefill {
  reason: string
  lines: ChangeOrderLine[]
  scope: ChangeOrderScope | null
  work?: ChangeOrderWorkInput | null
}

export const CO_EVENT = 'ezbiz:changeorders:updated'
// A draft has its OK: the owner or office made it, or OK'd a Salesman's (only they make drafts). "Draft" read as not OK'd yet (review, Oct 27 2026).
const STATUS_WORDS: Record<ChangeOrderStatus, string> = { needs_ok: 'Waiting for OK', draft: "OK'd, not sent yet", sent: 'Sent', approved: 'Approved', void: 'Void' }

export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)
const signed = (cents: number) => `${cents >= 0 ? '+' : '−'}${money(Math.abs(cents))}`
/** "152 ft, 22 sections, 1 walk gate". */
const workWords = (w: ChangeOrderWork) => `${w.footage} ft, ${w.sections} sections${w.walkGates ? `, ${w.walkGates} walk gate${w.walkGates > 1 ? 's' : ''}` : ''}${w.dblGates ? `, ${w.dblGates} double gate${w.dblGates > 1 ? 's' : ''}` : ''}`
const shortDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/* ───────── the server's copy ───────── */

let cache: ChangeOrder[] = []
const emit = () => { try { window.dispatchEvent(new CustomEvent(CO_EVENT)) } catch { /* no window */ } }

const byId = (a: ChangeOrder, b: ChangeOrder) => a.id.localeCompare(b.id)
function keep(rows: ChangeOrder[], quoteId?: string) {
  const had = quoteId ? cache.filter(c => c.quoteId === quoteId) : cache
  // Read again on a timer (the job page, every 20 seconds): tell the screen only when something changed,
  // so the documents, packet and payments it reads again are not asked for each time.
  const same = JSON.stringify([...had].sort(byId)) === JSON.stringify([...rows].sort(byId))
  cache = quoteId ? [...cache.filter(c => c.quoteId !== quoteId), ...rows] : rows
  if (!same) emit()
}
function put(row: ChangeOrder) {
  cache = cache.some(c => c.id === row.id) ? cache.map(c => (c.id === row.id ? row : c)) : [...cache, row]
  // A change made here: the next read goes to the server.
  readAt.clear()
  emit()
}

/**
 * One read per quote at a time, and none again within a few seconds of the
 * last: opening a sold quote and its change order builder read the same
 * quote's change orders 5 times (the drawer, its section, the builder, the
 * start of a change; audit #17, Oct 27 2026). Live screens still read every
 * 20 seconds and when the app comes back on screen.
 */
const inFlight = new Map<string, Promise<ChangeOrder[] | null>>()
const readAt = new Map<string, number>()
const FRESH_MS = 3_000

/** Read a quote's (or every) change order from the server. */
export async function refreshChangeOrders(quoteId?: string): Promise<ChangeOrder[] | null> {
  // The Installer sees no prices: change orders are not his to read (the server refuses with 403), so they are
  // not asked for; the crew packet takes the work now, price free, from /api/install-packets/work (round 2b).
  if (!can('prices.view')) return null
  const key = quoteId ?? '*'
  const going = inFlight.get(key)
  if (going) return going
  if (Date.now() - (readAt.get(key) ?? 0) < FRESH_MS) return quoteId ? cache.filter(c => c.quoteId === quoteId) : cache
  const p = (async () => {
    const r = await sendJson('GET', `/api/change-orders${quoteId ? `?quoteId=${encodeURIComponent(quoteId)}` : ''}`)
    if (!r.result.ok || !Array.isArray(r.json?.data)) return null
    keep(r.json.data as ChangeOrder[], quoteId)
    readAt.set(key, Date.now())
    return r.json.data as ChangeOrder[]
  })().finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}

export function loadChangeOrders(): ChangeOrder[] { return cache }

/** All change orders for a quote, by number. */
export function getOrdersForQuote(quoteId: string): ChangeOrder[] {
  return cache.filter(co => co.quoteId === quoteId).sort((a, b) => a.number - b.number)
}

/** The approved change orders' total for a quote, in dollars. */
export function getApprovedCOTotal(quoteId: string): number {
  return getOrdersForQuote(quoteId).filter(co => co.status === 'approved').reduce((s, co) => s + co.totalCents, 0) / 100
}

/** Still waiting for the customer's own signature: sent, or approved verbally by the office. */
export const awaitingSignature = (co: ChangeOrder) => co.status === 'sent' || (co.status === 'approved' && !co.signedAt)

/** The contract revision now: 1 as signed, then the newest approved change order's. */
export function contractRevOf(orders: ChangeOrder[]): number {
  return Math.max(1, ...orders.filter(o => o.status === 'approved').map(o => o.contractRev ?? 1))
}

/* ───────── the work now ───────── */

/** Overlaid quotes and the signed quote they came from (the signed one is what a save keeps). */
const signedOf = new WeakMap<object, SavedQuote>()

/**
 * The signed quote with the work as it is now: the newest approved change
 * order's drawing, runs, gates, sections and pull sheet (quantities), and the
 * contract price. The quote builder opens it for the next change (so a change
 * is priced from the work now), and the install packet and site plan are made
 * from it. The signed quote itself never changes (signedQuoteOf).
 */
export function quoteWithChanges(quote: SavedQuote, orders: ChangeOrder[] = getOrdersForQuote(quote.id)): SavedQuote {
  const approved = orders.filter(o => o.quoteId === quote.id && o.status === 'approved')
  const withWork = approved.filter(o => o.work).sort((a, b) => (a.approvedAt ?? '').localeCompare(b.approvedAt ?? '') || a.number - b.number)
  const last = withWork[withWork.length - 1]
  const w = last ? (last.jobWork ?? last.work) : null
  if (!w && !approved.length) return quote
  const total = approved.reduce((s, o) => s + o.totalCents, 0)
  const out: SavedQuote = {
    ...quote,
    finalPrice: Math.round((quote.finalPrice * 100) + total) / 100,
    ...(w ? {
      fenceStyle: w.fenceStyle || quote.fenceStyle, runs: w.runs, runRails: w.runRails, corners: w.corners, ends: w.ends,
      walkGates: w.walkGates, dblGates: w.dblGates, tearOutSections: w.tearOutSections, tearOutGates: w.tearOutGates, sections: w.sections,
      layout: w.layout ?? quote.layout, pullSheet: w.pullSheet.map(l => ({ item: l.item, qty: l.qty, unitCost: 0, total: 0 })) as SavedQuote['pullSheet'],
      proposal: quote.proposal ? { ...quote.proposal, ...(w.planSvg ? { planSvg: w.planSvg } : {}) } : quote.proposal,
    } : {}),
  }
  signedOf.set(out, signedQuoteOf(quote))
  return out
}

/**
 * The quote the builder opens for the next change (round 3, Oct 26 2026): the
 * work with every approved change order's change and every still open one's
 * (the server's /api/change-orders/start), so a second change order never
 * starts from the signed quote and drops the first one's change. The price is
 * the contract with the open ones' drawing changes in it too, so the next
 * change's price difference counts only its own change.
 */
export async function quoteForChange(quote: SavedQuote): Promise<SavedQuote> {
  await refreshChangeOrders(quote.id)
  const now = quoteWithChanges(quote)
  const r = await sendJson('GET', `/api/change-orders/start?quoteId=${encodeURIComponent(quote.id)}`)
  const d = r.result.ok ? r.json?.data : null
  if (!d || !Array.isArray(d.runs)) return now
  const open = Array.isArray(d.open) ? d.open as Array<{ id: string; number: number }> : []
  const openCents = getOrdersForQuote(quote.id).filter(o => open.some(x => x.id === o.id)).reduce((s, o) => s + o.totalCents, 0)
  const out: SavedQuote = {
    ...now,
    finalPrice: Math.round(now.finalPrice * 100 + openCents) / 100,
    fenceStyle: d.fenceStyle || now.fenceStyle, runs: d.runs, runRails: d.runRails, corners: d.corners, ends: d.ends,
    walkGates: d.walkGates, dblGates: d.dblGates, tearOutSections: d.tearOutSections, tearOutGates: d.tearOutGates,
    ...(typeof d.sections === 'number' ? { sections: d.sections } : {}),
    layout: d.layout ? { ...(now.layout ?? {}), ...d.layout } as SavedQuote['layout'] : now.layout,
    proposal: now.proposal ? { ...now.proposal, ...(d.planSvg ? { planSvg: d.planSvg } : {}) } : now.proposal,
  }
  signedOf.set(out, signedQuoteOf(quote))
  if (open.length) {
    const rows = getOrdersForQuote(quote.id)
    openOf.set(out, open.map(o => ({ number: o.number, change: rows.find(r => r.id === o.id)?.change ?? null })).sort((a, b) => a.number - b.number))
    const names = open.map(o => `CO-${o.number}`)
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    toast.info(`The drawing has ${list} in it`, `${list} ${names.length === 1 ? 'is' : 'are'} not signed yet. The new change order adds only its own change; the job keeps every change that is signed.`)
  }
  return out
}

/** The open (not signed) change orders whose change is in the drawing quoteForChange opened. */
const openOf = new WeakMap<object, Array<{ number: number; change: string | null }>>()

/**
 * The note the change order editor keeps on screen (round 3 recheck, Oct 26
 * 2026: the drawing showed CO-1's change and its price with nothing saying
 * so): "This drawing includes CO-1 (Left side 40 ft → 50 ft), not signed
 * yet." Null when no open change order is in it.
 */
export function openChangesNote(q: object | null | undefined): string | null {
  const open = q ? openOf.get(q) : undefined
  if (!open?.length) return null
  const one = (o: { number: number; change: string | null }) => `CO-${o.number}${o.change ? ` (${o.change})` : ''}`
  const list = open.length === 1 ? one(open[0]) : `${open.slice(0, -1).map(one).join(', ')} and ${one(open[open.length - 1])}`
  return `This drawing includes ${list}, not signed yet. The price shown is for this drawing, with ${open.length === 1 ? 'that change' : 'those changes'} in it; the new change order adds only its own change.`
}

/** The quote as signed, for a quote that may be the work now (quoteWithChanges). */
export function signedQuoteOf<T extends object>(q: T): T {
  return (signedOf.get(q) as T | undefined) ?? q
}

/* ───────── calls ───────── */

/** After an approval: the server's word when the scheduled install no longer fits. */
function warnSchedule(json: any) {
  if (typeof json?.scheduleWarning === 'string' && json.scheduleWarning) toast.warning('Check the schedule', json.scheduleWarning)
}

/** Make one. `verbalReason`: approved now, verbally (owner and office only). */
export async function createChangeOrder(input: { quoteId: string; reason: string; lines: ChangeOrderLine[]; scope: ChangeOrderScope | null; verbalReason?: string | null; work?: ChangeOrderWorkInput | null }): Promise<ChangeOrder | null> {
  const approved = !!input.verbalReason?.trim()
  const r = await sendJson('POST', '/api/change-orders', {
    id: newId(), quoteId: input.quoteId, reason: input.reason, lines: input.lines, scope: input.scope ?? undefined,
    status: approved ? 'approved' : 'draft', ...(approved ? { verbalReason: input.verbalReason!.trim() } : {}), ...(input.work ? { work: input.work } : {}),
  })
  if (!r.result.ok) { toast.error('Change order not saved', r.json?.error || 'Check the signal and try again.'); return null }
  const row = r.json.data as ChangeOrder
  put(row)
  // Drawn while another change order with a drawing is open and changing the same thing: say so (server openNotice).
  if (typeof r.json?.notice === 'string' && /changes the same thing/.test(r.json.notice)) toast.warning(`CO-${row.number} and another open change order change the same thing`, r.json.notice)
  if (row.status === 'approved') { void refreshJobs(); warnSchedule(r.json) }
  return row
}

/** Send, approve (verbally, with a reason) or void one (built on the version on screen). */
export async function setChangeOrderStatus(co: ChangeOrder, status: ChangeOrderStatus, verbalReason?: string): Promise<ChangeOrder | null> {
  const r = await sendJson('PATCH', `/api/change-orders/${encodeURIComponent(co.id)}`, { baseVersion: co.version, status, ...(verbalReason ? { verbalReason } : {}) })
  if (!r.result.ok) {
    if (r.status === 409 && r.json?.code === 'STALE_VERSION' && r.json?.data) { put(r.json.data as ChangeOrder); toast.warning('Changed on another phone', 'This change order was changed somewhere else. It shows as it is now; try again.'); return null }
    toast.error('Change order not saved', r.json?.error || 'Check the signal and try again.')
    return null
  }
  const row = r.json.data as ChangeOrder
  put(row)
  if (status === 'approved' || co.status === 'approved') { void refreshJobs(); warnSchedule(r.json) }
  return row
}

/** The customer signs on this phone, in person. */
export async function signInPerson(co: ChangeOrder, name: string, signature: string): Promise<ChangeOrder | null> {
  const r = await sendJson('POST', `/api/change-orders/${encodeURIComponent(co.id)}/sign`, { name, signature })
  if (!r.result.ok) { toast.error('Signature not saved', r.json?.error || 'Check the signal and try again.'); return null }
  const row = r.json.data as ChangeOrder
  put(row)
  void refreshJobs()
  warnSchedule(r.json)
  return row
}

/** The customer's link (/p/co/<token>): the public door on a Tailscale address, the app's own address otherwise (as proposals). */
export function changeOrderUrl(token: string): string {
  const { protocol, hostname, origin } = window.location
  return hostname.endsWith('.ts.net') ? `${protocol}//${hostname}:8443/p/co/${token}` : `${origin}/p/co/${token}`
}

/** Make (or get) the customer's link. */
export async function changeOrderLink(co: ChangeOrder): Promise<string | null> {
  const r = await sendJson('POST', `/api/change-orders/${encodeURIComponent(co.id)}/link`, {})
  if (!r.result.ok || !r.json?.data?.token) { toast.error('Could not make the link', r.json?.error || 'Check the signal and try again.'); return null }
  if (r.json.data.changeOrder) put(r.json.data.changeOrder as ChangeOrder)
  return changeOrderUrl(r.json.data.token)
}

/** The quote's change orders, kept fresh. */
export function useChangeOrders(quoteId: string): { orders: ChangeOrder[]; loaded: boolean } {
  const [orders, setOrders] = useState<ChangeOrder[]>(() => getOrdersForQuote(quoteId))
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const on = () => setOrders(getOrdersForQuote(quoteId))
    window.addEventListener(CO_EVENT, on)
    void refreshChangeOrders(quoteId).then(() => { setLoaded(true); on() })
    return () => window.removeEventListener(CO_EVENT, on)
  }, [quoteId])
  return { orders, loaded }
}

/**
 * A screen with a quote's change orders open (the job page): read them again
 * every 20 seconds while it is on screen, when the app comes back on screen,
 * and on the app's live refresh (liveRefresh.ts), so a change order the
 * customer signs on their link shows as signed (and the documents, the packet
 * notice and the contract that listen to CO_EVENT follow) without a reload.
 */
export function useChangeOrdersLive(quoteId: string | null | undefined, everyMs = 20_000) {
  useEffect(() => {
    if (!quoteId) return
    const again = () => { if (document.visibilityState === 'visible') void refreshChangeOrders(quoteId) }
    const t = window.setInterval(again, everyMs)
    document.addEventListener('visibilitychange', again)
    window.addEventListener(LIVE_REFRESH_EVENT, again)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', again); window.removeEventListener(LIVE_REFRESH_EVENT, again) }
  }, [quoteId, everyMs])
}

/* ───────── Approved verbally: the reason ───────── */

function VerbalReason({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs text-gray-700 font-semibold" data-co-verbal>
      Why approve it without the customer's signature?
      <input className="mt-1 w-full border border-gray-300 rounded-lg px-3 min-h-[44px] text-sm font-normal" maxLength={500} value={value} onChange={e => onChange(e.target.value)}
        placeholder="e.g. Customer agreed on the phone" data-co-verbal-reason />
      <span className="block font-normal text-gray-500 mt-1">Counts as approved now: the contract, schedule and pull sheet follow. The customer's copy says "Not signed by you yet" until they sign.</span>
    </label>
  )
}

/* ───────── Make a change order ───────── */

interface EditLine {
  id: string; description: string; amount: string; credit: boolean
  /** Picked from the pick list: the quantity, the source, the words it was given (changed by hand: kept on a new quantity) and a price being worked out. */
  qty?: number; qtyText?: string; source?: ChangeOrderLineSource | null; auto?: string; pricing?: boolean
  /** Filled in from the drawing: $0 is a real price (the same panels, no price change), so it can be saved. */
  zeroOk?: boolean
}
const toEdit = (l: ChangeOrderLine): EditLine => ({ id: l.id, description: l.description, amount: l.amountCents ? (Math.abs(l.amountCents) / 100).toFixed(l.amountCents % 100 ? 2 : 0) : '', credit: l.amountCents < 0, ...(l.qty ? { qty: l.qty } : {}), ...(l.source ? { source: l.source } : {}) })
const pickWords = (label: string, qty: number) => (qty > 1 ? `${qty} × ${label}` : label)

/* ───────── The pick list: the Repair price list and the catalog ───────── */

interface PickItem { source: string; group: 'repair' | 'catalog'; label: string; detail: string; unitCents: number; warnings: string[] }
interface PickList { fenceStyle: string; styleLabel: string; noStyle: boolean; items: PickItem[] }

/** One picked item at a quantity, priced on the server for the job's style. */
async function pickPrice(quoteId: string, source: string, qty: number): Promise<{ priceCents: number; label: string; qty: number; fenceStyle: string; warnings: string[] } | null> {
  const r = await sendJson('GET', `/api/change-orders/pick-price?quoteId=${encodeURIComponent(quoteId)}&source=${encodeURIComponent(source)}&qty=${qty}`)
  if (!r.result.ok || !r.json?.data) { toast.error('Not priced', r.json?.error || 'Check the signal and try again.'); return null }
  return r.json.data
}

const SHOWN = 60

/**
 * Search the Repair price list (priced for the job's style, as a repair quote
 * prices it) and the catalog (Inventory items, priced as a repair prices its
 * parts). Prices only. Tapping an item adds it as a line.
 */
function PickSheet({ quoteId, onPick, onClose }: { quoteId: string; onPick: (item: PickItem, list: PickList) => void; onClose: () => void }) {
  useBackLayer(onClose, { key: 'co-pick-sheet' })
  const [list, setList] = useState<PickList | null>(null)
  const [error, setError] = useState('')
  const [group, setGroup] = useState<'repair' | 'catalog'>('repair')
  const [q, setQ] = useState('')
  useEffect(() => {
    let live = true
    void sendJson('GET', `/api/change-orders/pick-list?quoteId=${encodeURIComponent(quoteId)}`).then(r => {
      if (!live) return
      if (r.result.ok && r.json?.data) setList(r.json.data as PickList)
      else setError(r.json?.error || 'The price list did not load. Check the signal and try again.')
    })
    return () => { live = false }
  }, [quoteId])
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  // A search looks in both lists; with no search, the list picked.
  const found = (list?.items ?? []).filter(i => (words.length ? true : i.group === group) && words.every(w => `${i.label} ${i.detail}`.toLowerCase().includes(w)))
  const shown = found.slice(0, SHOWN)
  return (
    <div className="fixed inset-0 z-[85] flex items-end md:items-center justify-center bg-black/50" onClick={onClose} data-co-pick-sheet>
      <div className="bg-white w-full md:max-w-[560px] rounded-t-2xl md:rounded-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 pb-2 space-y-2 border-b border-gray-100">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-bold text-gray-900">Pick from the price list</h2>
              <p className="text-xs text-gray-500">{list ? (list.noStyle ? `The job's style (${list.styleLabel}) is not in Settings, so nothing can be priced from it. Type a custom line instead.` : `Priced for ${list.styleLabel}, at today's Settings. You can change the amount after.`) : ' '}</p>
            </div>
            <button onClick={onClose} aria-label="Close" className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 text-xl">×</button>
          </div>
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search, e.g. gate, post, hinge" autoComplete="off"
            className="w-full h-12 border border-gray-300 rounded-lg px-3 text-base" data-co-pick-search />
          {!words.length && (
            <div className="grid grid-cols-2 gap-2" role="tablist">
              {(['repair', 'catalog'] as const).map(g => (
                <button key={g} type="button" role="tab" aria-selected={group === g} onClick={() => setGroup(g)}
                  className={`min-h-[44px] rounded-lg text-sm font-semibold border ${group === g ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-700'}`} data-co-pick-group={g}>
                  {g === 'repair' ? 'Repair price list' : 'Catalog'}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="overflow-y-auto p-2 flex-1" data-co-pick-results>
          {error && <p className="text-sm text-red-700 p-2" role="alert">{error}</p>}
          {!list && !error && <p className="text-sm text-gray-500 p-2">Loading the price list…</p>}
          {list && !shown.length && !list.noStyle && <p className="text-sm text-gray-500 p-2">Nothing matches. Try another word, or type a custom line.</p>}
          {shown.map(i => (
            <button key={i.source} type="button" onClick={() => onPick(i, list!)} className="w-full text-left rounded-xl px-3 py-2 min-h-[52px] hover:bg-gray-50 active:bg-gray-100 flex items-center justify-between gap-3" data-co-pick-item={i.source}>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900">{i.label}</span>
                <span className="block text-xs text-gray-500 truncate">{words.length ? `${i.group === 'repair' ? 'Repair price list' : 'Catalog'}${i.detail ? ` · ${i.detail}` : ''}` : i.detail}</span>
                {i.warnings.length > 0 && <span className="block text-[11px] text-amber-800">{i.warnings[0]}</span>}
              </span>
              <span className="text-sm font-semibold text-gray-900 shrink-0" data-co-pick-price>{money(i.unitCents)}</span>
            </button>
          ))}
          {found.length > SHOWN && <p className="text-xs text-gray-500 p-2">Showing {SHOWN} of {found.length}. Type more of the name to narrow it.</p>}
        </div>
      </div>
    </div>
  )
}
/** A line in whole dollars (Oct 21 2026): rounded down, a credit to the larger whole dollar, so the cents never go on the customer. */
const centsOf = (l: EditLine) => { const n = Math.round((parseFloat(l.amount) || 0) * 100); return wholeDollarCents(l.credit ? -Math.abs(n) : Math.abs(n)).cents }
const hasCents = (l: EditLine) => Math.round((parseFloat(l.amount) || 0) * 100) % 100 !== 0

export function QuickChangeOrderModal({
  quoteId,
  customerName,
  existingCount,
  prefill,
  onSaved,
  onClose,
}: {
  quoteId: string
  customerName: string
  existingCount: number
  /** Filled in from what was changed on the signed quote (quote builder). */
  prefill?: ChangeOrderPrefill | null
  onSaved: (co: ChangeOrder) => void
  onClose: () => void
}) {
  useBackLayer(onClose, { key: 'quick-change-order-modal' })
  const [items, setItems] = useState<EditLine[]>(() =>
    prefill?.lines.length ? prefill.lines.map(l => ({ ...toEdit(l), ...(l.amountCents === 0 ? { amount: '0', zeroOk: true } : {}) })) : [{ id: newId(), description: '', amount: '', credit: false }])
  const [reason, setReason] = useState(prefill?.reason ?? '')
  const [busy, setBusy] = useState(false)
  const [verbal, setVerbal] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const approver = can('billing.change')

  const update = (id: string, patch: Partial<EditLine>) => setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)))

  /** A picked item becomes a line: quantity 1, its words and its price (all can be changed); an empty first line is replaced. */
  function addPicked(p: PickItem, list: PickList) {
    setPicking(false)
    const line: EditLine = {
      id: newId(), description: p.label, auto: p.label, amount: String(Math.round(p.unitCents) / 100), credit: false, qty: 1,
      source: { kind: p.group, ref: p.source, label: p.label, fenceStyle: list.fenceStyle, listCents: p.unitCents },
    }
    setItems(prev => [...prev.filter(i => i.description.trim() || i.amount.trim() || i.source), line])
  }

  /** A new quantity on a picked line: priced again on the server (the words follow unless they were changed by hand). */
  async function setQty(item: EditLine, raw: string) {
    const qty = Math.max(1, Math.min(10_000, Math.round(Number(raw) || 1)))
    if (!item.source || qty === item.qty) return
    update(item.id, { qty, pricing: true })
    const r = await pickPrice(quoteId, item.source.ref, qty)
    setItems(prev => prev.map(i => {
      if (i.id !== item.id) return i
      if (!r || i.qty !== qty) return { ...i, pricing: false }
      const words = pickWords(r.label, qty)
      const keepWords = i.auto !== undefined && i.description !== i.auto
      return { ...i, pricing: false, amount: String(Math.round(r.priceCents) / 100), description: keepWords ? i.description : words, auto: keepWords ? i.auto : words, source: { ...i.source!, listCents: r.priceCents, fenceStyle: r.fenceStyle } }
    }))
  }
  const total = items.reduce((s, i) => s + centsOf(i), 0)
  // A line needs words and an amount; a line from the drawing may be $0 (still the same panels: the work changes, the price does not).
  const linesOk = items.some(i => i.description.trim() && (centsOf(i) !== 0 || (i.zeroOk && i.amount.trim() !== '')))
  // The reason is required (Oct 26 2026): the customer reads it under "Why" on their link, the signing sheet and the PDF.
  const reasonOk = reason.trim().length >= 3
  const canSave = linesOk && reasonOk && !busy && !items.some(i => i.pricing)
  const whyNot = busy || items.some(i => i.pricing) ? '' : !items.some(i => i.description.trim()) ? 'Say what changes on a line.' : !linesOk ? 'Put a price on the line (a credit is a price too).' : !reasonOk ? 'Type the reason for the change (the customer sees it).' : ''

  // Tapped twice before the window closes: saved once.
  const savedOnce = useRef(false)
  async function save(verbalReason: string | null) {
    if (!canSave || savedOnce.current) return
    savedOnce.current = true
    setBusy(true)
    const lines: ChangeOrderLine[] = items.filter(i => i.description.trim() || centsOf(i) !== 0).map(i => ({
      id: i.id, description: i.description.trim(), amountCents: centsOf(i), ...(i.source ? { qty: i.qty ?? 1, source: i.source } : {}),
    }))
    const co = await createChangeOrder({ quoteId, reason: reason.trim(), lines, scope: prefill?.scope ?? null, verbalReason, work: prefill?.work ?? null })
    setBusy(false)
    if (!co) { savedOnce.current = false; return }
    toast.success(`Change order CO-${co.number} saved`, co.status === 'needs_ok' ? 'Sent to Jonathan and the office to OK. Once they OK it, the customer signs it on your phone, their link or the portal.'
      : verbalReason ? `Approved verbally: contract rev ${co.contractRev ?? ''}, ${signed(co.totalCents)}. The customer can still sign it.` : 'Ready to sign: the customer signs it on this phone, their link or the portal.')
    onSaved(co)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-6 md:pt-12 bg-black/40" onClick={onClose} data-co-modal>
      {/* The window's lines scroll; its title and its Save bar stay put, so Save is always in sight on a phone
          (round 3 recheck: Save sat below the visible part of the sheet). */}
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[600px] max-h-[calc(100dvh-2.5rem)] md:max-h-[90vh] flex flex-col overflow-hidden mx-3 lg:mx-0" onClick={e => e.stopPropagation()} data-co-modal-window>
        <div className="px-4 md:px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-gray-900">Change order CO-{existingCount + 1}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{customerName}{prefill ? ' · filled in from your changes, priced at today\'s costs' : ''}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-4 md:px-6 py-5 space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-contain" data-co-modal-body>
          {prefill?.work && <p className="text-xs text-gray-700 bg-gray-50 rounded-lg px-3 py-2" data-co-from-drawing>From the yard drawing: once approved, the pull sheet, install packet, site plan, crew days and job costing follow the new drawing.</p>}
          <div>
            <label htmlFor="co-reason" className="text-xs text-gray-600 font-semibold mb-1 block">Reason for the change <span className="font-normal text-gray-500">(required; the customer sees it)</span></label>
            <input id="co-reason" required maxLength={1000} enterKeyHint="done" autoCapitalize="sentences"
              className="w-full border border-gray-300 rounded-lg px-3 min-h-[44px] text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="e.g. Customer asked for a gate on the left side" value={reason} onChange={e => setReason(e.target.value)} data-co-reason />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <label className="text-xs text-gray-600 font-semibold">Lines</label>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPicking(true)} className="text-sm border border-orange-300 text-orange-700 font-semibold min-h-[44px] px-3 rounded-lg" data-co-pick-open>Pick from price list</button>
                <button type="button" onClick={() => setItems(p => [...p, { id: newId(), description: '', amount: '', credit: false }])} className="text-sm text-orange-600 font-semibold min-h-[44px] px-2" data-co-add-line>+ Custom line</button>
              </div>
            </div>
            <div className="space-y-3">
              {items.map(item => (
                <div key={item.id} className="rounded-xl border border-gray-200 p-2 space-y-2" data-co-line>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    placeholder="What changes, e.g. Add a walk gate on the north side"
                    value={item.description}
                    onChange={e => update(item.id, { description: e.target.value })}
                    data-co-line-description
                  />
                  {item.source && (
                    <div className="flex items-center gap-2 text-xs text-gray-600" data-co-line-source={item.source.ref}>
                      <label className="flex items-center gap-1 font-semibold text-gray-700">Qty
                        <input type="number" inputMode="numeric" min={1} max={10000} step={1} value={item.qtyText ?? String(item.qty ?? 1)}
                          onChange={e => { const t = e.target.value; update(item.id, { qtyText: t }); if (/^\d+$/.test(t) && Number(t) >= 1) void setQty(item, t) }}
                          onBlur={() => update(item.id, { qtyText: undefined })}
                          className="w-20 border border-gray-300 rounded-lg px-2 min-h-[44px] text-sm text-right font-normal" data-co-line-qty />
                      </label>
                      <span className="min-w-0">{item.pricing ? 'Pricing…' : `${item.source.kind === 'repair' ? 'Repair price list' : 'Catalog'}${typeof item.source.listCents === 'number' ? `: ${money(item.source.listCents)}` : ''}`}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <select className="border border-gray-300 rounded-lg px-2 py-2 text-sm min-h-[44px]" value={item.credit ? 'credit' : 'add'} onChange={e => update(item.id, { credit: e.target.value === 'credit' })} data-co-line-kind>
                      <option value="add">Add</option>
                      <option value="credit">Credit</option>
                    </select>
                    <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden flex-1 focus-within:ring-2 focus-within:ring-orange-400">
                      <span className="px-2 text-gray-500 bg-gray-50 border-r border-gray-300 py-2 text-sm">$</span>
                      <input type="number" inputMode="numeric" min={0} step="1" className="w-full px-2 py-2 text-sm text-right outline-none" placeholder="0"
                        value={item.amount} onChange={e => update(item.id, { amount: e.target.value })} data-co-line-amount />
                    </div>
                    {items.length > 1 && (
                      <button onClick={() => setItems(p => p.filter(i => i.id !== item.id))} aria-label="Remove line" className="min-w-[44px] min-h-[44px] inline-grid place-items-center text-gray-400 hover:text-red-500 text-lg leading-none">×</button>
                    )}
                  </div>
                  {hasCents(item) && <p className="text-xs text-gray-600" data-co-line-whole>Whole dollars only: {signed(centsOf(item))} (the cents come off, out of profit).</p>}
                </div>
              ))}
            </div>
          </div>

          <div className={`rounded-xl p-4 flex items-center justify-between ${total >= 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <span className="text-sm font-semibold text-gray-700">Change to the contract</span>
            <span className={`text-xl font-bold ${total >= 0 ? 'text-green-700' : 'text-red-600'}`} data-co-total>{signed(total)}</span>
          </div>
          {total === 0 && linesOk && <p className="text-xs text-gray-700 bg-gray-50 rounded-lg px-3 py-2" data-co-no-price-change>No price change: the work changes, the price stays the same. Save it so the customer signs the new drawing and the crew gets it.</p>}
          {verbal !== null && <VerbalReason value={verbal} onChange={setVerbal} />}
        </div>

        <div className="px-4 md:px-6 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] border-t border-gray-200 flex flex-wrap items-center justify-end gap-2 shrink-0 bg-white" data-co-save-bar>
          {/* In the Save bar, so a phone always sees why Save is grey (the missing reason sits above the lines). */}
          {whyNot && <p className="w-full text-xs text-amber-900" data-co-why-not>{whyNot}</p>}
          <button onClick={onClose} className="px-4 min-h-[44px] text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button onClick={() => void save(null)} disabled={!canSave}
            className="bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold px-5 min-h-[44px] rounded-xl text-sm" data-co-save-draft>
            {approver ? 'Save (customer signs next)' : 'Save and send to the office to OK'}
          </button>
          {approver && (verbal === null
            ? <button onClick={() => setVerbal('')} disabled={!canSave} className="btn btn-secondary min-h-[44px]" data-co-save-approved>Approved verbally…</button>
            : <button onClick={() => void save(verbal.trim())} disabled={!canSave || verbal.trim().length < 3} className="btn btn-primary min-h-[44px]" data-co-save-verbal>Save as approved verbally</button>)}
        </div>
        {/* Inside the window (its clicks stop here), so closing the list never closes the change order. */}
        {picking && <PickSheet quoteId={quoteId} onPick={addPicked} onClose={() => setPicking(false)} />}
      </div>
    </div>
  )
}

/* ───────── The customer signs on this phone ───────── */

/** The server's copy of what the customer's link shows (GET /api/change-orders/:id/for-signing). */
interface ForSigning {
  contract: { beforeCents: number; afterCents: number } | null
  planSvg: string | null
  /** Its own change, said when the drawing shows other change orders too. */
  own: string | null
  /** "The drawing also shows CO-1's change (Left side 40 ft → 50 ft): not part of this change order (CO-1, not signed yet)." */
  alsoInDrawing: string[]
  /** "Questions? Call ...": the number the signed PDF and the customer's link give (Jonathan's Direct). */
  questionsPhone?: string | null
}

/**
 * The phone handed to the customer: a full screen of its own, so nothing of
 * the job page shows behind it (round 2 review, Oct 26 2026: "Quoted cost
 * +$637.02 (materials..., labor...)" and "By WT Christa (sales)" could be read
 * behind the sheet). Only what the customer signs: the lines, the total, the
 * contract before and with it, a warranty change.
 */
function SignInPersonSheet({ co, customerName, contract, onDone, onClose }: { co: ChangeOrder; customerName: string; contract: { beforeCents: number; afterCents: number } | null; onDone: () => void; onClose: () => void }) {
  useBackLayer(onClose, { key: 'co-sign-in-person' })
  const [name, setName] = useState(customerName)
  const [ink, setInk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // What their link shows (the server's words and figures): the contract, the new layout and the other open change orders in it.
  const [shown, setShown] = useState<ForSigning | null>(null)
  useEffect(() => {
    let live = true
    void sendJson('GET', `/api/change-orders/${encodeURIComponent(co.id)}/for-signing`).then(r => { if (live && r.result.ok && r.json?.data) setShown(r.json.data as ForSigning) })
    return () => { live = false }
  }, [co.id])
  const contractNow = shown?.contract ?? contract
  async function sign() {
    if (!name.trim()) { setError('Type the customer\'s name.'); return }
    if (!ink) { setError('The customer signs in the box.'); return }
    setBusy(true); setError('')
    const row = await signInPerson(co, name.trim(), ink)
    setBusy(false)
    if (!row) return
    toast.success(`Change order CO-${row.number} signed`, `Signed by ${row.signedBy}. Contract rev ${row.contractRev ?? ''}.`)
    onDone()
  }
  return (
    <div className="fixed inset-0 z-[85] bg-white overflow-y-auto" data-co-sign-sheet data-customer-holds>
      <div className="w-full md:max-w-[560px] mx-auto p-4 pb-[calc(16px+env(safe-area-inset-bottom))] space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-bold text-gray-900">Change order CO-{co.number}: customer signs</h2>
            <p className="text-xs text-gray-500">Hand the phone to the customer.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 text-xl">×</button>
        </div>
        {co.reason && <p className="text-sm text-gray-800 bg-gray-50 rounded-lg px-3 py-2 break-words" data-co-sign-why><b>Why:</b> {co.reason}</p>}
        <table className="w-full text-sm"><tbody>
          {co.lines.map(l => <tr key={l.id} className="border-b border-gray-100"><td className="py-2 pr-2 text-gray-800">{l.description || 'Change'}</td><td className="py-2 text-right font-semibold whitespace-nowrap">{signed(l.amountCents)}</td></tr>)}
          <tr><td className="pt-2 font-bold">{co.totalCents < 0 ? 'Total credit' : 'Total'}</td><td className="pt-2 text-right font-black text-lg whitespace-nowrap" data-co-sign-total>{signed(co.totalCents)}</td></tr>
        </tbody></table>
        {contractNow && (
          <table className="w-full text-sm bg-gray-50 rounded-xl" data-co-sign-contract><tbody>
            <tr><td className="pt-2 px-3 text-gray-700">Your contract {co.status === 'approved' ? 'before this change' : 'now'}</td><td className="pt-2 px-3 text-right whitespace-nowrap" data-co-sign-before>{money(contractNow.beforeCents)}</td></tr>
            <tr><td className="pt-1 px-3 text-gray-700">This change</td><td className="pt-1 px-3 text-right whitespace-nowrap">{signed(co.totalCents)}</td></tr>
            <tr><td className="pb-2 pt-1 px-3 font-bold text-gray-900">{co.status === 'approved' ? 'With this change' : 'New contract total'}</td><td className="pb-2 pt-1 px-3 text-right font-black whitespace-nowrap" data-co-sign-new-contract>{money(contractNow.afterCents)}</td></tr>
          </tbody></table>
        )}
        {co.warrantyAfter && <p className="text-xs text-amber-900 bg-amber-50 rounded-lg px-3 py-2" data-co-sign-warranty>Warranty changes{co.warrantyBefore?.name ? ` from ${co.warrantyBefore.name}` : ''} to <b>{co.warrantyAfter.name}</b>: {co.warrantyAfter.text}</p>}
        {/* The new layout, as the customer's link shows it (an image: the drawing cannot run anything on this phone). */}
        {shown?.planSvg && (
          <section className="space-y-1.5" data-co-sign-plan>
            <h3 className="text-sm font-bold text-gray-900">The new layout</h3>
            {shown.own && <p className="text-xs text-gray-700" data-co-sign-own><b>This change order:</b> {shown.own}.</p>}
            {shown.alsoInDrawing.map((t, i) => <p key={i} className="text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5" data-co-sign-not-part>{t}</p>)}
            <img src={svgDataUrl(shown.planSvg)} alt={`The new layout with change order CO-${co.number}`} className="w-full h-auto rounded-xl border border-gray-200 bg-white" />
          </section>
        )}
        <label className="block text-sm text-gray-700">Customer's name
          <input value={name} onChange={e => setName(e.target.value)} autoComplete="off" maxLength={200} className="mt-1 w-full h-12 border border-gray-300 rounded-lg px-3 text-base" data-co-sign-name />
        </label>
        <SignaturePad onChange={setInk} />
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <button type="button" onClick={() => void sign()} disabled={busy} className="btn btn-primary w-full min-h-[52px]" data-co-sign-submit>{busy ? 'Saving…' : 'Approve and sign'}</button>
        {shown?.questionsPhone && <p className="text-xs text-gray-500 text-center" data-co-sign-questions>Questions? Call us at <a href={`tel:${shown.questionsPhone.replace(/[^\d+]/g, '')}`} className="font-semibold text-gray-700 underline">{phoneWords(shown.questionsPhone)}</a>.</p>}
      </div>
    </div>
  )
}

/* ───────── A quote's (or job's) change orders ───────── */

/**
 * Send it to the customer to approve and sign: their link, texted or emailed
 * from this phone (never sent by the server), or copied. Sending a draft marks
 * it Sent. The customer also sees sent change orders in the customer portal.
 */
function SendToCustomer({ co, quoteId }: { co: ChangeOrder; quoteId: string }) {
  const [busy, setBusy] = useState(false)
  const cfg = getConfig()
  const company = cfg.company?.name || 'Getter Done Fence'
  const q = getQuotes().find(x => x.id === quoteId)
  const first = (q?.customerName || '').split(' ')[0] || 'there'
  const message = (u: string) => `Hi ${first}, here is change order CO-${co.number} from ${company} (${signed(co.totalCents)}). You can ${co.status === 'approved' ? 'sign' : 'approve and sign'} it on your phone: ${u}`
  async function go(kind: 'text' | 'email' | 'copy') {
    setBusy(true)
    const u = await changeOrderLink(co)
    if (u && co.status === 'draft') await setChangeOrderStatus({ ...co, version: (getOrdersForQuote(quoteId).find(x => x.id === co.id) ?? co).version }, 'sent')
    setBusy(false)
    if (!u) return
    // The text in the registered form: "Company: ... Reply STOP to opt out." (lib/customerText.ts).
    if (kind === 'text') window.location.href = smsLink(q?.customerPhone || '', customerText(message(u), company))
    if (kind === 'email') window.location.href = `mailto:${encodeURIComponent(q?.customerEmail || '')}?subject=${encodeURIComponent(`Change order CO-${co.number} from ${company}`)}&body=${encodeURIComponent(message(u))}`
    if (kind === 'copy') { await navigator.clipboard?.writeText(u).catch(() => {}); toast.success('Link copied') }
  }
  return (
    <div className="mt-2 space-y-1" data-co-customer-send>
      <p className="text-xs text-gray-500">The customer signs on this phone, on their link, or in the customer portal{co.status === 'draft' ? '; sending the link marks it Sent' : ''}.</p>
      {!cfg.proposal?.publicLinks && <p className="text-[11px] text-amber-800">Links open only on your own phones and computers until outside access is on (Settings → Proposals).</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void go('text')} className="text-xs border border-gray-300 text-gray-700 font-semibold px-3 min-h-[44px] rounded-lg" data-co-text>Text the link</button>
        <button type="button" disabled={busy} onClick={() => void go('email')} className="text-xs border border-gray-300 text-gray-700 font-semibold px-3 min-h-[44px] rounded-lg" data-co-email>Email</button>
        <button type="button" disabled={busy} onClick={() => void go('copy')} className="text-xs border border-gray-300 text-gray-700 font-semibold px-3 min-h-[44px] rounded-lg" data-co-copy-link>Copy link</button>
      </div>
    </div>
  )
}

const VIA_WORDS: Record<string, string> = { portal: ', in the customer portal', link: ', on their link', in_person: ', in person' }

/** Change orders a notice already scrolled to (once each, so reopening the job does not jump again). */
const scrolledTo = new Set<string>()

export function ChangeOrderPanel({ quoteId, originalPrice, customerName = '', hideNew = false }: { quoteId: string; originalPrice: number; customerName?: string; hideNew?: boolean }) {
  const { orders, loaded } = useChangeOrders(quoteId)
  const [showModal, setShowModal] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [signing, setSigning] = useState<ChangeOrder | null>(null)
  const [verbalFor, setVerbalFor] = useState<{ id: string; reason: string } | null>(null)
  const approver = can('billing.change')
  const maker = can('quotes.change')
  const costs = can('costs.view')

  const originalCents = Math.round(originalPrice * 100)
  const approvedCents = orders.filter(o => o.status === 'approved').reduce((s, o) => s + o.totalCents, 0)
  /** The contract before a change order and with it (approved ones by contract revision), for the customer signing it. */
  const contractAround = (co: ChangeOrder) => {
    if (co.status === 'void') return null
    const mine = co.status === 'approved' ? co.contractRev ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
    const before = originalCents + orders.filter(o => o.id !== co.id && o.status === 'approved' && (o.contractRev ?? 0) < mine).reduce((s, o) => s + o.totalCents, 0)
    return { beforeCents: before, afterCents: before + co.totalCents }
  }
  // A notice opens the job (or card) at its change order (?co=<id>): scrolled to it, its buttons in view.
  const nav = useNav()
  const want = nav.params.get('co') ?? new URLSearchParams(window.location.search).get('co')
  useEffect(() => {
    if (!want || !loaded || scrolledTo.has(want) || !orders.some(o => o.id === want)) return
    scrolledTo.add(want)
    requestAnimationFrame(() => document.querySelector(`[data-co-id="${CSS.escape(want)}"]`)?.scrollIntoView({ block: 'center' }))
  }, [want, loaded, orders])

  async function setStatus(co: ChangeOrder, status: ChangeOrderStatus, verbalReason?: string) {
    setBusy(co.id)
    const row = await setChangeOrderStatus(co, status, verbalReason)
    setBusy(null)
    if (row && status === 'approved') { setVerbalFor(null); toast.success(`Change order CO-${row.number} approved verbally`, `Contract rev ${row.contractRev ?? ''}. The customer can still sign it.`) }
    if (row && status === 'draft' && co.status === 'needs_ok') toast.success(`Change order CO-${row.number} OK'd`, 'It can go to the customer now: signed on a phone, their link or the portal.')
  }

  const STATUS_COLORS: Record<ChangeOrderStatus, string> = {
    needs_ok: 'bg-amber-100 text-amber-900',
    draft: 'bg-yellow-100 text-yellow-800',
    sent: 'bg-blue-100 text-blue-800',
    approved: 'bg-green-100 text-green-800',
    void: 'bg-gray-100 text-gray-500 line-through',
  }

  return (
    <div data-co-panel>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-600">Change orders</p>
        {maker && !hideNew && (
          <button onClick={() => setShowModal(true)} className="text-sm bg-orange-500 hover:bg-orange-600 text-white font-semibold px-3 min-h-[44px] rounded-lg" data-co-new>
            Make a change order
          </button>
        )}
      </div>

      <div className="bg-gray-900 rounded-xl p-3 mb-3" data-co-summary>
        <div className="flex items-center justify-between">
          <span className="text-gray-300 text-xs">Signed price</span>
          <span className="text-gray-200 text-sm">{money(originalCents)}</span>
        </div>
        {approvedCents !== 0 && (
          <div className="flex items-center justify-between mt-1">
            <span className="text-gray-300 text-xs">Approved changes</span>
            <span className={`text-sm font-semibold ${approvedCents >= 0 ? 'text-green-400' : 'text-red-400'}`}>{signed(approvedCents)}</span>
          </div>
        )}
        <div className="border-t border-gray-700 mt-2 pt-2 flex items-center justify-between">
          <span className="text-white text-xs font-semibold">Contract value <span className="font-normal text-gray-400" data-co-contract-rev>(rev {contractRevOf(orders)})</span></span>
          <span className="text-orange-400 font-bold text-lg" data-co-contract>{money(originalCents + approvedCents)}</span>
        </div>
      </div>

      {orders.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-3">{loaded ? 'No change orders' : 'Loading change orders...'}</p>
      ) : (
        <div className="space-y-2">
          {orders.map(co => (
            <div key={co.id} className={`border rounded-xl p-3 ${want === co.id ? 'border-orange-400 ring-2 ring-orange-200' : 'border-gray-200'}`} data-co-row={co.number} data-co-id={co.id} data-co-status={co.status}>
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-gray-800">CO-{co.number}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[co.status]}`}>{STATUS_WORDS[co.status]}</span>
                  {co.contractRev && co.status === 'approved' && <span className="text-[11px] text-gray-500" data-co-rev>Contract rev {co.contractRev}</span>}
                </div>
                <span className={`text-sm font-bold ${co.totalCents >= 0 ? 'text-green-700' : 'text-red-600'}`}>{signed(co.totalCents)}</span>
              </div>
              {co.lines.map(l => (
                <div key={l.id} className="flex items-center justify-between text-xs py-0.5 gap-2">
                  <span className="text-gray-700">{l.description || 'No description'}</span>
                  <span className="text-gray-600 shrink-0">{signed(l.amountCents)}</span>
                </div>
              ))}
              {co.reason && <p className="text-xs text-gray-500 mt-1 italic">{co.reason}</p>}
              {/* Its own change, side by side; never its drawing's whole fence, which counts other change orders
                  open when it was drawn (round 3 recheck: CO-1 read "New drawing: 156 ft" on a 152 ft job). */}
              {co.work && <p className="text-xs text-gray-600 mt-1" data-co-work>{co.change ? `Its change: ${co.change}.` : `New drawing: ${workWords(co.work)}.`}{co.status === 'approved' && co.jobWork ? ` The job with it: ${workWords(co.jobWork)}.` : ''}</p>}
              {co.work && co.status !== 'approved' && co.status !== 'void' && (co.alsoInDrawing ?? []).map(a => (
                <p key={a.number} className="text-xs text-gray-500 mt-0.5" data-co-also-in-drawing={a.number}>Its drawing also shows CO-{a.number}{a.change ? ` (${a.change})` : ''}: not part of this change order ({a.status === 'void' ? 'cancelled' : a.signed ? 'signed' : 'not signed yet'}).</p>
              ))}
              {co.warrantyAfter && <p className="text-xs text-amber-900 mt-1" data-co-warranty>Warranty changes{co.warrantyBefore?.name ? ` from ${co.warrantyBefore.name}` : ''} to {co.warrantyAfter.name}.</p>}
              {costs && co.costDelta && <p className="text-xs text-gray-500 mt-1" data-co-cost>Quoted cost {signed(co.costDelta.totalCents)} (materials {signed(co.costDelta.materialCents)}, labor {signed(co.costDelta.laborCents)}).</p>}
              <p className="text-xs text-gray-400 mt-1">
                {co.createdBy ? `By ${co.createdBy}` : ''}{co.approvedBy && !co.signedAt && !co.verbalAt ? ` · approved by ${co.approvedBy}` : ''}
              </p>
              {co.verbalAt && (
                <p className="text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5 mt-1.5" data-co-verbal-note>
                  Approved verbally by {co.verbalBy} on {shortDay(co.verbalAt)}: {co.verbalReason}.{co.signedAt ? '' : ' Not signed by the customer yet.'}
                </p>
              )}
              {co.signedAt && (
                <p className="text-xs text-green-800 bg-green-50 border border-green-200 rounded-lg px-2 py-1.5 mt-1.5" data-co-customer-signed>
                  Signed by the customer on {shortDay(co.signedAt)}{co.signedBy ? ` (${co.signedBy})` : ''}{VIA_WORDS[co.signedVia ?? ''] ?? ''}.
                </p>
              )}
              {co.status === 'needs_ok' && (
                <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-1.5" data-co-waiting-ok>
                  {approver ? `${co.createdBy || 'The salesman'} made this. OK it to send it to the customer, or void it.` : 'Waiting for Jonathan or the office to OK it. Then the customer signs it here, on their link or in the portal.'}
                </p>
              )}
              {(co.status === 'draft' || awaitingSignature(co)) && maker && <SendToCustomer co={co} quoteId={quoteId} />}
              {verbalFor?.id === co.id && (
                <div className="mt-2 space-y-2">
                  <VerbalReason value={verbalFor.reason} onChange={v => setVerbalFor({ id: co.id, reason: v })} />
                  <div className="flex gap-2">
                    <button disabled={busy === co.id || verbalFor.reason.trim().length < 3} onClick={() => void setStatus(co, 'approved', verbalFor.reason.trim())} className="text-xs bg-green-600 text-white font-semibold px-3 min-h-[44px] rounded-lg disabled:opacity-50" data-co-verbal-save>Approve verbally</button>
                    <button onClick={() => setVerbalFor(null)} className="text-xs text-gray-600 px-3 min-h-[44px]">Cancel</button>
                  </div>
                </div>
              )}
              {co.status !== 'void' && (
                <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-gray-100">
                  {co.status === 'needs_ok' && approver && (
                    <button disabled={busy === co.id} onClick={() => void setStatus(co, 'draft')} className="text-xs bg-green-600 hover:bg-green-700 text-white font-semibold px-3 min-h-[44px] rounded-lg" data-co-ok>OK to send</button>
                  )}
                  {(co.status === 'draft' || awaitingSignature(co)) && maker && (
                    <button disabled={busy === co.id} onClick={() => setSigning(co)} className="text-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold px-3 min-h-[44px] rounded-lg" data-co-sign-here>Customer signs on this phone</button>
                  )}
                  {co.status === 'draft' && maker && (
                    <button disabled={busy === co.id} onClick={() => void setStatus(co, 'sent')} className="text-xs border border-blue-300 text-blue-700 font-semibold px-3 min-h-[44px] rounded-lg" data-co-send>Mark sent</button>
                  )}
                  {(co.status === 'needs_ok' || co.status === 'draft' || co.status === 'sent') && approver && verbalFor?.id !== co.id && (
                    <button disabled={busy === co.id} onClick={() => setVerbalFor({ id: co.id, reason: '' })} className="text-xs border border-green-600 text-green-700 font-semibold px-3 min-h-[44px] rounded-lg" data-co-approve>Approved verbally…</button>
                  )}
                  {((co.status !== 'approved' && maker) || (co.status === 'approved' && approver)) && (
                    <button disabled={busy === co.id} onClick={() => { if (window.confirm(`Void change order CO-${co.number}?${co.status === 'approved' ? ' It comes off the contract value.' : ''}`)) void setStatus(co, 'void') }}
                      className="text-xs border border-gray-300 text-gray-600 hover:text-gray-800 font-semibold px-3 min-h-[44px] rounded-lg" data-co-void>Void</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <QuickChangeOrderModal
          quoteId={quoteId}
          customerName={customerName}
          existingCount={orders.length}
          onSaved={() => setShowModal(false)}
          onClose={() => setShowModal(false)}
        />
      )}
      {signing && <SignInPersonSheet co={signing} contract={contractAround(signing)} customerName={customerName || getQuotes().find(q => q.id === quoteId)?.customerName || ''} onDone={() => setSigning(null)} onClose={() => setSigning(null)} />}
    </div>
  )
}

/** A quote's change orders, only once it has one (the pipeline card): their status, the OK, signing and sending. */
export function ChangeOrdersIfAny({ quoteId, originalPrice, customerName }: { quoteId: string; originalPrice: number; customerName: string }) {
  const { orders } = useChangeOrders(quoteId)
  if (!orders.length) return null
  return <div className="mt-3" data-card-co-list><ChangeOrderPanel quoteId={quoteId} originalPrice={originalPrice} customerName={customerName} hideNew /></div>
}

/* ───────── "Change order": easy to find ───────── */

/** Is this quote signed (a change order can be made on it)? */
export const isSignedForChange = (q: { status?: string; acceptedAt?: string | null; soldAt?: string | null } | null | undefined) =>
  !!q && (q.status === 'SOLD' || !!q.acceptedAt || !!q.soldAt)

/**
 * Open the signed quote in the quote builder with the work as it is now, to
 * change the yard drawing (footage, gates, style, height). Saving the change
 * makes the change order, filled in and priced (QuoteBuilder).
 */
export async function openChangeFromDrawing(quote: SavedQuote): Promise<void> {
  await refreshChangeOrders(quote.id)
  window.dispatchEvent(new CustomEvent('ezbiz:open-quote', { detail: { id: quote.id, quote: quoteWithChanges(quote), changeOrder: true } }))
}

/**
 * The "Change order" button for a signed job (the job page, the pipeline card
 * window, the customer page): change the yard drawing, or type the change
 * (add an item, credit an item, a custom line with a price).
 */
export function ChangeOrderButton({ quoteId, customerName, className = '', label = 'Change order', onOpened }: { quoteId: string; customerName: string; className?: string; label?: string; onOpened?: () => void }) {
  const [menu, setMenu] = useState(false)
  const [typing, setTyping] = useState(false)
  const quote = getQuotes().find(q => q.id === quoteId)
  if (!can('quotes.change') || !quote || !isSignedForChange(quote)) return null
  const drawing = !(quote.work && (quote.work.type === 'move' || quote.work.type === 'repair'))
  // A job with a yard drawing opens straight on it ("Type the change instead" is there); else the choice (round 2 review, Oct 26 2026: one tap less).
  const now = quoteWithChanges(quote)
  const direct = drawing && !!now.layout?.yard
  return (
    <>
      <button type="button" onClick={() => { if (direct) { onOpened?.(); void openChangeFromDrawing(quote) } else setMenu(true) }} className={className || 'btn btn-secondary'} data-co-button={quoteId} data-co-direct={direct ? 'drawing' : undefined}>{label}</button>
      {menu && <ChangeOrderMenu customerName={customerName} drawing={drawing} onClose={() => setMenu(false)}
        onDrawing={() => { setMenu(false); onOpened?.(); void openChangeFromDrawing(quote) }}
        onLines={() => { setMenu(false); void refreshChangeOrders(quoteId).then(() => setTyping(true)) }} />}
      {typing && <QuickChangeOrderModal quoteId={quoteId} customerName={customerName} existingCount={getOrdersForQuote(quoteId).length} onSaved={() => setTyping(false)} onClose={() => setTyping(false)} />}
    </>
  )
}

function ChangeOrderMenu({ customerName, drawing, onClose, onDrawing, onLines }: { customerName: string; drawing: boolean; onClose: () => void; onDrawing: () => void; onLines: () => void }) {
  useBackLayer(onClose, { key: 'co-menu' })
  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center bg-black/40" onClick={onClose} data-co-menu>
      <div className="bg-white w-full md:max-w-[440px] rounded-t-2xl md:rounded-2xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div><h2 className="font-bold text-gray-900">Change order</h2><p className="text-xs text-gray-500">{customerName}</p></div>
          <button onClick={onClose} aria-label="Close" className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 text-xl">×</button>
        </div>
        {drawing && (
          <button type="button" onClick={onDrawing} className="w-full text-left rounded-xl border border-gray-200 p-3 min-h-[56px] hover:bg-gray-50" data-co-from-drawing-start>
            <span className="block font-semibold text-gray-900">Change the yard drawing</span>
            <span className="block text-xs text-gray-600">Add or remove footage or gates, change the style or height. Priced for you; the pull sheet, packet and site plan follow.</span>
          </button>
        )}
        <button type="button" onClick={onLines} className="w-full text-left rounded-xl border border-gray-200 p-3 min-h-[56px] hover:bg-gray-50" data-co-from-lines>
          <span className="block font-semibold text-gray-900">Type the change</span>
          <span className="block text-xs text-gray-600">Pick from the Repair price list or the catalog (add or credit), or type a custom line with a price.</span>
        </button>
      </div>
    </div>
  )
}

/* ───────── The job's history ───────── */

interface TimelineItem { at: string; kind: string; title: string; detail: string; by: string }

/**
 * The job's timeline: the contract as signed, change orders, the payment schedule following, pull sheet revisions; and a schedule warning.
 * `refreshKey` changes when the job changes (its stage, or its saved copy coming back from the server): the history is read again, so a
 * stage move or a line the server added shows while the window is open (review Oct 28 2026: only after reopening the window).
 */
export function JobTimeline({ jobId, refreshKey = '' }: { jobId: string; refreshKey?: string }) {
  const [data, setData] = useState<{ items: TimelineItem[]; scheduleWarning: string | null; contractRev: number } | null>(null)
  const [all, setAll] = useState(false)
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    sendJson('GET', `/api/change-orders/timeline?jobId=${encodeURIComponent(jobId)}`).then(r => { if (live && r.result.ok) setData(r.json.data) })
    return () => { live = false }
  }, [jobId, n, refreshKey])
  useEffect(() => {
    const h = () => setN(x => x + 1)
    window.addEventListener(CO_EVENT, h)
    return () => window.removeEventListener(CO_EVENT, h)
  }, [])
  if (!data) return <p className="text-xs text-gray-500">Loading the job history…</p>
  const items = all ? data.items : data.items.slice(0, 8)
  return (
    <div className="space-y-2" data-job-timeline>
      {data.scheduleWarning && <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-job-schedule-warning>{data.scheduleWarning}</p>}
      <p className="text-xs text-gray-600">Contract rev {data.contractRev}</p>
      {items.length === 0 ? <p className="text-xs text-gray-500">Nothing yet.</p> : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="text-xs" data-job-timeline-item={it.kind}>
              <span className="text-gray-500">{shortDay(it.at)}</span> <span className="text-gray-900 font-medium">{it.title}</span>
              {it.detail && <span className="text-gray-600"> {it.detail}</span>}{it.by && !it.title.includes(it.by) && <span className="text-gray-400"> · {it.by}</span>}
            </li>
          ))}
        </ul>
      )}
      {data.items.length > 8 && <button type="button" className="text-xs text-orange-600 font-semibold min-h-[44px]" onClick={() => setAll(x => !x)}>{all ? 'Show less' : `Show all ${data.items.length}`}</button>}
    </div>
  )
}

/** "Change order" for each of a customer's signed quotes (the customer page). */
export function CustomerChangeOrderButtons({ customerId, customerName }: { customerId: string; customerName: string }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const h = () => setTick(t => t + 1)
    window.addEventListener('fencepro:quotes:updated', h)
    return () => window.removeEventListener('fencepro:quotes:updated', h)
  }, [])
  const signedQuotes = getQuotes().filter(q => q.customerId === customerId && isSignedForChange(q))
  if (!signedQuotes.length || !can('quotes.change')) return null
  return (
    <div className="flex flex-wrap gap-2" data-customer-change-orders>
      {signedQuotes.map(q => (
        <ChangeOrderButton key={q.id} quoteId={q.id} customerName={customerName} className="btn btn-secondary"
          label={signedQuotes.length > 1 ? `Change order (${money(Math.round(q.finalPrice * 100))} quote)` : 'Change order'} />
      ))}
    </div>
  )
}
