/**
 * Vendor invoices (lib/vendorInvoices.ts): the list, one invoice with its
 * pages and lines, fixing by tap, matching, OKs, Undo, price history and
 * vendor totals by month.
 *
 * Files arrive through the photo upload (routes/media.ts, kind "invoice"), so
 * they are saved on the phone first and resume after lost signal.
 *
 * Owner, admin, manager and office only ('invoices.manage'); a Salesman or
 * Installer gets 403 and nothing else. OK'ing a big price change, adding an
 * Inventory item and Undo change prices, so they also need 'prices.change'.
 */

import { Router } from 'express'
import express from 'express'
import fs from 'fs'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { can, requireCan, roleOf } from '../lib/permissions.js'
import { audit } from '../lib/auditLog.js'
import { plainZod } from '../lib/plainZod.js'
import {
  editHeader, editLine, matchLine, decideWaiting, markOrdered, undoInvoice, deleteInvoice, rereadInvoice, suggestItems, documentFinish,
  vendorTotalsByMonth, InvoiceError, NOT_INVENTORY, LIVE_STATUSES, type Actor,
} from '../lib/vendorInvoices.js'

const router = Router()
router.use(requireUser, requireAccount, requireCan('invoices.manage'))

async function actorOf(req: any): Promise<Actor> {
  const u = await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } }).catch(() => null)
  return { id: req.user.id, name: u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || req.user.email : req.user.email }
}

function fail(res: any, err: unknown, what: string) {
  if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
  if (err instanceof InvoiceError) { res.status(err.status).json({ success: false, error: err.message, ...(err.status === 403 ? { code: 'NOT_ALLOWED' } : {}) }); return }
  console.error(`[invoices] ${what}:`, err)
  res.status(500).json({ success: false, error: `Could not ${what}` })
}

const LINE_FIELDS = {
  id: true, seq: true, page: true, row: true, box: true, raw: true, itemNumber: true, description: true, qty: true, unit: true,
  unitPriceHc: true, totalCents: true, conf: true, problems: true, ignored: true, edited: true, inventoryItemId: true, inventoryName: true,
  vendorPer: true, invPer: true, invQty: true, extraCents: true, estTaxCents: true, landedCents: true, unitLandedCents: true, prevUnitCents: true,
  changePct: true, state: true, stateNote: true,
} as const

function summary(i: any) {
  const lines = i.lines ?? []
  return {
    id: i.id, status: i.status, vendorId: i.vendorId, vendorName: i.vendorName, invoiceNumber: i.invoiceNumber, invoiceDate: i.invoiceDate,
    totalCents: i.totalCents, jobId: i.jobId, jobName: i.jobName, uploadedBy: i.uploadedBy, createdAt: i.createdAt, appliedAt: i.appliedAt,
    undoneAt: i.undoneAt, message: i.message, pageCount: i.pageCount, engine: i.engine,
    docType: i.docType, ordered: i.ordered, orderedAt: i.orderedAt, orderedBy: i.orderedBy, replacedById: i.replacedById, revision: i.revision,
    taxFound: i.taxFound, taxOk: i.taxOk, taxRate: i.taxRate, estTaxBp: i.estTaxBp ?? null, estTaxCents: i.estTaxCents ?? 0, skipped: i.skipped,
    counts: {
      lines: lines.filter((l: any) => !l.ignored).length,
      applied: lines.filter((l: any) => l.state === 'applied').length,
      historyOnly: lines.filter((l: any) => l.state === 'history_only').length,
      needsMatch: lines.filter((l: any) => l.state === 'needs_match').length,
      waitingOk: lines.filter((l: any) => l.state === 'waiting_ok').length,
      problems: Array.isArray(i.problems) ? i.problems.length : 0,
    },
  }
}

// ── Lists ─────────────────────────────────────────────────────────────────────

router.get('/', async (req: any, res) => {
  try {
    const list = await prisma.vendorInvoice.findMany({
      where: { accountId: req.user.crmAccountId },
      include: { lines: { select: { state: true, ignored: true } } },
      orderBy: { createdAt: 'desc' }, take: 300,
    })
    res.json({ success: true, data: list.map(summary) })
  } catch (err) { fail(res, err, 'load the invoices') }
})

/** Prices waiting for an OK (more than the limit up or down). */
router.get('/waiting', async (req: any, res) => {
  try {
    const lines = await prisma.vendorInvoiceLine.findMany({
      where: { state: 'waiting_ok', invoice: { accountId: req.user.crmAccountId } },
      include: { invoice: { select: { id: true, vendorName: true, invoiceNumber: true, invoiceDate: true } } },
      orderBy: { createdAt: 'asc' },
    })
    res.json({ success: true, data: lines.map(l => ({ ...pick(l), invoice: l.invoice })) })
  } catch (err) { fail(res, err, 'load the prices waiting for an OK') }
})

/** Vendor items never seen before, with suggestions (a tap still decides). */
router.get('/needs-match', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const [lines, inv] = await Promise.all([
      prisma.vendorInvoiceLine.findMany({
        // Only documents still in play: an undone, replaced or refused one's lines do not count.
        where: { state: 'needs_match', invoice: { accountId, status: { in: LIVE_STATUSES } } },
        include: { invoice: { select: { id: true, vendorId: true, vendorName: true, invoiceNumber: true, invoiceDate: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.inventoryState.findUnique({ where: { accountId }, select: { items: true } }),
    ])
    const items = Array.isArray(inv?.items) ? (inv!.items as any[]) : []
    // A line with no finish word ranks by the finish of the rest of its document.
    const docLines = await prisma.vendorInvoiceLine.findMany({
      where: { invoiceId: { in: [...new Set(lines.map(l => l.invoiceId))] } },
      select: { id: true, invoiceId: true, description: true, inventoryName: true, ignored: true },
    })
    const byDoc = new Map<string, typeof docLines>()
    for (const d of docLines) byDoc.set(d.invoiceId, [...(byDoc.get(d.invoiceId) ?? []), d])
    res.json({ success: true, data: lines.map(l => ({ ...pick(l), invoice: l.invoice, suggestions: suggestItems(l, items, 5, { docFinish: documentFinish(byDoc.get(l.invoiceId) ?? [], l.id) }) })) })
  } catch (err) { fail(res, err, 'load the lines that need a match') }
})

/** Suggestions for one line (Change match on a quote line). */
router.get('/lines/:lineId/suggestions', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const line = await prisma.vendorInvoiceLine.findUnique({ where: { id: String(req.params.lineId) }, include: { invoice: { select: { accountId: true } } } })
    if (!line || line.invoice.accountId !== accountId) { res.status(404).json({ success: false, error: 'No such line' }); return }
    const [inv, docLines] = await Promise.all([
      prisma.inventoryState.findUnique({ where: { accountId }, select: { items: true } }),
      prisma.vendorInvoiceLine.findMany({ where: { invoiceId: line.invoiceId }, select: { id: true, description: true, inventoryName: true, ignored: true } }),
    ])
    // The item it is matched to now comes first (Change match); no finish word: the document's finish.
    res.json({ success: true, data: suggestItems(line, Array.isArray(inv?.items) ? (inv!.items as any[]) : [], 5, { docFinish: documentFinish(docLines, line.id) }) })
  } catch (err) { fail(res, err, 'load the suggestions') }
})

const pick = (l: any) => Object.fromEntries(Object.keys(LINE_FIELDS).map(k => [k, l[k]]))

/** Price history: one item (all vendors), or the latest changes. */
router.get('/history', async (req: any, res) => {
  try {
    const itemId = typeof req.query.itemId === 'string' ? req.query.itemId : undefined
    const rows = await prisma.priceHistory.findMany({
      where: { accountId: req.user.crmAccountId, ...(itemId ? { inventoryItemId: itemId } : {}) },
      orderBy: [{ createdAt: 'desc' }], take: itemId ? 500 : 200,
    })
    const invoiceIds = [...new Set(rows.map(r => r.invoiceId).filter(Boolean))] as string[]
    const invoices = await prisma.vendorInvoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, invoiceNumber: true, status: true } })
    const byId = new Map(invoices.map(i => [i.id, i]))
    res.json({ success: true, data: rows.map(r => ({ ...r, invoiceNumber: r.invoiceId ? byId.get(r.invoiceId)?.invoiceNumber ?? '' : '' })) })
  } catch (err) { fail(res, err, 'load the price history') }
})

/** Every vendor with its bills' totals by month (typed in or uploaded). */
router.get('/vendors-by-month', async (req: any, res) => {
  try {
    const v = await prisma.vendorState.findUnique({ where: { accountId: req.user.crmAccountId } })
    const months = Math.min(24, Math.max(1, Number(req.query.months) || 12))
    res.json({ success: true, data: vendorTotalsByMonth(Array.isArray(v?.vendors) ? v!.vendors as any[] : [], Array.isArray(v?.bills) ? v!.bills as any[] : [], months) })
  } catch (err) { fail(res, err, 'load the vendor totals') }
})

/** Jobs to link a job lot order to. */
router.get('/jobs', async (req: any, res) => {
  try {
    const jobs = await prisma.savedJob.findMany({
      where: { accountId: req.user.crmAccountId, deletedAt: null },
      select: { id: true, customerName: true, fenceStyle: true, status: true, customerAddress: true },
      orderBy: { updatedAt: 'desc' }, take: 200,
    })
    res.json({ success: true, data: jobs })
  } catch (err) { fail(res, err, 'load the jobs') }
})

// ── One invoice ───────────────────────────────────────────────────────────────

async function mine(req: any, res: any) {
  const inv = await prisma.vendorInvoice.findUnique({ where: { id: String(req.params.id) }, include: { lines: { orderBy: { seq: 'asc' } }, files: { orderBy: { seq: 'asc' } } } })
  if (!inv || inv.accountId !== req.user.crmAccountId) { res.status(404).json({ success: false, error: 'No such invoice' }); return null }
  return inv
}

router.get('/:id', async (req: any, res) => {
  try {
    const inv = await mine(req, res)
    if (!inv) return
    const history = await prisma.priceHistory.findMany({ where: { invoiceId: inv.id }, orderBy: { createdAt: 'asc' } })
    const pages = (Array.isArray(inv.pages) ? inv.pages as any[] : []).map(p => ({ page: p.page, source: p.source, width: p.width, height: p.height, rows: p.rows }))
    res.json({
      success: true,
      data: {
        ...summary(inv), subtotalCents: inv.subtotalCents, taxCents: inv.taxCents, freightCents: inv.freightCents, fees: inv.fees,
        feesCents: inv.feesCents, problems: inv.problems, readMs: inv.readMs, duplicateOfId: inv.duplicateOfId, billId: inv.billId,
        lines: inv.lines.map(pick), pages, files: inv.files.map(f => ({ id: f.id, fileName: f.fileName, mime: f.mime, bytes: f.bytes })),
        history: history.map(h => ({ id: h.id, inventoryItemId: h.inventoryItemId, unitLandedCents: h.unitLandedCents, prevUnitCents: h.prevUnitCents, approved: h.approved, changedInventory: h.changedInventory, undoneAt: h.undoneAt, appliedBy: h.appliedBy, createdAt: h.createdAt })),
      },
    })
  } catch (err) { fail(res, err, 'load the invoice') }
})

/** A page picture (what was read), to show next to the lines. */
router.get('/:id/page/:n', async (req: any, res) => {
  const inv = await mine(req, res).catch(() => null)
  if (!inv) { if (!res.headersSent) res.status(404).end(); return }
  const p = (Array.isArray(inv.pages) ? inv.pages as any[] : []).find(x => x.page === Number(req.params.n))
  if (!p?.image || !fs.existsSync(p.image)) { res.status(404).end(); return }
  res.setHeader('Content-Type', 'image/jpeg')
  res.setHeader('Cache-Control', 'private, max-age=3600')
  fs.createReadStream(p.image).pipe(res)
})

/** An uploaded file as it came. */
router.get('/:id/files/:fileId', async (req: any, res) => {
  const inv = await mine(req, res).catch(() => null)
  if (!inv) { if (!res.headersSent) res.status(404).end(); return }
  const f = inv.files.find(x => x.id === req.params.fileId)
  if (!f || !fs.existsSync(f.path)) { res.status(404).end(); return }
  res.setHeader('Content-Type', f.mime)
  res.setHeader('Content-Disposition', `inline; filename="${f.fileName.replace(/[^\w.\- ]/g, '_') || 'invoice'}"`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  fs.createReadStream(f.path).pipe(res)
})

const cents = z.number().int().min(-100_000_000).max(100_000_000)
const headerSchema = z.object({
  vendorId: z.string().max(100).nullable().optional(),
  newVendorName: z.string().min(2).max(120).optional(),
  invoiceNumber: z.string().max(40).optional(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'The date must be YYYY-MM-DD').optional(),
  subtotalCents: cents.nullable().optional(),
  taxCents: cents.optional(),
  freightCents: cents.optional(),
  fees: z.array(z.object({ label: z.string().min(1).max(60), cents })).max(20).optional(),
  totalCents: cents.nullable().optional(),
  jobId: z.string().max(100).nullable().optional(),
  taxOk: z.boolean().optional(),
})

router.patch('/:id', express.json({ limit: '64kb' }), async (req: any, res) => {
  try {
    const patch = headerSchema.parse(req.body)
    await editHeader(req.user.crmAccountId, String(req.params.id), patch, await actorOf(req))
    await audit(req, 'update', 'VendorInvoice', String(req.params.id), { newValues: patch })
    res.json({ success: true })
  } catch (err) { fail(res, err, 'save the invoice') }
})

const lineSchema = z.object({
  itemNumber: z.string().max(40).optional(),
  description: z.string().max(300).optional(),
  qty: z.number().positive().max(10_000_000).nullable().optional(),
  unit: z.string().max(12).optional(),
  unitPriceHc: z.number().int().min(-1_000_000_000).max(1_000_000_000).nullable().optional(),
  totalCents: cents.nullable().optional(),
  ignored: z.boolean().optional(),
  confirm: z.boolean().optional(),
})

router.post('/:id/lines', express.json({ limit: '64kb' }), async (req: any, res) => {
  try {
    const patch = lineSchema.parse(req.body)
    const id = await editLine(req.user.crmAccountId, String(req.params.id), null, patch, await actorOf(req))
    await audit(req, 'create', 'VendorInvoiceLine', id, { newValues: { invoiceId: req.params.id, ...patch } })
    res.json({ success: true, data: { id } })
  } catch (err) { fail(res, err, 'add the line') }
})

router.patch('/:id/lines/:lineId', express.json({ limit: '64kb' }), async (req: any, res) => {
  try {
    const patch = lineSchema.parse(req.body)
    await editLine(req.user.crmAccountId, String(req.params.id), String(req.params.lineId), patch, await actorOf(req))
    await audit(req, 'update', 'VendorInvoiceLine', String(req.params.lineId), { newValues: { invoiceId: req.params.id, ...patch } })
    res.json({ success: true })
  } catch (err) { fail(res, err, 'save the line') }
})

const matchSchema = z.object({
  inventoryItemId: z.string().max(100).optional(),
  newItem: z.object({ name: z.string().min(2).max(200), category: z.string().max(80).optional(), unitOfMeasure: z.string().max(20).optional() }).optional(),
  notInventory: z.boolean().optional(),
  vendorPer: z.number().positive().max(100000).optional(),
  invPer: z.number().positive().max(100000).optional(),
}).refine(v => !!v.inventoryItemId || !!v.newItem || v.notInventory, 'Pick an Inventory item, add one, or say it is not an Inventory item.')

router.post('/lines/:lineId/match', express.json({ limit: '64kb' }), async (req: any, res) => {
  try {
    const choice = matchSchema.parse(req.body)
    if (choice.inventoryItemId === NOT_INVENTORY) throw new InvoiceError('Pick an Inventory item.')
    await matchLine(req.user.crmAccountId, String(req.params.lineId), choice, await actorOf(req), { mayCreateItem: can(roleOf(req), 'prices.change') })
    await audit(req, 'update', 'VendorItemLink', String(req.params.lineId), { newValues: choice })
    res.json({ success: true })
  } catch (err) { fail(res, err, 'save the match') }
})

router.post('/lines/:lineId/ok', requireCan('prices.change'), async (req: any, res) => {
  try {
    await decideWaiting(req.user.crmAccountId, String(req.params.lineId), true, await actorOf(req))
    await audit(req, 'update', 'VendorInvoiceLine', String(req.params.lineId), { newValues: { decision: 'ok' } })
    res.json({ success: true })
  } catch (err) { fail(res, err, 'apply the price') }
})

router.post('/lines/:lineId/reject', requireCan('prices.change'), async (req: any, res) => {
  try {
    await decideWaiting(req.user.crmAccountId, String(req.params.lineId), false, await actorOf(req))
    await audit(req, 'update', 'VendorInvoiceLine', String(req.params.lineId), { newValues: { decision: 'rejected' } })
    res.json({ success: true })
  } catch (err) { fail(res, err, 'turn the price down') }
})

/** "We ordered this": a vendor quote becomes the invoice (bill and prices). It changes prices, so owner, admin or manager. */
router.post('/:id/ordered', requireCan('prices.change'), async (req: any, res) => {
  try {
    await markOrdered(req.user.crmAccountId, String(req.params.id), await actorOf(req))
    await audit(req, 'update', 'VendorInvoice', String(req.params.id), { newValues: { ordered: true } })
    res.json({ success: true })
  } catch (err) { fail(res, err, 'mark it ordered') }
})

router.post('/:id/undo', requireCan('prices.change'), async (req: any, res) => {
  try {
    const r = await undoInvoice(req.user.crmAccountId, String(req.params.id), await actorOf(req))
    await audit(req, 'update', 'VendorInvoice', String(req.params.id), { newValues: { undo: r } })
    res.json({ success: true, data: r })
  } catch (err) { fail(res, err, 'undo the invoice') }
})

router.post('/:id/reread', async (req: any, res) => {
  try {
    await rereadInvoice(req.user.crmAccountId, String(req.params.id))
    res.json({ success: true })
  } catch (err) { fail(res, err, 'read the invoice again') }
})

router.delete('/:id', async (req: any, res) => {
  try {
    await deleteInvoice(req.user.crmAccountId, String(req.params.id))
    await audit(req, 'delete', 'VendorInvoice', String(req.params.id))
    res.json({ success: true })
  } catch (err) { fail(res, err, 'remove the invoice') }
})

export default router
