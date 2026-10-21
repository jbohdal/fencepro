/**
 * Follow ups: tracked calls and texts instead of "write it in notes".
 *
 *   CallLog          every call, text or other touch and how it went
 *   CardFollowUp     per pipeline card: the next follow up and the step of
 *                    its stage's schedule (the rules: lib/followUpRules.ts)
 *   FollowUpSettings Settings > Follow ups: steps per stage, text templates
 *   PendingTouch     a call or text just started from the app, so "How'd it
 *                    go?" is asked when the person comes back
 *
 * Who sees what: everyone sees the badges on the pipeline (the pipeline is
 * already everyone's). The Follow ups list and the report are scoped on the
 * server: a salesman gets only the cards that are theirs; the owner, admins,
 * managers and the office see everyone and may pick a rep.
 *
 * A card's owner: the salesman named on the card (assignedRep, matched to a
 * login by name), else the person who first followed it up, else the owner
 * of the company.
 *
 * Texts are never sent from here: the app opens the phone's own texting app.
 */

import prisma from './prisma.js'
import { isFullRole } from './permissions.js'
import {
  applyAnswer, badgeFor, cleanConfig, defaultConfig, dueStatus, floridaDay, floridaHour, isDay, keepGoing,
  MUST_HAVE_FOLLOW_UP, setNext, stageSinceOf, startState, stopsSteps, reconcile, addDays, daysBetween,
  type Answer, type Channel, type FollowUpConfig, type FollowUpState, type LostReason, type Outcome,
} from './followUpRules.js'
import { openedForCard, longestOption, optionWords, viewHistoryItem, type Opened } from './proposalViewRules.js'

type Tx = any

// ── Settings ─────────────────────────────────────────────────────────────────

export async function loadConfig(accountId: string, db: Tx = prisma): Promise<{ config: FollowUpConfig; version: number }> {
  const row = await db.followUpSettings.findUnique({ where: { accountId } })
  if (!row) return { config: defaultConfig(), version: 0 }
  try { return { config: cleanConfig({ steps: row.steps, templates: row.templates }), version: row.version } } catch { return { config: defaultConfig(), version: row.version } }
}

/** Save Settings > Follow ups on the version it was built on. Returns null when someone saved in between. */
export async function saveConfig(accountId: string, input: unknown, baseVersion: number, userId: string): Promise<{ config: FollowUpConfig; version: number } | null> {
  const config = cleanConfig(input)
  if (baseVersion === 0) {
    try {
      const made = await prisma.followUpSettings.create({ data: { accountId, steps: config.steps as any, templates: config.templates as any, updatedBy: userId } })
      return { config, version: made.version }
    } catch { return null }
  }
  const done = await prisma.followUpSettings.updateMany({ where: { accountId, version: baseVersion }, data: { steps: config.steps as any, templates: config.templates as any, updatedBy: userId, version: { increment: 1 } } })
  if (!done.count) return null
  return { config, version: baseVersion + 1 }
}

// ── State rows ───────────────────────────────────────────────────────────────

function toState(row: any): FollowUpState {
  return {
    stage: row.stage, stageSince: row.stageSince, stepIndex: row.stepIndex, dueOn: row.dueOn ?? null,
    dueKind: row.dueKind, setBy: row.setBy, stoppedReason: row.stoppedReason ?? null,
    lastOutcome: row.lastOutcome ?? null, lastContactAt: row.lastContactAt ? new Date(row.lastContactAt).toISOString() : null,
    touches: row.touches ?? 0,
  }
}

function stateData(s: FollowUpState) {
  return {
    stage: s.stage, stageSince: s.stageSince, stepIndex: s.stepIndex, dueOn: s.dueOn, dueKind: s.dueKind, setBy: s.setBy,
    stoppedReason: s.stoppedReason, lastOutcome: s.lastOutcome, lastContactAt: s.lastContactAt ? new Date(s.lastContactAt) : null, touches: s.touches,
  }
}

async function saveState(db: Tx, accountId: string, cardId: string, s: FollowUpState, ownerUserId?: string | null) {
  const data = stateData(s)
  await db.cardFollowUp.upsert({
    where: { accountId_cardId: { accountId, cardId } },
    create: { accountId, cardId, ...data, ownerUserId: ownerUserId ?? null },
    update: { ...data, ...(ownerUserId ? { ownerUserId } : {}) },
  })
}

/**
 * The pipeline was saved: every card that changed stage (or is new) starts
 * its new stage's steps, from today. Called in the save's own transaction.
 */
export async function onCardMoves(db: Tx, accountId: string, before: any[], after: any[], today = floridaDay(new Date())): Promise<number> {
  const was = new Map(before.filter(l => l?.id).map(l => [l.id, l]))
  // A card taken off the board takes its follow up with it (its call log stays as history).
  const kept = new Set(after.filter(l => l?.id).map(l => l.id))
  const gone = [...was.keys()].filter(id => !kept.has(id))
  if (gone.length) await db.cardFollowUp.deleteMany({ where: { accountId, cardId: { in: gone } } })
  const moved = after.filter(l => l?.id && l.stage && was.get(l.id)?.stage !== l.stage)
  if (!moved.length) return gone.length
  const { config } = await loadConfig(accountId, db)
  const rows = await db.cardFollowUp.findMany({ where: { accountId, cardId: { in: moved.map(l => l.id) } } })
  const have = new Map<string, any>(rows.map((r: any) => [r.cardId, r]))
  let n = 0
  for (const card of moved) {
    const row = have.get(card.id)
    const prev = row ? toState(row) : null
    // A card that was never followed up and enters a stage without steps gets no row.
    const next = startState(card.stage, today, config, prev ?? undefined)
    if (!row && !next.dueOn && !next.stoppedReason) continue
    if (!row && next.stoppedReason) continue
    await saveState(db, accountId, card.id, next)
    n++
  }
  return n
}

// ── Who is who ───────────────────────────────────────────────────────────────

export interface Person { id: string; name: string; email: string; role: string }

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

export async function peopleOf(accountId: string): Promise<{ people: Person[]; owner: Person | null; byName: (rep: unknown) => Person | null }> {
  const users = await prisma.crmUser.findMany({
    where: { crmAccountId: accountId, role: { not: 'customer' as any } },
    select: { id: true, firstName: true, lastName: true, email: true, role: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  const people: Person[] = users.filter(u => String(u.status) !== 'deleted').map(u => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), email: u.email, role: String(u.role) }))
  const owner = people.find(p => p.role === 'super_admin') ?? people.find(p => p.role === 'admin') ?? null
  const full = new Map(people.map(p => [norm(p.name), p]))
  const firsts = new Map<string, Person[]>()
  for (const p of people) { const f = norm(p.name).split(' ')[0]; if (f) firsts.set(f, [...(firsts.get(f) ?? []), p]) }
  const byName = (rep: unknown): Person | null => {
    const n = norm(rep)
    if (!n) return null
    const hit = full.get(n)
    if (hit) return hit
    const one = firsts.get(n)
    return one && one.length === 1 ? one[0] : null
  }
  return { people, owner, byName }
}

/** May this role see everyone's follow ups (and pick a rep)? Owner, admin, manager and the office. */
export function seesEveryone(role: string | null | undefined): boolean {
  return isFullRole(role) || role === 'office_staff'
}

// ── Cards with their follow ups ──────────────────────────────────────────────

export interface CardRow {
  cardId: string
  customerId: string | null
  name: string
  firstName: string
  stage: string
  phone: string
  address: string
  valueCents: number
  ownerId: string | null
  ownerName: string
  dueOn: string | null
  dueKind: string
  status: string
  days: number
  stepIndex: number
  stepCount: number
  lastOutcome: string | null
  lastContactAt: string | null
  daysSinceContact: number | null
  touches: number
  badge: { text: string; tone: string } | null
  /** The follow up as it stands (null: never followed up), for the app to work an answer out with no signal. */
  state: FollowUpState | null
  /** Customer opens of the proposal sent (null: none sent, nothing shown). */
  opened: Opened | null
}

/** A card's value: the customer's newest open quote (sent beats draft on the same day), else what the card says. Whole dollars to cents. */
function valueOf(card: any, quotes: Array<{ crmContactId: string | null; status: string; date: string; finalPrice: number }>): number {
  const mine = card.customerId ? quotes.filter(q => q.crmContactId === card.customerId) : []
  const latest = (list: typeof mine) => list.reduce<(typeof mine)[number] | undefined>((b, q) => (!b || (q.date || '') > (b.date || '') ? q : b), undefined)
  let q: (typeof mine)[number] | undefined
  if (stopsSteps(card.stage) === 'signed') q = latest(mine.filter(x => x.status === 'SOLD'))
  else {
    const sent = latest(mine.filter(x => x.status === 'SENT')), draft = latest(mine.filter(x => x.status === 'DRAFT'))
    q = sent && draft ? ((draft.date || '') > (sent.date || '') ? draft : sent) : sent || draft
  }
  const dollars = q ? q.finalPrice || 0 : Number(card.quotePrice || card.jobValue || 0)
  return Math.round((Number.isFinite(dollars) ? dollars : 0) * 100)
}

/** Every card of the company with its follow up as it stands today. */
export async function cardRows(accountId: string, now = new Date()): Promise<{ rows: CardRow[]; config: FollowUpConfig; people: Person[]; today: string }> {
  const today = floridaDay(now)
  const [pipe, { config }, states, quotes, who] = await Promise.all([
    prisma.pipelineState.findUnique({ where: { accountId }, select: { leads: true } }),
    loadConfig(accountId),
    prisma.cardFollowUp.findMany({ where: { accountId } }),
    prisma.savedQuote.findMany({ where: { accountId, archivedAt: null, status: { in: ['DRAFT', 'SENT', 'SOLD'] as any } }, select: { crmContactId: true, status: true, date: true, finalPrice: true, shareToken: true, viewCount: true, lastViewedAt: true, acceptedAt: true } }),
    peopleOf(accountId),
  ])
  const leads = ((pipe?.leads as any[]) ?? []).filter(l => l?.id)
  const byCard = new Map(states.map(s => [s.cardId, s]))
  const contactIds = [...new Set(leads.map(l => l.customerId).filter(Boolean))] as string[]
  const contacts = contactIds.length ? await prisma.crmContact.findMany({ where: { id: { in: contactIds } }, select: { id: true, phone: true } }) : []
  const phoneOf = new Map(contacts.map(c => [c.id, c.phone || '']))
  const q = quotes.map(x => ({ crmContactId: x.crmContactId, status: String(x.status), date: x.date, finalPrice: x.finalPrice }))
  const opens = quotes.map(x => ({ crmContactId: x.crmContactId, status: String(x.status), shareToken: x.shareToken, viewCount: x.viewCount, lastViewedAt: x.lastViewedAt, acceptedAt: x.acceptedAt }))
  const rows: CardRow[] = leads.map(card => {
    const row = byCard.get(card.id)
    const state = reconcile(row ? toState(row) : null, card, config, today)
    const owner = who.byName(card.assignedRep) ?? who.people.find(p => p.id === row?.ownerUserId) ?? who.owner
    const s = dueStatus(state, today)
    const steps = config.steps[card.stage] ?? []
    const last = state?.lastContactAt ? floridaDay(state.lastContactAt) : null
    return {
      cardId: card.id, customerId: card.customerId ?? null,
      name: `${card.firstName ?? ''} ${card.lastName ?? ''}`.trim() || 'Customer', firstName: String(card.firstName ?? ''),
      stage: card.stage, phone: String(card.phone || phoneOf.get(card.customerId) || ''), address: String(card.address || ''),
      valueCents: valueOf(card, q),
      ownerId: owner?.id ?? null, ownerName: owner?.name ?? '',
      dueOn: state?.dueOn ?? null, dueKind: state?.dueKind ?? 'call', status: s.status, days: s.days,
      stepIndex: state && state.stage === card.stage ? state.stepIndex : 0, stepCount: steps.length,
      lastOutcome: state?.lastOutcome ?? null, lastContactAt: state?.lastContactAt ?? null,
      daysSinceContact: last ? daysBetween(last, today) : null, touches: state?.touches ?? 0,
      badge: badgeFor(state, card.stage, today),
      state,
      opened: openedForCard(card, opens),
    }
  })
  return { rows, config, people: who.people, today }
}

export interface OpenedRow extends CardRow { openedAt: string; openedDevice: string; openedLongest: string; openedTimes: number }

/**
 * Cards whose customer opened the proposal in the last 24 hours (staff views
 * never), newest open first, each with its latest open: when, on what, and the
 * option looked at longest. Closed cards (signed, lost) are left out.
 */
export async function openedLastDay(accountId: string, rows: CardRow[], now = new Date()): Promise<OpenedRow[]> {
  const views = await prisma.proposalView.findMany({
    where: { accountId, staff: false, startedAt: { gt: new Date(now.getTime() - 86_400_000) } },
    orderBy: { startedAt: 'desc' }, take: 500,
    select: { quoteId: true, cardId: true, crmContactId: true, startedAt: true, device: true, optionMs: true },
  })
  if (!views.length) return []
  const quotes = await prisma.savedQuote.findMany({ where: { id: { in: [...new Set(views.map(v => v.quoteId))] } }, select: { id: true, proposal: true } })
  const optionsOf = new Map(quotes.map(q => [q.id, ((q.proposal as any)?.options ?? []) as any[]]))
  const byCard = new Map<string, { v: (typeof views)[number]; times: number }>()
  for (const v of views) {
    const cards = v.cardId && rows.some(r => r.cardId === v.cardId) ? [v.cardId] : rows.filter(r => r.customerId && r.customerId === v.crmContactId).map(r => r.cardId)
    for (const c of cards) {
      const had = byCard.get(c)
      if (had) had.times++
      else byCard.set(c, { v, times: 1 })
    }
  }
  const out: OpenedRow[] = []
  for (const r of rows) {
    const hit = byCard.get(r.cardId)
    if (!hit || stopsSteps(r.stage)) continue
    const options = optionsOf.get(hit.v.quoteId) ?? []
    const top = longestOption(hit.v.optionMs as Record<string, number>)
    out.push({ ...r, openedAt: hit.v.startedAt.toISOString(), openedDevice: hit.v.device, openedLongest: top && options.length > 1 ? optionWords(options[top.index]) : '', openedTimes: hit.times })
  }
  return out.sort((a, b) => b.openedAt.localeCompare(a.openedAt))
}

/** The Follow ups screen: opened in the last day, overdue, due today and coming up, for this person (or a rep the owner picked). */
export async function followUpList(accountId: string, viewer: { id: string; role: string | null }, rep?: string | null) {
  const { rows, people, today } = await cardRows(accountId)
  const all = seesEveryone(viewer.role)
  const who = all ? (rep || null) : viewer.id
  const open = rows.filter(r => !stopsSteps(r.stage) && (r.status === 'overdue' || r.status === 'today' || r.status === 'upcoming' || (r.status === 'none' && MUST_HAVE_FOLLOW_UP.includes(r.stage))))
  const mine = who ? open.filter(r => r.ownerId === who) : open
  const by = (a: CardRow, b: CardRow) => (a.dueOn || '').localeCompare(b.dueOn || '') || b.valueCents - a.valueCents
  // The rep picker: everyone who owns a card with a follow up (the owner and office only).
  const reps = all ? people.filter(p => open.some(r => r.ownerId === p.id)).map(p => ({ id: p.id, name: p.name })) : []
  const opened = await openedLastDay(accountId, who ? rows.filter(r => r.ownerId === who) : rows)
  return {
    today, seesEveryone: all, rep: who,
    opened24h: opened,
    overdue: mine.filter(r => r.status === 'overdue').sort(by),
    dueToday: mine.filter(r => r.status === 'today').sort(by),
    upcoming: mine.filter(r => r.status === 'upcoming').sort(by).slice(0, 200),
    notSet: mine.filter(r => r.status === 'none').sort((a, b) => b.valueCents - a.valueCents),
    reps,
  }
}

// ── Answers ──────────────────────────────────────────────────────────────────

export interface CallInput {
  id: string
  cardId: string
  channel: Channel
  outcome: Outcome
  lostReason?: LostReason | null
  note?: string
  pickedOn?: string | null
  at?: string | null
}

/** Save an answer, once (the id is the phone's). Returns the card's follow up after it. */
export async function logCall(accountId: string, user: { id: string; name: string }, input: CallInput): Promise<{ state: FollowUpState; already: boolean; log: any }> {
  const now = new Date()
  const at = input.at && !Number.isNaN(Date.parse(input.at)) && Date.parse(input.at) <= now.getTime() + 5 * 60_000 ? new Date(input.at) : now
  const today = floridaDay(at)
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'followup:' + accountId + ':' + input.cardId}))`
    const had = await tx.callLog.findUnique({ where: { id: input.id } })
    const pipe = await tx.pipelineState.findUnique({ where: { accountId }, select: { leads: true } })
    const card = ((pipe?.leads as any[]) ?? []).find(l => l?.id === input.cardId)
    const { config } = await loadConfig(accountId, tx)
    const row = await tx.cardFollowUp.findUnique({ where: { accountId_cardId: { accountId, cardId: input.cardId } } })
    if (had) {
      if (had.accountId !== accountId) throw Object.assign(new Error('That id is taken.'), { status: 409 })
      return { state: row ? toState(row) : startState(card?.stage ?? had.stage, today, config), already: true, log: had }
    }
    if (!card) throw Object.assign(new Error('That card is not on the pipeline any more.'), { status: 404 })
    const before = reconcile(row ? toState(row) : null, card, config, today)
    const answer: Answer = { outcome: input.outcome, pickedOn: input.pickedOn ?? null, today, at: at.toISOString() }
    const next = applyAnswer(row ? toState(row) : null, card, config, answer)
    const log = await tx.callLog.create({
      data: {
        id: input.id, accountId, cardId: input.cardId, crmContactId: card.customerId ?? null, userId: user.id, userName: user.name,
        channel: input.channel, outcome: input.outcome, lostReason: input.outcome === 'lost' ? (input.lostReason ?? 'other') : null,
        note: (input.note ?? '').trim().slice(0, 1000), stage: card.stage, at,
        dueOn: before?.dueOn ?? null, nextFollowUpOn: next.dueOn,
      },
    })
    await saveState(tx, accountId, input.cardId, next, row?.ownerUserId ? null : user.id)
    // The question for this call is answered.
    await tx.pendingTouch.deleteMany({ where: { userId: user.id, cardId: input.cardId } })
    return { state: next, already: false, log }
  }, { timeout: 15_000 })
}

/** One tap to change the next follow up (null clears it), or "keep" to start the steps again. */
export async function changeNext(accountId: string, userId: string, cardId: string, change: { dueOn?: string | null; keep?: boolean }): Promise<FollowUpState> {
  const today = floridaDay(new Date())
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'followup:' + accountId + ':' + cardId}))`
    const pipe = await tx.pipelineState.findUnique({ where: { accountId }, select: { leads: true } })
    const card = ((pipe?.leads as any[]) ?? []).find(l => l?.id === cardId)
    if (!card) throw Object.assign(new Error('That card is not on the pipeline any more.'), { status: 404 })
    const { config } = await loadConfig(accountId, tx)
    const row = await tx.cardFollowUp.findUnique({ where: { accountId_cardId: { accountId, cardId } } })
    const prev = row ? toState(row) : null
    const next = change.keep ? keepGoing(reconcile(prev, card, config, today), card, config, today) : setNext(prev, card, config, change.dueOn ?? null, today)
    await saveState(tx, accountId, cardId, next, row?.ownerUserId ? null : userId)
    return next
  }, { timeout: 15_000 })
}

// ── Item j: a first follow up on the open cards that have none ──────────────

/** Open cards in Estimating and Pending Signature with no follow up set, by owner. Reads only. */
export async function firstFollowUpPreview(accountId: string) {
  const { rows, today } = await cardRows(accountId)
  const cards = rows.filter(r => MUST_HAVE_FOLLOW_UP.includes(r.stage) && r.status === 'none')
  const byOwner = new Map<string, { ownerId: string | null; name: string; count: number }>()
  for (const r of cards) {
    const k = r.ownerId ?? ''
    const cur = byOwner.get(k) ?? { ownerId: r.ownerId, name: r.ownerName || 'Nobody', count: 0 }
    cur.count++
    byOwner.set(k, cur)
  }
  return { count: cards.length, dueOn: addDays(today, 1), byOwner: [...byOwner.values()].sort((a, b) => b.count - a.count), cardIds: cards.map(r => r.cardId) }
}

/**
 * Set a first follow up, due tomorrow, for the card's owner, on every open
 * Estimating and Pending Signature card that has none. Only when the owner
 * presses the button (never at start-up). One at a time per company (a lock),
 * in one transaction; a card that got a follow up meanwhile is left alone.
 */
export async function runFirstFollowUp(accountId: string): Promise<{ set: number; dueOn: string }> {
  const preview = await firstFollowUpPreview(accountId)
  const { rows } = await cardRows(accountId)
  const owners = new Map(rows.map(r => [r.cardId, r.ownerId]))
  const today = floridaDay(new Date())
  const dueOn = addDays(today, 1)
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'followup-first:' + accountId}))`
    const pipe = await tx.pipelineState.findUnique({ where: { accountId }, select: { leads: true } })
    const leads = new Map((((pipe?.leads as any[]) ?? []).filter(l => l?.id)).map(l => [l.id, l]))
    const { config } = await loadConfig(accountId, tx)
    let set = 0
    for (const cardId of preview.cardIds) {
      const card = leads.get(cardId)
      if (!card || !MUST_HAVE_FOLLOW_UP.includes(card.stage)) continue
      const row = await tx.cardFollowUp.findUnique({ where: { accountId_cardId: { accountId, cardId } } })
      const now = reconcile(row ? toState(row) : null, card, config, today)
      if (now?.dueOn && !now.stoppedReason) continue
      const base = now ?? startState(card.stage, stageSinceOf(card, today), config)
      const next: FollowUpState = { ...base, stage: card.stage, dueOn: dueOn, dueKind: 'call', setBy: 'first', stoppedReason: null }
      await saveState(tx, accountId, cardId, next, owners.get(cardId) ?? null)
      set++
    }
    return { set, dueOn }
  }, { timeout: 60_000 })
}

// ── The 7 am push ────────────────────────────────────────────────────────────

/**
 * Whether this copy may deliver pushes to phones. Only the live install
 * (production, not the dev database): the dev copy holds live's data,
 * including the phones that turned push on.
 */
export function pushDeliveryAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== 'production') return false
  return !/\/ezbiz_dev(\?|$)/.test(env.DATABASE_URL || '')
}

/** The ledger key for one person's morning push on one day: sent at most once. */
export const morningKey = (userId: string, day: string) => `followup-morning:${userId}:${day}`

export interface MorningMessage { userId: string; email: string; name: string; title: string; body: string; count: number }

/** What each person's 7 am push says (their own calls for today and overdue ones). */
export function morningMessages(rows: CardRow[], people: Person[]): MorningMessage[] {
  const out: MorningMessage[] = []
  for (const p of people) {
    const mine = rows.filter(r => r.ownerId === p.id && !stopsSteps(r.stage) && (r.status === 'today' || r.status === 'overdue'))
    if (!mine.length) continue
    const overdue = mine.filter(r => r.status === 'overdue').length
    const names = mine.slice().sort((a, b) => (a.dueOn || '').localeCompare(b.dueOn || '')).slice(0, 4).map(r => r.name)
    const title = `${mine.length} follow up${mine.length === 1 ? '' : 's'} today`
    const body = `${names.join(', ')}${mine.length > names.length ? ` and ${mine.length - names.length} more` : ''}.${overdue ? ` ${overdue} overdue.` : ''}`
    out.push({ userId: p.id, email: p.email, name: p.name, title, body, count: mine.length })
  }
  return out
}

/**
 * From 7 am Florida time (until noon, so an app started late in the morning
 * still sends; after noon the day is skipped): each person gets one push with
 * their calls for the day. The ledger row and the bell notification are saved
 * together, so a day's push is made once per person however often this runs.
 */
export async function followUpMorningPush(now = new Date(), deps: { send?: (accountId: string, msg: { title: string; body: string; url: string; tag: string }, userIds: string[]) => Promise<unknown>; allowed?: boolean; accountIds?: string[] } = {}): Promise<{ made: number; delivered: number; logged: string[] }> {
  const out = { made: 0, delivered: 0, logged: [] as string[] }
  const hour = floridaHour(now)
  if (hour < 7 || hour >= 12) return out
  const day = floridaDay(now)
  const allowed = deps.allowed ?? pushDeliveryAllowed()
  const accounts = await prisma.pipelineState.findMany({ where: deps.accountIds ? { accountId: { in: deps.accountIds } } : undefined, select: { accountId: true } })
  for (const { accountId } of accounts) {
    const { rows, people } = await cardRows(accountId, now)
    for (const m of morningMessages(rows, people)) {
      const key = morningKey(m.userId, day)
      // Already made today (the unique key below still guards two at once).
      if (await prisma.automationEffect.findUnique({ where: { key }, select: { key: true } })) continue
      try {
        await prisma.$transaction(async tx => {
          await tx.automationEffect.create({ data: { key, runId: 'followup-morning', status: 'done', result: { count: m.count } as any } })
          await tx.notification.create({ data: { recipientId: m.email, title: m.title, body: m.body, type: 'info', link: '/follow-ups' } })
        })
      } catch { continue } // already made today
      out.made++
      if (!allowed) {
        const line = `[follow-ups] dev copy: 7 am push not delivered to ${m.name}: ${m.title}. ${m.body}`
        console.log(line); out.logged.push(line)
        continue
      }
      try {
        const send = deps.send ?? (async (a, msg, userIds) => (await import('./automations/push.js')).sendPush(a, msg, { userIds }))
        await send(accountId, { title: m.title, body: m.body, url: '/follow-ups', tag: `followups-${day}` }, [m.userId])
        out.delivered++
      } catch (err) { console.error('[follow-ups] morning push:', String((err as Error)?.message || err).slice(0, 200)) }
    }
  }
  return out
}

// ── One history per customer ─────────────────────────────────────────────────

export interface HistoryItem { at: string; kind: string; title: string; detail: string; by: string }

const money = (dollars: number) => '$' + Math.round(dollars || 0).toLocaleString('en-US')
const OUTCOME_WORDS: Record<string, string> = {
  no_answer: 'No answer', voicemail: 'Left voicemail', deciding: 'Talked, still deciding', not_now: 'Talked, not now',
  booked: 'Booked appointment', signed: 'Signed', lost: 'Lost',
}
const LOST_WORDS: Record<string, string> = { price: 'price', competitor: 'went with someone else', not_needed: 'no longer needed', other: 'other' }
const APPT_WORDS: Record<string, string> = { estimate: 'Estimate', follow_up: 'Follow up visit', contract_signing: 'Contract signing', install: 'Install', service: 'Service', warranty: 'Warranty', call_back: 'Call back', other: 'Appointment' }

/** Calls, texts, emails, quotes sent, proposal opens, appointments and notes, newest first. */
export async function customerHistory(accountId: string, opts: { customerId?: string | null; cardId?: string | null }): Promise<HistoryItem[]> {
  const { customerId, cardId } = opts
  if (!customerId && !cardId) return []
  const items: HistoryItem[] = []
  const calls = await prisma.callLog.findMany({
    where: { accountId, OR: [...(customerId ? [{ crmContactId: customerId }] : []), ...(cardId ? [{ cardId }] : [])] },
    orderBy: { at: 'desc' }, take: 200,
  })
  for (const c of calls) {
    const what = c.channel === 'text' ? 'Text' : c.channel === 'other' ? 'Contact' : 'Call'
    const outcome = OUTCOME_WORDS[c.outcome] ?? c.outcome
    const extra = c.outcome === 'lost' && c.lostReason ? ` (${LOST_WORDS[c.lostReason] ?? c.lostReason})` : ''
    const next = c.nextFollowUpOn ? ` Next follow up ${c.nextFollowUpOn}.` : ''
    items.push({ at: c.at.toISOString(), kind: c.channel === 'text' ? 'text' : 'call', title: `${what}: ${outcome}${extra}`, detail: `${c.note ? c.note + ' ' : ''}${next}`.trim(), by: c.userName })
  }
  if (customerId) {
    const [notes, appts, quotes] = await Promise.all([
      prisma.crmContactNote.findMany({ where: { crmContactId: customerId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 200 }),
      prisma.appointment.findMany({ where: { accountId, crmContactId: customerId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.savedQuote.findMany({
        where: { accountId, crmContactId: customerId, archivedAt: null },
        select: { id: true, status: true, date: true, finalPrice: true, fenceStyle: true, createdAt: true, proposal: true, shareToken: true, firstViewedAt: true, lastViewedAt: true, viewCount: true, acceptedAt: true, acceptedBy: true },
        orderBy: { createdAt: 'desc' }, take: 100,
      }),
    ])
    const allViews = quotes.length ? await prisma.proposalView.findMany({ where: { accountId, quoteId: { in: quotes.map(q => q.id) } }, orderBy: { startedAt: 'desc' }, take: 300 }) : []
    const viewsOf = new Map<string, typeof allViews>()
    for (const v of allViews) viewsOf.set(v.quoteId, [...(viewsOf.get(v.quoteId) ?? []), v])
    const staffIds = [...new Set(allViews.map(v => v.staffUserId).filter(Boolean))] as string[]
    const staffNames = new Map((staffIds.length ? await prisma.crmUser.findMany({ where: { id: { in: staffIds } }, select: { id: true, firstName: true, lastName: true } }) : []).map(u => [u.id, `${u.firstName} ${u.lastName}`.trim()]))
    for (const n of notes) {
      const author = (n as any).createdBy && !String((n as any).createdBy).includes('@') ? String((n as any).createdBy) : 'Staff'
      items.push({ at: n.createdAt.toISOString(), kind: 'note', title: 'Note', detail: n.body, by: author })
    }
    for (const a of appts) {
      const when = a.startAt ? a.startAt.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'no date yet'
      const status = a.status === 'scheduled' ? '' : ` (${a.status.replace(/_/g, ' ')})`
      items.push({ at: a.createdAt.toISOString(), kind: 'appointment', title: `${APPT_WORDS[a.type] ?? 'Appointment'} booked for ${when}${status}`, detail: [a.assignedTo ? `With ${a.assignedTo}.` : '', a.outcomeNotes].filter(Boolean).join(' '), by: '' })
    }
    for (const q of quotes) {
      const p = (q.proposal ?? null) as any
      const sentOn = String(p?.createdAt || q.date || '').slice(0, 10)
      if (q.status === 'SENT' || q.status === 'SOLD' || q.status === 'LOST' || q.shareToken) {
        items.push({ at: isDay(sentOn) ? `${sentOn}T12:00:00.000Z` : q.createdAt.toISOString(), kind: 'quote', title: `Quote sent: ${money(q.finalPrice)}`, detail: String(q.status).toLowerCase() === 'sent' ? '' : `Now ${String(q.status).toLowerCase()}.`, by: '' })
      } else {
        items.push({ at: q.createdAt.toISOString(), kind: 'quote', title: `Quote made: ${money(q.finalPrice)} (draft)`, detail: '', by: '' })
      }
      // Each open as it was recorded (Staff view for our own); an older quote opened before opens were recorded one by one keeps its count.
      const views = viewsOf.get(q.id) ?? []
      for (const v of views) items.push(viewHistoryItem(v, ((q.proposal as any)?.options ?? []) as any[], v.staffUserId ? staffNames.get(v.staffUserId) ?? '' : ''))
      const counted = views.filter(v => !v.staff).length
      const earlier = q.viewCount - counted
      const firstAt = q.firstViewedAt ?? q.lastViewedAt
      if (earlier > 0 && firstAt) {
        const oldest = views.length ? views[views.length - 1].startedAt : null
        const last = oldest && q.lastViewedAt && q.lastViewedAt >= oldest ? firstAt : (q.lastViewedAt ?? firstAt)
        const day = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })
        items.push({ at: last.toISOString(), kind: 'proposal_opened', title: `Proposal opened ${earlier} time${earlier === 1 ? '' : 's'}${counted ? ' before' : ''}`, detail: counted ? 'Before opens were recorded one by one.' : `First ${day(firstAt)}, last ${day(last)}.`, by: '' })
      }
      if (q.acceptedAt) items.push({ at: q.acceptedAt.toISOString(), kind: 'quote', title: 'Proposal accepted online', detail: q.acceptedBy ? `By ${q.acceptedBy}.` : '', by: '' })
    }
  }
  // Emails and prepared texts sent by automations for this card.
  if (cardId) {
    const runs = await prisma.automationRun.findMany({ where: { accountId, entityId: cardId }, select: { log: true }, take: 100 })
    for (const r of runs) {
      for (const e of ((r.log as any[]) ?? [])) {
        if (e?.result !== 'done' || typeof e.detail !== 'string') continue
        if (/^emailed /.test(e.detail)) items.push({ at: String(e.at), kind: 'email', title: 'Email sent', detail: e.detail.replace(/^emailed /, 'To '), by: 'Automation' })
        else if (/^text prepared/.test(e.detail)) items.push({ at: String(e.at), kind: 'text', title: 'Text prepared', detail: e.detail, by: 'Automation' })
      }
    }
  }
  return items.filter(i => !Number.isNaN(Date.parse(i.at))).sort((a, b) => b.at.localeCompare(a.at))
}

// ── The report ───────────────────────────────────────────────────────────────

export interface RepReport {
  repId: string | null
  rep: string
  onTime: number
  late: number
  overdueNow: number
  done: number
  missed: number
  calls: number
  signed: number
  touchesToClose: number | null
  noFollowUpCents: number
  noFollowUpCards: number
}

/**
 * Follow ups done and missed per rep, average touches to close, and the
 * dollars in Estimating and Pending Signature cards with no follow up set.
 *   done     an answer logged on or before the day its follow up was due
 *   missed   an answer logged after that day, and follow ups overdue now
 *   touches  calls and texts logged on a card before it was signed
 */
export async function followUpReport(accountId: string, viewer: { id: string; role: string | null }, from: string, to: string) {
  const { rows, people, today } = await cardRows(accountId)
  // A day either side, then exactly the Florida days from `from` to `to`.
  const start = new Date(`${addDays(from, -1)}T00:00:00Z`), end = new Date(`${addDays(to, 2)}T00:00:00Z`)
  const inRange = (d: Date) => { const day = floridaDay(d); return day >= from && day <= to }
  const calls = (await prisma.callLog.findMany({ where: { accountId, at: { gte: start, lt: end } }, select: { userId: true, userName: true, cardId: true, outcome: true, at: true, dueOn: true } })).filter(c => inRange(c.at))
  // Cards signed in the period: an answer "Signed", or the card moved into Signed Contract.
  const moved = (await prisma.automationEvent.findMany({ where: { accountId, type: 'card_entered', board: 'sales', occurredAt: { gte: start, lt: end } }, select: { entityId: true, data: true, occurredAt: true } })).filter(e => inRange(e.occurredAt))
  const signedAt = new Map<string, Date>()
  for (const e of moved) if ((e.data as any)?.stage === 'Signed Contract') { const was = signedAt.get(e.entityId); if (!was || e.occurredAt < was) signedAt.set(e.entityId, e.occurredAt) }
  for (const c of calls) if (c.outcome === 'signed' && c.cardId) { const was = signedAt.get(c.cardId); if (!was || c.at < was) signedAt.set(c.cardId, c.at) }
  const signedCards = [...signedAt.keys()]
  const touchRows = signedCards.length ? await prisma.callLog.findMany({ where: { accountId, cardId: { in: signedCards } }, select: { cardId: true, at: true, outcome: true } }) : []
  const ownerOfCard = new Map(rows.map(r => [r.cardId, r.ownerId]))

  const all = seesEveryone(viewer.role)
  const reps = new Map<string, RepReport>()
  const repFor = (id: string | null, name?: string): RepReport => {
    const key = id ?? ''
    let r = reps.get(key)
    if (!r) {
      r = { repId: id, rep: people.find(p => p.id === id)?.name ?? name ?? 'Nobody', onTime: 0, late: 0, overdueNow: 0, done: 0, missed: 0, calls: 0, signed: 0, touchesToClose: null, noFollowUpCents: 0, noFollowUpCards: 0 }
      reps.set(key, r)
    }
    return r
  }
  for (const c of calls) {
    const r = repFor(c.userId, c.userName)
    r.calls++
    if (!c.dueOn) continue
    if (floridaDay(c.at) <= c.dueOn) r.onTime++; else r.late++
  }
  for (const row of rows) {
    if (stopsSteps(row.stage)) continue
    if (row.status === 'overdue') repFor(row.ownerId).overdueNow++
    if (row.status === 'none' && MUST_HAVE_FOLLOW_UP.includes(row.stage)) { const r = repFor(row.ownerId); r.noFollowUpCents += row.valueCents; r.noFollowUpCards++ }
  }
  const touchSum = new Map<string, { cards: number; touches: number }>()
  for (const cardId of signedCards) {
    // A card since removed from the board has no owner to count it for.
    if (!ownerOfCard.has(cardId)) continue
    const when = signedAt.get(cardId)!
    // Every call and text up to the signing (an answer "Signed" is the last touch).
    const n = touchRows.filter(t => t.cardId === cardId && t.at.getTime() <= when.getTime() + 60_000).length
    const owner = ownerOfCard.get(cardId) ?? null
    const r = repFor(owner)
    r.signed++
    const s = touchSum.get(owner ?? '') ?? { cards: 0, touches: 0 }
    s.cards++; s.touches += n
    touchSum.set(owner ?? '', s)
  }
  for (const [k, s] of touchSum) { const r = reps.get(k); if (r) r.touchesToClose = s.cards ? Math.round((s.touches / s.cards) * 10) / 10 : null }
  for (const r of reps.values()) { r.done = r.onTime; r.missed = r.late + r.overdueNow }
  let list = [...reps.values()]
  if (!all) list = list.filter(r => r.repId === viewer.id)
  list.sort((a, b) => a.rep.localeCompare(b.rep))
  const totalTouches = [...touchSum.entries()].filter(([k]) => all || k === viewer.id).reduce((s, [, v]) => ({ cards: s.cards + v.cards, touches: s.touches + v.touches }), { cards: 0, touches: 0 })
  return {
    from, to, today, seesEveryone: all,
    reps: list,
    totals: {
      done: list.reduce((s, r) => s + r.done, 0),
      missed: list.reduce((s, r) => s + r.missed, 0),
      calls: list.reduce((s, r) => s + r.calls, 0),
      signed: list.reduce((s, r) => s + r.signed, 0),
      touchesToClose: totalTouches.cards ? Math.round((totalTouches.touches / totalTouches.cards) * 10) / 10 : null,
      noFollowUpCents: list.reduce((s, r) => s + r.noFollowUpCents, 0),
      noFollowUpCards: list.reduce((s, r) => s + r.noFollowUpCards, 0),
    },
  }
}

export { badgeFor, dueStatus, floridaDay }
