/**
 * Commission stays with whoever sold it (Jonathan, Nov 2 2026): "COMMISSION
 * STAYS with whoever sold it when a signed job is moved. Owner can edit it by
 * hand."
 *
 * Two different things, kept apart:
 *   - Who is working it now: the rep on the quote and job (salesRep). A move
 *     changes it (lib/salesmanMove.ts); the Salesman's lists, the job page, the
 *     board, the bell and the automations read it.
 *   - Who sold it: the seller. The commission, Sales by rep and job costing's
 *     By salesman credit the seller. The sale and its commission stay together:
 *     revenue, close rate and commission all go to the same one name.
 *
 * The record: the quote's pricing JSON, written only when a signed quote is
 * moved or edited by hand (no schema change, nothing to fill in on old rows):
 *   pricing.soldBy              the seller's name. Unsold quotes never have it.
 *   pricing.commissionHandCents the commission the owner typed, integer cents.
 *
 * With no record, in order: the audit log's first signed salesmanMoved `from`
 * (a job moved before this record existed, and a job with no quote, which has
 * no pricing to hold it), else the rep.
 *
 * The hand edit: the owner (super_admin) only, on a signed quote, from the
 * quote or its job. It changes the name above, the commission figure, the
 * margin saved after it (quote and job) and a move's or repair's saved
 * commission and margin. Nothing else: no price, cost, status, contract or
 * payment schedule. hasSalesman and pricing.commissionPct stay: a change order
 * is priced from them, so they would reach what the customer pays. The
 * proposal stays as signed, its option copies too. Written to the audit log
 * with old and new.
 *
 * It holds: a signed quote's saves never change these (keepSaleRecord puts the
 * saved figures back over a phone's older copy), a move never touches a signed
 * commission, and a later move keeps the seller.
 *
 * A Salesman sees no more than before: her screens show no commission, and a
 * moved job leaves her (lib/salesScope.ts: the rep decides). The Installer gets
 * no figure (lib/costRedact.ts).
 */

import prisma from './prisma.js'
import { audit } from './auditLog.js'
import { assignees } from './leadAssign.js'
import { isSignedQuote } from './quoteLock.js'
import { quoteCommissionCents, samePerson } from './quotesFollowCustomer.js'
import { staffRoleOf } from './costRedact.js'

type Json = any

export const OWNER_ONLY_COMMISSION = 'Only the owner can change a commission.'

/** The name on a quote's record: '' with none. */
export function soldByOn(pricing: unknown): string {
  const s = (pricing as Json)?.soldBy
  return typeof s === 'string' ? s.trim() : ''
}

/** A quote's pricing with the seller written on it. */
export const pricingWithSeller = (pricing: unknown, soldBy: string): Json => ({ ...((pricing ?? {}) as Json), soldBy })

/** A quote's pricing with no record: what a new or unsold quote saves, so a copy of a signed quote never carries one. */
export function withoutSaleRecord<T>(pricing: T): T {
  if (!pricing || typeof pricing !== 'object') return pricing
  const { soldBy: _by, commissionHandCents: _hand, ...rest } = pricing as Json
  return rest as T
}

/**
 * A save of a signed quote that has a record: its copy may be older than the record, and a signed quote's figures are
 * not a save's to change. They are left as saved, so the rest of the save (a note, a name) goes through.
 */
export function keepSaleRecord(existing: { pricing?: unknown; work?: unknown }, data: Json): void {
  if (!soldByOn(existing.pricing)) return
  delete data.pricing
  delete data.gmPct
  delete data.hasSalesman
  const priced = (existing.work as Json)?.priced
  if (data.work && typeof data.work === 'object' && priced) data.work = { ...data.work, priced }
}

// ── Moved before the record existed: the audit log ──

/** Quote and job ids → the seller, from the audit log's signed moves (oldest first: the first `from` sold it). */
async function readMovedSellers(): Promise<Map<string, string>> {
  const rows = await prisma.crmAuditLog.findMany({
    where: { action: 'update', entityType: { in: ['SavedQuote', 'SavedJob'] }, newValues: { path: ['salesmanMoved', 'signed'], equals: true } },
    select: { entityId: true, newValues: true }, orderBy: { createdAt: 'asc' },
  })
  const out = new Map<string, string>()
  for (const r of rows) {
    const from = String((r.newValues as Json)?.salesmanMoved?.from ?? '').trim()
    if (r.entityId && from && !out.has(r.entityId)) out.set(r.entityId, from)
  }
  return out
}

const MOVED_FOR_MS = 60_000
let moved: { at: number; list: Promise<Map<string, string>> } | null = null

/** The list above, read at most once a minute (every quote list asks); a move forgets it. */
export function movedSellers(): Promise<Map<string, string>> {
  if (!moved || Date.now() - moved.at > MOVED_FOR_MS) moved = { at: Date.now(), list: readMovedSellers() }
  return moved.list
}

export const forgetMovedSellers = (): void => { moved = null }

/** Who sold this quote or job, for its commission and its sale. */
export function sellerOf(q: { id: string; salesRep?: string | null; pricing?: unknown }, moves: ReadonlyMap<string, string>): string {
  return soldByOn(q.pricing) || moves.get(q.id) || String(q.salesRep ?? '').trim()
}

/** Quotes as they go to the app: `soldBy` on each one sold by someone other than its rep (a name, no money). */
export async function withSoldBy<T extends { id: string; salesRep?: string | null; pricing?: unknown }>(quotes: T[]): Promise<Array<T & { soldBy?: string }>> {
  const moves = await movedSellers()
  return quotes.map(q => {
    const soldBy = sellerOf(q, moves)
    return soldBy && !samePerson(soldBy, q.salesRep) ? { ...q, soldBy } : q
  })
}

// ── The owner's hand edit ──

type HandQuote = { finalPrice: number; totalCOGS: number; pricing?: unknown; work?: unknown }

/** The saved figures with the commission set to `cents`: the margin after it, a move's or repair's copy, and the record. */
export function handCommission(q: HandQuote, cents: number, soldBy: string): { gmPct: number; pricing: Json; work?: Json } {
  const price = Math.round(q.finalPrice * 100)
  const out: { gmPct: number; pricing: Json; work?: Json } = {
    gmPct: price > 0 ? (price - Math.round(q.totalCOGS * 100) - cents) / price : 0,
    pricing: { ...pricingWithSeller(q.pricing, soldBy), commissionHandCents: cents },
  }
  const work = q.work as Json
  const p = work?.priced
  if (p && typeof p === 'object') {
    const grossMarginCents = (Number(p.grossMarginCents) || 0) + (Number(p.commissionCents) || 0) - cents
    out.work = { ...work, priced: { ...p, commissionCents: cents, grossMarginCents } }
    if (Number(p.priceCents) > 0) out.gmPct = grossMarginCents / Number(p.priceCents)
  }
  return out
}

/** Only a super_admin: stricter than the move (lib/salesmanChoice.ts isOwnerLogin), which also lets a lone admin in. */
const isSuperAdmin = (req: any): boolean => (staffRoleOf(req) ?? req.user?.role) === 'super_admin' && !!req.user?.id

const refuseNotOwner = (res: any) => res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: OWNER_ONLY_COMMISSION })

/** The quote with whether it is signed: locked, or with a quoted cost or a job made from it. */
async function quoteToEdit(accountId: string, id: string) {
  const q = await prisma.savedQuote.findFirst({ where: { id, accountId, deletedAt: null } })
  if (!q) return null
  const [job, cost] = await Promise.all([
    prisma.savedJob.findFirst({ where: { accountId, quoteId: q.id }, select: { id: true } }),
    prisma.jobQuotedCost.findUnique({ where: { accountId_quoteId: { accountId, quoteId: q.id } }, select: { id: true } }),
  ])
  return { q, signed: isSignedQuote(q, !!cost) || !!job }
}

async function commissionNow(q: NonNullable<Awaited<ReturnType<typeof quoteToEdit>>>['q']) {
  return {
    soldBy: sellerOf(q, await movedSellers()), rep: q.salesRep, commissionCents: quoteCommissionCents(q), priceCents: Math.round(q.finalPrice * 100),
    byHand: typeof (q.pricing as Json)?.commissionHandCents === 'number',
  }
}

/** GET /api/saved-quotes/:id/commission: who gets the commission and how much. The owner only. */
export async function commissionRead(req: any, res: any) {
  try {
    if (!isSuperAdmin(req)) { refuseNotOwner(res); return }
    const found = await quoteToEdit(req.user.crmAccountId, String(req.params.id))
    if (!found) { res.status(404).json({ success: false, error: 'That quote is not on file any more.' }); return }
    res.json({ success: true, data: { signed: found.signed, ...(await commissionNow(found.q)) } })
  } catch (err) {
    console.error('[commission] read error:', err)
    res.status(500).json({ success: false, error: 'Could not read the commission.' })
  }
}

/**
 * POST /api/saved-quotes/:id/commission, { to?: <login id>, commissionCents?: <whole cents> }: the owner changes who gets
 * a signed job's commission and how much. Anyone else gets a 403 and nothing changes. Only saved internal figures change.
 */
export async function commissionEdit(req: any, res: any) {
  try {
    if (!isSuperAdmin(req)) { refuseNotOwner(res); return }
    const accountId = req.user.crmAccountId
    const found = await quoteToEdit(accountId, String(req.params.id))
    if (!found) { res.status(404).json({ success: false, error: 'That quote is not on file any more.' }); return }
    const { q, signed } = found
    if (!signed) { res.status(409).json({ success: false, code: 'NOT_SIGNED', error: 'This quote is not signed. Its commission follows the Salesman.' }); return }
    const was = await commissionNow(q)
    const cents = req.body?.commissionCents === undefined ? was.commissionCents : req.body.commissionCents
    if (!Number.isInteger(cents) || cents < 0) { res.status(400).json({ success: false, error: 'The commission is an amount of $0 or more.' }); return }
    if (cents > was.priceCents) { res.status(400).json({ success: false, error: 'The commission cannot be more than the price.' }); return }
    let soldBy = was.soldBy
    if (req.body?.to !== undefined) {
      const person = (await assignees(accountId)).find(p => p.id === req.body.to)
      if (!person) { res.status(400).json({ success: false, code: 'NOT_ASSIGNABLE', error: 'The commission goes to the owner or a Salesman with an active login.' }); return }
      soldBy = person.name
    }
    if (!soldBy) { res.status(400).json({ success: false, error: 'Choose who gets the commission.' }); return }
    const fields = handCommission(q, cents, soldBy)
    const changed = await prisma.$transaction(async tx => {
      // Only if nobody saved it since it was read here.
      const r = await tx.savedQuote.updateMany({ where: { id: q.id, accountId, deletedAt: null, updatedAt: q.updatedAt }, data: fields })
      if (r.count !== 1) return false
      await tx.savedJob.updateMany({ where: { accountId, quoteId: q.id, deletedAt: null }, data: { gmPct: fields.gmPct } })
      return true
    })
    if (!changed) { res.status(409).json({ success: false, code: 'CHANGED', error: 'This quote was changed a moment ago. Nothing was changed. Look at it again.' }); return }
    const now = { soldBy, commissionCents: cents, gmPct: fields.gmPct }
    await audit(req, 'update', 'SavedQuote', q.id, { oldValues: { soldBy: was.soldBy, commissionCents: was.commissionCents, gmPct: q.gmPct }, newValues: { ...now, commissionHandEdit: true } })
    res.json({ success: true, data: { signed: true, rep: q.salesRep, priceCents: was.priceCents, byHand: true, ...now } })
  } catch (err) {
    console.error('[commission] edit error:', err)
    res.status(500).json({ success: false, error: 'Could not change the commission. Nothing was changed.' })
  }
}
