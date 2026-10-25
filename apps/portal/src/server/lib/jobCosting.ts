/**
 * Job costing: quoted vs actual (the math is in jobCostingMath.ts).
 *
 *   Quoted cost   saved once, when a quote is signed (the customer's proposal
 *                 link, the old quote link, or marked Sold in the app): the pull
 *                 sheet with its unit costs, labor, tear out, as priced.
 *   Takeoff       after install, the crew goes down the pull sheet: used,
 *                 back to the shop, back to the vendor, items added on the job,
 *                 actual labor, a photo per line. draft -> submitted -> approved.
 *   Actual cost   worked out from the takeoff on the install date's landed
 *                 costs (lib/priceHistory.ts; job lot invoices linked to the job
 *                 first) and frozen when the owner or office approves it.
 *
 * Quotes signed before this went live have no quoted cost, and jobs finished
 * before it have no takeoff: they are shown "No takeoff", never guessed.
 */

import prisma from './prisma.js'
import { markSignedNow } from './everSold.js'
import { serializeMedia } from './media.js'
import { landedCostOn, jobLotInvoiceLines } from './priceHistory.js'
import { currentWorkRow, type StoredWork } from './changeOrderWork.js'
import {
  quotedCostOf, linesFromQuoted, laborFromQuoted, actualCostOf, subPaidOf, jobLotUnitCosts, compare, partsOf, subRateFor, toCents, findItemId, qty,
  type QuotedCost, type TakeoffLine, type TakeoffLabor, type ActualCost, type UnitCost, type ReportJob, type TakeoffStatus, type PricingSettings,
} from './jobCostingMath.js'

export type TakeoffRow = NonNullable<Awaited<ReturnType<typeof prisma.jobTakeoff.findUnique>>>

const err = (status: number, message: string) => Object.assign(new Error(message), { status })

/** Today in Ocala (YYYY-MM-DD). */
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

async function settingsOf(accountId: string): Promise<{ pricing: PricingSettings; styles: any[]; items: any[] }> {
  const [b, inv] = await Promise.all([
    prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }),
    prisma.inventoryState.findUnique({ where: { accountId }, select: { items: true } }),
  ])
  const config = (b?.config ?? {}) as any
  return {
    pricing: (config.pricing && typeof config.pricing === 'object' ? config.pricing : {}) as PricingSettings,
    styles: Array.isArray(config.fenceStyles) ? config.fenceStyles : [],
    items: Array.isArray(inv?.items) ? (inv!.items as any[]) : [],
  }
}

// ── Quoted cost (at signing) ──────────────────────────────────────────────────

/**
 * Save the quote's cost as it is now, once. Called where a quote becomes
 * signed; a second call (the same signing sent twice) keeps the first.
 */
/**
 * Does a saved quoted cost belong to the option the quote is signed at? The
 * quote's style and price are the accepted option's (routes/proposal.ts
 * acceptQuote makes the quote the chosen option; Sold in the app signs it as
 * it is). A quoted cost saved for another option (Manuel Cotrich, Oct 20
 * 2026: marked Sold in the app at the white option, $6,072.01, then he signed
 * the tan option online at $7,113.83) does not.
 */
export function quotedMatchesQuote(row: { fenceStyle: string; priceCents: number }, q: { fenceStyle: string; finalPrice: number }): boolean {
  return row.fenceStyle === q.fenceStyle && row.priceCents === toCents(q.finalPrice)
}

/**
 * Save the quote's cost as signed, once. Called where a quote becomes signed;
 * a second call for the same signing keeps the first. One saved for a
 * different option than the one now signed is replaced by the accepted
 * option's (`replaced` in the log), so the job's Quoted cost is always the
 * option the customer signed.
 */
export async function snapshotQuotedCost(accountId: string, quoteId: string, signedVia: 'proposal' | 'share' | 'app', opts: { replaceMismatch?: boolean } = { replaceMismatch: true }): Promise<boolean> {
  const exists = await prisma.jobQuotedCost.findUnique({ where: { accountId_quoteId: { accountId, quoteId } }, select: { id: true, fenceStyle: true, priceCents: true } })
  const q = await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId } })
  if (!q || q.status !== 'SOLD') return false
  if (exists && (quotedMatchesQuote(exists, q) || !opts.replaceMismatch)) return false
  const s = await settingsOf(accountId)
  const snap = quotedCostOf(q as any, { inventory: s.items, pricing: s.pricing, style: s.styles.find(x => x?.name === q.fenceStyle), signedVia, signedAt: q.acceptedAt ?? new Date() })
  const data = {
    accountId, quoteId, signedVia, signedAt: new Date(snap.signedAt), fenceStyle: snap.fenceStyle, salesRep: snap.salesRep, jobType: snap.jobType,
    sections: snap.sections, footage: snap.footage, priceCents: snap.priceCents, materialCents: snap.materialCents, laborCents: snap.laborCents,
    tearOutCents: snap.tearOutCents, totalCents: snap.totalCents, lines: snap.lines as any, labor: snap.labor as any,
  }
  try {
    if (exists) {
      // Saved for another option: the accepted option's cost takes its place (only while it is still the other one).
      const n = await prisma.jobQuotedCost.updateMany({ where: { id: exists.id, fenceStyle: exists.fenceStyle, priceCents: exists.priceCents }, data: { ...data, createdAt: new Date() } })
      if (n.count === 1) {
        console.log(`[job-costing] quoted cost for quote ${quoteId} replaced: was ${exists.fenceStyle} ${exists.priceCents}c, now the accepted ${snap.fenceStyle} ${snap.priceCents}c`)
        // A takeoff started from the other option and not submitted yet follows the signed one.
        const job = await prisma.savedJob.findFirst({ where: { accountId, quoteId, deletedAt: null }, select: { id: true } })
        if (job) await rebuildDraftTakeoff(accountId, job.id, 'the signed option changed').catch(e => console.error('[job-costing] takeoff rebuild:', e))
      }
      return n.count === 1
    }
    await prisma.jobQuotedCost.create({ data })
    await markSignedNow(accountId, quoteId)
    return true
  } catch (e) {
    if ((e as any)?.code === 'P2002') return false // saved at the same moment by the other request
    throw e
  }
}

/** The same, never failing the signing it follows (a failure is logged and the job shows "No quoted cost"). */
export function snapshotAfterSigning(accountId: string, quoteId: string, signedVia: 'proposal' | 'share' | 'app'): Promise<void> {
  return snapshotQuotedCost(accountId, quoteId, signedVia).then(() => {}, e => console.error(`[job-costing] quoted cost for quote ${quoteId}:`, e))
}

type QuotedRow = NonNullable<Awaited<ReturnType<typeof prisma.jobQuotedCost.findUnique>>>
export function quotedOf(r: QuotedRow): QuotedCost {
  return {
    quoteId: r.quoteId, signedAt: r.signedAt.toISOString(), signedVia: r.signedVia, fenceStyle: r.fenceStyle, salesRep: r.salesRep, jobType: r.jobType,
    sections: r.sections, footage: r.footage, priceCents: r.priceCents, materialCents: r.materialCents, laborCents: r.laborCents, tearOutCents: r.tearOutCents,
    totalCents: r.totalCents, lines: (Array.isArray(r.lines) ? r.lines : []) as any, labor: (r.labor ?? {}) as any,
  }
}

export async function quotedCostFor(accountId: string, quoteId: string | null | undefined): Promise<QuotedCost | null> {
  if (!quoteId) return null
  const r = await prisma.jobQuotedCost.findUnique({ where: { accountId_quoteId: { accountId, quoteId } } })
  return r ? quotedOf(r) : null
}

/**
 * The quoted cost with the approved change orders on it (Oct 22 2026): the
 * cost frozen at signing plus each change order's cost difference (the new
 * work priced on the server when it was made, lib/changeOrderWork.ts), the
 * price plus the change orders, and the pull sheet lines of the work now (the
 * newest change order that changed the work). A change order typed as lines
 * only has no cost difference and changes the price only. Null as before when
 * there is no quoted cost.
 */
export async function quotedNow(accountId: string, quoteId: string | null | undefined, base?: QuotedCost | null): Promise<QuotedCost | null> {
  const quoted = base === undefined ? await quotedCostFor(accountId, quoteId) : base
  if (!quoted || !quoteId) return quoted
  const rows = await prisma.changeOrder.findMany({ where: { accountId, quoteId, status: 'approved', deletedAt: null } })
  if (!rows.length) return quoted
  const d = { materialCents: 0, laborCents: 0, tearOutCents: 0, totalCents: 0 }
  for (const r of rows) {
    const c = (r.costDelta ?? null) as any
    if (c && typeof c === 'object') for (const k of Object.keys(d) as Array<keyof typeof d>) d[k] += Math.round(Number(c[k]) || 0)
  }
  const out: QuotedCost = {
    ...quoted, priceCents: quoted.priceCents + rows.reduce((s, r) => s + r.totalCents, 0),
    materialCents: quoted.materialCents + d.materialCents, laborCents: quoted.laborCents + d.laborCents, tearOutCents: quoted.tearOutCents + d.tearOutCents, totalCents: quoted.totalCents + d.totalCents,
  }
  const cur = currentWorkRow(rows)
  if (cur) {
    const s = await settingsOf(accountId)
    const w = cur.work as unknown as StoredWork
    out.lines = (w.pullSheet ?? []).map((l, i) => ({ l, i })).filter(({ l }) => l && typeof l.item === 'string' && l.item.trim()).map(({ l, i }) => {
      const unit = toCents(l.unitCost)
      return { key: `q${i}`, part: String(l.item), inventoryItemId: findItemId(s.items, String(l.item)), qty: qty(l.qty), unitCostCents: unit, totalCostCents: typeof l.total === 'number' ? toCents(l.total) : Math.round(qty(l.qty) * unit) }
    })
    out.sections = w.sections; out.footage = Math.round(w.footage); out.fenceStyle = w.fenceStyle || out.fenceStyle
  }
  return out
}

// ── The takeoff ───────────────────────────────────────────────────────────────

export const linesOf = (t: { lines: unknown }) => (Array.isArray(t.lines) ? t.lines : []) as TakeoffLine[]
export const laborOf = (t: { labor: unknown }): TakeoffLabor => {
  const l = (t.labor && typeof t.labor === 'object' ? t.labor : {}) as any
  return { mode: l.mode === 'sub' ? 'sub' : 'crew', subUnit: l.subUnit === 'foot' ? 'foot' : 'section', subUnits: qty(l.subUnits), subPaidCents: subPaidOf(l), crew: Array.isArray(l.crew) ? l.crew : [] }
}

async function jobOf(accountId: string, jobId: string) {
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null, archivedAt: null } })
  if (!job) throw err(404, 'Job not found')
  return job
}

/**
 * Start the job's takeoff from the pull sheet as signed (or, for a quote
 * signed before job costing, the quote's pull sheet as saved). One per job:
 * starting it again, or on a second phone, returns the one.
 */
export async function startTakeoff(accountId: string, jobId: string, by: string, id: string): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.jobTakeoff.findUnique({ where: { jobId } })
  if (existing) {
    if (existing.accountId !== accountId) throw err(404, 'Job not found')
    return { id: existing.id, created: false }
  }
  const job = await jobOf(accountId, jobId)
  const taken = await prisma.jobTakeoff.findUnique({ where: { id }, select: { id: true } })
  if (taken) throw err(409, 'Invalid id')
  // The pull sheet of the work now: as signed, or the newest change order's (quotedNow).
  const quoted = await quotedNow(accountId, job.quoteId)
  let lines: TakeoffLine[]
  let labor: TakeoffLabor
  if (quoted) {
    lines = linesFromQuoted(quoted.lines, key => `${id}:${key}`)
    labor = laborFromQuoted(quoted.labor, { mode: 'sub', subUnit: 'section', subUnits: job.sections })
  } else {
    const q = job.quoteId ? await prisma.savedQuote.findFirst({ where: { id: job.quoteId, accountId } }) : null
    const s = await settingsOf(accountId)
    const sheet = Array.isArray(q?.pullSheet) ? (q!.pullSheet as any[]) : []
    lines = sheet.filter(l => l && typeof l.item === 'string' && l.item.trim()).map((l, i) => ({
      id: `${id}:q${i}`, key: `q${i}`, part: String(l.item), inventoryItemId: findItemId(s.items, String(l.item)), plannedQty: qty(l.qty), usedQty: qty(l.qty),
      shopReturnQty: 0, vendorReturnQty: 0, extra: false, reason: '', note: '', photoClientId: null,
    }))
    const mode = ((q?.pricing as any)?.laborMode ?? s.pricing.laborMode) === 'subcontractor' ? 'sub' : 'crew'
    labor = { mode, subUnit: ((q?.pricing as any)?.subUnit ?? s.pricing.subUnit) === 'foot' ? 'foot' : 'section', subUnits: mode === 'sub' ? job.sections : 0, crew: [] }
  }
  try {
    await prisma.jobTakeoff.create({
      data: { id, accountId, jobId, quoteId: job.quoteId, installDate: job.completedDate || job.scheduledDate || today(), lines: lines as any, labor: labor as any, startedBy: by || null },
    })
    return { id, created: true }
  } catch (e) {
    if ((e as any)?.code === 'P2002') {
      const row = await prisma.jobTakeoff.findUnique({ where: { jobId } })
      if (row && row.accountId === accountId) return { id: row.id, created: false }
    }
    throw e
  }
}

/**
 * Does a takeoff list the parts of the work as signed? False when its planned
 * lines (not the ones added on the job) are a different pull sheet: started
 * from another option (Manuel Cotrich's, Oct 22 2026: white vinyl parts on a
 * tan job).
 */
export function takeoffMatchesQuoted(t: { lines: unknown }, quoted: QuotedCost | null): boolean {
  if (!quoted) return true
  const planned = linesOf(t).filter(l => !l.extra).map(l => `${l.part}|${l.plannedQty}`).sort()
  const want = quoted.lines.map(l => `${l.part}|${l.qty}`).sort()
  return planned.length === want.length && planned.every((x, i) => x === want[i])
}

/**
 * A takeoff still in draft whose lines are not the signed work: its lines and
 * labor made again from the signed pull sheet (what startTakeoff would make
 * now). Submitted or approved takeoffs are never changed. True when rebuilt.
 */
export async function rebuildDraftTakeoff(accountId: string, jobId: string, why: string): Promise<boolean> {
  const t = await prisma.jobTakeoff.findUnique({ where: { jobId } })
  if (!t || t.accountId !== accountId || t.status !== 'draft') return false
  const job = await jobOf(accountId, jobId)
  const quoted = await quotedNow(accountId, job.quoteId)
  if (!quoted || takeoffMatchesQuoted(t, quoted)) return false
  const lines = linesFromQuoted(quoted.lines, key => `${t.id}:${key}`)
  const labor = laborFromQuoted(quoted.labor, { mode: 'sub', subUnit: 'section', subUnits: job.sections })
  const n = await prisma.jobTakeoff.updateMany({ where: { id: t.id, status: 'draft' }, data: { lines: lines as any, labor: labor as any, installDate: job.completedDate || job.scheduledDate || t.installDate, note: `${t.note ? `${t.note}\n` : ''}Lines made again from the signed quote (${quoted.fenceStyle}): ${why}.`.slice(0, 2000) } })
  if (n.count === 1) console.log(`[job-costing] draft takeoff ${t.id} rebuilt from the signed quote (${quoted.fenceStyle}): ${why}`)
  return n.count === 1
}

/** Change one takeoff under a row lock (two phones saving at once never lose each other's line). */
export async function mutateTakeoff<T>(accountId: string, id: string, fn: (t: TakeoffRow, tx: any) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "JobTakeoff" WHERE id = ${id} FOR UPDATE`
    const t = await tx.jobTakeoff.findUnique({ where: { id } })
    if (!t || t.accountId !== accountId) throw err(404, 'Takeoff not found')
    return fn(t, tx)
  }, { timeout: 15_000 })
}

/**
 * The takeoff as every phone sees it: quantities only, never a cost (for the
 * crew, the owner and the office alike; costs are on the job's comparison).
 */
export async function takeoffView(t: TakeoffRow) {
  const lines = linesOf(t)
  const ids = lines.map(l => l.photoClientId).filter((x): x is string => !!x)
  const media = ids.length ? await prisma.mediaItem.findMany({ where: { clientId: { in: ids }, deletedAt: null } }) : []
  return {
    id: t.id, jobId: t.jobId, status: t.status as TakeoffStatus, installDate: t.installDate, note: t.note,
    lines: lines.map(l => ({ id: l.id, key: l.key, part: l.part, inventoryItemId: l.inventoryItemId, plannedQty: l.plannedQty, usedQty: l.usedQty, shopReturnQty: l.shopReturnQty, vendorReturnQty: l.vendorReturnQty, extra: !!l.extra, reason: l.reason || '', note: l.note || '', photoClientId: l.photoClientId ?? null })),
    labor: laborOf(t),
    startedBy: t.startedBy, submittedAt: t.submittedAt, submittedBy: t.submittedBy, approvedAt: t.approvedAt, approvedBy: t.approvedBy, updatedAt: t.updatedAt,
    media: Object.fromEntries(media.map(m => { const s = serializeMedia(m); return [m.clientId, { id: s.id, url: s.url, thumbUrl: s.thumbUrl, markupUrl: s.markupUrl, visibility: s.visibility }] })),
  }
}

// ── Actual cost ───────────────────────────────────────────────────────────────

/** Each line's landed unit cost on the install date: job lot invoice first, then price history / Inventory, then the quote's. */
export async function unitCostsFor(accountId: string, jobId: string, lines: TakeoffLine[], day: string, quoted: QuotedCost | null): Promise<(l: TakeoffLine) => UnitCost> {
  const jobLot = jobLotUnitCosts(await jobLotInvoiceLines(accountId, jobId))
  const ids = [...new Set(lines.map(l => l.inventoryItemId).filter((x): x is string => !!x))]
  const landed = new Map<string, UnitCost>()
  for (const itemId of ids) {
    if (jobLot.has(itemId)) continue
    const c = await landedCostOn(accountId, itemId, day)
    if (c) landed.set(itemId, { cents: c.cents, source: c.source, ...(c.invoiceId ? { invoiceId: c.invoiceId } : {}) })
  }
  const fromQuote = new Map((quoted?.lines ?? []).map(l => [l.key, l.unitCostCents]))
  return l => {
    if (l.inventoryItemId && jobLot.has(l.inventoryItemId)) return jobLot.get(l.inventoryItemId)!
    if (l.inventoryItemId && landed.has(l.inventoryItemId)) return landed.get(l.inventoryItemId)!
    if (l.key && fromQuote.has(l.key)) return { cents: fromQuote.get(l.key)!, source: 'quote' }
    return { cents: 0, source: 'none' }
  }
}

/** The actual cost of a takeoff now (a preview until approved). */
export async function actualNow(accountId: string, t: TakeoffRow, quoted: QuotedCost | null, otherLaborCostCents: number, frozen: boolean): Promise<ActualCost> {
  const lines = linesOf(t)
  const s = await settingsOf(accountId)
  const day = t.installDate || today()
  const unitCostOf = await unitCostsFor(accountId, t.jobId, lines, day, quoted)
  const job = await prisma.savedJob.findUnique({ where: { id: t.jobId }, select: { fenceStyle: true } })
  // Settings' rates of today are only the fallback for a job with no quoted cost: with one, the
  // sub rate and hourly rate saved at signing are used (jobCostingMath actualCostOf).
  return actualCostOf({ lines, labor: laborOf(t), installDate: day }, {
    quoted, unitCostOf, hourlyCostCents: toCents(s.pricing.manHourRate), subRateCostCents: toCents(subRateFor(s.styles.find(x => x?.name === job?.fenceStyle), s.pricing)),
    otherLaborCostCents, frozen,
  })
}

/** The frozen actual cost of an approved takeoff, or the preview of one not approved yet. */
export async function actualFor(accountId: string, t: TakeoffRow, quoted: QuotedCost | null): Promise<ActualCost> {
  if (t.status === 'approved' && t.actualCost && typeof t.actualCost === 'object') return t.actualCost as unknown as ActualCost
  return actualNow(accountId, t, quoted, 0, false)
}

/** Quoted vs actual for one job (owner and office only). */
export async function jobComparison(accountId: string, jobId: string) {
  const job = await jobOf(accountId, jobId)
  const quoted = await quotedNow(accountId, job.quoteId)
  const t = await prisma.jobTakeoff.findUnique({ where: { jobId } })
  const takeoff = t && t.accountId === accountId ? t : null
  const actual = takeoff ? await actualFor(accountId, takeoff, quoted) : null
  const priceCents = toCents(job.contractValue) || quoted?.priceCents || toCents(job.quotePrice)
  return {
    jobId, quoteId: job.quoteId, fenceStyle: job.fenceStyle, salesRep: job.salesRep,
    hasQuoted: !!quoted, quotedSignedAt: quoted?.signedAt ?? null,
    takeoff: takeoff ? { id: takeoff.id, status: takeoff.status, installDate: takeoff.installDate, approvedAt: takeoff.approvedAt, approvedBy: takeoff.approvedBy } : null,
    comparison: compare(quoted, actual, priceCents),
    actualCost: actual,
  }
}

// ── The report ────────────────────────────────────────────────────────────────

const DONE = ['completed', 'invoiced', 'paid'] as const

/** Every completed job (and any with a takeoff): quoted vs actual, "No takeoff" where there is none. */
export async function reportJobs(accountId: string, from?: string, to?: string): Promise<ReportJob[]> {
  const [jobs, takeoffs, quotedRows] = await Promise.all([
    prisma.savedJob.findMany({ where: { accountId, deletedAt: null } }),
    prisma.jobTakeoff.findMany({ where: { accountId } }),
    prisma.jobQuotedCost.findMany({ where: { accountId } }),
  ])
  const tByJob = new Map(takeoffs.map(t => [t.jobId, t]))
  const qByQuote = new Map(quotedRows.map(q => [q.quoteId, quotedOf(q)]))
  // Quotes with approved change orders: their quoted cost and price include them (quotedNow).
  const withChanges = new Set((await prisma.changeOrder.findMany({ where: { accountId, status: 'approved', deletedAt: null }, select: { quoteId: true } })).map(r => r.quoteId))
  const out: ReportJob[] = []
  for (const j of jobs) {
    const t = tByJob.get(j.id) ?? null
    if (!t && !(DONE as readonly string[]).includes(j.status)) continue
    const signedCost = j.quoteId ? qByQuote.get(j.quoteId) ?? null : null
    const quoted = signedCost && withChanges.has(j.quoteId!) ? await quotedNow(accountId, j.quoteId, signedCost) : signedCost
    const day = t?.installDate || j.completedDate || j.scheduledDate || j.updatedAt.toISOString().slice(0, 10)
    const month = day.slice(0, 7)
    if (from && month < from.slice(0, 7)) continue
    if (to && month > to.slice(0, 7)) continue
    const approved = t?.status === 'approved' && t.actualCost && typeof t.actualCost === 'object' ? (t.actualCost as unknown as ActualCost) : null
    out.push({
      jobId: j.id, customerName: j.customerName, fenceStyle: j.fenceStyle, salesRep: j.salesRep || quoted?.salesRep || '', month,
      priceCents: toCents(j.contractValue) || quoted?.priceCents || toCents(j.quotePrice),
      quotedCents: quoted ? quoted.totalCents : null,
      actualCents: approved ? approved.totalCents : null,
      takeoff: t ? (t.status as TakeoffStatus) : 'none',
      parts: t?.status === 'approved' ? partsOf(linesOf(t)) : [],
    })
  }
  return out.sort((a, b) => b.month.localeCompare(a.month) || a.customerName.localeCompare(b.customerName))
}

/**
 * For the P&L: crew labor of approved takeoffs, by install date. Only crew
 * hours: materials reach the P&L through vendor bills and a sub's pay through
 * the sub's bill, so adding those here would count them twice.
 */
export async function financeLabor(accountId: string) {
  const ts = await prisma.jobTakeoff.findMany({ where: { accountId, status: 'approved' } })
  return ts.filter(t => laborOf(t).mode === 'crew').map(t => {
    const a = (t.actualCost ?? {}) as unknown as ActualCost
    return { jobId: t.jobId, quoteId: t.quoteId, installDate: a.installDate || t.installDate, crewLaborCostCents: Math.max(0, (a.laborCents ?? 0)) }
  })
}
