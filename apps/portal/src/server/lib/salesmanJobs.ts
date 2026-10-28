/**
 * The Salesman's job page (Jonathan, Oct 28 2026, audit #49: "Open the job
 * page to the Salesman read only, without costs").
 *
 * Which jobs: only the Salesman's own. A job is the Salesman's when its quote
 * or its customer is: made by the Salesman (ownerId) or naming the Salesman
 * as the rep (salesRep, assigned). A job whose own rep names the Salesman
 * counts too (it takes its rep from the quote; lib/salesRep.ts). Any other
 * job answers 404, the same as a job that is not there.
 *
 * Read only: the Salesman reads jobs and makes the job when a quote is sold
 * (POST /api/saved-jobs, the signed contract flow). One more write stays, as
 * before: booking an install appointment linked to the Salesman's own job
 * (BookingDialog.tsx) gives the job that appointment's dates and "scheduled"
 * (installBookingSave below). Every other job write (stage moves, Advance,
 * hold, notes, materials, the locate, milestone ticks, archive, delete,
 * import) is refused with a plain sentence.
 *
 * Without costs: every answer a Salesman gets from the job routes goes out
 * through redactCosts (lib/costRedact.ts: margin, material and labor cost,
 * supplier prices, vendor bills' costs, ...), and a sentence in a note or the
 * job history that talks about a cost has its dollar figures and percents
 * left out (withoutCostFigures). Prices the customer agreed to stay: the
 * Salesman sold them.
 */

import prisma from './prisma.js'
import { redactCosts, MONEY_MARK } from './costRedact.js'
import { verifyStaffBearer } from './secrets.js'
import { sameName, repName, SALESMAN_ROLE } from './salesRep.js'
import { floridaDay } from './automations/context.js'

export const isSalesman = (role: string | null | undefined): boolean => role === SALESMAN_ROLE

/** The plain sentence a Salesman's job write is refused with. */
export const SALESMAN_JOB_READ_ONLY = 'The Salesman\'s login shows jobs read only. Ask the office to change this job.'

export interface SalesmanLogin { id: string; accountId: string; name: string; firstName: string }

/** The signed in Salesman, from the database (the cookie's session or the token names the login). */
export async function salesmanLogin(userId: string): Promise<SalesmanLogin | null> {
  const u = await prisma.crmUser.findUnique({ where: { id: userId }, select: { id: true, crmAccountId: true, firstName: true, lastName: true } })
  if (!u?.crmAccountId) return null
  return { id: u.id, accountId: u.crmAccountId, name: repName(u), firstName: (u.firstName ?? '').trim() }
}

/** Does this rep name the Salesman? The full name, or the first name alone when that is all the record has ("Christa"). */
export function namesSalesman(me: Pick<SalesmanLogin, 'name' | 'firstName'>, rep: string | null | undefined): boolean {
  if (!rep || !rep.trim()) return false
  if (sameName(rep, me.name)) return true
  return !/\s/.test(rep.trim()) && sameName(rep, me.firstName)
}

/** A quote or customer made by the Salesman, or with the Salesman as its rep. */
const ownsRecord = (me: SalesmanLogin, r: { ownerId?: string | null; salesRep?: string | null }) => r.ownerId === me.id || namesSalesman(me, r.salesRep)

/** Every job of the account that is the Salesman's. */
export async function salesmanJobIds(me: SalesmanLogin): Promise<Set<string>> {
  const accountId = me.accountId
  const [quotes, contacts] = await Promise.all([
    prisma.savedQuote.findMany({ where: { accountId, OR: [{ ownerId: me.id }, { salesRep: { not: '' } }] }, select: { id: true, ownerId: true, salesRep: true } }),
    prisma.crmContact.findMany({ where: { accountId, OR: [{ ownerId: me.id }, { salesRep: { not: null } }] }, select: { id: true, ownerId: true, salesRep: true } }),
  ])
  const quoteIds = quotes.filter(q => ownsRecord(me, q)).map(q => q.id)
  const contactIds = contacts.filter(c => ownsRecord(me, c)).map(c => c.id)
  const jobs = await prisma.savedJob.findMany({
    where: { accountId, OR: [{ quoteId: { in: quoteIds } }, { crmContactId: { in: contactIds } }, { salesRep: { not: '' } }] },
    select: { id: true, quoteId: true, crmContactId: true, salesRep: true },
  })
  const q = new Set(quoteIds)
  const c = new Set(contactIds)
  return new Set(jobs.filter(j => (j.quoteId && q.has(j.quoteId)) || (j.crmContactId && c.has(j.crmContactId)) || namesSalesman(me, j.salesRep)).map(j => j.id))
}

/** Is this one job the Salesman's? (Its quote, its customer, or its own rep.) */
export async function salesmanOwnsJob(me: SalesmanLogin, jobId: string): Promise<boolean> {
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId: me.accountId }, select: { quoteId: true, crmContactId: true, salesRep: true } })
  if (!job) return false
  if (namesSalesman(me, job.salesRep)) return true
  const [quote, contact] = await Promise.all([
    job.quoteId ? prisma.savedQuote.findFirst({ where: { id: job.quoteId, accountId: me.accountId }, select: { ownerId: true, salesRep: true } }) : null,
    job.crmContactId ? prisma.crmContact.findFirst({ where: { id: job.crmContactId, accountId: me.accountId }, select: { ownerId: true, salesRep: true } }) : null,
  ])
  return (!!quote && ownsRecord(me, quote)) || (!!contact && ownsRecord(me, contact))
}

/** A sentence about what something costs us (not what the customer pays). */
const COST_WORDS = /\b(costs?|costing|cogs|margins?|profit|markup|mark up|supplier|vendor|wholesale|labor|labour|wages?|overhead|commission|sub rate|bill(ed)? us)\b/i
const MONEY = /\$\s?\d+(?:,\d{3})*(?:\.\d+)?/g
const PERCENT = /\d+(?:\.\d+)?\s?%/g

/**
 * A text with the figures left out of every sentence that talks about a cost
 * ("Material cost went up $212 at the supplier." → "Material cost went up $ (left out) at the supplier.").
 * Sentences about the price ("Change order CO-1 approved: +$450") are kept as written.
 */
export function withoutCostFigures(text: string): string {
  if (!text || (!text.includes('$') && !text.includes('%'))) return text
  return text.split('\n').map(line => line.split(/(?<=[.!?;])\s+/).map(s => (COST_WORDS.test(s) ? s.replace(MONEY, MONEY_MARK).replace(PERCENT, '(left out)') : s)).join(' ')).join('\n')
}

function scrubText(v: unknown): unknown {
  if (typeof v === 'string') return withoutCostFigures(v)
  if (Array.isArray(v)) return v.map(scrubText)
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[k] = scrubText(x)
    return out
  }
  return v
}

/** An answer as the Salesman gets it from the job routes: no cost field, no cost figure in its words. */
export function forSalesman<T>(body: T): T {
  return scrubText(redactCosts(body)) as T
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const YMD = /^\d{4}-\d{2}-\d{2}$/
/** What the booking changes on the job; opsStage follows the status (the server works it out). */
const BOOKING_KEYS = new Set(['scheduledDate', 'scheduledEndDate', 'status'])

/**
 * The job save that follows booking an install appointment on the Salesman's
 * own job (BookingDialog.tsx: the appointment is saved, then the job takes its
 * dates with status "scheduled"). The PATCH carries the whole job and the copy
 * it was edited from (base); it counts as that booking only when what changed
 * is the install days (and the status, to scheduled), and an install
 * appointment linked to this job has those very days. Returns the body to save
 * (only those fields), or null: anything else is refused.
 */
export async function installBookingSave(me: SalesmanLogin, jobId: string, body: unknown): Promise<Record<string, unknown> | null> {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const base = b.base
  if (!base || typeof base !== 'object' || b.reopen) return null
  const was = base as Record<string, unknown>
  const changed = Object.keys(b).filter(k => k !== 'base' && k !== 'reopen' && k !== 'opsStage' && !same(b[k], was[k]))
  if (!changed.length || changed.some(k => !BOOKING_KEYS.has(k)) || !changed.includes('scheduledDate')) return null
  if (changed.includes('status') && b.status !== 'scheduled') return null
  const start = b.scheduledDate
  const end = b.scheduledEndDate ?? null
  if (typeof start !== 'string' || !YMD.test(start) || (end !== null && (typeof end !== 'string' || !YMD.test(end)))) return null
  const appts = await prisma.appointment.findMany({
    where: { accountId: me.accountId, jobId, type: 'install', deletedAt: null, archivedAt: null, status: { not: 'cancelled' }, startAt: { not: null }, endAt: { not: null } },
    select: { startAt: true, endAt: true },
  })
  const booked = appts.some(a => floridaDay(a.startAt!) === start && (end === null || floridaDay(new Date(a.endAt!.getTime() - 1)) === end))
  if (!booked) return null
  const out: Record<string, unknown> = { base: { scheduledDate: was.scheduledDate, scheduledEndDate: was.scheduledEndDate ?? null, status: was.status, opsStage: was.opsStage } }
  for (const k of changed) out[k] = b[k]
  return out
}

/** Words in a job route path that are not a job id. */
const NOT_IDS = new Set(['milestones', 'sync'])

/**
 * Mounted at the top of the saved-jobs router. For the Salesman only: the
 * list and the board's milestone counts keep the Salesman's jobs; one job
 * (and its milestones) outside them answers 404; every write but making the
 * job of a sold quote is refused; every answer goes out without costs.
 * Every other login passes untouched.
 */
export async function salesmanJobScope(req: any, res: any, next: any): Promise<void> {
  const who = verifyStaffBearer(req)
  if (!who || !isSalesman(who.role)) { next(); return }
  try {
    const me = await salesmanLogin(String(who.sub))
    if (!me) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: 'Your login is not linked to a company.' }); return }
    const parts = String(req.path || '/').split('/').filter(Boolean)
    const first = parts[0]
    const creating = req.method === 'POST' && parts.length === 0
    // Booking an install on the Salesman's own job: only its days and "scheduled" are saved.
    const booking = req.method === 'PATCH' && parts.length === 1 && (await salesmanOwnsJob(me, first)) ? await installBookingSave(me, first, req.body) : null
    if (booking) req.body = booking
    if (req.method !== 'GET' && !creating && !booking) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: SALESMAN_JOB_READ_ONLY }); return }
    if (first && !NOT_IDS.has(first) && !(await salesmanOwnsJob(me, first))) { res.status(404).json({ success: false, error: 'Job not found' }); return }
    const listing = req.method === 'GET' && (parts.length === 0 || (first === 'milestones' && parts[1] === 'summary'))
    const mine = listing ? await salesmanJobIds(me) : null
    const json = res.json.bind(res)
    res.json = (body: any) => {
      let b = body
      if (mine && b && Array.isArray(b.data)) b = { ...b, data: b.data.filter((x: any) => x && mine.has(x.id)) }
      else if (mine && b?.data && typeof b.data === 'object') b = { ...b, data: Object.fromEntries(Object.entries(b.data).filter(([id]) => mine.has(id))) }
      return json(forSalesman(b))
    }
    next()
  } catch (err) {
    console.error('[salesman jobs] scope error:', err)
    res.status(500).json({ success: false, error: 'Could not read the jobs' })
  }
}
