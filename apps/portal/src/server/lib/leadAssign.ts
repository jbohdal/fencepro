/**
 * Website and phone leads nobody has assigned (Jonathan, Oct 28 2026):
 * "Leads: unassigned website and phone leads push me right away with a one
 * tap Assign (to me or Christa). They never sit unseen."
 *
 * Since the Salesman sees only the Salesman's own and assigned customers
 * (lib/salesScope.ts), a lead from the website or the phone agent reaches
 * the Salesman only once someone assigns it. So:
 *
 *   - A new lead with no rep pushes the owner (and admins) at once: who it
 *     is, where it came from, the town and what they asked for. Tapping it
 *     opens the Assign screen (/assign-lead?customer=<id>); where the phone
 *     shows a push's buttons (Android Chrome, a computer) the choices are on
 *     the push itself. On the dev copy the push is held in the dev outbox
 *     (lib/outboundGate.ts), never sent.
 *   - Assign: one tap per person (the owner, admins and every active
 *     Salesman login, by name). It writes the rep on the customer (Sales
 *     rep) and on the customer's open pipeline cards (assignedRep): the two
 *     things salesScope reads, so the Salesman has it on the next screen
 *     load. A note on the customer's History says who assigned it, to whom
 *     and when. A lead already assigned to someone else is not changed
 *     without saying so first (409 ALREADY_ASSIGNED; the screen asks).
 *     The customer's open quotes (and their commission) move with it; sold
 *     ones stay with whoever sold them (lib/quotesFollowCustomer.ts).
 *   - Only the owner, admin, manager and office assign. Not the Salesman.
 *     A lead that already has someone moves to another person only by the
 *     owner (Jonathan, Oct 29 2026, "owner only"; lib/salesmanChoice.ts
 *     isOwnerLogin): anyone else gets a 403 saying who has it.
 *   - Until assigned, the lead is on the waiting list the owner's Dashboard,
 *     Today and Sales Pipeline show at the top, whether or not the push
 *     reached a phone.
 */

import prisma from './prisma.js'
import { repName, sameName, SALESMAN_ROLE, ASSIGN_NOTE_PREFIX } from './salesRep.js'
import { forgetScope } from './salesScope.js'
import { loadPipelineStages } from './pipelineStages.js'
import { isFinishedStage } from './pipelineStageModel.js'
import { applyPipelineDelta } from './pipelineDelta.js'
import { holdOutbound, realDeliveryAllowed } from './outboundGate.js'
import { moveCallbacks, moveUpcomingVisits, loginForRep } from './leadCallback.js'
import type { PushMessage, PushResult } from './automations/push.js'
import { moveOpenQuotes, samePerson, type MovedQuote } from './quotesFollowCustomer.js'

/** Roles that may assign a lead: the owner, admin, manager and office. Never the Salesman or the Installer. */
export const ASSIGNER_ROLES = new Set(['super_admin', 'admin', 'manager', 'office_staff'])
/** Who a lead can be assigned to: the owner and admins, and every Salesman. */
const ASSIGNEE_ROLES = ['super_admin', 'admin', SALESMAN_ROLE] as const
/** A lead older than this with no rep is taken as handled some other way and leaves the waiting list. */
export const WAITING_DAYS = 30
export { ASSIGN_NOTE_PREFIX }

export const canAssignLeads = (role: string | null | undefined): boolean => !!role && ASSIGNER_ROLES.has(role)

const SOURCE_WORDS: Record<string, string> = { ez_quote: 'Website quote', ez_quote_partial: "Didn't finish instant quote", retell: 'Phone call', website_chat: 'Website chat' }
export const sourceWords = (source: string | null | undefined): string => SOURCE_WORDS[String(source || '')] ?? 'New lead'

/**
 * The town of an address as people write it: "12 Elm St, Ocala, FL 34470",
 * "12 Elm St, Ocala FL 34470", "Ocala, Florida". Empty when it cannot tell.
 */
export function townOf(address: string | null | undefined): string {
  const parts = String(address || '').split(',').map(p => p.trim()).filter(Boolean).filter(p => !/^(usa|us|united states)$/i.test(p))
  if (!parts.length) return ''
  const stateOnly = /^(fl|florida)?\s*\d{5}(-\d{4})?$|^(fl|florida)$/i
  let i = parts.length - 1
  if (stateOnly.test(parts[i]) && i > 0) i--
  const town = parts[i].replace(/\s+(fl|florida)\b.*$/i, '').replace(/\s+\d{5}(-\d{4})?$/, '').trim()
  // What is left is the street ("12 Elm St", "12 Elm St, FL"): no town.
  if (i === 0 && /^\d/.test(town)) return ''
  return town
}

export interface LeadFacts {
  name: string; source: string; address?: string | null; fenceType?: string | null; feet?: number | null; callbackAt?: string | null
  /** What they asked for when it is not a fence or a call back (a website chat's booked visit). */
  asked?: string | null
}

/** What the push says, in a few words. */
export function leadPushWords(l: LeadFacts): { title: string; body: string } {
  const name = String(l.name || '').trim() || 'Someone'
  const town = townOf(l.address)
  const what = [String(l.fenceType || '').trim(), l.feet && l.feet > 0 ? `${Math.round(l.feet)} ft` : ''].filter(Boolean).join(', ')
  const asked = what || (l.callbackAt ? `call back ${String(l.callbackAt).trim()}` : '') || String(l.asked || '').trim()
  const body = [sourceWords(l.source), town, asked].filter(Boolean).join(' · ')
  return { title: `New lead: ${name}`, body: `${body}. Tap to assign.` }
}

export interface Assignee { id: string; name: string; role: string; email: string }

/** The people a lead can go to: owner and admins first, then each active Salesman, by name. */
export async function assignees(accountId: string): Promise<Assignee[]> {
  const users = await prisma.crmUser.findMany({
    where: { crmAccountId: accountId, status: 'active', role: { in: [...ASSIGNEE_ROLES] as any } },
    select: { id: true, firstName: true, lastName: true, role: true, email: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  const rank = (r: string) => (r === 'super_admin' ? 0 : r === 'admin' ? 1 : 2)
  return users
    .map(u => ({ id: u.id, name: repName(u) || u.email, role: String(u.role), email: u.email, at: u.createdAt.getTime() }))
    .sort((a, b) => rank(a.role) - rank(b.role) || (a.role === SALESMAN_ROLE ? a.name.localeCompare(b.name) : a.at - b.at))
    .map(({ at: _at, ...u }) => u)
}

/** The owner and admins: who the push goes to. */
async function ownerIds(accountId: string): Promise<Array<{ id: string; name: string }>> {
  const users = await prisma.crmUser.findMany({ where: { crmAccountId: accountId, status: 'active', role: { in: ['super_admin', 'admin'] as any } }, select: { id: true, firstName: true, lastName: true, email: true } })
  return users.map(u => ({ id: u.id, name: repName(u) || u.email }))
}

export interface LeadRep { name: string; from: 'customer' | 'card' | 'appointment'; by: string | null; at: string | null }

/** The cards on the board for a customer. */
const cardsOf = (leads: any[], contactId: string) => (Array.isArray(leads) ? leads : []).filter(l => l && typeof l === 'object' && l.customerId === contactId)

/** Who a lead is assigned to, or null: the customer's Sales rep, a card's rep, or an appointment booked with someone. */
export async function leadRepOf(accountId: string, contactId: string): Promise<LeadRep | null> {
  const [contact, board, appt] = await Promise.all([
    prisma.crmContact.findFirst({ where: { id: contactId, accountId }, select: { salesRep: true } }),
    prisma.pipelineState.findUnique({ where: { accountId }, select: { leads: true } }),
    prisma.appointment.findFirst({ where: { accountId, crmContactId: contactId, deletedAt: null, OR: [{ assignedTo: { not: '' } }, { assignedToUserId: { not: null } }] }, select: { assignedTo: true, assignedToUserId: true } }),
  ])
  let rep: Pick<LeadRep, 'name' | 'from'> | null = null
  if (contact?.salesRep?.trim()) rep = { name: contact.salesRep.trim(), from: 'customer' }
  if (!rep) {
    const card = cardsOf(board?.leads as any[], contactId).find(c => typeof c.assignedRep === 'string' && c.assignedRep.trim())
    if (card) rep = { name: String(card.assignedRep).trim(), from: 'card' }
  }
  if (!rep && appt) {
    let name = appt.assignedTo?.trim() || ''
    if (!name && appt.assignedToUserId) {
      const u = await prisma.crmUser.findUnique({ where: { id: appt.assignedToUserId }, select: { firstName: true, lastName: true } })
      name = u ? repName(u) : ''
    }
    if (name) rep = { name, from: 'appointment' }
  }
  if (!rep) return null
  const note = await prisma.crmContactNote.findFirst({ where: { crmContactId: contactId, accountId, deletedAt: null, body: { startsWith: ASSIGN_NOTE_PREFIX } }, orderBy: { createdAt: 'desc' }, select: { createdBy: true, createdAt: true, body: true } })
  const noteNamesRep = !!note && sameName(note.body.slice(ASSIGN_NOTE_PREFIX.length).split(' by ')[0].replace(/\.$/, ''), rep.name)
  return { ...rep, by: noteNamesRep ? note!.createdBy : null, at: noteNamesRep ? note!.createdAt.toISOString() : null }
}

// ── The push ────────────────────────────────────────────────────────────────

export type LeadPushSend = (accountId: string, msg: PushMessage, userIds: string[]) => Promise<PushResult>
/** The Assign screen for one lead: where its push and its bell entry open. */
export const assignLeadLink = (contactId: string): string => `/assign-lead?customer=${encodeURIComponent(contactId)}`

/**
 * Where a new lead's bell entry goes: the Assign screen while nobody has it
 * (review, Oct 28 2026: the bell opened the customer page, with no Assign
 * buttons), else `otherwise` (its card, its customer).
 */
export async function newLeadLink(accountId: string, contactId: string, otherwise: string | null): Promise<string | null> {
  const rep = await leadRepOf(accountId, contactId).catch(() => null)
  return rep ? otherwise : assignLeadLink(contactId)
}

export interface LeadPushDeps { send?: LeadPushSend; allowed?: boolean }
export interface LeadPushOutcome { pushed: boolean; why?: string; title?: string; body?: string; to?: string[]; held?: boolean; result?: PushResult }

/** Pushes still on their way (the intake answers the website without waiting); the tests wait on them. */
const inFlight = new Set<Promise<unknown>>()
export async function leadPushesSettled(): Promise<void> {
  while (inFlight.size) await Promise.allSettled([...inFlight])
}

/** Push the owner about a new lead, in the background (never slows or fails the intake). */
export function pushNewLeadSoon(accountId: string, contactId: string, facts: LeadFacts, deps: LeadPushDeps = {}): void {
  const p = pushNewLead(accountId, contactId, facts, deps)
    .catch(err => { console.error('[lead-assign] push failed:', String((err as Error)?.message || err).slice(0, 200)) })
    .finally(() => { inFlight.delete(p) })
  inFlight.add(p)
}

/**
 * One push to the owner and admins for a new lead with no rep. A lead that
 * already has one (a Sales rep, a card's rep, an appointment booked with
 * someone) gets none. Not sent from the dev copy or tests: held in the dev
 * outbox. Nobody signed up for push on a phone: nothing goes out, and the
 * lead is on the waiting list in the app all the same.
 */
export async function pushNewLead(accountId: string, contactId: string, facts: LeadFacts, deps: LeadPushDeps = {}): Promise<LeadPushOutcome> {
  if (await leadRepOf(accountId, contactId)) return { pushed: false, why: 'already assigned' }
  return deliverLeadPush(accountId, contactId, leadPushWords(facts), deps)
}

/**
 * Send one lead push (the first, or a repeat: lib/leadRepush.ts) to the owner
 * and admins, with its Assign buttons. Held in the dev outbox off the live
 * install. `renotify`: the phone sounds again although a push for this lead
 * (same tag) is still showing.
 */
export async function deliverLeadPush(accountId: string, contactId: string, words: { title: string; body: string }, deps: LeadPushDeps = {}, opts: { renotify?: boolean } = {}): Promise<LeadPushOutcome> {
  const owners = await ownerIds(accountId)
  if (!owners.length) return { pushed: false, why: 'no owner login' }
  const { title, body } = words
  const url = assignLeadLink(contactId)
  // Buttons on the push where the phone shows them (not an iPhone home screen app): one per person, the push carries up to two.
  const people = await assignees(accountId)
  const actions = people.slice(0, 2).map(p => ({ action: `assign:${p.id}`, title: `Assign to ${p.name.split(' ')[0]}` }))
  const msg: PushMessage = { title, body, url, tag: `lead-${contactId}`, actions, assign: { customerId: contactId }, ...(opts.renotify ? { renotify: true } : {}) }
  const to = owners.map(o => o.id)
  const allowed = deps.allowed ?? realDeliveryAllowed()
  if (!allowed && !deps.send) {
    holdOutbound('push', owners.map(o => o.name).join(', '), title, `${body} (${url})`)
    return { pushed: true, held: true, title, body, to }
  }
  const send: LeadPushSend = deps.send ?? (async (a, m, ids) => (await import('./automations/push.js')).sendPush(a, m, { userIds: ids }))
  const result = await send(accountId, msg, to)
  return { pushed: true, title, body, to, result }
}

// ── Waiting to be assigned ─────────────────────────────────────────────────

export interface WaitingLead {
  customerId: string
  name: string
  source: string
  sourceWords: string
  town: string
  what: string
  phone: string
  at: string
  cardId: string | null
}

/**
 * Website and phone leads of the last WAITING_DAYS days with no rep: not
 * deleted, not archived, and not on a card that is finished (sold, lost)
 * or archived. Newest first.
 */
export async function waitingLeads(accountId: string, now = new Date()): Promise<WaitingLead[]> {
  const since = new Date(now.getTime() - WAITING_DAYS * 86_400_000)
  const rows = await prisma.intakeLead.findMany({
    where: { accountId, deletedAt: null, createdAt: { gte: since }, crmContactId: { not: null } },
    orderBy: { createdAt: 'desc' }, take: 500,
    select: { crmContactId: true, source: true, name: true, phone: true, address: true, fenceType: true, callbackAt: true, createdAt: true },
  })
  if (!rows.length) return []
  const ids = [...new Set(rows.map(r => r.crmContactId!))]
  const [contacts, board, appts, stages] = await Promise.all([
    prisma.crmContact.findMany({ where: { id: { in: ids }, accountId, deletedAt: null, archivedAt: null }, select: { id: true, firstName: true, lastName: true, salesRep: true, serviceAddress: true, phone: true } }),
    prisma.pipelineState.findUnique({ where: { accountId }, select: { leads: true, archivedLeads: true } }),
    prisma.appointment.findMany({ where: { accountId, crmContactId: { in: ids }, deletedAt: null, OR: [{ assignedTo: { not: '' } }, { assignedToUserId: { not: null } }] }, select: { crmContactId: true } }),
    loadPipelineStages(accountId).then(s => s.stages).catch(() => []),
  ])
  const leads = (board?.leads as any[]) ?? []
  const archived = (board?.archivedLeads as any[]) ?? []
  const booked = new Set(appts.map(a => a.crmContactId))
  const byId = new Map(contacts.map(c => [c.id, c]))
  const out: WaitingLead[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const id = r.crmContactId!
    if (seen.has(id)) continue
    seen.add(id)
    const c = byId.get(id)
    if (!c || c.salesRep?.trim() || booked.has(id)) continue
    const cards = cardsOf(leads, id)
    if (cards.some(k => typeof k.assignedRep === 'string' && k.assignedRep.trim())) continue
    // Handled on the board: its card is finished (sold, lost), or only archived ones are left.
    if (cards.length && cards.every(k => isFinishedStage(stages, k.stage))) continue
    if (!cards.length && cardsOf(archived, id).length) continue
    const open = cards.find(k => !isFinishedStage(stages, k.stage)) ?? null
    out.push({
      customerId: id,
      name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.replace(/\s+/g, ' ').trim() || r.name,
      source: r.source,
      sourceWords: sourceWords(r.source),
      town: townOf(c.serviceAddress || r.address),
      what: r.fenceType || (r.callbackAt ? `Call back ${r.callbackAt}` : ''),
      phone: c.phone || r.phone || '',
      at: r.createdAt.toISOString(),
      cardId: open?.id ?? null,
    })
  }
  return out
}

/** One lead for the Assign screen: what the waiting list says, plus who has it now (null: nobody). */
export async function leadForAssign(accountId: string, contactId: string): Promise<(WaitingLead & { rep: LeadRep | null }) | null> {
  const c = await prisma.crmContact.findFirst({ where: { id: contactId, accountId, deletedAt: null }, select: { id: true, firstName: true, lastName: true, serviceAddress: true, phone: true, leadSource: true, createdAt: true } })
  if (!c) return null
  const [intake, board, rep] = await Promise.all([
    prisma.intakeLead.findFirst({ where: { accountId, crmContactId: contactId, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { source: true, fenceType: true, callbackAt: true, createdAt: true, address: true, name: true } }),
    prisma.pipelineState.findUnique({ where: { accountId }, select: { leads: true } }),
    leadRepOf(accountId, contactId),
  ])
  const stages = await loadPipelineStages(accountId).then(s => s.stages).catch(() => [])
  const cards = cardsOf((board?.leads as any[]) ?? [], contactId)
  const open = cards.find(k => !isFinishedStage(stages, k.stage)) ?? cards[0] ?? null
  return {
    customerId: c.id,
    name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.replace(/\s+/g, ' ').trim() || intake?.name || 'Customer',
    source: intake?.source ?? '',
    sourceWords: intake ? sourceWords(intake.source) : (c.leadSource || 'Customer'),
    town: townOf(c.serviceAddress || intake?.address),
    what: intake?.fenceType || (intake?.callbackAt ? `Call back ${intake.callbackAt}` : ''),
    phone: c.phone || '',
    at: (intake?.createdAt ?? c.createdAt).toISOString(),
    cardId: open?.id ?? null,
    rep,
  }
}

// ── Assign ──────────────────────────────────────────────────────────────────

export type AssignAnswer =
  | { ok: true; already: boolean; assignedTo: string; cardIds: string[]; version: number | null; callbackIds: string[]; quotesMoved: MovedQuote[]; visitIds?: string[]; was?: string; wasKeeps?: number; customerName?: string }
  | { ok: false; status: number; code: string; error: string; rep?: LeadRep }

/**
 * Assign a lead to one person. `replace` is the answer to "Already assigned
 * to X: assign to Y instead?"; without it a lead someone else has is left as
 * it is (409 ALREADY_ASSIGNED, with who has it, who assigned it and when).
 */
export async function assignLead(input: { accountId: string; contactId: string; toUserId: string; by: { id: string; name: string }; replace?: boolean; byOwner: boolean }): Promise<AssignAnswer> {
  const { accountId, contactId } = input
  const contact = await prisma.crmContact.findFirst({ where: { id: contactId, accountId, deletedAt: null }, select: { id: true } })
  if (!contact) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'That customer is not on file any more.' }
  const people = await assignees(accountId)
  const target = people.find(p => p.id === input.toUserId)
  if (!target) return { ok: false, status: 400, code: 'NOT_ASSIGNABLE', error: 'Leads go to the owner or a Salesman with an active login.' }
  const current = await leadRepOf(accountId, contactId)
  // The rep may be written as the first name alone ("Christa"), as salesScope reads it.
  const isTarget = (name: string) => sameName(name, target.name) || sameName(name, target.name.split(' ')[0])
  if (current && isTarget(current.name)) {
    // Already theirs: make sure the customer and the cards both say so, no new note.
    const cardIds = await setCardsRep(accountId, contactId, target.name)
    await prisma.crmContact.updateMany({ where: { id: contactId, accountId, OR: [{ salesRep: null }, { salesRep: '' }] }, data: { salesRep: target.name } })
    // Its open call back too (D7, lib/leadCallback.ts), in case it was booked with someone else.
    const callbackIds = await moveCallbacks(accountId, contactId, target)
    // Open quotes left with someone else (before quotes moved with the customer) come along too (lib/quotesFollowCustomer.ts),
    // when the owner does it: moving a quote's Salesman is the owner's (Oct 29 2026), so the office's tap leaves them.
    const quotesMoved = input.byOwner ? await moveOpenQuotes({ accountId, contactId, toRep: target.name, by: input.by }) : []
    for (const p of callbackIds.length || quotesMoved.length ? people : [target]) forgetScope(p.id)
    const v = await prisma.pipelineState.findUnique({ where: { accountId }, select: { version: true } })
    return { ok: true, already: true, assignedTo: target.name, cardIds: cardIds ?? [], version: v?.version ?? null, callbackIds, quotesMoved }
  }
  // A lead that already has a Salesman moves to someone else only by the owner (Jonathan, Oct 29 2026: "owner
  // only"); the office keeps the one tap Assign of a lead nobody has.
  if (current && !input.byOwner) {
    return { ok: false, status: 403, code: 'NOT_ALLOWED', error: `Already assigned to ${current.name}. Only the owner can give a lead that has a Salesman to someone else.`, rep: current }
  }
  if (current && !input.replace) {
    const who = current.by ? ` by ${current.by}` : ''
    return { ok: false, status: 409, code: 'ALREADY_ASSIGNED', error: `Already assigned to ${current.name}${who}.`, rep: current }
  }

  await prisma.crmContact.update({ where: { id: contactId }, data: { salesRep: target.name } })
  const cardIds = await setCardsRep(accountId, contactId, target.name)
  if (cardIds === null) {
    // The board was busy for every try: the customer carries the rep, which is enough for the Salesman's scope.
    console.warn(`[lead-assign] could not write the rep on the cards of ${contactId}; the customer has it`)
  }
  // The call back moves with the lead (Jonathan, Oct 29 2026, D7): its open call backs go to the new person.
  const callbackIds = await moveCallbacks(accountId, contactId, target)
  // So do the upcoming visits that were with the Salesman it moves from (the owner's call, Oct 30 2026; lib/leadCallback.ts).
  const visitIds = current ? await moveUpcomingVisits(accountId, contactId, await loginForRep(accountId, current.name), current.name, target) : []
  await prisma.crmContactNote.create({
    data: {
      crmContactId: contactId, accountId, isPinned: false,
      body: `${ASSIGN_NOTE_PREFIX}${target.name} by ${input.by.name}.${current ? ` It was ${current.name}'s.` : ''}${callbackIds.length ? ` The call back went with it.` : ''}${visitIds.length ? ` ${visitIds.length === 1 ? 'The upcoming visit went' : `The ${visitIds.length} upcoming visits went`} with it.` : ''}`,
      createdBy: input.by.name, createdById: input.by.id,
    },
  })
  // The customer's open quotes and their commission go with the customer; sold ones stay (lib/quotesFollowCustomer.ts).
  const quotesMoved = await moveOpenQuotes({ accountId, contactId, toRep: target.name, by: input.by })
  // The Salesman's next request reads the scope again: this lead is in it (and out of the one it left).
  for (const p of people) forgetScope(p.id)
  const v = await prisma.pipelineState.findUnique({ where: { accountId }, select: { version: true } })
  // What stays with the Salesman it moved from (the owner's message says it, review Oct 30 2026): the signed quotes
  // still theirs keep the customer on their list (lib/salesScope.ts).
  const wasKeeps = current && !isTarget(current.name) ? await stillTheirs(accountId, contactId, current.name) : 0
  const who = await prisma.crmContact.findFirst({ where: { id: contactId }, select: { firstName: true, lastName: true } })
  const customerName = `${who?.firstName ?? ''} ${who?.lastName ?? ''}`.replace(/\s+/g, ' ').trim()
  return { ok: true, already: false, assignedTo: target.name, cardIds: cardIds ?? [], version: v?.version ?? null, callbackIds, quotesMoved, visitIds, was: current?.name, wasKeeps, customerName }
}

/** The customer's quotes (sold ones: the open ones went with the customer) whose Sales rep is still `rep`. */
async function stillTheirs(accountId: string, contactId: string, rep: string): Promise<number> {
  const qs = await prisma.savedQuote.findMany({ where: { accountId, crmContactId: contactId, deletedAt: null }, select: { salesRep: true } })
  return qs.filter(q => samePerson(q.salesRep, rep)).length
}

/**
 * Write the rep on the customer's open cards (not finished ones: a sold or
 * lost card keeps who had it). A versioned save like any other, tried again
 * when a browser saved in between. Null when the board stayed busy.
 */
export async function setCardsRep(accountId: string, contactId: string, rep: string): Promise<string[] | null> {
  const stages = await loadPipelineStages(accountId).then(s => s.stages).catch(() => [])
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await prisma.pipelineState.findUnique({ where: { accountId } })
    if (!state) return []
    const leads = (state.leads as any[]) ?? []
    const change = cardsOf(leads, contactId).filter(k => !isFinishedStage(stages, k.stage) && !sameName(k.assignedRep, rep))
    if (!change.length) return []
    const next = applyPipelineDelta({ leads, stages: (state.stages as any[]) ?? [] }, { upsert: change.map(k => ({ lead: { ...k, assignedRep: rep } })), remove: [] })
    const done = await prisma.pipelineState.updateMany({ where: { accountId, version: state.version }, data: { leads: JSON.parse(JSON.stringify(next.leads)), version: { increment: 1 } } })
    if (done.count === 1) return change.map(k => String(k.id))
  }
  return null
}
