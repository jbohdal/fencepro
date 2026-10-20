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
 * Change orders saved before this were a list in the account's key value
 * store (fencepro_changeorders, dollars); importFromKv copies them in once
 * (by id) and leaves the list as it was.
 */

import prisma from './prisma.js'
import { isSignedQuote } from './quoteLock.js'

export type ChangeOrderStatus = 'draft' | 'sent' | 'approved' | 'void'
export const CO_STATUSES: readonly ChangeOrderStatus[] = ['draft', 'sent', 'approved', 'void']

export interface ChangeOrderLine { id: string; description: string; amountCents: number }

type Row = NonNullable<Awaited<ReturnType<typeof prisma.changeOrder.findUnique>>>

const err = (status: number, message: string) => Object.assign(new Error(message), { status })

export const linesOf = (r: { lines: unknown }): ChangeOrderLine[] =>
  (Array.isArray(r.lines) ? r.lines : []).map((l: any) => ({ id: String(l?.id ?? ''), description: String(l?.description ?? ''), amountCents: Math.round(Number(l?.amountCents) || 0) }))

export const totalOf = (lines: ChangeOrderLine[]) => lines.reduce((s, l) => s + l.amountCents, 0)

/** What every phone gets: prices only (a change order has no cost in it). */
export function view(r: Row) {
  return {
    id: r.id, quoteId: r.quoteId, number: r.number, status: r.status as ChangeOrderStatus, reason: r.reason,
    lines: linesOf(r), totalCents: r.totalCents, scope: r.scope ?? null, createdBy: r.createdBy,
    sentAt: r.sentAt, approvedAt: r.approvedAt, approvedBy: r.approvedBy, voidedAt: r.voidedAt,
    version: r.version, createdAt: r.createdAt, updatedAt: r.updatedAt,
  }
}

/** Is the quote signed (Sold, accepted, or a quoted cost saved at signing)? */
export async function quoteIsSigned(accountId: string, quoteId: string): Promise<boolean> {
  const q = await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId }, select: { status: true, acceptedAt: true } })
  if (!q) return false
  if (isSignedQuote(q)) return true
  return !!(await prisma.jobQuotedCost.findUnique({ where: { accountId_quoteId: { accountId, quoteId } }, select: { id: true } }))
}

/** The approved total of a quote's change orders, in cents. */
export async function approvedTotalCents(accountId: string, quoteId: string, tx: any = prisma): Promise<number> {
  const rows = await tx.changeOrder.findMany({ where: { accountId, quoteId, status: 'approved' }, select: { totalCents: true } })
  return rows.reduce((s: number, r: { totalCents: number }) => s + r.totalCents, 0)
}

/**
 * The job for this quote gets its change order total and contract value from
 * the approved change orders (contract value = quote price + approved total).
 * Returns the job's id, or null when the quote has no job yet.
 */
export async function applyToJob(accountId: string, quoteId: string, tx: any = prisma): Promise<string | null> {
  const job = await tx.savedJob.findFirst({ where: { accountId, quoteId, archivedAt: null } })
  if (!job) return null
  const cents = await approvedTotalCents(accountId, quoteId, tx)
  const quoteCents = Math.round((job.quotePrice || 0) * 100)
  await tx.savedJob.update({ where: { id: job.id }, data: { changeOrderTotal: cents / 100, contractValue: (quoteCents + cents) / 100 } })
  return job.id
}

/** For a job save: the server's change order total and contract value, when its quote has change orders. */
export async function jobTotalsFor(accountId: string, quoteId: string | null | undefined, quotePrice: number): Promise<{ changeOrderTotal: number; contractValue: number } | null> {
  if (!quoteId) return null
  const any = await prisma.changeOrder.count({ where: { accountId, quoteId } })
  if (!any) return null
  const cents = await approvedTotalCents(accountId, quoteId)
  return { changeOrderTotal: cents / 100, contractValue: (Math.round((quotePrice || 0) * 100) + cents) / 100 }
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
  status: 'draft' | 'approved'
  by: string
}

/** Make one on a signed quote. Approved at once ("the customer agreed on site") updates the job too. */
export async function createChangeOrder(accountId: string, c: NewChangeOrder): Promise<Row> {
  if (!(await quoteIsSigned(accountId, c.quoteId))) throw err(409, 'Change orders are for signed quotes. This one is not signed: edit the quote instead.')
  if (c.id) {
    const same = await prisma.changeOrder.findUnique({ where: { id: c.id } })
    if (same) { if (same.accountId !== accountId) throw err(409, 'Invalid id'); return same } // sent twice: the first one stands
  }
  const lines = c.lines.filter(l => l.description.trim() || l.amountCents !== 0)
  if (!lines.length) throw err(400, 'Add at least one line with a description or an amount.')
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const number = await nextNumber(accountId, c.quoteId, tx)
        const row = await tx.changeOrder.create({
          data: {
            ...(c.id ? { id: c.id } : {}), accountId, quoteId: c.quoteId, number, status: c.status, reason: c.reason,
            lines: lines as any, totalCents: totalOf(lines), scope: (c.scope ?? undefined) as any, createdBy: c.by,
            ...(c.status === 'approved' ? { approvedAt: new Date(), approvedBy: c.by } : {}),
          },
        })
        if (c.status === 'approved') await applyToJob(accountId, c.quoteId, tx)
        return row
      })
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

export interface ChangeOrderEdit { reason?: string; lines?: ChangeOrderLine[]; status?: ChangeOrderStatus }

/**
 * Change one, built on `baseVersion` (refused as stale otherwise). Lines and
 * the reason change while it is a draft or sent; approved and void are final
 * (an approved one can still be voided).
 */
export async function editChangeOrder(accountId: string, id: string, baseVersion: number, edit: ChangeOrderEdit, by: string): Promise<{ row: Row; stale: boolean }> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "ChangeOrder" WHERE id = ${id} FOR UPDATE`
    const cur = await tx.changeOrder.findUnique({ where: { id } })
    if (!cur || cur.accountId !== accountId) throw err(404, 'Change order not found')
    if (cur.version !== baseVersion) return { row: cur, stale: true }
    const data: Record<string, unknown> = { version: cur.version + 1 }
    const open = cur.status === 'draft' || cur.status === 'sent'
    if (edit.lines !== undefined || edit.reason !== undefined) {
      if (!open) throw err(409, cur.status === 'approved' ? 'This change order is approved. Void it and make a new one to change it.' : 'This change order is void.')
      if (edit.lines !== undefined) {
        const lines = edit.lines.filter(l => l.description.trim() || l.amountCents !== 0)
        if (!lines.length) throw err(400, 'Add at least one line with a description or an amount.')
        data.lines = lines; data.totalCents = totalOf(lines)
      }
      if (edit.reason !== undefined) data.reason = edit.reason
    }
    if (edit.status !== undefined && edit.status !== cur.status) {
      const to = edit.status
      if (cur.status === 'void') throw err(409, 'This change order is void.')
      if (cur.status === 'approved' && to !== 'void') throw err(409, 'This change order is approved. Void it and make a new one to change it.')
      if (to === 'draft') throw err(409, 'A change order goes from draft to sent to approved.')
      data.status = to
      if (to === 'sent') data.sentAt = new Date()
      if (to === 'approved') { data.approvedAt = new Date(); data.approvedBy = by }
      if (to === 'void') data.voidedAt = new Date()
    }
    const row = await tx.changeOrder.update({ where: { id }, data: data as any })
    if (cur.status === 'approved' || row.status === 'approved') await applyToJob(accountId, cur.quoteId, tx)
    return { row, stale: false }
  }, { timeout: 15_000 })
}
