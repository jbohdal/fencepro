/**
 * The Salesman sees only the Salesman's own quotes and customers, plus any
 * assigned to the Salesman (Jonathan, Oct 28 2026). Enforced here, on the
 * server, for every list and every record opened by id; the owner, admin,
 * manager and office are unchanged. The rule (docs/DECISIONS.md, "Salesman
 * scope"):
 *
 *   The Salesman's own customers ("direct"): customers the Salesman entered
 *   (ownerId), customers whose Sales rep is the Salesman, the customer on a
 *   pipeline card whose rep is the Salesman, and the customer of an
 *   appointment booked with the Salesman.
 *
 *   Quotes: quotes the Salesman made (ownerId), quotes whose Sales rep is the
 *   Salesman, and every quote of a direct customer.
 *
 *   Customers in scope: the direct ones, plus the customer of every quote and
 *   job in scope (a quote assigned to the Salesman brings its customer in;
 *   that customer's other quotes stay out).
 *
 *   Jobs: jobs whose Sales rep is the Salesman, the job of a quote in scope,
 *   and every job of a direct customer.
 *
 *   Pipeline cards: the card's rep is the Salesman, or its customer is in scope.
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
  contactIds: Set<string>
  quoteIds: Set<string>
  jobIds: Set<string>
}

export const isSalesman = (role: string | null | undefined): boolean => role === SALESMAN_ROLE

/** Is this rep name the Salesman? */
export function isMine(s: Pick<SalesScope, 'names'>, rep: unknown): boolean {
  return typeof rep === 'string' && s.names.some(n => sameName(n, rep))
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
  const s = { names: input.names }
  const direct = new Set<string>()
  for (const c of input.contacts) if (c.ownerId === input.userId || isMine(s, c.salesRep)) direct.add(c.id)
  for (const k of input.cards) if (k.customerId && isMine(s, k.assignedRep)) direct.add(k.customerId)
  for (const a of input.appointments) if (a.assignedToUserId === input.userId || isMine(s, a.assignedTo)) direct.add(a.crmContactId)

  const quoteIds = new Set<string>()
  const contactIds = new Set<string>(direct)
  for (const q of input.quotes) {
    if (q.ownerId === input.userId || isMine(s, q.salesRep) || (q.crmContactId && direct.has(q.crmContactId))) {
      quoteIds.add(q.id)
      if (q.crmContactId) contactIds.add(q.crmContactId)
    }
  }
  const jobIds = new Set<string>()
  for (const j of input.jobs) {
    if (isMine(s, j.salesRep) || (j.quoteId && quoteIds.has(j.quoteId)) || (j.crmContactId && direct.has(j.crmContactId))) {
      jobIds.add(j.id)
      if (j.crmContactId) contactIds.add(j.crmContactId)
    }
  }
  return { userId: input.userId, accountId: input.accountId, names: input.names, directContactIds: direct, contactIds, quoteIds, jobIds }
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
  // First the Salesman's own customers; then every quote of theirs, then the jobs of the quotes in scope.
  const base = { userId, accountId, names, contacts, cards: cardRows, appointments }
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
    case 'contacts': return s.contactIds.has(item.id) || item.ownerId === s.userId || isMine(s, item.salesRep)
    case 'quotes': return s.quoteIds.has(item.id) || item.ownerId === s.userId || isMine(s, item.salesRep) || (!!item.crmContactId && s.directContactIds.has(item.crmContactId))
    case 'jobs': return s.jobIds.has(item.id) || isMine(s, item.salesRep) || (!!item.quoteId && s.quoteIds.has(item.quoteId)) || (!!item.crmContactId && s.directContactIds.has(item.crmContactId))
    case 'appointments': return item.assignedToUserId === s.userId || isMine(s, item.assignedTo) || (!!item.crmContactId && s.contactIds.has(item.crmContactId))
    case 'pipeline': return isMine(s, item.assignedRep) || (!!item.customerId && s.contactIds.has(item.customerId))
  }
}

/** Is a card id one of the Salesman's cards on this board? */
export function cardInScope(s: SalesScope, leads: any[], cardId: string): boolean {
  const card = (Array.isArray(leads) ? leads : []).find(l => l?.id === cardId)
  return !!card && inSalesScope('pipeline', s, card)
}

/** Words in a path that are routes, not record ids. */
const NOT_IDS = new Set(['sync', 'notes', 'geo', 'team', 'share', 'cards', 'board', 'column', 'search', 'pages', 'words', 'archived', 'milestones', 'sold-quote'])

const notFound = (res: any) => res.status(404).json({ success: false, error: 'Not found' })

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
        if (!row || !inSalesScope(kind, scope, row)) { notFound(res); return }
      }
    }
    if (!first && req.method === 'POST' && typeof req.body?.id === 'string' && kind !== 'pipeline') {
      const row = await MODEL[kind](req.body.id, scope.accountId).catch(() => null)
      if (row && !inSalesScope(kind, scope, row)) { notFound(res); return }
    }
    const json = res.json.bind(res)
    res.json = (body: any) => {
      if (!body || typeof body !== 'object') return json(body)
      // The list itself (what hangs off one record, its notes or history, was checked by its id above).
      if (!first && Array.isArray(body.data)) return json({ ...body, data: body.data.filter((x: any) => inSalesScope(kind, scope, x)) })
      if (kind === 'pipeline' && body.data && typeof body.data === 'object' && (Array.isArray(body.data.leads) || Array.isArray(body.data.archivedLeads))) {
        const keep = (list: unknown) => (Array.isArray(list) ? list.filter((x: any) => inSalesScope('pipeline', scope, x)) : list)
        return json({ ...body, data: { ...body.data, leads: keep(body.data.leads), archivedLeads: keep(body.data.archivedLeads) } })
      }
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
  const allIn = async (s: SalesScope) => {
    for (const { kind, id } of named) if (!(await idInSalesScope(kind, s, id))) return false
    return true
  }
  if (await allIn(scope)) return false
  // The scope is kept a few seconds: a quote or job made since then (by the office too) is read again once before refusing.
  forgetScope(scope.userId)
  const fresh = await scopeFor(scope.userId, scope.accountId)
  if (fresh && await allIn(fresh)) return false
  notFound(res)
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
