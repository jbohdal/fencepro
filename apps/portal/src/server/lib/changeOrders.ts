/**
 * Change orders on signed quotes (Oct 2026). A signed quote is locked
 * (lib/quoteLock.ts); added or removed fence, gates or a style change are a
 * change order instead: lines with descriptions and amounts in integer cents
 * (a credit is negative), a status, and a version.
 *
 *   draft     made, not shown to the customer yet
 *   sent      shown to the customer
 *   approved  the customer agreed: its total is added to the job's contract value
 *   void      dropped (an approved one voided comes off the contract value again)
 *
 * The job's changeOrderTotal and contractValue (SavedJob, dollars) are kept by
 * the server from the approved change orders (applyToJob), so a job page, job
 * costing and the final invoice all read the same figure.
 *
 * The customer sees a change order once it is sent: in the customer portal
 * (routes/portal.ts, their own quotes only) and on its own link
 * /p/co/<token> (routes/changeOrderPublic.ts), the way proposals reach them.
 * "Approve and sign" there (signByCustomer) records the typed name, the drawn
 * signature, the time, IP and browser, and approves it exactly as the office
 * does (applyToJob). Nothing is texted or emailed by the server: the office
 * sends the link from its own phone.
 *
 * Change orders saved before this were a list in the account's key value
 * store (fencepro_changeorders, dollars); importFromKv copies them in once
 * (by id) and leaves the list as it was.
 */

import crypto from 'crypto'
import prisma from './prisma.js'
import { isSignedQuote } from './quoteLock.js'
import { priceWork, costDeltaOf, scopeOf, workChangeable, approvedInOrder, daysFor, startOfChange, effectiveWork, requestForShape, openNotice, rebuildJobWork, type StoredWork, type WorkInput } from './changeOrderWork.js'
import { shapeOf, sameShape, ownChangeWords, ownLineWords } from './changeOrderMerge.js'

/**
 * needs_ok: made by a Salesman (round 2, Oct 26 2026). It waits for the
 * owner's or the office's OK (it becomes a draft) before it can go to the
 * customer: not sent, no link, not signed on the phone, so never billed.
 */
export type ChangeOrderStatus = 'needs_ok' | 'draft' | 'sent' | 'approved' | 'void'
export const CO_STATUSES: readonly ChangeOrderStatus[] = ['needs_ok', 'draft', 'sent', 'approved', 'void']
export const WAITING_OK = 'This change order waits for Jonathan or the office to OK it before it goes to the customer.'

/**
 * A line: what changes and its amount. A line picked from the pick list
 * (lib/changeOrderPicks.ts, Oct 22 2026) also keeps its quantity and where it
 * came from, for history: "repair:<key>[:walk|double]" (the Repair price list)
 * or "catalog:<Inventory item id>", the job's style it was priced for and the
 * price the list gave (its amount may have been changed by hand since).
 */
export interface ChangeOrderLine { id: string; description: string; amountCents: number; qty?: number; source?: LineSource | null }
export interface LineSource { kind: 'repair' | 'catalog'; ref: string; label: string; fenceStyle?: string; listCents?: number }

type Row = NonNullable<Awaited<ReturnType<typeof prisma.changeOrder.findUnique>>>

const err = (status: number, message: string) => Object.assign(new Error(message), { status })

function sourceOf(s: any): LineSource | null {
  if (!s || typeof s !== 'object' || (s.kind !== 'repair' && s.kind !== 'catalog') || typeof s.ref !== 'string' || !s.ref) return null
  return {
    kind: s.kind, ref: s.ref.slice(0, 200), label: String(s.label ?? '').slice(0, 300),
    ...(typeof s.fenceStyle === 'string' && s.fenceStyle ? { fenceStyle: s.fenceStyle.slice(0, 200) } : {}),
    ...(Number.isInteger(s.listCents) ? { listCents: s.listCents } : {}),
  }
}

export const linesOf = (r: { lines: unknown }): ChangeOrderLine[] =>
  (Array.isArray(r.lines) ? r.lines : []).map((l: any) => {
    const qty = Number(l?.qty), source = sourceOf(l?.source)
    return {
      id: String(l?.id ?? ''), description: String(l?.description ?? ''), amountCents: Math.round(Number(l?.amountCents) || 0),
      ...(Number.isInteger(qty) && qty > 0 ? { qty } : {}), ...(source ? { source } : {}),
    }
  })

/**
 * The lines as they are shown and signed (round 3 recheck, Oct 26 2026): a
 * fence line written with the whole fence before and after ("146 ft to 156
 * ft") says the change order's own sides instead ("Left side 40 ft → 50 ft"),
 * true whichever open change order is signed first. Once the customer signed,
 * the lines are what they signed (kept at signing, signIn).
 */
export function shownLines(r: { lines: unknown; work?: unknown; signedAt?: Date | null }): ChangeOrderLine[] {
  const lines = linesOf(r)
  if (r.signedAt) return lines
  const sides = ownChangeWords(r.work)
  return sides ? lines.map(l => ({ ...l, description: ownLineWords(l.description, sides) })) : lines
}

type Sib = { id: string; number: number; status: string; work?: unknown; createdAt: Date; approvedAt: Date | null; voidedAt: Date | null; signedAt?: Date | null; deletedAt?: Date | null }

/**
 * The other change orders whose change is in this one's drawing: the ones
 * still open (or not yet approved or voided) when it was drawn (it starts from
 * the drawing with every open one's change in it, lib/changeOrderWork.ts
 * startOfChange). Its picture shows their sides too, so the customer is told
 * which parts are not part of this change order, and whether each is signed.
 */
export function alsoInDrawing(r: Sib, siblings: Sib[]): Array<{ number: number; status: string; signed: boolean; change: string | null }> {
  const w = r.work as any
  if (!w || typeof w !== 'object' || !w.base) return []
  const made = new Date(r.createdAt).getTime()
  return siblings
    .filter(s => s.id !== r.id && !s.deletedAt && s.work && typeof s.work === 'object' && new Date(s.createdAt).getTime() < made
      && (!s.approvedAt || new Date(s.approvedAt).getTime() > made) && (!s.voidedAt || new Date(s.voidedAt).getTime() > made)
      && !(s.status === 'void' && !s.voidedAt))
    .sort((a, b) => a.number - b.number)
    .map(s => ({ number: s.number, status: s.status, signed: s.status === 'approved', change: ownChangeWords(s.work) }))
}

/** "The drawing also shows CO-1's change (Left side 40 ft → 50 ft): not part of this change order (CO-1, not signed yet)." */
export function alsoInDrawingWords(also: ReturnType<typeof alsoInDrawing>): string[] {
  return also.map(a => {
    const state = a.status === 'void' ? 'cancelled: it will not be built' : a.signed ? 'signed separately' : 'not signed yet'
    return `The drawing also shows CO-${a.number}'s change${a.change ? ` (${a.change})` : ''}: not part of this change order (CO-${a.number}, ${state}).`
  })
}

/** A line as the customer sees it: what changes, how many and the amount (never where it was picked from). */
const customerLine = ({ source, ...l }: ChangeOrderLine) => { void source; return l }

export const totalOf = (lines: ChangeOrderLine[]) => lines.reduce((s, l) => s + l.amountCents, 0)

/**
 * Whole dollar lines (Jonathan, Oct 21 2026): each amount made or changed from
 * now on is rounded down to the whole dollar (a credit to the larger whole
 * dollar credit), so the cents never go on the customer. Change orders already
 * saved keep their amounts until their lines are changed.
 */
export const wholeDollarLine = (l: ChangeOrderLine): ChangeOrderLine => ({ ...l, amountCents: Math.floor(Math.round(l.amountCents) / 100) * 100 })

/** A warranty as kept on a change order: its name and words. */
const warrantyOf = (w: unknown) => (w && typeof w === 'object' ? { name: String((w as any).name ?? ''), text: String((w as any).text ?? '') } : null)

/**
 * The new work for every phone: quantities only (the pull sheet without a
 * cost), the yard as drawn and its plan, so the install packet and the site
 * plan follow it. Never a cost.
 */
export function workView(w: unknown) {
  if (!w || typeof w !== 'object') return null
  const x = w as StoredWork
  return {
    fenceStyle: x.fenceStyle, runs: x.runs, runRails: x.runRails, corners: x.corners, ends: x.ends, walkGates: x.walkGates, dblGates: x.dblGates,
    tearOutSections: x.tearOutSections, tearOutGates: x.tearOutGates, sections: x.sections, footage: x.footage, layout: x.layout ?? null, planSvg: x.planSvg ?? null,
    pullSheet: (Array.isArray(x.pullSheet) ? x.pullSheet : []).filter(l => !l.moneyOnly).map(l => ({ item: l.item, qty: l.qty })),
  }
}

/** Signed by the customer, or still waiting for their signature (sent, or approved verbally by the office). */
export const needsSignature = (r: { status: string; signedAt: Date | null }) => r.status === 'sent' || (r.status === 'approved' && !r.signedAt)

/** What every phone gets: prices only (a change order has no cost in it; costDelta is added for owner and office by the route). */
export function view(r: Row, siblings: Row[] = []) {
  return {
    id: r.id, quoteId: r.quoteId, number: r.number, status: r.status as ChangeOrderStatus, reason: r.reason,
    lines: shownLines(r), totalCents: r.totalCents,
    // Its own change side by side, and the other change orders its drawing also shows (round 3 recheck).
    change: ownChangeWords(r.work), alsoInDrawing: alsoInDrawing(r, siblings), scope: r.scope ?? null, createdBy: r.createdBy,
    sentAt: r.sentAt, approvedAt: r.approvedAt, approvedBy: r.approvedBy, voidedAt: r.voidedAt,
    signedBy: r.signedBy ?? null, signedAt: r.signedAt ?? null, signedVia: r.signedVia ?? null, hasLink: !!r.shareToken,
    verbalBy: r.verbalBy ?? null, verbalAt: r.verbalAt ?? null, verbalReason: r.verbalReason ?? null, contractRev: r.contractRev ?? null,
    work: workView(r.work),
    // The job's work after it, when its change was put on another change order's (rebuildJobWork); else its own.
    jobWork: r.work && typeof r.work === 'object' && (r.work as any).applied ? workView((r.work as any).applied) : null,
    warrantyBefore: warrantyOf(r.warrantyBefore), warrantyAfter: warrantyOf(r.warrantyAfter),
    version: r.version, createdAt: r.createdAt, updatedAt: r.updatedAt,
  }
}

export interface ContractAround {
  beforeCents: number
  afterCents: number
  /** The signed quote's price, in cents. */
  quoteCents: number
  /** The change orders already in "before" (approved before this one), in the order approved. */
  earlier: Array<{ number: number; totalCents: number }>
  /** Contract adjustments on the payment schedule already in "before", in cents. */
  adjustmentsCents: number
}

/**
 * The customer's contract total before this change order and with it, in
 * cents: the signed price, the change orders approved before it (by contract
 * revision; all approved ones for one not approved yet) and the contract
 * adjustments on the payment schedule. Null for a void one. The customer's
 * page shows "Your contract: $X now, $Y with this change" (round 2 review,
 * Oct 26 2026: it said only "adds $1,138").
 */
export async function contractAround(r: Row, quotePrice: number | null | undefined, asOf: Date | null = null): Promise<ContractAround | null> {
  if (r.status === 'void') return null
  const others = await prisma.changeOrder.findMany({ where: { accountId: r.accountId, quoteId: r.quoteId, status: 'approved', deletedAt: null, id: { not: r.id } }, select: { number: true, totalCents: true, contractRev: true } })
  const mine = r.status === 'approved' ? r.contractRev ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
  const earlier = others.filter(o => (o.contractRev ?? 0) < mine).sort((a, b) => (a.contractRev ?? 0) - (b.contractRev ?? 0) || a.number - b.number)
  const before = earlier.reduce((s, o) => s + o.totalCents, 0)
  const jobs = (await prisma.savedJob.findMany({ where: { accountId: r.accountId, quoteId: r.quoteId, deletedAt: null }, select: { id: true } })).map(j => j.id)
  const quoteCents = Math.round((quotePrice ?? 0) * 100)
  // asOf (the signed PDF): only the adjustments made by then, so it says what the customer saw when signing.
  const adjustmentsCents = await adjustmentsOf(prisma, r.accountId, jobs, asOf)
  const base = quoteCents + before + adjustmentsCents
  return { beforeCents: base, afterCents: base + r.totalCents, quoteCents, earlier: earlier.map(o => ({ number: o.number, totalCents: o.totalCents })), adjustmentsCents }
}

/** What the customer sees: the lines, amounts and total; never who made it, a cost, the IP or the signature image. */
export function customerView(r: Row, q?: { fenceStyle?: string | null; finalPrice?: number | null; customerName?: string | null } | null, contract: ContractAround | null = null) {
  return {
    id: r.id, number: r.number, status: r.status as ChangeOrderStatus, reason: r.reason, lines: shownLines(r).map(customerLine), totalCents: r.totalCents,
    sentAt: r.sentAt, approvedAt: r.approvedAt, voidedAt: r.voidedAt, signedBy: r.signedBy ?? null, signedAt: r.signedAt ?? null,
    // Approved verbally with the office: it is part of the contract, and still waits for the customer's own signature.
    needsSignature: needsSignature(r), contractRev: r.contractRev ?? null,
    warrantyBefore: warrantyOf(r.warrantyBefore), warrantyAfter: warrantyOf(r.warrantyAfter),
    quote: q ? { fenceStyle: q.fenceStyle ?? '', priceCents: Math.round((q.finalPrice ?? 0) * 100) } : null,
    contract,
  }
}

/** The customer's change orders: sent, approved, and void ones they were shown. */
export const CUSTOMER_VISIBLE = { OR: [{ status: 'sent' }, { status: 'approved' }, { status: 'void', sentAt: { not: null } }] }

/** The change orders on a portal customer's own quotes (the quote's contact is the customer), newest quote first. */
export async function changeOrdersForContact(contactId: string) {
  if (typeof contactId !== 'string' || !contactId) return [] // never "every quote"
  const quotes = await prisma.savedQuote.findMany({
    where: { crmContactId: contactId, deletedAt: null, archivedAt: null },
    select: { id: true, accountId: true, fenceStyle: true, finalPrice: true, customerName: true },
  })
  if (!quotes.length) return []
  const rows = await prisma.changeOrder.findMany({
    where: { AND: [{ OR: quotes.map(q => ({ accountId: q.accountId, quoteId: q.id })) }, CUSTOMER_VISIBLE, { deletedAt: null }] },
    orderBy: [{ createdAt: 'desc' }],
  })
  const byId = new Map(quotes.map(q => [q.id, q]))
  return Promise.all(rows.map(async r => customerView(r, byId.get(r.quoteId), await contractAround(r, byId.get(r.quoteId)?.finalPrice))))
}

/** The link to send the customer: made once, kept (32 random bytes, base64url). Draft or sent change orders only get a new one. */
export async function linkFor(accountId: string, id: string): Promise<{ token: string; row: Row }> {
  const row = await prisma.changeOrder.findUnique({ where: { id } })
  if (!row || row.accountId !== accountId) throw err(404, 'Change order not found')
  if (row.status === 'needs_ok') throw err(409, WAITING_OK)
  if (row.shareToken) return { token: row.shareToken, row }
  if (row.status === 'void') throw err(409, 'This change order is void.')
  const token = crypto.randomBytes(24).toString('base64url')
  const n = await prisma.changeOrder.updateMany({ where: { id, shareToken: null }, data: { shareToken: token } })
  const now = (await prisma.changeOrder.findUnique({ where: { id } }))!
  return { token: n.count ? token : now.shareToken!, row: now }
}

export async function byLink(token: string): Promise<Row | null> {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return null
  return prisma.changeOrder.findFirst({ where: { shareToken: token } }).catch(() => null)
}

export interface CustomerSignature { name: string; signature: string; ip: string | null; userAgent: string | null; via: 'portal' | 'link' | 'in_person'; witness?: string | null }

/**
 * The customer approves and signs a change order: approved (as the office
 * approves one: applyToJob puts its total on the job's contract value), with
 * the typed name, the signature, the time, IP and browser. The same signature
 * sent again (the answer was lost) stands; a different one is refused.
 *
 * Sent ones are signed on the link or in the portal; in person (the office's
 * phone handed to the customer) a draft can be signed too. One approved
 * verbally by the office is signed the same way: it stays approved (approved
 * at, by, the contract revision as they were) and gets the customer's
 * signature.
 */
export async function signByCustomer(accountId: string, id: string, s: CustomerSignature): Promise<{ row: Row; again: boolean }> {
  const out = await signIn(accountId, id, s)
  // Whoever made it, and the owner and the office, are told it was signed (lib/changeOrderNotices.ts).
  if (!out.again) { const { signedNotice } = await import('./changeOrderNotices.js'); await signedNotice(out.row) }
  // The signed change order PDF, stored once with the signed record (lib/signedDocuments.ts); a repeat makes it if the first try did not.
  const { fileSignedChangeOrder } = await import('./signedDocuments.js')
  await fileSignedChangeOrder(out.row.id).catch(e => console.error('[change-orders] signed file:', e))
  return out
}

async function signIn(accountId: string, id: string, s: CustomerSignature): Promise<{ row: Row; again: boolean }> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "ChangeOrder" WHERE id = ${id} FOR UPDATE`
    const cur = await tx.changeOrder.findUnique({ where: { id } })
    if (!cur || cur.accountId !== accountId) throw err(404, 'This change order is not available.')
    if (cur.status === 'approved' && cur.signedAt && cur.signedBy === s.name && cur.signedVia === s.via) return { row: cur, again: true }
    if (cur.status === 'approved' && cur.signedAt) throw err(409, 'This change order is already approved.')
    if (cur.status === 'void') throw err(409, 'This change order was cancelled. Please call us.')
    if (cur.status === 'needs_ok') throw err(409, WAITING_OK)
    const verbal = cur.status === 'approved' // approved verbally: signed now, everything else as it was
    if (!verbal && cur.status !== 'sent' && !(cur.status === 'draft' && s.via === 'in_person')) throw err(409, 'This change order is not ready to sign yet. Please call us.')
    const now = new Date()
    // The words they were shown are the words they sign (the signed PDF and the record keep them).
    const shown = shownLines(cur)
    const signed = {
      signedBy: s.name, signature: s.signature, signedAt: now, signedIp: s.ip?.slice(0, 100) ?? null, signedUserAgent: s.userAgent?.slice(0, 500) ?? null, signedVia: s.via,
      ...(JSON.stringify(shown) !== JSON.stringify(linesOf(cur)) ? { lines: shown as any } : {}),
    }
    const row = await tx.changeOrder.update({
      where: { id },
      data: verbal
        ? { ...signed, version: cur.version + 1 }
        : {
          status: 'approved', approvedAt: now, approvedBy: s.via === 'in_person' && s.witness ? `${s.name} (customer, in person with ${s.witness})` : `${s.name} (customer)`,
          ...signed, version: cur.version + 1,
        },
    })
    if (!verbal) await applyToJob(accountId, cur.quoteId, tx, { id, by: s.name })
    return { row: (await tx.changeOrder.findUnique({ where: { id } })) ?? row, again: false }
  }, { timeout: 15_000 })
}

/** Is the quote signed (Sold, accepted, or a quoted cost saved at signing)? */
export async function quoteIsSigned(accountId: string, quoteId: string): Promise<boolean> {
  const q = await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId }, select: { status: true, acceptedAt: true, soldAt: true } })
  if (!q) return false
  if (isSignedQuote(q)) return true
  return !!(await prisma.jobQuotedCost.findUnique({ where: { accountId_quoteId: { accountId, quoteId } }, select: { id: true } }))
}

/** The approved total of a quote's change orders, in cents. */
export async function approvedTotalCents(accountId: string, quoteId: string, tx: any = prisma): Promise<number> {
  const rows = await tx.changeOrder.findMany({ where: { accountId, quoteId, status: 'approved', deletedAt: null }, select: { totalCents: true } })
  return rows.reduce((s: number, r: { totalCents: number }) => s + r.totalCents, 0)
}

/**
 * The job for this quote gets its change order total and contract value from
 * the approved change orders (contract value = quote price + approved total).
 * Returns the job's id, or null when the quote has no job yet.
 */
export async function applyToJob(accountId: string, quoteId: string, tx: any = prisma, changed: { id: string; by?: string } | null = null): Promise<string | null> {
  const rows = await tx.changeOrder.findMany({ where: { accountId, quoteId, deletedAt: null } })
  // Contract revisions: rev 1 is the contract as signed; each change order gets the next one when it is approved, and keeps it.
  let rev = Math.max(1, ...rows.map((r: Row) => r.contractRev ?? 0))
  for (const r of approvedInOrder(rows as Row[])) if (!r.contractRev) { rev++; await tx.changeOrder.update({ where: { id: r.id }, data: { contractRev: rev } }); r.contractRev = rev }
  const job = await tx.savedJob.findFirst({ where: { accountId, quoteId, deletedAt: null, archivedAt: null } })
  if (!job) return null
  const cents = await approvedTotalCents(accountId, quoteId, tx)
  const quoteCents = Math.round((job.quotePrice || 0) * 100)
  const adj = await adjustmentsOf(tx, accountId, [job.id])
  const contract = (quoteCents + cents + adj) / 100
  const data: Record<string, unknown> = { changeOrderTotal: cents / 100, contractValue: contract }
  // The work: the newest approved change order that changed it, else the quote as signed. The job's scope
  // and crew days follow (about 15 sections a day; days typed by hand move by the same difference).
  if (rows.some((r: Row) => r.work)) {
    // Rebuilt from the signed quote and every approved change order's own change, in the order approved
    // (lib/changeOrderWork.ts rebuildJobWork): signing two in any order never drops one's change.
    const cur = (await rebuildJobWork(accountId, quoteId, tx)).work
    const q = cur ? null : await tx.savedQuote.findFirst({ where: { id: quoteId, accountId } })
    const w = cur ? cur : q ? { fenceStyle: q.fenceStyle, sections: q.sections, footage: (Array.isArray(q.runs) ? q.runs as number[] : []).reduce((s, f) => s + (Number(f) > 0 ? Number(f) : 0), 0), walkGates: q.walkGates, dblGates: q.dblGates, tearOutSections: q.tearOutSections } : null
    if (w) {
      const oldAuto = daysFor(job.sections), newAuto = daysFor(w.sections)
      Object.assign(data, {
        fenceStyle: w.fenceStyle || job.fenceStyle, sections: w.sections, totalFeet: Math.round(w.footage), walkGates: w.walkGates, dblGates: w.dblGates, tearOutSections: w.tearOutSections,
        estimatedDays: !job.estimatedDays || job.estimatedDays === oldAuto ? newAuto : Math.max(1, job.estimatedDays + newAuto - oldAuto),
      })
      await tx.scheduledGridJob.updateMany({ where: { accountId, stagingJobId: job.id, deletedAt: null }, data: { sections: w.sections } })
    }
  }
  await tx.savedJob.update({ where: { id: job.id }, data })
  await tx.scheduledGridJob.updateMany({ where: { accountId, stagingJobId: job.id, deletedAt: null }, data: { jobPrice: contract } })
  // The job's payment schedule: its Final follows the change orders, logged (lib/contractBilling.ts); after the
  // Final is paid, an increase is its own invoice (lib/contractBilling.ts billChangeOrderIn).
  const { finalFollowsChangeOrders } = await import('./contractBilling.js')
  await finalFollowsChangeOrders(tx, accountId, job.id, { userId: null, name: changed?.by || 'Change order' }, changed?.id ?? null)
  return job.id
}

/** Contract amount adjustments on the payment schedule (owner/admin, logged; lib/contractBilling.ts addAdjustment), in cents. */
async function adjustmentsOf(db: any, accountId: string, jobIds: string[], asOf: Date | null = null): Promise<number> {
  if (!jobIds.length) return 0
  const r = await db.contractAdjustment.aggregate({ where: { accountId, jobId: { in: jobIds }, ...(asOf ? { createdAt: { lte: asOf } } : {}) }, _sum: { amountCents: true } })
  return r._sum.amountCents ?? 0
}

/** For a job save: the server's change order total and contract value (quote price + approved change orders + adjustments), when its quote has either. */
export async function jobTotalsFor(accountId: string, quoteId: string | null | undefined, quotePrice: number): Promise<{ changeOrderTotal: number; contractValue: number } | null> {
  if (!quoteId) return null
  const any = await prisma.changeOrder.count({ where: { accountId, quoteId, deletedAt: null } })
  const jobs = (await prisma.savedJob.findMany({ where: { accountId, quoteId, deletedAt: null }, select: { id: true } })).map(j => j.id)
  const adj = await adjustmentsOf(prisma, accountId, jobs)
  if (!any && !adj) return null
  const cents = any ? await approvedTotalCents(accountId, quoteId) : 0
  return { changeOrderTotal: cents / 100, contractValue: (Math.round((quotePrice || 0) * 100) + cents + adj) / 100 }
}

/** The quote a job is for (a job page asks by job). */
export async function quoteOfJob(accountId: string, jobId: string): Promise<string | null> {
  const j = await prisma.savedJob.findFirst({ where: { id: jobId, accountId }, select: { quoteId: true } })
  return j?.quoteId ?? null
}

// ── Change orders saved before (the key value list) ─────────────────────────

const OLD_STATUS: Record<string, ChangeOrderStatus> = { PENDING: 'draft', APPROVED: 'approved', VOIDED: 'void' }

/** Copy the old list's change orders in, once each (by id). The list itself is left as it was. */
export async function importFromKv(accountId: string): Promise<number> {
  const kv = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: 'fencepro_changeorders' } } }).catch(() => null)
  const list = Array.isArray(kv?.value) ? (kv!.value as any[]) : []
  if (!list.length) return 0
  // all rows: an id taken by a deleted change order is still taken.
  const have = new Set((await prisma.changeOrder.findMany({ where: { accountId, id: { in: list.map(o => String(o?.id ?? '')) } }, select: { id: true } })).map(r => r.id))
  let made = 0
  for (const o of list) {
    if (!o || typeof o.id !== 'string' || !o.id || have.has(o.id) || typeof o.quoteId !== 'string' || !o.quoteId) continue
    const lines: ChangeOrderLine[] = (Array.isArray(o.items) ? o.items : []).map((i: any, n: number) => ({
      id: String(i?.id ?? `l${n}`), description: String(i?.description ?? ''), amountCents: Math.round((Number(i?.amount) || 0) * 100),
    }))
    const status = OLD_STATUS[String(o.status)] ?? 'draft'
    const number = Number.isInteger(o.orderNumber) && o.orderNumber > 0 ? o.orderNumber : 1
    try {
      await prisma.changeOrder.create({
        data: {
          id: o.id, accountId, quoteId: o.quoteId, number: await freeNumber(accountId, o.quoteId, number), status, reason: String(o.reason ?? ''),
          lines: lines as any, totalCents: totalOf(lines), approvedBy: o.approvedBy || null, approvedAt: status === 'approved' ? new Date() : null,
          createdBy: 'imported',
        },
      })
      made++
      if (status === 'approved') await applyToJob(accountId, o.quoteId)
    } catch (e) {
      if ((e as any)?.code !== 'P2002') throw e
    }
  }
  return made
}

async function freeNumber(accountId: string, quoteId: string, want: number): Promise<number> {
  const taken = await prisma.changeOrder.findFirst({ where: { accountId, quoteId, number: want }, select: { id: true } })
  return taken ? nextNumber(accountId, quoteId) : want
}

export async function nextNumber(accountId: string, quoteId: string, tx: any = prisma): Promise<number> {
  const last = await tx.changeOrder.findFirst({ where: { accountId, quoteId }, orderBy: { number: 'desc' }, select: { number: true } })
  return (last?.number ?? 0) + 1
}

// ── Saving ───────────────────────────────────────────────────────────────────

export interface NewChangeOrder {
  id?: string
  quoteId: string
  reason: string
  lines: ChangeOrderLine[]
  scope: unknown
  status: 'needs_ok' | 'draft' | 'approved'
  by: string
  /** From the yard drawing: the work after the change, priced on the server. */
  work?: WorkInput | null
  /** Approved at once, verbally (owner and office): why. */
  verbalReason?: string | null
}

/** The verbal approval's reason: required, kept short. */
function verbalReasonOf(r: string | null | undefined): string {
  const t = (r ?? '').trim()
  if (t.length < 3) throw err(400, 'Say why it is approved without the customer\'s signature (for example: "Customer agreed on the phone").')
  return t.slice(0, 500)
}

/**
 * The work after the change, its cost difference and the warranty switch,
 * worked out before the change order is saved (lib/changeOrderWork.ts).
 */
async function workPart(accountId: string, quoteId: string, input: WorkInput): Promise<Record<string, unknown>> {
  const q = await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId } })
  if (!q) throw err(404, 'Quote not found')
  if (!workChangeable(q)) return {}
  const priced = await priceWork(accountId, q, input)
  // It starts from the work with every signed and every still open change order's change in it
  // (round 3, Oct 26 2026: a second one drawn from the signed quote dropped the first one's change).
  const start = await startOfChange(accountId, quoteId)
  const last = start?.steps[start.steps.length - 1]
  let before: any = q
  if (start && last) {
    const known = effectiveWork(last.row) as any
    before = sameShape(shapeOf(known), start.shape) ? known
      : await priceWork(accountId, q, { request: requestForShape(start.shape, start.like), layout: start.shape.yard ? { yard: start.shape.yard } : null, planSvg: null })
  }
  const base = shapeOf(before)
  const after = { ...priced, base }
  const notice = start ? openNotice('This change order', start, { number: 0, base, work: shapeOf(priced) }) : null
  const out: Record<string, unknown> = { work: after, costDelta: await costDeltaOf(accountId, q, before, priced), scope: scopeOf(before, priced), ...(notice ? { notice } : {}) }
  // No dig <-> dig set: the warranty that goes with the install changes too, and the customer signs the new words.
  const styleBefore = String(before?.fenceStyle ?? q.fenceStyle)
  if (after.fenceStyle && after.fenceStyle !== styleBefore) {
    const { pricingModule } = await import('./estimates.js')
    const { effectiveQuoteWarranty } = await import('./warranties.js')
    const m = await pricingModule()
    const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const was = m.styleWarranty(b?.config ?? null, styleBefore, null), now = m.styleWarranty(b?.config ?? null, after.fenceStyle, null)
    if (now && (!was || was.id !== now.id)) {
      const current = (await effectiveQuoteWarranty(q as any, q.fenceStyle, b?.config ?? null)).warranty ?? was
      if (!current || current.name !== now.name || current.text !== now.text) { out.warrantyBefore = current ?? null; out.warrantyAfter = now }
    }
  }
  return out
}

/** Make one on a signed quote. Approved at once (verbally, with a reason) updates the job too. */
export async function createChangeOrder(accountId: string, c: NewChangeOrder): Promise<Row & { notice?: string }> {
  if (!(await quoteIsSigned(accountId, c.quoteId))) throw err(409, 'Change orders are for signed quotes. This one is not signed: edit the quote instead.')
  if (c.id) {
    const same = await prisma.changeOrder.findUnique({ where: { id: c.id } })
    if (same) { if (same.accountId !== accountId) throw err(409, 'Invalid id'); return same } // sent twice: the first one stands
  }
  const lines = linesOf({ lines: c.lines }).map(wholeDollarLine).filter(l => l.description.trim() || l.amountCents !== 0)
  if (!lines.length) throw err(400, 'Add at least one line with a description or an amount.')
  const verbal = c.status === 'approved' ? verbalReasonOf(c.verbalReason) : null
  const { notice, ...extra } = c.work ? await workPart(accountId, c.quoteId, c.work) : {} as Record<string, unknown>
  const said = (r: Row) => (typeof notice === 'string' ? Object.assign(r, { notice }) : r)
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const number = await nextNumber(accountId, c.quoteId, tx)
        const now = new Date()
        const row = await tx.changeOrder.create({
          data: {
            ...(c.id ? { id: c.id } : {}), accountId, quoteId: c.quoteId, number, status: c.status, reason: c.reason,
            lines: lines as any, totalCents: totalOf(lines), scope: (c.scope ?? undefined) as any, createdBy: c.by,
            ...(extra as any),
            ...(verbal ? { approvedAt: now, approvedBy: c.by, verbalBy: c.by, verbalAt: now, verbalReason: verbal } : {}),
          },
        })
        if (c.status === 'approved') await applyToJob(accountId, c.quoteId, tx, { id: row.id, by: c.by })
        return said((await tx.changeOrder.findUnique({ where: { id: row.id } })) ?? row)
      }, { timeout: 20_000 })
    } catch (e) {
      // Two made at the same moment took the same number: try the next one.
      if ((e as any)?.code === 'P2002' && attempt < 3) {
        if (c.id) { const same = await prisma.changeOrder.findUnique({ where: { id: c.id } }); if (same && same.accountId === accountId) return same }
        continue
      }
      throw e
    }
  }
}

/**
 * The reason for the change, typed by whoever makes the change order (owner,
 * office or Salesman): required, at least 3 letters (Oct 26 2026: "Replace the
 * generic 'Why' with a required reason"). The customer sees it on their link,
 * the signing sheet and the signed PDF under "Why". Null: it will do.
 */
export const REASON_REQUIRED = 'Type the reason for the change (the customer sees it), e.g. Customer asked for a gate on the left side.'
export function reasonProblem(reason: unknown): string | null {
  return String(reason ?? '').trim().length >= 3 ? null : REASON_REQUIRED
}

export interface ChangeOrderEdit { reason?: string; lines?: ChangeOrderLine[]; status?: ChangeOrderStatus; verbalReason?: string }

export const CHANGED_NEEDS_OK = 'Your change sends it back to Jonathan or the office to OK before it goes to the customer.'

/**
 * Change one, built on `baseVersion` (refused as stale otherwise). Lines and
 * the reason change while it is a draft or sent; approved and void are final
 * (an approved one can still be voided). The office approves one verbally,
 * with a reason (the customer's own signature comes later).
 */
export async function editChangeOrder(accountId: string, id: string, baseVersion: number, edit: ChangeOrderEdit, by: string, opts: { needsOk?: boolean } = {}): Promise<{ row: Row; stale: boolean; backToOk?: boolean }> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "ChangeOrder" WHERE id = ${id} FOR UPDATE`
    const cur = await tx.changeOrder.findUnique({ where: { id } })
    if (!cur || cur.accountId !== accountId) throw err(404, 'Change order not found')
    if (cur.version !== baseVersion) return { row: cur, stale: true }
    const data: Record<string, unknown> = { version: cur.version + 1 }
    const open = cur.status === 'needs_ok' || cur.status === 'draft' || cur.status === 'sent'
    let backToOk = false
    if (edit.lines !== undefined || edit.reason !== undefined) {
      if (!open) throw err(409, cur.status === 'approved' ? 'This change order is approved. Void it and make a new one to change it.' : 'This change order is void.')
      let changed = false
      if (edit.lines !== undefined) {
        const lines = linesOf({ lines: edit.lines }).map(wholeDollarLine).filter(l => l.description.trim() || l.amountCents !== 0)
        if (!lines.length) throw err(400, 'Add at least one line with a description or an amount.')
        data.lines = lines; data.totalCents = totalOf(lines)
        // The lines as shown (shownLines) sent back unchanged are no change either.
        changed = JSON.stringify(lines) !== JSON.stringify(linesOf(cur)) && JSON.stringify(lines) !== JSON.stringify(shownLines(cur))
      }
      if (edit.reason !== undefined) {
        const reason = edit.reason.trim()
        if (reasonProblem(reason)) throw err(400, REASON_REQUIRED)
        data.reason = reason; changed = changed || reason !== cur.reason
      }
      // A Salesman's change to the lines, prices or words of one already OK'd (a draft or sent) sends it
      // back to "Waiting for OK" (round 2 review, Oct 26 2026: her edit stayed OK'd and could be signed).
      if (opts.needsOk && changed && cur.status !== 'needs_ok') {
        if (edit.status !== undefined && edit.status !== 'void' && edit.status !== cur.status) throw err(409, CHANGED_NEEDS_OK)
        data.status = 'needs_ok'
        backToOk = true
      }
    }
    if (edit.status !== undefined && edit.status !== cur.status && !(backToOk && edit.status !== 'void')) {
      const to = edit.status
      if (cur.status === 'void') throw err(409, 'This change order is void.')
      if (cur.status === 'approved' && to !== 'void') throw err(409, 'This change order is approved. Void it and make a new one to change it.')
      // The OK (owner or office; the route checks): waiting for the OK, then a draft that can go to the customer.
      if (to === 'draft' && cur.status !== 'needs_ok') throw err(409, 'A change order goes from draft to sent to approved.')
      if (to === 'sent' && cur.status === 'needs_ok') throw err(409, WAITING_OK)
      data.status = to
      if (to === 'sent') data.sentAt = new Date()
      if (to === 'approved') { const now = new Date(); Object.assign(data, { approvedAt: now, approvedBy: by, verbalBy: by, verbalAt: now, verbalReason: verbalReasonOf(edit.verbalReason) }) }
      if (to === 'void') data.voidedAt = new Date()
    }
    const row = await tx.changeOrder.update({ where: { id }, data: data as any })
    if (cur.status === 'approved' || row.status === 'approved') await applyToJob(accountId, cur.quoteId, tx, { id, by })
    return { row: (await tx.changeOrder.findUnique({ where: { id } })) ?? row, stale: false, backToOk: backToOk && row.status === 'needs_ok' }
  }, { timeout: 15_000 })
}
