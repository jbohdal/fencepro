/**
 * The owner changes the Salesman on one quote, or on one job, to fix a wrong
 * pick (Jonathan, Oct 29 2026): "Make sure tonight's Salesman choice lets me
 * (owner only) change the salesman from the customer page AND from a single
 * quote, including a signed one, to fix a wrong pick. Changing a signed
 * job's salesman asks first and moves its commission too, with a History
 * note. Christa can't change it."
 *
 *   - Who: the owner only (lib/salesmanChoice.ts isOwnerLogin, by role as D4
 *     finds him). The routes refuse everyone else with a 403.
 *   - Which: the quote's Sales rep, the Sales rep of every job made from it,
 *     and the name on the quoted cost saved at signing (JobQuotedCost; job
 *     costing falls back to it). Nothing else: the price, the cost, the
 *     margin, the commission switch (hasSalesman), the status, the signed
 *     documents and the payment schedule stay exactly as they were. The
 *     commission is a share of the price the quote carries
 *     (quoteCommissionCents), so with the rep changed it is credited to the
 *     new person wherever commission is grouped by person: Sales by rep, the
 *     board, the quote list, the job page, job costing.
 *   - The customer's own Salesman does not change (that is the customer
 *     page's Change, lib/leadAssign.ts).
 *   - Unsold (Draft, Sent, Lost, never sold, no job): moved at once. Signed,
 *     sold, accepted, or with a job: answered first with the question (who
 *     from, who to, and the commission it carries, in cents, for the owner's
 *     eyes only) and moved when asked again with `confirm`.
 *   - Written down: a History line on the customer, with no money (the
 *     Salesman reads the History), and the amounts in cents in the audit log
 *     (by the route).
 *   - Who sees it: every remembered Salesman scope is forgotten; the new
 *     Salesman has the quote and its job on the next request, the old one
 *     no longer does, even if the old one wrote it or the customer is still
 *     the old one's: the rep on a quote or job decides (lib/salesScope.ts,
 *     Oct 29 2026). What the old one's phone held is put back on its next
 *     save (lib/salesServed.ts).
 */

import prisma from './prisma.js'
import { assignees } from './leadAssign.js'
import { isSignedQuote } from './quoteLock.js'
import { quoteCommissionCents, samePerson } from './quotesFollowCustomer.js'
import { forgetAllScopes } from './salesScope.js'
import { audit } from './auditLog.js'
import { enteringName, OWNER_ONLY_SALESMAN, requestIsOwner } from './salesmanChoice.js'

import { SALESMAN_MOVED_NOTE_PREFIX } from './salesRep.js'
export { SALESMAN_MOVED_NOTE_PREFIX }

export interface SalesmanMoved {
  quoteId: string | null
  jobIds: string[]
  from: string
  to: string
  signed: boolean
  /** The customer's price, unchanged (integer cents). */
  priceCents: number
  /** The commission the quote carries, credited now to `to` (integer cents). */
  commissionCents: number
}

export type MoveAnswer =
  | { ok: true; already: boolean; moved: SalesmanMoved }
  | { ok: false; status: number; code: string; error: string; confirm?: { from: string; to: string; signed: true; commissionCents: number; question: string } }

const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The question the owner answers before a signed job's Salesman changes (the amount is for the owner only). */
export function confirmQuestion(from: string, to: string, commissionCents: number): string {
  const was = from.trim() || 'nobody'
  return commissionCents > 0
    ? `This job is signed. Move it and its ${dollars(commissionCents)} commission from ${was} to ${to}?`
    : `This job is signed. Move it from ${was} to ${to}? It carries no commission.`
}

/** "quote #DFFD02": the quote's number as the quote window shows it (web quoteNumber.ts: the last 6 of its id, capitals). */
export const quoteWords = (q: { id: string }): string => `quote #${q.id.slice(-6).toUpperCase()}`

/** The History line: no money (the Salesman reads it). */
export function movedNote(what: string, from: string, to: string, by: string, signed: boolean): string {
  const was = from.trim() || 'nobody'
  return `${SALESMAN_MOVED_NOTE_PREFIX}${what} changed from ${was} to ${to} by ${by} (${signed ? 'signed job; its commission went with it' : 'not sold yet; its commission goes with it'}). The customer's own Salesman is unchanged.`
}

/**
 * Give one quote (and every job made from it) to `toUserId`, an owner or
 * Salesman login. The caller has checked the person is the owner.
 */
export async function moveSalesman(input: { accountId: string; quoteId?: string; jobId?: string; toUserId: string; by: { id: string | null; name: string }; confirm?: boolean }): Promise<MoveAnswer> {
  const { accountId } = input
  const job = input.jobId ? await prisma.savedJob.findFirst({ where: { id: input.jobId, accountId, deletedAt: null } }) : null
  if (input.jobId && !job) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'That job is not on file any more.' }
  const quoteId = input.quoteId ?? job?.quoteId ?? null
  const quote = quoteId ? await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId, deletedAt: null } }) : null
  if (input.quoteId && !quote) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'That quote is not on file any more.' }
  const target = (await assignees(accountId)).find(p => p.id === input.toUserId)
  if (!target) return { ok: false, status: 400, code: 'NOT_ASSIGNABLE', error: 'The Salesman is the owner or a Salesman with an active login.' }

  const jobs = quote
    ? await prisma.savedJob.findMany({ where: { accountId, quoteId: quote.id, deletedAt: null }, select: { id: true, salesRep: true } })
    : [{ id: job!.id, salesRep: job!.salesRep }]
  const from = (quote ? quote.salesRep : job!.salesRep) || ''
  const hasCost = quote ? !!(await prisma.jobQuotedCost.findUnique({ where: { accountId_quoteId: { accountId, quoteId: quote.id } }, select: { id: true } })) : false
  // A job is a sale; a quote is signed when locked (lib/quoteLock.ts) or a job was made from it.
  const signed = !quote || isSignedQuote(quote, hasCost) || jobs.length > 0
  const commissionCents = quote ? quoteCommissionCents(quote) : 0
  const priceCents = Math.round((quote ? quote.finalPrice : (job!.contractValue || job!.quotePrice || 0)) * 100)
  const moved: SalesmanMoved = { quoteId: quote?.id ?? null, jobIds: jobs.map(j => j.id), from, to: target.name, signed, priceCents, commissionCents }

  // Already theirs everywhere: nothing to do, no History line.
  if (samePerson(from, target.name) && jobs.every(j => samePerson(j.salesRep, target.name))) return { ok: true, already: true, moved }

  if (signed && !input.confirm) {
    return { ok: false, status: 409, code: 'CONFIRM_SIGNED', error: confirmQuestion(from, target.name, commissionCents), confirm: { from, to: target.name, signed: true, commissionCents, question: confirmQuestion(from, target.name, commissionCents) } }
  }

  const contactId = quote?.crmContactId ?? job?.crmContactId ?? null
  const changed = await prisma.$transaction(async tx => {
    if (quote) {
      // Only if nobody changed its Salesman since it was read here.
      const q = await tx.savedQuote.updateMany({ where: { id: quote.id, accountId, deletedAt: null, salesRep: quote.salesRep }, data: { salesRep: target.name } })
      if (q.count !== 1) return false
      await tx.jobQuotedCost.updateMany({ where: { accountId, quoteId: quote.id }, data: { salesRep: target.name } })
    }
    if (jobs.length) await tx.savedJob.updateMany({ where: { accountId, id: { in: jobs.map(j => j.id) } }, data: { salesRep: target.name } })
    if (contactId) {
      const what = quote ? quoteWords(quote) : 'the job'
      await tx.crmContactNote.create({ data: { crmContactId: contactId, accountId, isPinned: false, body: movedNote(what, from, target.name, input.by.name, signed), createdBy: input.by.name, createdById: input.by.id } })
    }
    return true
  })
  if (!changed) return { ok: false, status: 409, code: 'CHANGED', error: 'The Salesman on this quote was changed a moment ago. Look at it again.' }
  // The new Salesman has it on the next request; the old one no longer does (the rep decides).
  forgetAllScopes()
  return { ok: true, already: false, moved }
}

/**
 * POST /api/saved-quotes/:id/salesman and POST /api/saved-jobs/:id/salesman, { to: <login id>, confirm?: true }.
 * The owner only: everyone else (the office, a manager, a Salesman, the Installer) gets a 403 and nothing changes.
 */
export function salesmanMoveRoute(kind: 'quote' | 'job') {
  return async (req: any, res: any) => {
    try {
      if (!(await requestIsOwner(req))) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: OWNER_ONLY_SALESMAN }); return }
      const to = typeof req.body?.to === 'string' ? req.body.to.trim() : ''
      if (!to || to.length > 100) { res.status(400).json({ success: false, error: 'Choose the Salesman.' }); return }
      const id = String(req.params.id)
      const r = await moveSalesman({
        accountId: req.user.crmAccountId, ...(kind === 'quote' ? { quoteId: id } : { jobId: id }), toUserId: to,
        by: { id: req.user.id ?? null, name: (await enteringName(req.user.id)) || req.user.email || 'the owner' }, confirm: req.body?.confirm === true,
      })
      if (!r.ok) { res.status(r.status).json({ success: false, code: r.code, error: r.error, ...(r.confirm ? { confirm: r.confirm } : {}) }); return }
      // The amounts, in cents, in the audit log (the History line has none).
      if (!r.already) {
        const m = r.moved
        if (m.quoteId) await audit(req, 'update', 'SavedQuote', m.quoteId, { oldValues: { salesRep: m.from }, newValues: { salesRep: m.to, salesmanMoved: m } })
        for (const j of m.jobIds) await audit(req, 'update', 'SavedJob', j, { oldValues: { salesRep: m.from }, newValues: { salesRep: m.to, salesmanMoved: m } })
      }
      res.json({ success: true, data: { already: r.already, from: r.moved.from, to: r.moved.to, signed: r.moved.signed, quoteId: r.moved.quoteId, jobIds: r.moved.jobIds, commissionCents: r.moved.commissionCents } })
    } catch (err) {
      console.error(`[salesman-move] ${kind} error:`, err)
      res.status(500).json({ success: false, error: 'Could not change the Salesman. Nothing was changed.' })
    }
  }
}
