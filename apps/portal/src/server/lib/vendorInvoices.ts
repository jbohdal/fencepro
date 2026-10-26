/**
 * Vendor invoices update Inventory prices, with no typing and never wrong.
 *
 *   upload (phone first, lib/media upload) → read on the Mac (invoiceReader)
 *   → pull apart (invoiceParse) → checks → match → apply
 *
 * The checks, in order (evaluate):
 *   1. Duplicate: the same vendor and invoice number, or the same file, is
 *      refused.
 *   2. Needs review: the vendor, number or date is missing, a line is unclear
 *      (quantity x price is not the amount, or the reader was unsure), or the
 *      lines + tax + freight + fees do not add up to the total. Nothing at all
 *      is applied until this passes.
 *   3. The vendor bill is saved in Vendors.
 *   4. Needs a match: a vendor item never seen before waits until someone
 *      picks its Inventory item (or makes one) and its unit, once. After that
 *      it is automatic for that vendor and item. Lines that are matched are
 *      applied right away; the rest of the invoice waits for its matches.
 *   Quotations (docType 'quote') go through the same checks and matching but
 *   change no price: they are saved as vendor quotes (status 'quote') until
 *   someone taps "We ordered this" (ordered), then they are treated as the
 *   invoice. A newer revision of a quote (same vendor and number; later date,
 *   else the higher document id in the file name, else uploaded later)
 *   replaces the older one (status 'replaced').
 *   The same document in another file (same vendor, number, date, lines and
 *   total) is refused as a duplicate, quote or invoice.
 *   Landed cost (Jonathan, Oct 2026): a fuel charge is never in item prices
 *   (it stays on the vendor bill); freight, printed tax and other fees are
 *   spread over the lines; a document with no tax row gets estimated tax
 *   (7.22%, Settings) and says so, unless someone says "no tax is right".
 *   5. Apply: the landed cost (lib/invoiceMath) becomes the Inventory cost,
 *      confirmed on the invoice date. A change of more than the limit (20%,
 *      Settings) waits for an OK; the rest of the invoice still applies.
 *      An invoice older than the item's current price is kept in history only.
 *
 * Every change to Inventory and Vendors runs in one transaction that locks
 * Settings, Inventory and Vendors first (lib/lockState.ts) and raises their
 * versions, so open browsers merge it in. Undo puts each price back unless
 * something newer changed it since.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import prisma from './prisma.js'
import { lockAccountState } from './lockState.js'
import { readInvoiceFile, type ReadPage } from './invoiceReader.js'
import { parseInvoice, findVendor, normalizeName, lineAddsUp, type KnownVendor, type LineProblem } from './invoiceParse.js'
import { checkTotals, spreadExtras, toInventoryQty, unitLanded, needsOk, changePct, matchKey, invoiceNumberKey, dollars, landedParts, pctText, isFuelFee, DEFAULT_EST_TAX_BP, type CheckProblem } from './invoiceMath.js'
import { digSetPipeItem } from './digSetPipeMatch.js'

export const DEFAULT_JUMP_PCT = 20
/** A remembered "this vendor item is not an Inventory item". */
export const NOT_INVENTORY = '__none__'

export interface Actor { id: string | null; name: string }

// ── Files ─────────────────────────────────────────────────────────────────────

export function invoiceDir(accountId: string, invoiceId: string, ...parts: string[]): string {
  const dir = path.resolve(process.env.UPLOAD_DIR || './uploads', 'invoices', accountId.replace(/[^\w-]/g, ''), invoiceId.replace(/[^\w-]/g, ''), ...parts)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export const sha256File = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

// ── Small helpers ─────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10)
const itemCents = (item: any): number | null => {
  const n = Number(item?.unitCost)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const uid = () => crypto.randomUUID()

/** Settings, Inventory and Vendors, locked for the rest of the transaction (always in that order). */
async function lockAll(tx: any, accountId: string) {
  await lockAccountState(tx, accountId)
  await tx.$queryRaw`SELECT 1 FROM "VendorState" WHERE "accountId" = ${accountId} FOR UPDATE`
}

async function jumpLimit(tx: any, accountId: string): Promise<number> {
  const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const v = Number((b?.config as any)?.pricing?.invoiceJumpPct)
  return Number.isFinite(v) && v > 0 && v <= 500 ? v : DEFAULT_JUMP_PCT
}

/** The estimated tax rate (Settings → Material prices, a percent like 7.22) in basis points; 7.22% when not set. */
export function estTaxBpOf(config: unknown): number {
  const v = Number((config as any)?.pricing?.invoiceEstTaxPct)
  return Number.isFinite(v) && v >= 0 && v <= 30 ? Math.round(v * 100) : DEFAULT_EST_TAX_BP
}

/**
 * What a document says, for telling the same document apart from a real
 * revision: its date, total and lines (description, quantity, price, amount).
 * Two files of one quote (06-251126 sent twice) give the same.
 */
export function contentKey(inv: { invoiceDate: string; totalCents: number | null }, lines: Array<{ description: string; qty: number | null; unitPriceHc: number | null; totalCents: number | null; ignored?: boolean }>): string {
  return JSON.stringify([inv.invoiceDate, inv.totalCents, ...lines.filter(l => !l.ignored).map(l => [normalizeName(l.description), l.qty, l.unitPriceHc, l.totalCents])])
}

async function vendorState(tx: any, accountId: string) {
  const v = await tx.vendorState.findUnique({ where: { accountId } })
  return { vendors: arr(v?.vendors), bills: arr(v?.bills), payments: arr(v?.payments), exists: !!v }
}
async function saveVendorState(tx: any, accountId: string, s: { vendors: any[]; bills: any[]; payments: any[]; exists: boolean }) {
  if (s.exists) await tx.vendorState.update({ where: { accountId }, data: { vendors: s.vendors, bills: s.bills, version: { increment: 1 } } })
  else await tx.vendorState.create({ data: { accountId, vendors: s.vendors, bills: s.bills, payments: s.payments } })
}

const knownVendors = (vendors: any[]): KnownVendor[] =>
  vendors.filter(v => v && v.id && v.name).map(v => ({ id: String(v.id), name: String(v.name), aliases: arr(v.invoiceNames).map(String) }))

function newVendor(name: string): any {
  const now = new Date().toISOString()
  return {
    id: uid(), name, contactName: '', phone: '', email: '', address: '', city: '', state: '', zip: '',
    paymentTerms: 'net_30', accountNumber: '', notes: 'Added from an uploaded invoice.', isActive: true,
    invoiceNames: [], createdAt: now, updatedAt: now,
  }
}

const TERMS_DAYS: Record<string, number> = { net_15: 15, net_30: 30, net_45: 45, net_60: 60, due_on_receipt: 0 }
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Reader problems for a line, from its numbers (kept: what only a person can clear). */
export function lineProblemsFor(l: { qty: number | null; unitPriceHc: number | null; totalCents: number | null; unit: string; conf: number; edited: boolean }): LineProblem[] {
  const p: LineProblem[] = []
  if (l.totalCents == null) p.push('no_amount')
  if (l.qty == null || !(l.qty > 0)) p.push('no_quantity')
  if (l.unitPriceHc == null) p.push('no_price')
  if (l.qty != null && l.unitPriceHc != null && l.totalCents != null && !lineAddsUp(l.qty, l.unitPriceHc, l.totalCents, l.unit)) p.push('math')
  if (!l.edited && l.conf < 0.35) p.push('unclear')
  if (l.totalCents != null && l.totalCents < 0) p.push('credit')
  return p
}

// ── Receiving files ───────────────────────────────────────────────────────────

export interface IncomingFile {
  accountId: string
  actor: Actor
  clientId: string
  batchId: string
  seq: number
  pageCount: number
  fileName: string
  mime: string
  path: string
  bytes: number
  jobId?: string | null
}

/** One file of an invoice has fully arrived. When all its files are in, it is read. */
export async function receiveInvoiceFile(f: IncomingFile): Promise<{ invoiceId: string; fileId: string }> {
  const sha = sha256File(f.path)
  const result = await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoice-batch:' + f.accountId + ':' + f.batchId}))`
    let inv = await tx.vendorInvoice.findUnique({ where: { accountId_batchId: { accountId: f.accountId, batchId: f.batchId } } })
    if (!inv) {
      inv = await tx.vendorInvoice.create({
        data: { accountId: f.accountId, batchId: f.batchId, pageCount: Math.max(1, f.pageCount), uploadedById: f.actor.id, uploadedBy: f.actor.name, jobId: f.jobId || null },
      })
    }
    const had = await tx.vendorInvoiceFile.findUnique({ where: { clientId: f.clientId } })
    if (had) return { invoiceId: inv.id, fileId: had.id, ready: false }
    const dest = path.join(invoiceDir(f.accountId, inv.id), `${String(f.seq).padStart(3, '0')}-${f.clientId.replace(/[^\w-]/g, '')}${path.extname(f.fileName) || (f.mime === 'application/pdf' ? '.pdf' : '.jpg')}`)
    fs.renameSync(f.path, dest)
    const file = await tx.vendorInvoiceFile.create({
      data: { accountId: f.accountId, invoiceId: inv.id, clientId: f.clientId, seq: f.seq, fileName: f.fileName.slice(0, 200), mime: f.mime, bytes: f.bytes, path: dest, sha256: sha },
    })
    const count = await tx.vendorInvoiceFile.count({ where: { invoiceId: inv.id } })
    if (count < inv.pageCount || inv.status !== 'receiving') return { invoiceId: inv.id, fileId: file.id, ready: false }
    // The same file uploaded before (not counting ones refused or that failed) is refused.
    const files = await tx.vendorInvoiceFile.findMany({ where: { invoiceId: inv.id } })
    const same = await tx.vendorInvoiceFile.findFirst({
      where: { accountId: f.accountId, sha256: { in: files.map((x: any) => x.sha256) }, invoiceId: { not: inv.id }, invoice: { status: { notIn: ['refused', 'failed'] } } },
      include: { invoice: true },
    })
    if (same) {
      const o = same.invoice
      await tx.vendorInvoice.update({
        where: { id: inv.id },
        data: { status: 'refused', duplicateOfId: o.id, message: `Refused: this file was already uploaded on ${o.createdAt.toISOString().slice(0, 10)}${o.invoiceNumber ? ` (invoice ${o.invoiceNumber}${o.vendorName ? ` from ${o.vendorName}` : ''})` : ''}. Nothing was changed.` },
      })
      return { invoiceId: inv.id, fileId: file.id, ready: false }
    }
    await tx.vendorInvoice.update({ where: { id: inv.id }, data: { status: 'reading' } })
    return { invoiceId: inv.id, fileId: file.id, ready: true }
  }, { timeout: 30_000 })
  if (result.ready) queueRead(result.invoiceId)
  return { invoiceId: result.invoiceId, fileId: result.fileId }
}

// ── Reading (one at a time on this Mac) ──────────────────────────────────────

let readQueue: Promise<void> = Promise.resolve()
const waiting = new Set<string>()
/** Resolves when everything queued so far has been read (tests). */
export function readsSettled(): Promise<void> { return readQueue }

export function queueRead(invoiceId: string): void {
  if (waiting.has(invoiceId)) return
  waiting.add(invoiceId)
  readQueue = readQueue.then(() => readInvoice(invoiceId)).catch(err => console.error('[invoices] read:', err)).finally(() => { waiting.delete(invoiceId) })
}

/** At start up: invoices that were being read when the server stopped. */
export async function resumeInvoiceReading(): Promise<void> {
  const left = await prisma.vendorInvoice.findMany({ where: { status: 'reading' }, select: { id: true } })
  for (const i of left) queueRead(i.id)
}

/** Rows as kept for the review screen (words are left out: they are only needed while reading). */
const keepPage = (p: ReadPage) => ({
  page: p.page, source: p.source, image: p.image, width: p.width, height: p.height,
  rows: p.rows.map(r => ({ i: r.i, text: r.cells.join('  '), box: r.box, conf: Math.round(r.conf * 100) / 100 })),
})

/** The first bytes of a file ('' when it cannot be read). */
function fileHead(p: string): string {
  try { const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(8); fs.readSync(fd, b, 0, 8, 0); fs.closeSync(fd); return b.toString('latin1') } catch { return '' }
}

/**
 * Why an invoice that was read needs review, when it is not plain from the
 * invoice itself: a file sent as a PDF that is not one (a photo renamed
 * .pdf), or nothing on it could be read. '' otherwise.
 */
export function reviewReason(r: { files: Array<{ mime: string; head: string }>; vendorName: string | null | undefined; lines: number; rows: number }): string {
  if (r.files.some(f => f.mime === 'application/pdf' && f.head && !f.head.startsWith('%PDF'))) {
    const photo = r.files.some(f => /^\xFF\xD8|^\x89PNG/.test(f.head))
    return `This file is named .pdf but is not a PDF${photo ? ' (it is a photo)' : ''}, so nothing on it could be read. Upload it again with Pick photos, or type the vendor, number and lines in.`
  }
  if (!r.rows) return 'Nothing on this invoice could be read. Upload a clearer photo or the PDF, or type the vendor, number and lines in.'
  if (!r.vendorName && !r.lines) return 'The vendor and the lines could not be read. Type them in, or upload a clearer photo.'
  return ''
}

export async function readInvoice(invoiceId: string, engine: 'vision' | 'tesseract' = 'vision'): Promise<void> {
  const inv = await prisma.vendorInvoice.findUnique({ where: { id: invoiceId }, include: { files: { orderBy: { seq: 'asc' } } } })
  if (!inv || inv.status !== 'reading') return
  try {
    const pages: ReadPage[] = []
    let ms = 0, used: string = engine
    const engines = new Set<string>()
    for (const f of inv.files) {
      const r = await readInvoiceFile(f.path, invoiceDir(inv.accountId, inv.id, 'read', `f${f.seq}`), { engine, firstPage: pages.length + 1 })
      pages.push(...r.pages)
      ms += r.ms
      engines.add(r.engine)
    }
    used = engines.size === 1 ? [...engines][0] : engine
    const vs = await vendorState(prisma, inv.accountId)
    const parsed = parseInvoice(pages, knownVendors(vs.vendors))
    const known = findVendor(parsed.vendorName, knownVendors(vs.vendors))
    const revision = revisionOf(inv.files[0]?.fileName ?? '')
    // Why it needs review when nothing could be read: said in words on the invoice.
    const message = reviewReason({ files: inv.files.map(f => ({ mime: f.mime, head: fileHead(f.path) })), vendorName: parsed.vendorName, lines: parsed.lines.length, rows: pages.reduce((n, p) => n + p.rows.length, 0) })
    await prisma.$transaction(async (tx: any) => {
      await tx.vendorInvoiceLine.deleteMany({ where: { invoiceId } })
      await tx.vendorInvoice.update({
        where: { id: invoiceId },
        data: {
          status: 'needs_review', engine: used, readMs: ms, pages: pages.map(keepPage) as any,
          vendorName: parsed.vendorName, vendorId: known?.id ?? null, invoiceNumber: parsed.invoiceNumber, invoiceKey: invoiceNumberKey(parsed.invoiceNumber),
          invoiceDate: parsed.invoiceDate, subtotalCents: parsed.subtotalCents, taxCents: parsed.taxCents, freightCents: parsed.freightCents,
          fees: parsed.fees.map(f => ({ label: f.label, cents: f.cents, page: f.page, row: f.row, box: f.box })) as any,
          feesCents: parsed.fees.reduce((s, f) => s + f.cents, 0), totalCents: parsed.totalCents,
          problems: [] as any, message,
          docType: parsed.docType, taxFound: parsed.taxFound, taxRate: parsed.taxRate, skipped: parsed.skipped as any, revision,
        },
      })
      if (parsed.lines.length) {
        await tx.vendorInvoiceLine.createMany({
          data: parsed.lines.map((l, seq) => ({
            invoiceId, seq, page: l.page, row: l.row, box: l.box as any, raw: l.raw, itemNumber: l.itemNumber, description: l.description,
            qty: l.qty, unit: l.unit, unitPriceHc: l.unitPriceHc, totalCents: l.totalCents, conf: l.conf, problems: l.problems as any,
            matchKey: matchKey(l.itemNumber, l.description),
          })),
        })
      }
    }, { timeout: 30_000 })
    await evaluate(invoiceId, { id: inv.uploadedById, name: inv.uploadedBy })
  } catch (err: any) {
    console.error('[invoices] could not read', invoiceId, err)
    await prisma.vendorInvoice.update({ where: { id: invoiceId }, data: { status: 'failed', message: `Could not read this invoice: ${String(err?.message ?? err).slice(0, 300)}` } }).catch(() => {})
  }
}

/** The vendor's document id in a file name ("6249853 Getter Done LLC-1429376.pdf" → "1429376"). */
export function revisionOf(fileName: string): string {
  const m = /-(\d{4,})(?:\s*\(\d+\))?\.[a-z0-9]+$/i.exec(fileName)
  return m ? m[1] : ''
}

/** Which of two revisions of one quote is newer: later date, then higher document id, then uploaded later. */
export function newerRevision(a: { invoiceDate: string; revision: string; createdAt: Date }, b: { invoiceDate: string; revision: string; createdAt: Date }): boolean {
  if (a.invoiceDate !== b.invoiceDate) return a.invoiceDate > b.invoiceDate
  if (a.revision && b.revision && a.revision !== b.revision) return Number(a.revision) > Number(b.revision)
  return a.createdAt > b.createdAt
}

const treatedAsInvoice = (i: { docType: string; ordered: boolean }) => i.docType !== 'quote' || i.ordered

// ── Evaluate: checks, bill, matching, applying ───────────────────────────────

export type InvoiceProblem =
  | CheckProblem
  | { kind: 'no_vendor' }
  | { kind: 'new_vendor'; name: string }
  | { kind: 'no_number' }
  | { kind: 'no_date' }
  | { kind: 'no_tax' }

/** Run every check and apply what can be applied. Safe to run again at any time. */
export async function evaluate(invoiceId: string, actor: Actor): Promise<void> {
  const head = await prisma.vendorInvoice.findUnique({ where: { id: invoiceId }, select: { accountId: true } })
  if (!head) return
  await prisma.$transaction(async (tx: any) => {
    await lockAll(tx, head.accountId)
    await evaluateTx(tx, invoiceId, actor)
  }, { timeout: 60_000 })
}

async function evaluateTx(tx: any, invoiceId: string, actor: Actor): Promise<void> {
  const inv = await tx.vendorInvoice.findUnique({ where: { id: invoiceId }, include: { lines: { orderBy: { seq: 'asc' } } } })
  if (!inv || !['needs_review', 'needs_match', 'applied', 'quote'].includes(inv.status)) return
  const asInvoice = treatedAsInvoice(inv)
  const accountId = inv.accountId
  const vs = await vendorState(tx, accountId)
  const vendors = knownVendors(vs.vendors)

  // The vendor: one picked, or one whose name is printed on the invoice.
  let vendorId: string | null = inv.vendorId && vendors.some(v => v.id === inv.vendorId) ? inv.vendorId : null
  if (!vendorId && inv.vendorName) vendorId = findVendor(inv.vendorName, vendors)?.id ?? null
  const vendor = vendors.find(v => v.id === vendorId) ?? null

  // 0. The same document again in another file (06-251126 sent twice): same vendor, number,
  //    date, total and lines as one uploaded before. Refused, quote or invoice; only on its
  //    first check, so nothing already priced is ever refused.
  if (vendorId && inv.invoiceKey && inv.status === 'needs_review') {
    const earlier = await tx.vendorInvoice.findMany({
      where: { accountId, vendorId, invoiceKey: inv.invoiceKey, id: { not: inv.id }, createdAt: { lt: inv.createdAt }, status: { notIn: ['refused', 'failed', 'receiving', 'reading'] } },
      include: { lines: { orderBy: { seq: 'asc' } } }, orderBy: { createdAt: 'asc' },
    })
    const mine = contentKey(inv, inv.lines)
    const same = earlier.find((o: any) => contentKey(o, o.lines) === mine)
    if (same) {
      const kind = same.docType === 'quote' ? 'quote' : 'invoice'
      await tx.vendorInvoice.update({
        where: { id: inv.id },
        data: { status: 'refused', vendorId, duplicateOfId: same.id, message: `Refused: the same ${kind} ${same.invoiceNumber} from ${vendor?.name || same.vendorName} (same date, lines and total) was already uploaded on ${same.createdAt.toISOString().slice(0, 10)}${same.revision ? ` as document ${same.revision}` : ''}. Nothing was changed.` },
      })
      return
    }
  }

  // 1. Duplicate: same vendor and invoice number (quotes not ordered are revisions instead, below).
  if (vendorId && inv.invoiceKey && asInvoice) {
    const dup = await tx.vendorInvoice.findFirst({
      where: {
        accountId, vendorId, invoiceKey: inv.invoiceKey, id: { not: inv.id }, createdAt: { lt: inv.createdAt }, status: { notIn: ['refused', 'failed', 'receiving', 'reading'] },
        OR: [{ docType: { not: 'quote' } }, { ordered: true }],
      },
      orderBy: { createdAt: 'asc' },
    })
    if (dup && inv.status !== 'applied') {
      await tx.vendorInvoice.update({
        where: { id: inv.id },
        data: { status: 'refused', vendorId, duplicateOfId: dup.id, message: `Refused: invoice ${dup.invoiceNumber} from ${vendor?.name || dup.vendorName} was already uploaded on ${dup.createdAt.toISOString().slice(0, 10)}. Nothing was changed.` },
      })
      return
    }
  }

  // Revisions of a quote: the newest is kept, older ones are marked replaced.
  if (vendorId && inv.invoiceKey && !asInvoice) {
    const others = await tx.vendorInvoice.findMany({
      where: { accountId, vendorId, invoiceKey: inv.invoiceKey, id: { not: inv.id }, docType: 'quote', ordered: false, status: { in: ['quote', 'needs_review', 'needs_match'] } },
    })
    const newer = others.filter((o: any) => newerRevision(o, inv)).sort((a: any, b: any) => (newerRevision(a, b) ? -1 : 1))[0]
    if (newer) {
      await tx.vendorInvoice.update({ where: { id: inv.id }, data: { status: 'replaced', vendorId, replacedById: newer.id, message: `Replaced by a newer revision of quote ${newer.invoiceNumber}${newer.revision ? ` (${newer.revision})` : ''}.` } })
      return
    }
    for (const o of others) {
      await tx.vendorInvoice.update({ where: { id: o.id }, data: { status: 'replaced', replacedById: inv.id, message: `Replaced by a newer revision of quote ${inv.invoiceNumber}${inv.revision ? ` (${inv.revision})` : ''}.` } })
    }
  }

  // 2. Needs review: header, unclear lines, the total check.
  const problems: InvoiceProblem[] = []
  if (!vendorId) problems.push(inv.vendorName ? { kind: 'new_vendor', name: inv.vendorName } : { kind: 'no_vendor' })
  if (!inv.invoiceNumber) problems.push({ kind: 'no_number' })
  if (!inv.invoiceDate) problems.push({ kind: 'no_date' })
  const check = checkTotals(
    inv.lines.map((l: any) => ({ totalCents: l.totalCents, problems: arr(l.problems), ignored: l.ignored })),
    { subtotalCents: inv.subtotalCents, taxCents: inv.taxCents, freightCents: inv.freightCents, feesCents: inv.feesCents, totalCents: inv.totalCents },
  )
  problems.push(...check.problems)
  // No tax row printed: estimated tax is added below (Jonathan, Oct 2026), so it no longer waits.
  if (problems.length) {
    // Never applied, never half applied: nothing has changed yet for an invoice in review.
    await tx.vendorInvoice.update({ where: { id: inv.id }, data: { status: inv.status === 'applied' ? 'applied' : 'needs_review', vendorId, problems: problems as any } })
    return
  }

  // What goes into item prices: printed tax, freight and fees except fuel; estimated tax when
  // no tax was printed (the rate is kept on the document once worked out); never fuel.
  const active = inv.lines.filter((l: any) => !l.ignored)
  const fees = arr(inv.fees).map((f: any) => ({ label: String(f?.label ?? ''), cents: Number(f?.cents) || 0 }))
  const estimating = !inv.taxFound && !inv.taxOk
  let estBp: number | null = null
  if (estimating) {
    estBp = inv.estTaxBp ?? estTaxBpOf((await tx.businessState.findUnique({ where: { accountId }, select: { config: true } }))?.config)
  }
  const parts = landedParts({ linesCents: check.linesCents, taxCents: inv.taxCents, freightCents: inv.freightCents, fees, taxFound: inv.taxFound, taxOk: inv.taxOk, estTaxBp: estBp ?? 0 })
  const lineCents = active.map((l: any) => l.totalCents ?? 0)
  const spread = spreadExtras(lineCents, parts.spreadCents)
  const estShare = spreadExtras(lineCents, parts.estTaxCents)
  const extras = spread.map((c, k) => c + estShare[k])
  const estNote = parts.estTaxCents > 0 && estBp != null ? ` Includes estimated tax (${pctText(estBp)}): the document printed no tax.` : ''

  // 3. The vendor bill (a quote has none until it is ordered).
  const billId = asInvoice ? upsertBill(vs, { ...inv, estTaxBp: estBp, estTaxCents: parts.estTaxCents }, vendor!) : null
  if (asInvoice) await saveVendorState(tx, accountId, vs)

  // 4 and 5. Landed cost for every line, then match and apply.
  const links = new Map<string, any>((await tx.vendorItemLink.findMany({ where: { accountId, vendorId } })).map((k: any) => [k.key, k]))
  const invState = await tx.inventoryState.findUnique({ where: { accountId } })
  const items: any[] = arr(invState?.items).map(i => ({ ...i }))
  const byId = new Map(items.map(i => [i.id, i]))
  const limit = await jumpLimit(tx, accountId)
  const lineUpdates = new Map<string, any>()
  const ready: Array<{ line: any; data: any }> = []

  active.forEach((l: any, k: number) => {
    const data: any = { extraCents: extras[k], estTaxCents: estShare[k], landedCents: (l.totalCents ?? 0) + extras[k] }
    lineUpdates.set(l.id, data)
    if (['applied', 'waiting_ok', 'rejected', 'skipped', 'undone'].includes(l.state)) return
    if (l.state === 'quoted' && asInvoice) data.state = 'open'
    const key = l.matchKey || matchKey(l.itemNumber, l.description)
    const link = links.get(key)
    if ((l.totalCents ?? 0) <= 0) { Object.assign(data, { state: 'skipped', stateNote: 'A credit or free line: not a price.' }); return }
    if (link?.inventoryItemId === NOT_INVENTORY) { Object.assign(data, { state: 'skipped', stateNote: 'Not an Inventory item (remembered for this vendor).' }); return }
    if (!link) {
      if (inv.jobId) Object.assign(data, { state: 'skipped', stateNote: 'Job lot order: bought for the job, not matched to Inventory.' })
      else Object.assign(data, { state: 'needs_match', stateNote: '' })
      return
    }
    const item = byId.get(link.inventoryItemId)
    if (!item) { Object.assign(data, { state: 'needs_match', stateNote: 'The Inventory item it was matched to is gone. Pick it again.' }); return }
    const invQty = toInventoryQty(l.qty, { vendorPer: link.vendorPer, invPer: link.invPer })
    Object.assign(data, { inventoryItemId: item.id, inventoryName: String(item.name ?? ''), vendorPer: link.vendorPer, invPer: link.invPer, invQty })
    ready.push({ line: l, data })
  })

  // One price per Inventory item: lines for the same item are added together.
  const groups = new Map<string, Array<{ line: any; data: any }>>()
  for (const r of ready) groups.set(r.data.inventoryItemId, [...(groups.get(r.data.inventoryItemId) ?? []), r])
  let inventoryChanged = false
  for (const [itemId, rs] of groups) {
    const item = byId.get(itemId)!
    const landed = rs.reduce((s, r) => s + r.data.landedCents, 0)
    const qty = rs.reduce((s, r) => s + r.data.invQty, 0)
    const unit = unitLanded(landed, 0, qty)
    // The price as printed, per Inventory unit (before tax, freight and fees).
    const printedCents = unitLanded(rs.reduce((s, r) => s + (r.line.totalCents ?? 0), 0), 0, qty).cents
    const est = rs.some(r => r.data.estTaxCents > 0) ? estNote : ''
    const prev = itemCents(item)
    const pct = changePct(prev, unit.cents)
    for (const r of rs) Object.assign(r.data, { unitLandedCents: unit.cents, unitLandedExact: unit.exact, prevUnitCents: prev, changePct: pct })
    // A quote shows what the price would be, and changes nothing.
    if (!asInvoice) {
      for (const r of rs) Object.assign(r.data, { state: 'quoted', stateNote: `Quote only: would be ${dollars(unit.cents)}${pct == null ? '' : ` (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)`}. Nothing changes unless it is ordered.${est}` })
      continue
    }
    // An invoice older than the item's current price only goes into history, so there is nothing to OK.
    const historyOnly = newerPriceKept(item, inv.invoiceDate, printedCents)
    if (!historyOnly && needsOk(prev, unit.cents, limit)) {
      for (const r of rs) Object.assign(r.data, { state: 'waiting_ok', stateNote: `${pct! > 0 ? 'Up' : 'Down'} ${Math.abs(pct!).toFixed(1)}% from ${dollars(prev!)}: waits for an OK (limit ${limit}%).${est}` })
      continue
    }
    const applied = await applyItem(tx, inv, vendor!, item, unit, actor, false, printedCents)
    if (applied.changed) inventoryChanged = true
    for (const r of rs) Object.assign(r.data, { state: 'applied', stateNote: `${applied.note}${applied.changed ? est : ''}` })
  }

  for (const [id, data] of lineUpdates) await tx.vendorInvoiceLine.update({ where: { id }, data })
  if (inventoryChanged) await tx.inventoryState.update({ where: { accountId }, data: { items, version: { increment: 1 } } })

  const states = active.map((l: any) => lineUpdates.get(l.id)?.state ?? l.state)
  const status = !asInvoice ? 'quote' : states.includes('needs_match') ? 'needs_match' : 'applied'
  await tx.vendorInvoice.update({
    where: { id: inv.id },
    data: {
      status, vendorId, billId: billId ?? inv.billId, problems: [] as any, appliedAt: status === 'applied' && !inv.appliedAt ? new Date() : inv.appliedAt,
      estTaxBp: estimating ? estBp : null, estTaxCents: parts.estTaxCents,
    },
  })
}

/**
 * Inventory already has a price from after this document (set by hand or by a
 * later invoice): this one only goes into price history. Except when that
 * price is this document's own printed price typed in by hand early (within a
 * cent, e.g. the black dig set posts typed from 06-251126 on Oct 20): then it
 * is not newer, and the landed cost replaces it.
 */
export function newerPriceKept(item: { unitCost?: unknown; priceUpdatedAt?: unknown; priceImported?: unknown }, invoiceDate: string, printedCents: number | null): boolean {
  if (typeof item.priceUpdatedAt !== 'string' || item.priceImported || !(item.priceUpdatedAt > invoiceDate)) return false
  const prev = itemCents(item)
  return !(prev != null && printedCents != null && Math.abs(prev - printedCents) <= 1)
}

/**
 * Put one item's landed cost into Inventory (the `item` object is changed in
 * place; the caller saves the items) and write its history row.
 */
async function applyItem(tx: any, inv: any, vendor: KnownVendor, item: any, unit: { cents: number; exact: number }, actor: Actor, approved: boolean, printedCents: number | null): Promise<{ changed: boolean; note: string }> {
  const prevCents = itemCents(item)
  const prevDate = typeof item.priceUpdatedAt === 'string' ? item.priceUpdatedAt : null
  const prevImported = typeof item.priceImported === 'boolean' ? item.priceImported : null
  // Inventory already has a price from after this invoice: keep it, record this one for history.
  const newer = newerPriceKept(item, inv.invoiceDate, printedCents)
  await tx.priceHistory.create({
    data: {
      accountId: inv.accountId, inventoryItemId: item.id, vendorId: vendor.id, vendorName: vendor.name, invoiceId: inv.id,
      day: inv.invoiceDate, unitLandedCents: unit.cents, unitLandedExact: unit.exact,
      prevUnitCents: prevCents, prevPriceUpdatedAt: prevDate, prevPriceImported: prevImported,
      appliedById: actor.id, appliedBy: actor.name, approved, changedInventory: !newer,
    },
  })
  if (newer) return { changed: false, note: `Kept in price history only: Inventory has a newer price (${prevDate}).` }
  item.unitCost = unit.cents / 100
  item.priceUpdatedAt = inv.invoiceDate
  item.priceImported = false
  return { changed: true, note: prevCents == null ? `Set to ${dollars(unit.cents)}.` : `${dollars(prevCents)} → ${dollars(unit.cents)}.` }
}

/** Make or update the vendor bill for this invoice in Vendors (not once it has payments). */
function upsertBill(vs: { vendors: any[]; bills: any[] }, inv: any, vendor: KnownVendor): string {
  const id = inv.billId || `vi-${inv.id}`
  const existing = vs.bills.find(b => b?.id === id)
  if (existing && Number(existing.amountPaidCents) > 0) return id
  const v = vs.vendors.find(x => x.id === vendor.id)
  const now = new Date().toISOString()
  const lineItems = [
    ...inv.lines.filter((l: any) => !l.ignored).map((l: any, i: number) => ({
      id: `${id}-l${i}`, description: [l.itemNumber, l.description].filter(Boolean).join(' '), quantity: l.qty ?? 0,
      unitCostCents: l.unitPriceHc == null ? 0 : Math.round(l.unitPriceHc / 100), totalCents: l.totalCents ?? 0, sortOrder: i,
    })),
  ]
  const fees = arr(inv.fees)
  const bill = {
    ...(existing ?? {}),
    id, vendorId: vendor.id, vendorName: vendor.name, billNumber: inv.invoiceNumber,
    description: 'Uploaded invoice', status: existing?.status ?? 'received', lineItems,
    subtotalCents: inv.subtotalCents ?? lineItems.reduce((s: number, l: any) => s + l.totalCents, 0),
    taxCents: inv.taxCents, freightCents: inv.freightCents, feesCents: inv.feesCents,
    fees: fees.map((f: any) => ({ label: f.label, cents: f.cents })),
    totalCents: inv.totalCents, amountPaidCents: existing?.amountPaidCents ?? 0, balanceDueCents: (inv.totalCents ?? 0) - (existing?.amountPaidCents ?? 0),
    billDate: inv.invoiceDate, dueDate: addDays(inv.invoiceDate, TERMS_DAYS[v?.paymentTerms] ?? 30),
    category: 'materials', jobId: inv.jobId ?? undefined, jobName: inv.jobName ?? undefined,
    notes: [
      inv.freightCents ? `Freight ${dollars(inv.freightCents)}` : '',
      ...fees.map((f: any) => `${f.label} ${dollars(f.cents)}${isFuelFee(String(f.label ?? '')) ? ' (on this bill only, not in item prices)' : ''}`),
      inv.estTaxCents > 0 && inv.estTaxBp != null ? `No tax printed: estimated tax ${pctText(inv.estTaxBp)} (${dollars(inv.estTaxCents)}) added to the item landed costs, not to this bill` : '',
    ].filter(Boolean).join(' · '),
    estTaxCents: inv.estTaxCents > 0 ? inv.estTaxCents : undefined,
    invoiceId: inv.id, createdBy: existing?.createdBy ?? inv.uploadedBy, createdAt: existing?.createdAt ?? now, updatedAt: now,
  }
  if (existing) vs.bills = vs.bills.map(b => (b?.id === id ? bill : b))
  else vs.bills = [bill, ...vs.bills]
  return id
}

// ── What people do in review ─────────────────────────────────────────────────

export class InvoiceError extends Error { constructor(message: string, public status = 400) { super(message) } }

async function editable(invoiceId: string, accountId: string) {
  const inv = await prisma.vendorInvoice.findUnique({ where: { id: invoiceId } })
  if (!inv || inv.accountId !== accountId) throw new InvoiceError('No such invoice', 404)
  return inv
}

export interface HeaderPatch {
  vendorId?: string | null
  newVendorName?: string
  invoiceNumber?: string
  invoiceDate?: string
  subtotalCents?: number | null
  taxCents?: number
  freightCents?: number
  fees?: Array<{ label: string; cents: number }>
  totalCents?: number | null
  jobId?: string | null
  /** "No tax on this document is right." */
  taxOk?: boolean
}

/** Fix the vendor, number, date or totals (only before anything is applied). */
export async function editHeader(accountId: string, invoiceId: string, patch: HeaderPatch, actor: Actor): Promise<void> {
  const inv = await editable(invoiceId, accountId)
  const touchesMoney = ['subtotalCents', 'taxCents', 'freightCents', 'fees', 'totalCents', 'invoiceNumber', 'invoiceDate'].some(k => k in patch)
  if (touchesMoney && inv.status !== 'needs_review') throw new InvoiceError('Only an invoice in Needs review can be changed. Undo it first.', 409)
  if (!['needs_review', 'needs_match', 'applied', 'quote'].includes(inv.status)) throw new InvoiceError('This invoice cannot be changed now.', 409)
  await prisma.$transaction(async (tx: any) => {
    await lockAll(tx, accountId)
    const data: any = {}
    if (patch.newVendorName || patch.vendorId !== undefined) {
      if (inv.status !== 'needs_review') throw new InvoiceError('The vendor can only be changed in Needs review.', 409)
      const vs = await vendorState(tx, accountId)
      let v = patch.vendorId ? vs.vendors.find(x => x.id === patch.vendorId) : null
      if (patch.vendorId && !v) throw new InvoiceError('No such vendor')
      if (!v && patch.newVendorName) {
        const name = patch.newVendorName.trim().slice(0, 120)
        v = vs.vendors.find(x => normalizeName(String(x.name)) === normalizeName(name)) ?? null
        if (!v) { v = newVendor(name); vs.vendors = [v, ...vs.vendors] }
      }
      // The name printed on the invoice is remembered, so the next one is found by itself.
      if (v && inv.vendorName && normalizeName(inv.vendorName) !== normalizeName(String(v.name))) {
        const names = arr(v.invoiceNames)
        if (!names.some((n: string) => normalizeName(n) === normalizeName(inv.vendorName))) v.invoiceNames = [...names, inv.vendorName]
        v.updatedAt = new Date().toISOString()
      }
      await saveVendorState(tx, accountId, vs)
      data.vendorId = v?.id ?? null
      if (v && !inv.vendorName) data.vendorName = v.name
    }
    if (patch.invoiceNumber !== undefined) { data.invoiceNumber = patch.invoiceNumber.trim().slice(0, 40); data.invoiceKey = invoiceNumberKey(data.invoiceNumber) }
    if (patch.invoiceDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.invoiceDate)) throw new InvoiceError('The date must be YYYY-MM-DD')
      data.invoiceDate = patch.invoiceDate
    }
    if (patch.subtotalCents !== undefined) data.subtotalCents = patch.subtotalCents
    if (patch.taxCents !== undefined) data.taxCents = patch.taxCents
    if (patch.freightCents !== undefined) data.freightCents = patch.freightCents
    if (patch.fees !== undefined) { data.fees = patch.fees; data.feesCents = patch.fees.reduce((s, f) => s + f.cents, 0) }
    if (patch.totalCents !== undefined) data.totalCents = patch.totalCents
    if (patch.taxOk !== undefined) {
      // It changes landed costs, so only before anything is priced from it.
      if (!['needs_review', 'quote'].includes(inv.status)) throw new InvoiceError('"No tax is right" can only be changed before prices are applied (in Needs review or on a quote). Undo it first.', 409)
      data.taxOk = patch.taxOk
    }
    if (patch.jobId !== undefined) {
      if (patch.jobId) {
        const job = await tx.savedJob.findFirst({ where: { id: patch.jobId, accountId }, select: { id: true, customerName: true, fenceStyle: true } })
        if (!job) throw new InvoiceError('No such job')
        data.jobId = job.id
        data.jobName = [job.customerName, job.fenceStyle].filter(Boolean).join(' · ')
      } else { data.jobId = null; data.jobName = null }
    }
    await tx.vendorInvoice.update({ where: { id: invoiceId }, data })
    // A job link on a saved bill follows.
    if (data.jobId !== undefined && inv.billId) {
      const vs = await vendorState(tx, accountId)
      vs.bills = vs.bills.map(b => (b?.id === inv.billId ? { ...b, jobId: data.jobId ?? undefined, jobName: data.jobName ?? undefined, updatedAt: new Date().toISOString() } : b))
      await saveVendorState(tx, accountId, vs)
    }
    await evaluateTx(tx, invoiceId, actor)
  }, { timeout: 60_000 })
}

export interface LinePatch {
  itemNumber?: string
  description?: string
  qty?: number | null
  unit?: string
  unitPriceHc?: number | null
  totalCents?: number | null
  ignored?: boolean
  /** "I checked it against the paper": clears unclear and math (the amount is taken as printed). */
  confirm?: boolean
}

/** Fix a line by tapping it (only in Needs review), or add one that was missed. */
export async function editLine(accountId: string, invoiceId: string, lineId: string | null, patch: LinePatch, actor: Actor): Promise<string> {
  const inv = await editable(invoiceId, accountId)
  if (inv.status !== 'needs_review') throw new InvoiceError('Lines can only be fixed while the invoice is in Needs review.', 409)
  let id = lineId
  await prisma.$transaction(async (tx: any) => {
    await lockAll(tx, accountId)
    let line: any
    if (lineId) {
      line = await tx.vendorInvoiceLine.findUnique({ where: { id: lineId } })
      if (!line || line.invoiceId !== invoiceId) throw new InvoiceError('No such line', 404)
    } else {
      const last = await tx.vendorInvoiceLine.findFirst({ where: { invoiceId }, orderBy: { seq: 'desc' } })
      line = await tx.vendorInvoiceLine.create({ data: { invoiceId, seq: (last?.seq ?? -1) + 1, raw: 'Added by hand', conf: 1, edited: true } })
      id = line.id
    }
    const next = { ...line, ...Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== undefined && k !== 'confirm')) }
    if (patch.unit !== undefined) next.unit = patch.unit.trim().toUpperCase().slice(0, 12) || 'EA'
    next.edited = true
    let problems = lineProblemsFor(next)
    if (patch.confirm) problems = problems.filter(p => p !== 'unclear' && p !== 'math')
    else if (line.edited && !arr(line.problems).includes('math')) problems = problems.filter(p => p !== 'unclear')
    await tx.vendorInvoiceLine.update({
      where: { id: line.id },
      data: {
        itemNumber: next.itemNumber, description: next.description, qty: next.qty, unit: next.unit, unitPriceHc: next.unitPriceHc,
        totalCents: next.totalCents, ignored: !!next.ignored, edited: true, problems, matchKey: matchKey(next.itemNumber ?? '', next.description ?? ''),
      },
    })
    await evaluateTx(tx, invoiceId, actor)
  }, { timeout: 60_000 })
  return id!
}

export interface MatchChoice {
  inventoryItemId?: string
  newItem?: { name: string; category?: string; unitOfMeasure?: string }
  /** Not an Inventory item (freight shown as a line, a one off): remembered for this vendor. */
  notInventory?: boolean
  vendorUnit?: string
  vendorPer?: number
  invPer?: number
}

/** A line on a quote not yet ordered can have its match changed (nothing has been priced from it). */
export const canRematch = (line: { state: string }, inv: { status: string }) => inv.status === 'quote' && ['quoted', 'skipped'].includes(line.state)

/**
 * Pick the Inventory item for a vendor's item, once, with its unit. Every
 * waiting line with the same vendor item (on any invoice) follows. On a quote
 * not yet ordered a match can also be changed ("Change match"): the lines of
 * that vendor item on quotes not yet ordered follow too.
 */
export async function matchLine(accountId: string, lineId: string, choice: MatchChoice, actor: Actor, opts: { mayCreateItem: boolean }): Promise<void> {
  const line = await prisma.vendorInvoiceLine.findUnique({ where: { id: lineId }, include: { invoice: true } })
  if (!line || line.invoice.accountId !== accountId) throw new InvoiceError('No such line', 404)
  if (line.state !== 'needs_match' && !canRematch(line, line.invoice)) throw new InvoiceError('This line is not waiting for a match.', 409)
  const vendorId = line.invoice.vendorId
  if (!vendorId) throw new InvoiceError('Pick the vendor first.', 409)
  const vendorPer = choice.vendorPer ?? 1, invPer = choice.invPer ?? 1
  if (!(vendorPer > 0) || !(invPer > 0) || vendorPer > 100000 || invPer > 100000) throw new InvoiceError('The unit needs two numbers above zero.')
  const affected = new Set<string>()
  await prisma.$transaction(async (tx: any) => {
    await lockAll(tx, accountId)
    let itemId = choice.notInventory ? NOT_INVENTORY : choice.inventoryItemId
    if (!choice.notInventory && choice.newItem) {
      if (!opts.mayCreateItem) throw new InvoiceError('Your role cannot add Inventory items. Ask Jonathan.', 403)
      const name = choice.newItem.name.trim().slice(0, 200)
      if (!name) throw new InvoiceError('The new item needs a name.')
      const invState = await tx.inventoryState.findUnique({ where: { accountId } })
      const items = arr(invState?.items)
      if (items.some(i => String(i.name).trim().toLowerCase() === name.toLowerCase())) throw new InvoiceError('An Inventory item already has that name. Pick it instead.', 409)
      const item = {
        id: `inv-${uid().slice(0, 8)}`, name, unitCost: 0, category: (choice.newItem.category || 'Misc').slice(0, 80),
        unitOfMeasure: (choice.newItem.unitOfMeasure || 'each').slice(0, 20), supplier: line.invoice.vendorName, status: 'active',
      }
      if (invState) await tx.inventoryState.update({ where: { accountId }, data: { items: [...items, item], version: { increment: 1 } } })
      else await tx.inventoryState.create({ data: { accountId, items: [item], bundles: [], locations: [], stockLevels: [], transactions: [] } })
      itemId = item.id
    }
    if (!itemId) throw new InvoiceError('Pick an Inventory item.')
    if (itemId !== NOT_INVENTORY) {
      const invState = await tx.inventoryState.findUnique({ where: { accountId }, select: { items: true } })
      if (!arr(invState?.items).some(i => i.id === itemId)) throw new InvoiceError('No such Inventory item')
    }
    const key = line.matchKey || matchKey(line.itemNumber, line.description)
    await tx.vendorItemLink.upsert({
      where: { accountId_vendorId_key: { accountId, vendorId, key } },
      create: { accountId, vendorId, key, inventoryItemId: itemId, vendorUnit: line.unit, vendorPer, invPer, createdById: actor.id },
      update: { inventoryItemId: itemId, vendorUnit: line.unit, vendorPer, invPer },
    })
    const waitingLines = await tx.vendorInvoiceLine.findMany({
      where: { matchKey: key, invoice: { accountId, vendorId }, OR: [{ state: 'needs_match' }, { state: { in: ['quoted', 'skipped'] }, invoice: { status: 'quote' } }] },
      select: { id: true, invoiceId: true },
    })
    for (const w of waitingLines) { affected.add(w.invoiceId); await tx.vendorInvoiceLine.update({ where: { id: w.id }, data: { state: 'open' } }) }
    affected.add(line.invoiceId)
    for (const id of affected) await evaluateTx(tx, id, actor)
  }, { timeout: 60_000 })
}

/** "We ordered this": a vendor quote is treated as the invoice from now on (bill, prices). */
export async function markOrdered(accountId: string, invoiceId: string, actor: Actor): Promise<void> {
  const inv = await editable(invoiceId, accountId)
  if (inv.docType !== 'quote' || inv.ordered) throw new InvoiceError('Only a vendor quote not yet ordered can be marked ordered.', 409)
  if (inv.status !== 'quote') throw new InvoiceError('This quote needs review first (it must add up), or it was replaced by a newer revision.', 409)
  await prisma.$transaction(async (tx: any) => {
    await lockAll(tx, accountId)
    await tx.vendorInvoice.update({ where: { id: invoiceId }, data: { ordered: true, orderedAt: new Date(), orderedBy: actor.name, status: 'needs_match' } })
    await evaluateTx(tx, invoiceId, actor)
  }, { timeout: 60_000 })
}

/** OK (or turn down) a price change that waited because it moved more than the limit. */
export async function decideWaiting(accountId: string, lineId: string, ok: boolean, actor: Actor): Promise<void> {
  const line = await prisma.vendorInvoiceLine.findUnique({ where: { id: lineId }, include: { invoice: true } })
  if (!line || line.invoice.accountId !== accountId) throw new InvoiceError('No such line', 404)
  if (line.state !== 'waiting_ok') throw new InvoiceError('This price is not waiting for an OK.', 409)
  await prisma.$transaction(async (tx: any) => {
    await lockAll(tx, accountId)
    const inv = await tx.vendorInvoice.findUnique({ where: { id: line.invoiceId } })
    const same = await tx.vendorInvoiceLine.findMany({ where: { invoiceId: line.invoiceId, inventoryItemId: line.inventoryItemId, state: 'waiting_ok' } })
    if (!ok) {
      for (const l of same) await tx.vendorInvoiceLine.update({ where: { id: l.id }, data: { state: 'rejected', stateNote: `Turned down by ${actor.name}; the price stayed ${l.prevUnitCents == null ? 'as it was' : dollars(l.prevUnitCents)}.` } })
      return
    }
    const invState = await tx.inventoryState.findUnique({ where: { accountId } })
    const items: any[] = arr(invState?.items).map(i => ({ ...i }))
    const item = items.find(i => i.id === line.inventoryItemId)
    if (!item) throw new InvoiceError('The Inventory item is gone.', 409)
    const vs = await vendorState(tx, accountId)
    const vendor = knownVendors(vs.vendors).find(v => v.id === inv.vendorId) ?? { id: inv.vendorId, name: inv.vendorName }
    const printedQty = same.reduce((s: number, l: any) => s + (l.invQty ?? 0), 0)
    const printed = printedQty > 0 ? unitLanded(same.reduce((s: number, l: any) => s + (l.totalCents ?? 0), 0), 0, printedQty).cents : null
    const r = await applyItem(tx, inv, vendor, item, { cents: line.unitLandedCents!, exact: line.unitLandedExact ?? line.unitLandedCents! }, actor, true, printed)
    for (const l of same) await tx.vendorInvoiceLine.update({ where: { id: l.id }, data: { state: 'applied', stateNote: `OK'd by ${actor.name}. ${r.note}` } })
    if (r.changed) await tx.inventoryState.update({ where: { accountId }, data: { items, version: { increment: 1 } } })
  }, { timeout: 60_000 })
}

export interface UndoResult { restored: Array<{ name: string; back: string }>; skipped: Array<{ name: string; reason: string }> }

/** Put every price this invoice changed back, unless something newer changed it since. */
export async function undoInvoice(accountId: string, invoiceId: string, actor: Actor): Promise<UndoResult> {
  const inv = await editable(invoiceId, accountId)
  if (!['applied', 'needs_match'].includes(inv.status)) throw new InvoiceError('Only an applied invoice can be undone.', 409)
  return prisma.$transaction(async (tx: any) => {
    await lockAll(tx, accountId)
    const out: UndoResult = { restored: [], skipped: [] }
    const rows = await tx.priceHistory.findMany({ where: { invoiceId, undoneAt: null }, orderBy: { createdAt: 'asc' } })
    const invState = await tx.inventoryState.findUnique({ where: { accountId } })
    const items: any[] = arr(invState?.items).map(i => ({ ...i }))
    const byId = new Map(items.map(i => [i.id, i]))
    let changed = false
    // Rows put back, and rows that never changed Inventory, leave the history; a skipped row is still in effect.
    const done: string[] = []
    for (const row of rows) {
      if (!row.changedInventory) { done.push(row.id); continue }
      const item = byId.get(row.inventoryItemId)
      const name = String(item?.name ?? row.inventoryItemId)
      if (!item) { out.skipped.push({ name, reason: 'It is no longer in Inventory.' }); continue }
      const newer = await tx.priceHistory.findFirst({
        where: { accountId, inventoryItemId: row.inventoryItemId, undoneAt: null, changedInventory: true, createdAt: { gt: row.createdAt }, invoiceId: { not: invoiceId } },
      })
      if (newer) { out.skipped.push({ name, reason: `Changed again since, by ${newer.vendorName} on ${newer.day}. Left at ${dollars(itemCents(item) ?? 0)}.` }); continue }
      if (itemCents(item) !== row.unitLandedCents) { out.skipped.push({ name, reason: `Its price was changed by hand since (now ${dollars(itemCents(item) ?? 0)}). Left as it is.` }); continue }
      item.unitCost = (row.prevUnitCents ?? 0) / 100
      if (row.prevPriceUpdatedAt) item.priceUpdatedAt = row.prevPriceUpdatedAt
      else delete item.priceUpdatedAt
      if (row.prevPriceImported != null) item.priceImported = row.prevPriceImported
      else delete item.priceImported
      changed = true
      done.push(row.id)
      out.restored.push({ name, back: row.prevUnitCents == null ? 'no price' : dollars(row.prevUnitCents) })
    }
    await tx.priceHistory.updateMany({ where: { id: { in: done } }, data: { undoneAt: new Date() } })
    if (changed) await tx.inventoryState.update({ where: { accountId }, data: { items, version: { increment: 1 } } })
    await tx.vendorInvoiceLine.updateMany({ where: { invoiceId, state: { in: ['applied', 'waiting_ok'] } }, data: { state: 'undone' } })
    const msg = [
      out.restored.length ? `Put back: ${out.restored.map(r => `${r.name} (${r.back})`).join(', ')}.` : 'No price needed putting back.',
      ...out.skipped.map(s => `Not put back: ${s.name}. ${s.reason}`),
    ].join(' ')
    await tx.vendorInvoice.update({ where: { id: invoiceId }, data: { status: 'undone', undoneAt: new Date(), undoneBy: actor.name, message: msg } })
    return out
  }, { timeout: 60_000 })
}

/** Remove an invoice that changed no prices (refused, failed, in review, or undone), and its unpaid bill. */
export async function deleteInvoice(accountId: string, invoiceId: string): Promise<void> {
  const inv = await editable(invoiceId, accountId)
  const live = await prisma.priceHistory.count({ where: { invoiceId, undoneAt: null, changedInventory: true } })
  if (live) throw new InvoiceError('This invoice changed prices. Undo it first.', 409)
  await prisma.$transaction(async (tx: any) => {
    await lockAll(tx, accountId)
    if (inv.billId) {
      const vs = await vendorState(tx, accountId)
      const bill = vs.bills.find(b => b?.id === inv.billId)
      if (bill && !(Number(bill.amountPaidCents) > 0)) { vs.bills = vs.bills.filter(b => b?.id !== inv.billId); await saveVendorState(tx, accountId, vs) }
    }
    await tx.priceHistory.deleteMany({ where: { invoiceId } })
    await tx.vendorInvoice.delete({ where: { id: invoiceId } })
  }, { timeout: 30_000 })
  fs.rmSync(invoiceDir(accountId, invoiceId), { recursive: true, force: true })
}

/** Read again from the files (after a failure, or with the other reader). */
export async function rereadInvoice(accountId: string, invoiceId: string): Promise<void> {
  const inv = await editable(invoiceId, accountId)
  if (!['failed', 'needs_review'].includes(inv.status)) throw new InvoiceError('Only an invoice that failed or is in Needs review can be read again.', 409)
  await prisma.vendorInvoice.update({ where: { id: invoiceId }, data: { status: 'reading', message: '' } })
  queueRead(invoiceId)
}

// ── Suggestions for Needs a match (a tap still decides) ─────────────────────

const words = (s: string) => new Set(s.toLowerCase().replace(/(\d)-(\d)/g, '$1 $2').split(/[^a-z0-9/]+/).filter(w => w.length >= 2 && !['in', 'of', 'x', 'ft', 'ea'].includes(w)))

export function suggestItems(line: { itemNumber: string; description: string }, items: any[], n = 5): Array<{ id: string; name: string; why: string }> {
  // A chain link dig set post pipe, by Jonathan's rule (lib/digSetPipeMatch): first, said why.
  const rule = digSetPipeItem(line.description, items)
  const byWords = wordSuggestions(line, items.filter(i => i?.id !== rule?.item.id), rule ? n - 1 : n)
  return rule ? [{ id: String(rule.item.id), name: String(rule.item.name), why: rule.rule.why }, ...byWords] : byWords
}

function wordSuggestions(line: { itemNumber: string; description: string }, items: any[], n: number): Array<{ id: string; name: string; why: string }> {
  const want = words(line.description)
  const code = line.itemNumber.trim().toUpperCase()
  const scored = items.filter(i => i?.id && i.status !== 'discontinued').map(i => {
    if (code && String(i.sku ?? '').trim().toUpperCase() === code) return { i, s: 100, why: 'Same item number' }
    const have = words(String(i.name ?? ''))
    let hit = 0
    for (const w of want) if (have.has(w)) hit++
    const s = want.size ? (hit / Math.max(want.size, have.size)) * 50 : 0
    return { i, s, why: hit ? `${hit} word${hit === 1 ? '' : 's'} alike` : '' }
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n)
  return scored.map(x => ({ id: x.i.id, name: String(x.i.name), why: x.why }))
}

// ── Finance: vendors and totals by month ─────────────────────────────────────

/** Every bill in Vendors (typed in or uploaded), totals by vendor and month (bill date). */
export function vendorTotalsByMonth(vendors: any[], bills: any[], months = 12, now = today()): { months: string[]; rows: Array<{ vendorId: string; name: string; byMonth: Record<string, number>; totalCents: number; bills: number }> } {
  const [y, m] = now.split('-').map(Number)
  const list: string[] = []
  for (let k = months - 1; k >= 0; k--) { const d = new Date(Date.UTC(y, m - 1 - k, 1)); list.push(d.toISOString().slice(0, 7)) }
  type VendorMonths = { vendorId: string; name: string; byMonth: Record<string, number>; totalCents: number; bills: number }
  const rows = new Map<string, VendorMonths>()
  for (const v of vendors) if (v?.id) rows.set(v.id, { vendorId: v.id, name: String(v.name ?? ''), byMonth: {}, totalCents: 0, bills: 0 })
  for (const b of bills) {
    if (!b || b.status === 'void') continue
    const month = String(b.billDate ?? '').slice(0, 7)
    if (!list.includes(month)) continue
    const r: VendorMonths = rows.get(b.vendorId) ?? { vendorId: b.vendorId, name: String(b.vendorName ?? ''), byMonth: {}, totalCents: 0, bills: 0 }
    const c = Number(b.totalCents) || 0
    r.byMonth[month] = (r.byMonth[month] ?? 0) + c
    r.totalCents += c
    r.bills += 1
    rows.set(b.vendorId, r)
  }
  return { months: list, rows: [...rows.values()].sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name)) }
}
