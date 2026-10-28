/**
 * Vendor invoices (Inventory > Invoices): talks to /api/vendor-invoices.
 * Files go up through the photo upload queue (mediaStore.addCapture, kind
 * 'invoice'): saved on the phone first, sent when there is signal, resumed
 * after lost signal. Everything else is read from and written to the server.
 */

import { fetchWithAuth } from './crmAuth'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { addCapture } from './mediaStore'

const ORIGIN = typeof window !== 'undefined' && window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : ''
const API = `${ORIGIN}/api/vendor-invoices`

export type InvoiceStatus = 'receiving' | 'reading' | 'needs_review' | 'needs_match' | 'applied' | 'refused' | 'undone' | 'failed' | 'quote' | 'replaced'
export type LineState = 'open' | 'needs_match' | 'waiting_ok' | 'applied' | 'history_only' | 'rejected' | 'skipped' | 'undone' | 'quoted'
export interface Box { x: number; y: number; w: number; h: number }

export interface InvoiceSummary {
  id: string
  status: InvoiceStatus
  vendorId: string | null
  vendorName: string
  invoiceNumber: string
  invoiceDate: string
  totalCents: number | null
  jobId: string | null
  jobName: string | null
  uploadedBy: string
  createdAt: string
  appliedAt: string | null
  undoneAt: string | null
  message: string
  pageCount: number
  engine: string
  counts: { lines: number; applied: number; needsMatch: number; waitingOk: number; problems: number }
  /** A vendor quotation: changes no price until "We ordered this". */
  docType: 'invoice' | 'quote'
  ordered: boolean
  orderedAt: string | null
  orderedBy: string | null
  replacedById: string | null
  revision: string
  taxFound: boolean
  taxOk: boolean
  taxRate: string
  /** No tax printed: the estimated tax rate it was priced with (basis points, 722 = 7.22%), and the amount added to landed costs. */
  estTaxBp: number | null
  estTaxCents: number
  /** Rows left out; why 'backordered' carries the line (not billed on this document; portal lib/invoiceParse). */
  skipped: Array<{ page: number; row: number; text: string; why: string; description?: string; qty?: number; unit?: string; unitPriceHc?: number }>
}

export interface InvoiceLine {
  id: string
  seq: number
  page: number
  row: number
  box: Box | null
  raw: string
  itemNumber: string
  description: string
  qty: number | null
  unit: string
  unitPriceHc: number | null
  totalCents: number | null
  conf: number
  problems: string[]
  ignored: boolean
  edited: boolean
  inventoryItemId: string | null
  inventoryName: string
  vendorPer: number | null
  invPer: number | null
  invQty: number | null
  extraCents: number | null
  /** The part of extraCents that is estimated tax. */
  estTaxCents: number
  landedCents: number | null
  unitLandedCents: number | null
  prevUnitCents: number | null
  changePct: number | null
  state: LineState
  stateNote: string
}

export type Problem =
  | { kind: 'unclear_lines'; lines: number[] }
  | { kind: 'subtotal'; linesCents: number; subtotalCents: number }
  | { kind: 'total'; computedCents: number; totalCents: number }
  | { kind: 'no_total' } | { kind: 'no_lines' } | { kind: 'no_vendor' } | { kind: 'no_number' } | { kind: 'no_date' }
  | { kind: 'new_vendor'; name: string } | { kind: 'no_tax' }

export interface InvoiceDetail extends InvoiceSummary {
  subtotalCents: number | null
  taxCents: number
  freightCents: number
  fees: Array<{ label: string; cents: number; page?: number; box?: Box | null }>
  feesCents: number
  problems: Problem[]
  readMs: number
  duplicateOfId: string | null
  billId: string | null
  lines: InvoiceLine[]
  pages: Array<{ page: number; source: string; width: number; height: number; rows: Array<{ i: number; text: string; box: Box; conf: number }> }>
  files: Array<{ id: string; fileName: string; mime: string; bytes: number }>
  history: Array<{ id: string; inventoryItemId: string; unitLandedCents: number; prevUnitCents: number | null; approved: boolean; changedInventory: boolean; undoneAt: string | null; appliedBy: string; createdAt: string }>
}

export interface WaitingLine extends InvoiceLine { invoice: { id: string; vendorName: string; invoiceNumber: string; invoiceDate: string } }
export interface MatchLine extends InvoiceLine {
  invoice: { id: string; vendorId: string | null; vendorName: string; invoiceNumber: string; invoiceDate: string }
  suggestions: Array<{ id: string; name: string; why: string }>
}
export interface HistoryRow {
  id: string; inventoryItemId: string; vendorName: string; invoiceId: string | null; invoiceNumber: string; day: string
  unitLandedCents: number; prevUnitCents: number | null; approved: boolean; changedInventory: boolean; undoneAt: string | null; appliedBy: string; createdAt: string
}
export interface VendorMonths { months: string[]; rows: Array<{ vendorId: string; name: string; byMonth: Record<string, number>; totalCents: number; bills: number }> }

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetchWithAuth(API + path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError('No signal. Try again when the phone has signal.', 0)
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json?.success === false) throw new ApiError(json?.error || `Something went wrong (${res.status})`, res.status)
  return json.data as T
}

export const listInvoices = () => call<InvoiceSummary[]>('GET', '')
export const getInvoice = (id: string) => call<InvoiceDetail>('GET', `/${id}`)
export const listWaiting = () => call<WaitingLine[]>('GET', '/waiting')
export const listNeedsMatch = () => call<MatchLine[]>('GET', '/needs-match')
export const priceHistory = (itemId?: string) => call<HistoryRow[]>('GET', `/history${itemId ? `?itemId=${encodeURIComponent(itemId)}` : ''}`)
export const vendorsByMonth = (months = 12) => call<VendorMonths>('GET', `/vendors-by-month?months=${months}`)
export const listJobs = () => call<Array<{ id: string; customerName: string; fenceStyle: string; status: string; customerAddress: string }>>('GET', '/jobs')

export const editHeader = (id: string, patch: Record<string, unknown>) => call<void>('PATCH', `/${id}`, patch)
export const editLine = (id: string, lineId: string, patch: Record<string, unknown>) => call<void>('PATCH', `/${id}/lines/${lineId}`, patch)
export const addLine = (id: string, patch: Record<string, unknown>) => call<{ id: string }>('POST', `/${id}/lines`, patch)
export const matchLine = (lineId: string, choice: Record<string, unknown>) => call<void>('POST', `/lines/${lineId}/match`, choice)
export const lineSuggestions = (lineId: string) => call<Array<{ id: string; name: string; why: string }>>('GET', `/lines/${lineId}/suggestions`)
/** Estimated tax rate in words: 722 → "7.22%". */
export const pctOfBp = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.?0+$/, '')}%`
/** A fuel charge stays on the vendor bill, never in item prices. */
export const isFuelFee = (label: string) => /\bfuel\b/i.test(label)
export const okLine = (lineId: string) => call<void>('POST', `/lines/${lineId}/ok`)
export const rejectLine = (lineId: string) => call<void>('POST', `/lines/${lineId}/reject`)
export const undoInvoice = (id: string) => call<{ restored: Array<{ name: string; back: string }>; skipped: Array<{ name: string; reason: string }>; bill?: { outcome: 'voided' | 'kept_paid'; billNumber: string; paidCents: number } | null }>('POST', `/${id}/undo`)
export const markOrdered = (id: string) => call<void>('POST', `/${id}/ordered`)
export const rereadInvoice = (id: string) => call<void>('POST', `/${id}/reread`)
export const removeInvoice = (id: string) => call<void>('DELETE', `/${id}`)

/** A page picture, fetched with the login (an <img> cannot send it), as an object URL. */
export async function pageImageUrl(id: string, page: number): Promise<string | null> {
  try {
    const r = await fetchWithAuth(`${API}/${id}/page/${page}`)
    if (!r.ok) return null
    return URL.createObjectURL(await r.blob())
  } catch { return null }
}

/** An uploaded file as it came, opened in a new tab. */
export async function openInvoiceFile(id: string, fileId: string): Promise<void> {
  const w = window.open('', '_blank')
  try {
    const r = await fetchWithAuth(`${API}/${id}/files/${fileId}`)
    if (!r.ok) { w?.close(); return }
    const url = URL.createObjectURL(await r.blob())
    if (w) w.location.href = url
  } catch { w?.close() }
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`)

/**
 * Queue files as one invoice: saved on this phone first, then sent (the same
 * queue as photos). Pages in the order given.
 */
/** Saves the files of one invoice on this device for upload; the ids of the saved files. */
export async function queueInvoice(files: Blob[], names: string[], jobId: string | null): Promise<string[]> {
  const batch = newId()
  const ids: string[] = []
  for (const [seq, f] of files.entries()) {
    const mime = f.type || (names[seq]?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
    const m = await addCapture(f, {
      kind: 'invoice', mime, takenAt: new Date().toISOString(), invoiceBatch: batch, invoiceSeq: seq, invoicePages: files.length,
      fileName: names[seq] ?? '', invoiceJobId: jobId,
    })
    ids.push(m.clientId)
  }
  return ids
}

export { isInvoicePdf, isInvoicePhoto, uploadOutcome } from './uploadOutcome'

/** "$1,234.56" */
export const money = (c: number | null | undefined) => c == null ? '—' : `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** A unit price kept in hundredths of a cent: "$0.0425", "$25.00". */
export const unitPrice = (hc: number | null | undefined) => {
  if (hc == null) return '—'
  const d = (hc / 10000).toFixed(4).replace(/0{1,2}$/, '')
  return `$${d}`
}
/** "12.34" → 1234; null when it is not an amount. */
export function toCents(s: string): number | null {
  const t = s.replace(/[$,\s]/g, '')
  if (!/^-?\d+(\.\d{0,2})?$/.test(t)) return null
  return Math.round(Number(t) * 100)
}
/** "0.0425" → 425 (hundredths of a cent); null when it is not a price. */
export function toHc(s: string): number | null {
  const t = s.replace(/[$,\s]/g, '')
  if (!/^-?\d+(\.\d{0,4})?$/.test(t)) return null
  return Math.round(Number(t) * 10000)
}
