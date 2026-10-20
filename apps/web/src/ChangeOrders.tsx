/**
 * Change orders on signed quotes (server: /api/change-orders, lib/changeOrders.ts).
 *
 * A signed quote is locked (its price stays as signed); added or removed
 * fence, gates or a style change go on a change order: lines with a
 * description and an amount (cents; a credit is negative), a status
 * (draft, sent, approved, void) and a version. Approved ones are added to the
 * job's contract value by the server. A Salesman makes and sends them; the
 * owner and office approve (prices only: a change order holds no cost).
 */
import { useEffect, useRef, useState } from 'react'
import { useBackLayer } from './nav'
import { can } from './permissions'
import { sendJson } from './syncHttp'
import { newId } from './recordSync'
import { toast } from './toast'
import { refreshJobs } from './jobStore'
import { getQuotes } from './quoteStore'
import { smsLink } from './appointmentLogic'
import { getConfig } from './configStore'

/* ───────── types ───────── */

export interface ChangeOrderLine {
  id: string
  description: string
  /** Positive adds to the contract, negative is a credit. */
  amountCents: number
}

export type ChangeOrderStatus = 'draft' | 'sent' | 'approved' | 'void'

/** What the change does to the work (differences), from the quote builder. */
export interface ChangeOrderScope {
  footageFt?: number
  walkGates?: number
  dblGates?: number
  sections?: number
  fromStyle?: string
  toStyle?: string
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
  /** Signed by the customer (customer portal or the change order's link). */
  signedBy?: string | null
  signedAt?: string | null
  signedVia?: 'portal' | 'link' | null
  /** A customer link was made for it. */
  hasLink?: boolean
  version: number
  createdAt: string
}

/** A change order filled in from what was changed on a signed quote. */
export interface ChangeOrderPrefill {
  reason: string
  lines: ChangeOrderLine[]
  scope: ChangeOrderScope | null
}

export const CO_EVENT = 'ezbiz:changeorders:updated'
const STATUS_WORDS: Record<ChangeOrderStatus, string> = { draft: 'Draft', sent: 'Sent', approved: 'Approved', void: 'Void' }

export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)
const signed = (cents: number) => `${cents >= 0 ? '+' : '−'}${money(Math.abs(cents))}`

/* ───────── the server's copy ───────── */

let cache: ChangeOrder[] = []
const emit = () => { try { window.dispatchEvent(new CustomEvent(CO_EVENT)) } catch { /* no window */ } }

function keep(rows: ChangeOrder[], quoteId?: string) {
  cache = quoteId ? [...cache.filter(c => c.quoteId !== quoteId), ...rows] : rows
  emit()
}
function put(row: ChangeOrder) {
  cache = cache.some(c => c.id === row.id) ? cache.map(c => (c.id === row.id ? row : c)) : [...cache, row]
  emit()
}

/** Read a quote's (or every) change order from the server. */
export async function refreshChangeOrders(quoteId?: string): Promise<ChangeOrder[] | null> {
  const r = await sendJson('GET', `/api/change-orders${quoteId ? `?quoteId=${encodeURIComponent(quoteId)}` : ''}`)
  if (!r.result.ok || !Array.isArray(r.json?.data)) return null
  keep(r.json.data as ChangeOrder[], quoteId)
  return r.json.data as ChangeOrder[]
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

/** Make one. `approved`: the customer agreed now (owner and office only). */
export async function createChangeOrder(input: { quoteId: string; reason: string; lines: ChangeOrderLine[]; scope: ChangeOrderScope | null; approved: boolean }): Promise<ChangeOrder | null> {
  const r = await sendJson('POST', '/api/change-orders', { id: newId(), quoteId: input.quoteId, reason: input.reason, lines: input.lines, scope: input.scope ?? undefined, status: input.approved ? 'approved' : 'draft' })
  if (!r.result.ok) { toast.error('Change order not saved', r.json?.error || 'Check the signal and try again.'); return null }
  const row = r.json.data as ChangeOrder
  put(row)
  if (row.status === 'approved') void refreshJobs()
  return row
}

/** Send, approve or void one (built on the version on screen). */
export async function setChangeOrderStatus(co: ChangeOrder, status: ChangeOrderStatus): Promise<ChangeOrder | null> {
  const r = await sendJson('PATCH', `/api/change-orders/${encodeURIComponent(co.id)}`, { baseVersion: co.version, status })
  if (!r.result.ok) {
    if (r.status === 409 && r.json?.code === 'STALE_VERSION' && r.json?.data) { put(r.json.data as ChangeOrder); toast.warning('Changed on another phone', 'This change order was changed somewhere else. It shows as it is now; try again.'); return null }
    toast.error('Change order not saved', r.json?.error || 'Check the signal and try again.')
    return null
  }
  const row = r.json.data as ChangeOrder
  put(row)
  if (status === 'approved' || co.status === 'approved') void refreshJobs()
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

/* ───────── Make a change order ───────── */

interface EditLine { id: string; description: string; amount: string; credit: boolean }
const toEdit = (l: ChangeOrderLine): EditLine => ({ id: l.id, description: l.description, amount: l.amountCents ? (Math.abs(l.amountCents) / 100).toFixed(2) : '', credit: l.amountCents < 0 })
const centsOf = (l: EditLine) => { const n = Math.round((parseFloat(l.amount) || 0) * 100); return l.credit ? -Math.abs(n) : Math.abs(n) }

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
    prefill?.lines.length ? prefill.lines.map(toEdit) : [{ id: newId(), description: '', amount: '', credit: false }])
  const [reason, setReason] = useState(prefill?.reason ?? '')
  const [busy, setBusy] = useState(false)
  const approver = can('billing.change')

  const update = (id: string, patch: Partial<EditLine>) => setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)))
  const total = items.reduce((s, i) => s + centsOf(i), 0)
  const canSave = items.some(i => i.description.trim() && centsOf(i) !== 0) && !busy

  // Tapped twice before the window closes: saved once.
  const savedOnce = useRef(false)
  async function save(approved: boolean) {
    if (!canSave || savedOnce.current) return
    savedOnce.current = true
    setBusy(true)
    const lines = items.filter(i => i.description.trim() || centsOf(i) !== 0).map(i => ({ id: i.id, description: i.description.trim(), amountCents: centsOf(i) }))
    const co = await createChangeOrder({ quoteId, reason: reason.trim(), lines, scope: prefill?.scope ?? null, approved })
    setBusy(false)
    if (!co) { savedOnce.current = false; return }
    toast.success(`Change order #${co.number} saved`, approved ? `Approved: the contract value is ${signed(co.totalCents)}.` : 'Saved as a draft. Approve it when the customer agrees.')
    onSaved(co)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-6 md:pt-12 bg-black/40" onClick={onClose} data-co-modal>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[600px] max-h-[90vh] overflow-y-auto mx-3 lg:mx-0" onClick={e => e.stopPropagation()}>
        <div className="px-4 md:px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">Change order #{existingCount + 1}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{customerName}{prefill ? ' · filled in from your changes, priced at today\'s costs' : ''}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-4 md:px-6 py-5 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-600 font-semibold">Lines</label>
              <button onClick={() => setItems(p => [...p, { id: newId(), description: '', amount: '', credit: false }])} className="text-sm text-orange-600 font-semibold min-h-[44px] px-2" data-co-add-line>+ Add line</button>
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
                  <div className="flex items-center gap-2">
                    <select className="border border-gray-300 rounded-lg px-2 py-2 text-sm min-h-[44px]" value={item.credit ? 'credit' : 'add'} onChange={e => update(item.id, { credit: e.target.value === 'credit' })} data-co-line-kind>
                      <option value="add">Add</option>
                      <option value="credit">Credit</option>
                    </select>
                    <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden flex-1 focus-within:ring-2 focus-within:ring-orange-400">
                      <span className="px-2 text-gray-500 bg-gray-50 border-r border-gray-300 py-2 text-sm">$</span>
                      <input type="number" inputMode="decimal" min={0} step="0.01" className="w-full px-2 py-2 text-sm text-right outline-none" placeholder="0.00"
                        value={item.amount} onChange={e => update(item.id, { amount: e.target.value })} data-co-line-amount />
                    </div>
                    {items.length > 1 && (
                      <button onClick={() => setItems(p => p.filter(i => i.id !== item.id))} aria-label="Remove line" className="min-w-[44px] min-h-[44px] inline-grid place-items-center text-gray-400 hover:text-red-500 text-lg leading-none">×</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-600 font-medium mb-1 block">Reason (optional)</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="e.g. Customer asked for the side yard too" value={reason} onChange={e => setReason(e.target.value)} data-co-reason />
          </div>

          <div className={`rounded-xl p-4 flex items-center justify-between ${total >= 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <span className="text-sm font-semibold text-gray-700">Change to the contract</span>
            <span className={`text-xl font-bold ${total >= 0 ? 'text-green-700' : 'text-red-600'}`} data-co-total>{signed(total)}</span>
          </div>
        </div>

        <div className="px-4 md:px-6 py-4 border-t border-gray-200 flex flex-wrap items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 min-h-[44px] text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button onClick={() => void save(false)} disabled={!canSave}
            className="bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold px-5 min-h-[44px] rounded-xl text-sm" data-co-save-draft>
            Save draft
          </button>
          {approver && (
            <button onClick={() => void save(true)} disabled={!canSave} className="btn btn-primary min-h-[44px]" data-co-save-approved>
              Customer agreed: approve
            </button>
          )}
        </div>
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
  const message = (u: string) => `Hi ${first}, here is change order #${co.number} from ${company} (${signed(co.totalCents)}). You can approve and sign it on your phone: ${u}`
  async function go(kind: 'text' | 'email' | 'copy') {
    setBusy(true)
    const u = await changeOrderLink(co)
    if (u && co.status === 'draft') await setChangeOrderStatus({ ...co, version: (getOrdersForQuote(quoteId).find(x => x.id === co.id) ?? co).version }, 'sent')
    setBusy(false)
    if (!u) return
    if (kind === 'text') window.location.href = smsLink(q?.customerPhone || '', message(u))
    if (kind === 'email') window.location.href = `mailto:${encodeURIComponent(q?.customerEmail || '')}?subject=${encodeURIComponent(`Change order #${co.number} from ${company}`)}&body=${encodeURIComponent(message(u))}`
    if (kind === 'copy') { await navigator.clipboard?.writeText(u).catch(() => {}); toast.success('Link copied') }
  }
  return (
    <div className="mt-2 space-y-1" data-co-customer-send>
      <p className="text-xs text-gray-500">The customer approves and signs on their link or in the customer portal{co.status === 'draft' ? '; sending it marks it Sent' : ''}.</p>
      {!cfg.proposal?.publicLinks && <p className="text-[11px] text-amber-800">Links open only on your own phones and computers until outside access is on (Settings → Proposals).</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void go('text')} className="text-xs border border-gray-300 text-gray-700 font-semibold px-3 min-h-[44px] rounded-lg" data-co-text>Text the link</button>
        <button type="button" disabled={busy} onClick={() => void go('email')} className="text-xs border border-gray-300 text-gray-700 font-semibold px-3 min-h-[44px] rounded-lg" data-co-email>Email</button>
        <button type="button" disabled={busy} onClick={() => void go('copy')} className="text-xs border border-gray-300 text-gray-700 font-semibold px-3 min-h-[44px] rounded-lg" data-co-copy-link>Copy link</button>
      </div>
    </div>
  )
}

export function ChangeOrderPanel({ quoteId, originalPrice, customerName = '' }: { quoteId: string; originalPrice: number; customerName?: string }) {
  const { orders, loaded } = useChangeOrders(quoteId)
  const [showModal, setShowModal] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const approver = can('billing.change')
  const maker = can('quotes.change')

  const originalCents = Math.round(originalPrice * 100)
  const approvedCents = orders.filter(o => o.status === 'approved').reduce((s, o) => s + o.totalCents, 0)

  async function setStatus(co: ChangeOrder, status: ChangeOrderStatus) {
    setBusy(co.id)
    await setChangeOrderStatus(co, status)
    setBusy(null)
  }

  const STATUS_COLORS: Record<ChangeOrderStatus, string> = {
    draft: 'bg-yellow-100 text-yellow-800',
    sent: 'bg-blue-100 text-blue-800',
    approved: 'bg-green-100 text-green-800',
    void: 'bg-gray-100 text-gray-500 line-through',
  }

  return (
    <div data-co-panel>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-600">Change orders</p>
        {maker && (
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
          <span className="text-white text-xs font-semibold">Contract value</span>
          <span className="text-orange-400 font-bold text-lg" data-co-contract>{money(originalCents + approvedCents)}</span>
        </div>
      </div>

      {orders.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-3">{loaded ? 'No change orders' : 'Loading change orders...'}</p>
      ) : (
        <div className="space-y-2">
          {orders.map(co => (
            <div key={co.id} className="border border-gray-200 rounded-xl p-3" data-co-row={co.number} data-co-status={co.status}>
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-800">CO #{co.number}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[co.status]}`}>{STATUS_WORDS[co.status]}</span>
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
              <p className="text-xs text-gray-400 mt-1">
                {co.createdBy ? `By ${co.createdBy}` : ''}{co.approvedBy && !co.signedAt ? ` · approved by ${co.approvedBy}` : ''}
              </p>
              {co.signedAt && (
                <p className="text-xs text-green-800 bg-green-50 border border-green-200 rounded-lg px-2 py-1.5 mt-1.5" data-co-customer-signed>
                  Signed by the customer on {new Date(co.signedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}{co.signedBy ? ` (${co.signedBy})` : ''}{co.signedVia === 'portal' ? ', in the customer portal' : co.signedVia === 'link' ? ', on their link' : ''}.
                </p>
              )}
              {(co.status === 'draft' || co.status === 'sent') && maker && <SendToCustomer co={co} quoteId={quoteId} />}
              {co.status !== 'void' && (
                <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-gray-100">
                  {co.status === 'draft' && maker && (
                    <button disabled={busy === co.id} onClick={() => void setStatus(co, 'sent')} className="text-xs border border-blue-300 text-blue-700 font-semibold px-3 min-h-[44px] rounded-lg" data-co-send>Mark sent</button>
                  )}
                  {(co.status === 'draft' || co.status === 'sent') && approver && (
                    <button disabled={busy === co.id} onClick={() => void setStatus(co, 'approved')} className="text-xs bg-green-600 hover:bg-green-700 text-white font-semibold px-3 min-h-[44px] rounded-lg" data-co-approve>Approve</button>
                  )}
                  {((co.status !== 'approved' && maker) || (co.status === 'approved' && approver)) && (
                    <button disabled={busy === co.id} onClick={() => { if (window.confirm(`Void change order #${co.number}?${co.status === 'approved' ? ' It comes off the contract value.' : ''}`)) void setStatus(co, 'void') }}
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
    </div>
  )
}
