/**
 * The Salesman sees only the Salesman's own quotes and customers, plus any
 * assigned to the Salesman (Jonathan, Oct 28 2026). Enforced here, on the
 * server, for every list and every record opened by id; the owner, admin,
 * manager and office are unchanged. The rule (docs/DECISIONS.md, "Salesman
 * scope"):
 *
 *   The Salesman's own customers ("direct"): customers whose Sales rep is
 *   the Salesman; customers the Salesman entered (ownerId) while their Sales
 *   rep is blank (a customer the Salesman gave to someone else, or that the
 *   owner or office moved to someone else, is that person's: Oct 28 2026,
 *   the Salesman choice); and, while the customer's Sales rep is blank or
 *   the Salesman, the customer on a pipeline card whose rep is the Salesman
 *   and the customer of an appointment booked with the Salesman (a card or
 *   visit left behind on a customer moved to someone else does not keep it).
 *
 *   Quotes, sold or not, and jobs: the rep on the record decides (Jonathan,
 *   Oct 29 2026, after a move: "Christa's quotes after a move: unsold ones
 *   leave her list. Signed ones she sold stay with her."). A quote or job
 *   whose Sales rep is the Salesman is hers; one whose Sales rep names
 *   someone else is not, whoever wrote it and whoever the customer's
 *   Salesman is. A moved quote (lib/quotesFollowCustomer.ts, a customer's
 *   open quotes follow the customer; lib/salesmanMove.ts, the owner moves one
 *   quote or job, its commission with it) leaves her the moment it moves; a
 *   sold quote whose rep is still her stays hers, and brings its customer,
 *   after the customer moves. Only a quote with no rep falls back to who
 *   wrote it (ownerId) or a direct customer; a job with no rep to its quote
 *   in scope or a direct customer.
 *
 *   Customers in scope: the direct ones, plus the customer of every quote and
 *   job in scope (a quote assigned to the Salesman brings its customer in;
 *   that customer's other quotes stay out). A customer stays only through
 *   something still hers.
 *
 *   Pipeline cards: its customer is in scope, or the card's rep is the
 *   Salesman and its customer (if any) is not someone else's; never a card
 *   for a quote or job whose rep names someone else (one deal the owner
 *   moved away, with its price).
 *   Appointments: booked with the Salesman, or with a customer in scope.
 *
 * "Is the Salesman" by name: the login's first and last name, or the first
 * name alone, without case or extra spaces (lib/salesRep.ts sameName; the
 * rep on a quote, job, customer and card is a name).
 *
 * A record outside the scope opened by id answers 404 (never 403: a 403 would
 * say the record exists). salesScoped(kind) is mounted in index.ts before
 * each route, next to the Installer's crewScoped; routes that answer pages or
 * other shapes (the pipeline's pages, the follow up board, possible matches,
 * payments) ask salesScopeOf(req) themselves.
 */

import crypto from 'crypto'
import prisma from './prisma.js'
import { staffRoleOf } from './costRedact.js'
import { verifyStaffBearer } from './secrets.js'
import { SALESMAN_ROLE, repName, sameName } from './salesRep.js'

export interface SalesScope {
  userId: string
  accountId: string
  /** The Salesman's names as a rep is written: "Christa Feagin", "Christa". */
  names: string[]
  /** Customers the Salesman entered or is the rep of, or has a card or appointment with. */
  directContactIds: Set<string>
  /** Customers whose Sales rep names someone else (as read): a card of the Salesman's left on one does not show. */
  elsewhereContactIds?: Set<string>
  /** Those customers' Salesman, by customer id (an appointment of hers on one says whose the customer is now). */
  elsewhereRep?: Map<string, string>
  /** Quotes and jobs read whose Sales rep names someone else: a card of her customer for one of them (a deal moved away) does not show. */
  elsewhereQuoteIds?: Set<string>
  elsewhereJobIds?: Set<string>
  /**
   * Quotes the Salesman wrote (ownerId) and customers the Salesman entered, whoever their rep is now. Never
   * read through these: a NEW entry of the business record or kv for one of them is still taken from her phone
   * (the pull sheet of a quote she just wrote for another Salesman's new customer), lib/salesScopeRecords.ts.
   */
  madeQuoteIds?: Set<string>
  madeContactIds?: Set<string>
  contactIds: Set<string>
  quoteIds: Set<string>
  jobIds: Set<string>
}

export const isSalesman = (role: string | null | undefined): boolean => role === SALESMAN_ROLE

/** Is this rep name the Salesman? */
export function isMine(s: Pick<SalesScope, 'names'>, rep: unknown): boolean {
  return typeof rep === 'string' && s.names.some(n => sameName(n, rep))
}

const blankRep = (rep: unknown): boolean => typeof rep !== 'string' || !rep.trim()

/** A quote is the Salesman's while its rep is the Salesman; with no rep, when the Salesman wrote it or its customer is direct. */
export function quoteIsMine(s: Pick<SalesScope, 'names' | 'userId' | 'directContactIds'>, q: { ownerId?: string | null; salesRep?: string | null; crmContactId?: string | null }): boolean {
  if (!blankRep(q.salesRep)) return isMine(s, q.salesRep)
  return q.ownerId === s.userId || (!!q.crmContactId && s.directContactIds.has(q.crmContactId))
}

/** A job is the Salesman's while its rep is the Salesman; with no rep, when its quote is in scope or its customer is direct. */
export function jobIsMine(s: Pick<SalesScope, 'names' | 'directContactIds' | 'quoteIds'>, j: { quoteId?: string | null; salesRep?: string | null; crmContactId?: string | null }): boolean {
  if (!blankRep(j.salesRep)) return isMine(s, j.salesRep)
  if (j.quoteId && s.quoteIds.has(j.quoteId)) return true
  return !!j.crmContactId && s.directContactIds.has(j.crmContactId)
}

/**
 * A customer the Salesman entered is the Salesman's while the customer's Sales rep is blank or the Salesman;
 * once the rep names someone else (the Salesman gave it away, or the owner or office changed it) it is theirs.
 */
export function enteredAndKept(s: Pick<SalesScope, 'names' | 'userId'>, c: { ownerId?: string | null; salesRep?: string | null }): boolean {
  return c.ownerId === s.userId && (!c.salesRep || !c.salesRep.trim() || isMine(s, c.salesRep))
}

/**
 * Work out the scope from the records. Pure: the database reads are in
 * salesScope(); the tests call this directly too.
 */
export function buildSalesScope(input: {
  userId: string
  accountId: string
  names: string[]
  contacts: Array<{ id: string; ownerId: string | null; salesRep: string | null }>
  quotes: Array<{ id: string; ownerId: string | null; salesRep: string | null; crmContactId: string | null }>
  jobs: Array<{ id: string; quoteId: string | null; crmContactId: string | null; salesRep: string | null }>
  cards: Array<{ customerId?: string | null; assignedRep?: string | null }>
  appointments: Array<{ crmContactId: string; assignedToUserId: string | null; assignedTo: string | null }>
}): SalesScope {
  const s = { names: input.names, userId: input.userId }
  const direct = new Set<string>()
  // Customers whose rep names someone else: a card or visit of the Salesman's left on one does not bring it in.
  const elsewhere = new Set<string>()
  const elsewhereRep = new Map<string, string>()
  for (const c of input.contacts) {
    if (enteredAndKept(s, c) || isMine(s, c.salesRep)) direct.add(c.id)
    else if (!blankRep(c.salesRep)) { elsewhere.add(c.id); elsewhereRep.set(c.id, c.salesRep!.trim()) }
  }
  for (const k of input.cards) if (k.customerId && !elsewhere.has(k.customerId) && isMine(s, k.assignedRep)) direct.add(k.customerId)
  for (const a of input.appointments) if (!elsewhere.has(a.crmContactId) && (a.assignedToUserId === input.userId || isMine(s, a.assignedTo))) direct.add(a.crmContactId)

  const quoteIds = new Set<string>()
  const contactIds = new Set<string>(direct)
  const sq = { ...s, directContactIds: direct }
  const elsewhereQuotes = new Set<string>()
  for (const q of input.quotes) {
    if (quoteIsMine(sq, q)) {
      quoteIds.add(q.id)
      if (q.crmContactId) contactIds.add(q.crmContactId)
    } else if (!blankRep(q.salesRep)) elsewhereQuotes.add(q.id)
  }
  const jobIds = new Set<string>()
  const sj = { ...sq, quoteIds }
  const elsewhereJobs = new Set<string>()
  for (const j of input.jobs) {
    if (jobIsMine(sj, j)) {
      jobIds.add(j.id)
      if (j.crmContactId) contactIds.add(j.crmContactId)
    } else if (!blankRep(j.salesRep)) elsewhereJobs.add(j.id)
  }
  const madeQuoteIds = new Set(input.quotes.filter(q => q.ownerId === input.userId).map(q => q.id))
  const madeContactIds = new Set(input.contacts.filter(c => c.ownerId === input.userId).map(c => c.id))
  for (const q of input.quotes) if (q.ownerId === input.userId && q.crmContactId) madeContactIds.add(q.crmContactId)
  return { userId: input.userId, accountId: input.accountId, names: input.names, directContactIds: direct, elsewhereContactIds: elsewhere, elsewhereRep, elsewhereQuoteIds: elsewhereQuotes, elsewhereJobIds: elsewhereJobs, madeQuoteIds, madeContactIds, contactIds, quoteIds, jobIds }
}

/** Rows whose rep could be one of these names (a cheap first cut; sameName decides). */
const repLike = (names: string[]) => names.map(n => ({ salesRep: { contains: n.split(' ')[0], mode: 'insensitive' as const } }))

/**
 * The Salesman's scope, read from the database, in the company the request is
 * signed in for (`accountId`, the token's, as every route reads it), else the
 * login's own. Null: not a login of a company.
 */
export async function salesScope(userId: string, accountIdIn?: string | null): Promise<SalesScope | null> {
  const me = await prisma.crmUser.findUnique({ where: { id: userId }, select: { crmAccountId: true, firstName: true, lastName: true } })
  const accountId = accountIdIn || me?.crmAccountId
  if (!me || !accountId) return null
  const names = [...new Set([repName(me), (me.firstName ?? '').trim()].filter(Boolean))]
  const first = (me.firstName ?? '').trim() || repName(me)
  const like = first ? repLike([first]) : []
  const [contacts, ownQuotes, ownJobs, cardRows, appointments] = await Promise.all([
    prisma.crmContact.findMany({ where: { accountId, deletedAt: null, OR: [{ ownerId: userId }, ...like] }, select: { id: true, ownerId: true, salesRep: true } }),
    prisma.savedQuote.findMany({ where: { accountId, deletedAt: null, OR: [{ ownerId: userId }, ...like] }, select: { id: true, ownerId: true, salesRep: true, crmContactId: true } }),
    prisma.savedJob.findMany({ where: { accountId, deletedAt: null, ...(like.length ? { OR: like } : { id: '' }) }, select: { id: true, quoteId: true, crmContactId: true, salesRep: true } }),
    // The board's cards (on it and archived) whose rep could be the Salesman, read in the database, not the whole board.
    first ? prisma.$queryRaw<Array<{ customerId: string | null; assignedRep: string | null }>>`
      SELECT l->>'customerId' AS "customerId", l->>'assignedRep' AS "assignedRep"
      FROM "PipelineState" p, jsonb_array_elements(COALESCE(p.leads::jsonb, '[]'::jsonb) || COALESCE(p."archivedLeads"::jsonb, '[]'::jsonb)) l
      WHERE p."accountId" = ${accountId} AND jsonb_typeof(l) = 'object' AND l->>'assignedRep' ILIKE ${'%' + first + '%'}` : Promise.resolve([]),
    prisma.appointment.findMany({ where: { accountId, deletedAt: null, OR: [{ assignedToUserId: userId }, ...(first ? [{ assignedTo: { contains: first, mode: 'insensitive' as const } }] : [])] }, select: { crmContactId: true, assignedToUserId: true, assignedTo: true } }),
  ])
  // The rep of each customer a card or visit names (one moved to someone else is not brought in by them).
  const loaded = new Set(contacts.map(c => c.id))
  const linked = [...new Set([...cardRows.map(k => k.customerId), ...appointments.map(a => a.crmContactId)].filter((x): x is string => !!x && !loaded.has(x)))]
  const linkedContacts = linked.length ? await prisma.crmContact.findMany({ where: { accountId, deletedAt: null, id: { in: linked } }, select: { id: true, ownerId: true, salesRep: true } }) : []
  // First the Salesman's own customers; then every quote of theirs, then the jobs of the quotes in scope.
  const base = { userId, accountId, names, contacts: [...contacts, ...linkedContacts], cards: cardRows, appointments }
  const direct = [...buildSalesScope({ ...base, quotes: [], jobs: [] }).directContactIds]
  const customerQuotes = direct.length ? await prisma.savedQuote.findMany({ where: { accountId, deletedAt: null, crmContactId: { in: direct } }, select: { id: true, ownerId: true, salesRep: true, crmContactId: true } }) : []
  const ownIds = new Set(ownQuotes.map(q => q.id))
  const quotes = [...ownQuotes, ...customerQuotes.filter(q => !ownIds.has(q.id))]
  const quoteIdList = [...buildSalesScope({ ...base, quotes, jobs: [] }).quoteIds]
  const jobsByQuoteOrCustomer = (quoteIdList.length || direct.length)
    ? await prisma.savedJob.findMany({ where: { accountId, deletedAt: null, OR: [...(quoteIdList.length ? [{ quoteId: { in: quoteIdList } }] : []), ...(direct.length ? [{ crmContactId: { in: direct } }] : [])] }, select: { id: true, quoteId: true, crmContactId: true, salesRep: true } })
    : []
  const ownJobIds = new Set(ownJobs.map(j => j.id))
  const jobs = [...ownJobs, ...jobsByQuoteOrCustomer.filter(j => !ownJobIds.has(j.id))]
  return buildSalesScope({ ...base, quotes, jobs })
}

// ── One short memory per login ──────────────────────────────────────────────
// A screen load asks for about eight lists at once: they share one reading of
// the scope for a few seconds. Any save by that login forgets it (salesScoped
// below), so a record the Salesman just made or took is in the next answer.

const MEMORY_MS = 4_000
const memory = new Map<string, { at: number; scope: Promise<SalesScope | null> }>()

export function scopeFor(userId: string, accountId?: string | null): Promise<SalesScope | null> {
  const key = `${userId}|${accountId ?? ''}`
  const hit = memory.get(key)
  if (hit && Date.now() - hit.at < MEMORY_MS) return hit.scope
  const scope = salesScope(userId, accountId).catch(() => null)
  memory.set(key, { at: Date.now(), scope })
  if (memory.size > 200) for (const [k, v] of memory) if (Date.now() - v.at >= MEMORY_MS) memory.delete(k)
  return scope
}

export function forgetScope(userId: string | null | undefined): void {
  if (userId) for (const k of [...memory.keys()]) if (k.startsWith(`${userId}|`)) memory.delete(k)
}

/** A customer's Salesman was chosen or changed: every Salesman reads the scope again (the new one has it, the old one not). */
export function forgetAllScopes(): void {
  memory.clear()
}

/** The Salesman's scope for this request, or null for every other login (and for a request with no staff login). */
export async function salesScopeOf(req: any): Promise<SalesScope | null> {
  if (!isSalesman(staffRoleOf(req) ?? req?.user?.role)) return null
  const who = verifyStaffBearer(req)
  const id = who?.sub ?? req?.user?.id
  if (!id) return null
  // A save can bring a record into scope: the next request reads the scope again.
  if (req.method !== 'GET' && req.method !== 'HEAD' && typeof req?.res?.on === 'function') req.res.on('finish', () => forgetScope(String(id)))
  return scopeFor(String(id), who?.crmAccountId ?? req?.user?.crmAccountId)
}

// ── Records ─────────────────────────────────────────────────────────────────

export type SalesKind = 'contacts' | 'quotes' | 'jobs' | 'appointments' | 'pipeline'

/** Is this record within the Salesman's scope? Also true for a record that says it is the Salesman's own (one just made). */
export function inSalesScope(kind: SalesKind, s: SalesScope, item: any): boolean {
  if (!item || typeof item !== 'object') return false
  switch (kind) {
    case 'contacts': return s.contactIds.has(item.id) || enteredAndKept(s, item) || isMine(s, item.salesRep)
    // The record's own rep decides (a quote or job moved to someone else since the scope was read is out).
    case 'quotes': return blankRep(item.salesRep) ? (s.quoteIds.has(item.id) || quoteIsMine(s, item)) : isMine(s, item.salesRep)
    case 'jobs': return blankRep(item.salesRep) ? (s.jobIds.has(item.id) || jobIsMine(s, item)) : isMine(s, item.salesRep)
    case 'appointments': return item.assignedToUserId === s.userId || isMine(s, item.assignedTo) || (!!item.crmContactId && s.contactIds.has(item.crmContactId))
    case 'pipeline': {
      // A card for a quote or job now someone else's (the owner moved that one deal) is theirs, with its price.
      if ((item.quoteId && s.elsewhereQuoteIds?.has(item.quoteId)) || (item.jobId && s.elsewhereJobIds?.has(item.jobId))) return false
      return (!!item.customerId && s.contactIds.has(item.customerId)) || (isMine(s, item.assignedRep) && !(item.customerId && s.elsewhereContactIds?.has(item.customerId)))
    }
  }
}

/** A short fingerprint of what the Salesman's board shows by (changes when a customer, quote or job enters or leaves her scope). */
export function scopeKey(s: SalesScope): string {
  const part = (x?: Set<string>) => [...(x ?? [])].sort().join(',')
  return crypto.createHash('sha1').update([s.contactIds, s.quoteIds, s.jobIds, s.elsewhereContactIds, s.elsewhereQuoteIds, s.elsewhereJobIds].map(part).join('|')).digest('base64url').slice(0, 16)
}

/** Is a card id one of the Salesman's cards on this board? */
export function cardInScope(s: SalesScope, leads: any[], cardId: string): boolean {
  const card = (Array.isArray(leads) ? leads : []).find(l => l?.id === cardId)
  return !!card && inSalesScope('pipeline', s, card)
}

/** Words in a path that are routes, not record ids. */
const NOT_IDS = new Set(['sync', 'notes', 'geo', 'team', 'share', 'cards', 'board', 'column', 'search', 'pages', 'words', 'archived', 'milestones', 'sold-quote', 'salesmen'])

const notFound = (res: any) => res.status(404).json({ success: false, error: 'Not found' })

/**
 * A customer, quote or job that is there but whose Salesman names someone else (the owner moved it, or her quote
 * for another Salesman's customer): the 404 says so, with only that person's name, so her open screen says "The
 * owner moved this to Sam" instead of "check the connection" (review, Oct 30 2026). Null: not there, or deleted.
 */
export function movedAnswer(s: Pick<SalesScope, 'names'>, row: { salesRep?: string | null; deletedAt?: Date | string | null } | null | undefined): Record<string, unknown> | null {
  const rep = typeof row?.salesRep === 'string' ? row.salesRep.trim() : ''
  if (!row || row.deletedAt || !rep || isMine(s, rep)) return null
  return { success: false, code: 'MOVED', movedTo: rep, error: `The owner moved this to ${rep}. It is off your list now.` }
}
const notFoundOrMoved = (res: any, s: SalesScope, row: any) => { const m = movedAnswer(s, row); if (m) res.status(404).json(m); else notFound(res) }

const MODEL: Record<Exclude<SalesKind, 'pipeline'>, (id: string, accountId: string) => Promise<any>> = {
  contacts: (id, accountId) => prisma.crmContact.findFirst({ where: { id, accountId }, select: { id: true, ownerId: true, salesRep: true, deletedAt: true } }),
  quotes: (id, accountId) => prisma.savedQuote.findFirst({ where: { id, accountId }, select: { id: true, ownerId: true, salesRep: true, crmContactId: true, deletedAt: true } }),
  jobs: (id, accountId) => prisma.savedJob.findFirst({ where: { id, accountId }, select: { id: true, quoteId: true, crmContactId: true, salesRep: true, deletedAt: true } }),
  appointments: (id, accountId) => prisma.appointment.findFirst({ where: { id, accountId }, select: { id: true, crmContactId: true, assignedToUserId: true, assignedTo: true } }),
}

/**
 * Middleware for one record kind. For the Salesman: a list keeps only records
 * in scope; one record outside it, by id (and what hangs off it: notes,
 * consent, history), is a 404; a create that names the id of someone else's
 * record (a retried create returns what is there) is a 404 too. Every other
 * login passes untouched.
 */
export function salesScoped(kind: SalesKind) {
  return async (req: any, res: any, next: any) => {
    if (!isSalesman(staffRoleOf(req))) { next(); return }
    const who = verifyStaffBearer(req)
    const userId = who?.sub ? String(who.sub) : null
    const scope = userId ? await scopeFor(userId, who?.crmAccountId ?? req?.user?.crmAccountId) : null
    if (!scope) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: 'Your login is not linked to a company.' }); return }
    // A save by the Salesman can bring a record into scope (a quote for a customer, a new customer): read it again next time.
    if (req.method !== 'GET' && req.method !== 'HEAD') res.on('finish', () => forgetScope(userId))
    const first = String(req.path || '/').split('/').filter(Boolean)[0]
    if (first && !NOT_IDS.has(first) && kind !== 'pipeline') {
      const known = kind === 'contacts' ? scope.contactIds.has(first) : kind === 'quotes' ? scope.quoteIds.has(first) : kind === 'jobs' ? scope.jobIds.has(first) : false
      if (!known) {
        // Not in the scope as read: the record itself may say it is the Salesman's (made a moment ago).
        const row = await MODEL[kind](first, scope.accountId).catch(() => null)
        if (!row || !inSalesScope(kind, scope, row)) { notFoundOrMoved(res, scope, kind === 'appointments' ? null : row); return }
      }
    }
    if (!first && req.method === 'POST' && typeof req.body?.id === 'string' && kind !== 'pipeline') {
      const row = await MODEL[kind](req.body.id, scope.accountId).catch(() => null)
      if (row && !inSalesScope(kind, scope, row)) { notFoundOrMoved(res, scope, kind === 'appointments' ? null : row); return }
    }
    // The board answers "unchanged" by its version; the Salesman's cards also change when her scope does (a deal
    // moved away): a scope she has not seen yet sends the board (routes/pipeline.ts reads salesScopeChanged).
    const key = kind === 'pipeline' ? scopeKey(scope) : ''
    if (kind === 'pipeline' && req.method === 'GET' && req.query?.scope !== key) req.salesScopeChanged = true
    const json = res.json.bind(res)
    res.json = (body: any) => {
      if (!body || typeof body !== 'object') return json(body)
      // The list itself (what hangs off one record, its notes or history, was checked by its id above).
      if (!first && Array.isArray(body.data)) {
        const data = body.data.filter((x: any) => inSalesScope(kind, scope, x))
        // A small refresh (?since=) carries only rows changed since; a row that left her scope (moved to someone
        // else) is simply not in it. `keepOnly`: every id of hers of this kind, so the phone drops the rest of its
        // copy (review, Oct 30 2026: her open lists kept moved rows until a full reload). Her own ids only.
        const own = kind === 'contacts' ? scope.contactIds : kind === 'quotes' ? scope.quoteIds : kind === 'jobs' ? scope.jobIds : null
        if (body.partial === true && own) return json({ ...body, data, keepOnly: [...new Set([...own, ...data.map((x: any) => x?.id).filter(Boolean)])] })
        if (kind === 'appointments') {
          // Her appointment with a customer she cannot open (the customer is someone else's now): it says so.
          const marked = data.map((a: any) => (a?.crmContactId && !scope.contactIds.has(a.crmContactId) ? { ...a, customerNotYours: scope.elsewhereRep?.get(a.crmContactId) ?? '' } : a))
          // A small refresh: one that left her (moved to someone else with its customer) goes as a removal, its id only.
          if (body.partial === true) {
            const kept = new Set(data.map((x: any) => x?.id))
            const left = body.data.filter((x: any) => x?.id && !kept.has(x.id)).map((x: any) => ({ id: x.id, deletedAt: new Date().toISOString() }))
            return json({ ...body, data: [...marked, ...left] })
          }
          return json({ ...body, data: marked })
        }
        return json({ ...body, data })
      }
      if (kind === 'pipeline' && body.data && typeof body.data === 'object' && (Array.isArray(body.data.leads) || Array.isArray(body.data.archivedLeads))) {
        const keep = (list: unknown) => (Array.isArray(list) ? list.filter((x: any) => inSalesScope('pipeline', scope, x)) : list)
        return json({ ...body, scopeKey: key, data: { ...body.data, leads: keep(body.data.leads), archivedLeads: keep(body.data.archivedLeads) } })
      }
      if (kind === 'pipeline' && body.unchanged) return json({ ...body, scopeKey: key })
      return json(body)
    }
    next()
  }
}

// ── A customer, job or quote a route names ──────────────────────────────────

export type SalesRefKind = 'contacts' | 'jobs' | 'quotes'

/** Is this customer, job or quote id within the scope? The scope as read, else the record itself says it is the Salesman's (made a moment ago). */
export async function idInSalesScope(kind: SalesRefKind, s: SalesScope, id: string): Promise<boolean> {
  if (!id) return false
  const known = kind === 'contacts' ? s.contactIds : kind === 'jobs' ? s.jobIds : s.quoteIds
  if (known.has(id)) return true
  const row = await MODEL[kind](id, s.accountId).catch(() => null)
  return !!row && !row.deletedAt && inSalesScope(kind, s, row)
}

type Refs = Partial<Record<SalesRefKind, string | null | undefined | Array<string | null | undefined>>>

/**
 * For a route keyed by a customer, job or quote id (in its path, query or
 * body): when the login is the Salesman and any id named is outside the
 * Salesman's scope, answers 404 (as for a record that is not there) and
 * returns true. Every other login, and ids in scope: false, nothing sent.
 */
export async function refusedOutsideSalesScope(req: any, res: any, refs: Refs): Promise<boolean> {
  const anyNamed = Object.values(refs).some(v => (Array.isArray(v) ? v : [v]).some(x => typeof x === 'string' && x.length > 0))
  if (!anyNamed) return false
  const scope = await salesScopeOf(req)
  if (!scope) {
    if (!isSalesman(staffRoleOf(req) ?? req?.user?.role)) return false
    res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: 'Your login is not linked to a company.' })
    return true
  }
  const named = (Object.keys(refs) as SalesRefKind[]).flatMap(kind => {
    const v = refs[kind]
    return (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string' && x.length > 0).map(id => ({ kind, id }))
  })
  let outside: { kind: SalesRefKind; id: string } | null = null
  const allIn = async (s: SalesScope) => {
    for (const n of named) if (!(await idInSalesScope(n.kind, s, n.id))) { outside = n; return false }
    return true
  }
  if (await allIn(scope)) return false
  // The scope is kept a few seconds: a quote or job made since then (by the office too) is read again once before refusing.
  forgetScope(scope.userId)
  const fresh = await scopeFor(scope.userId, scope.accountId)
  if (fresh && await allIn(fresh)) return false
  const o = outside as { kind: SalesRefKind; id: string } | null
  const row = o ? await MODEL[o.kind](o.id, scope.accountId).catch(() => null) : null
  notFoundOrMoved(res, fresh ?? scope, row)
  return true
}

/** The customer, job and quote ids a request names in its query or body (jobId, quoteId, customerId, crmContactId, contactId). */
export function refsInRequest(req: any): Refs {
  const pick = (k: string) => [req?.query?.[k], req?.body?.[k]].filter((x): x is string => typeof x === 'string' && x.length > 0)
  return { jobs: pick('jobId'), quotes: pick('quoteId'), contacts: [...pick('customerId'), ...pick('crmContactId'), ...pick('contactId')] }
}

/**
 * Middleware for a router keyed by customers, jobs or quotes. For the
 * Salesman: the ids the request names in its query or body, and those `refs`
 * finds for the record in its path (null: none), must be in the scope, else
 * 404; `list` may filter an answer. Every other login passes untouched.
 */
export function salesScopedRoute(opts: {
  refs?: (req: any, first: string | undefined) => Promise<Refs | null> | Refs | null
  list?: (body: any, s: SalesScope, req: any) => any
}) {
  return async (req: any, res: any, next: any) => {
    try {
      if (!isSalesman(staffRoleOf(req) ?? req?.user?.role)) { next(); return }
      const first = String(req.path || '/').split('/').filter(Boolean)[0]
      if (await refusedOutsideSalesScope(req, res, refsInRequest(req))) return
      const more = opts.refs ? await opts.refs(req, first) : null
      if (more && await refusedOutsideSalesScope(req, res, more)) return
      if (opts.list) {
        const scope = await salesScopeOf(req)
        if (scope) {
          const json = res.json.bind(res)
          res.json = (body: any) => json(body && typeof body === 'object' ? opts.list!(body, scope, req) : body)
        }
      }
      next()
    } catch (e) { next(e) }
  }
}

/** A list answer ({ data: [...] } or { data: { [key]: [...] } }) with only the rows whose job is in the scope. */
export function onlyScopedJobs(key?: string) {
  return (body: any, s: SalesScope) => {
    const keep = (rows: unknown) => (Array.isArray(rows) ? rows.filter((r: any) => !!r?.jobId && s.jobIds.has(r.jobId)) : rows)
    if (!key) return Array.isArray(body.data) ? { ...body, data: keep(body.data) } : body
    return body.data && typeof body.data === 'object' && Array.isArray(body.data[key]) ? { ...body, data: { ...body.data, [key]: keep(body.data[key]) } } : body
  }
}

/**
 * Middleware for the old customer portal routes (documents, invoices, tickets,
 * contracts' dashboard, chat): their records are tied to no customer, job or
 * quote of the app, so none is the Salesman's. With `list`, the list itself
 * (GET /) answers empty; everything else is a 404.
 */
export function salesmanHasNone(opts: { list?: boolean } = {}) {
  return (req: any, res: any, next: any): void => {
    if (!isSalesman(staffRoleOf(req))) { next(); return }
    if (opts.list && req.method === 'GET' && (req.path === '/' || req.path === '')) { res.json({ success: true, data: [] }); return }
    notFound(res)
  }
}

/**
 * Middleware: not the Salesman's (website and phone leads as they come in, before anyone is assigned to them;
 * the office takes them, and one assigned to the Salesman is then on the Salesman's list).
 */
export function refuseSalesman(error: string) {
  return (req: any, res: any, next: any): void => {
    if (isSalesman(staffRoleOf(req))) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error }); return }
    next()
  }
}
