/**
 * Sales Pipeline stages: the one list (Settings > Pipeline Stages), and the
 * rules every screen and the server use to read it.
 *
 * This file is kept byte for byte the same in apps/web/src/pipelineStageModel.ts
 * and apps/portal/src/server/lib/pipelineStageModel.ts (tests/pipelineStages.test.ts
 * checks it). It has no imports so both sides can use it as it is.
 *
 *   - Every stage has a permanent id. Cards, follow ups, stage rules and
 *     automations keep the id, never the name, so a rename changes nothing else.
 *   - The 13 stages the board had before the list was editable keep their old
 *     names as ids (START_IDS), so no saved card or record had to change.
 *     A stage added later gets an id like stage_k3x9q2mf.
 *   - The app never checks a stage's name. It checks what the stage is for:
 *     its group (Selling, Sold with work ahead, Sold with work done, Lost or
 *     dead) and its roles (new cards land here, Appointment, Ready to quote,
 *     Signed, Job complete, Lost).
 *
 * The 13 names below are the only place they are written in the app's code
 * (tests/pipelineStageNames.test.ts fails on any other).
 */

export type PipelineGroup = 'selling' | 'sold_ahead' | 'sold_done' | 'dead'
export type PipelineRole = 'first' | 'appointment' | 'ready_to_quote' | 'signed' | 'complete' | 'lost'

export interface PipelineStageDef {
  /** Permanent; never changes, never reused. */
  id: string
  name: string
  /** #rrggbb */
  color: string
  /** Position on the board inside its group, 0 first (the list is kept sorted by group, then order). */
  order: number
  /** Not a column and not offered in pickers; cards already in it still show. */
  hidden: boolean
  group: PipelineGroup
  /** What the stage is for; each role is on one stage at most. */
  roles: PipelineRole[]
  /** The card is done with (Paid & Closed, Lost Sale, No Answer): a customer's newer card is the one in play. */
  finished: boolean
  /** Shows "No follow up set" when a card in it has none. */
  needsFollowUp: boolean
  /** Chance of closing, 0 to 100, for the weighted pipeline value (Selling stages). */
  chancePct: number
}

export const GROUPS: PipelineGroup[] = ['selling', 'sold_ahead', 'sold_done', 'dead']
export const GROUP_LABEL: Record<PipelineGroup, string> = {
  selling: 'Selling', sold_ahead: 'Sold, work ahead', sold_done: 'Sold, work done', dead: 'Lost or dead',
}
export const ROLES: PipelineRole[] = ['first', 'appointment', 'ready_to_quote', 'signed', 'complete', 'lost']
export const ROLE_LABEL: Record<PipelineRole, string> = {
  first: 'New cards land here', appointment: 'Appointment', ready_to_quote: 'Ready to quote',
  signed: 'Signed', complete: 'Job complete', lost: 'Lost',
}
/** What each role does, in words (Settings). */
export const ROLE_HELP: Record<PipelineRole, string> = {
  first: 'New customers, website quotes, calls and chats get a card here.',
  appointment: 'Booking an estimate moves a card here; dropping a card here books one.',
  ready_to_quote: 'An appointment closed "Ready to quote" moves the card here.',
  signed: 'Moving a card here marks its quote sold and makes the job; follow ups stop.',
  complete: 'A job marked complete in Operations moves its card here.',
  lost: 'A Lost answer moves the card here; follow ups stop.',
}
/** The roles a stage list must have exactly once. */
export const REQUIRED_ROLES: PipelineRole[] = ['first', 'signed', 'lost']
/** The groups a role's stage may be in. */
export const ROLE_GROUPS: Record<PipelineRole, PipelineGroup[]> = {
  first: ['selling'], appointment: ['selling'], ready_to_quote: ['selling'],
  signed: ['sold_ahead'], complete: ['sold_ahead', 'sold_done'], lost: ['dead'],
}

/** The ids of the start stages (their names before the list could be edited). */
export const START_IDS = {
  firstContact: 'First Contact',
  appointment: 'Appointment',
  estimating: 'Estimating',
  pendingSignature: 'Pending Signature',
  signedContract: 'Signed Contract',
  jobPrep: 'Job Prep',
  pendingStart: 'Pending Start',
  jobsInProgress: 'Jobs In Progress',
  jobComplete: 'Job Complete',
  pendingPayment: 'Pending Payment',
  paidClosed: 'Paid & Closed',
  lostSale: 'Lost Sale',
  noAnswer: 'No Answer',
} as const

const S = (id: string, color: string, group: PipelineGroup, order: number, more: Partial<PipelineStageDef> = {}): PipelineStageDef =>
  ({ id, name: id, color, order, hidden: false, group, roles: [], finished: group === 'dead', needsFollowUp: false, chancePct: group === 'selling' ? 10 : 0, ...more })

/** The start list (Jonathan, Oct 20 2026). Colors are the board's. */
export const START_PIPELINE_STAGES: PipelineStageDef[] = [
  S(START_IDS.firstContact, '#6b7280', 'selling', 0, { roles: ['first'], chancePct: 5 }),
  S(START_IDS.appointment, '#3b82f6', 'selling', 1, { roles: ['appointment'], chancePct: 15 }),
  S(START_IDS.estimating, '#6366f1', 'selling', 2, { roles: ['ready_to_quote'], needsFollowUp: true, chancePct: 30 }),
  S(START_IDS.pendingSignature, '#a855f7', 'selling', 3, { needsFollowUp: true, chancePct: 60 }),
  S(START_IDS.signedContract, '#22c55e', 'sold_ahead', 0, { roles: ['signed'] }),
  S(START_IDS.jobPrep, '#14b8a6', 'sold_ahead', 1),
  S(START_IDS.pendingStart, '#06b6d4', 'sold_ahead', 2),
  S(START_IDS.jobsInProgress, '#f97316', 'sold_ahead', 3),
  S(START_IDS.jobComplete, '#10b981', 'sold_done', 0, { roles: ['complete'] }),
  S(START_IDS.pendingPayment, '#eab308', 'sold_done', 1),
  S(START_IDS.paidClosed, '#15803d', 'sold_done', 2, { finished: true }),
  S(START_IDS.lostSale, '#ef4444', 'dead', 0, { roles: ['lost'] }),
  S(START_IDS.noAnswer, '#9ca3af', 'dead', 1),
]

const HEX = /^#[0-9a-f]{6}$/i
const isGroup = (g: unknown): g is PipelineGroup => typeof g === 'string' && (GROUPS as string[]).includes(g)
const isRole = (r: unknown): r is PipelineRole => typeof r === 'string' && (ROLES as string[]).includes(r)
const groupRank = (g: PipelineGroup) => GROUPS.indexOf(g)

/** Finished follows the group: Lost or dead always, Selling and Sold with work ahead never, Sold with work done as set. */
export function finishedFor(group: PipelineGroup, flag: boolean): boolean {
  if (group === 'dead') return true
  if (group === 'sold_done') return flag
  return false
}

/** Sorted by group (Selling first, Lost or dead last), then order; order renumbered inside each group. */
export function sortedStages(list: PipelineStageDef[]): PipelineStageDef[] {
  return list.slice().sort((a, b) => groupRank(a.group) - groupRank(b.group) || a.order - b.order)
}
function renumber(list: PipelineStageDef[]): PipelineStageDef[] {
  const out = sortedStages(list)
  const n: Record<string, number> = {}
  for (const s of out) { s.order = n[s.group] ?? 0; n[s.group] = s.order + 1 }
  return out
}

/** Known fields only, one entry per id, sorted. Roles as sent (stagesProblem checks them). */
export function cleanStages(raw: unknown): PipelineStageDef[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: PipelineStageDef[] = []
  raw.forEach((r: any, i) => {
    const id = typeof r?.id === 'string' ? r.id.trim() : ''
    if (!id || seen.has(id)) return
    seen.add(id)
    const group: PipelineGroup = isGroup(r.group) ? r.group : 'selling'
    const roles = Array.isArray(r.roles) ? [...new Set((r.roles as unknown[]).filter(isRole))] : []
    const chance = Number(r.chancePct)
    out.push({
      id,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 60) : id,
      color: typeof r.color === 'string' && HEX.test(r.color) ? r.color.toLowerCase() : '#9ca3af',
      order: Number.isFinite(r.order) ? Number(r.order) : i,
      hidden: r.hidden === true,
      group,
      roles: ROLES.filter(x => roles.includes(x)),
      finished: finishedFor(group, r.finished === true),
      needsFollowUp: r.needsFollowUp === true,
      chancePct: Number.isFinite(chance) ? Math.max(0, Math.min(100, Math.round(chance))) : (group === 'selling' ? 10 : 0),
    })
  })
  return renumber(out)
}

/** A saved list made safe to use: known fields, sorted, and every required role on one stage. */
export function normalizeStages(raw: unknown): PipelineStageDef[] {
  const out = cleanStages(raw)
  if (!out.length) return START_PIPELINE_STAGES.map(s => ({ ...s, roles: [...s.roles] }))
  // Each role on one stage at most (the first one that has it, in board order).
  for (const role of ROLES) {
    let kept = false
    for (const s of out) {
      if (!s.roles.includes(role)) continue
      if (kept || !ROLE_GROUPS[role].includes(s.group)) s.roles = s.roles.filter(r => r !== role)
      else kept = true
    }
    if (!kept && (REQUIRED_ROLES as string[]).includes(role)) {
      const fit = out.find(s => ROLE_GROUPS[role].includes(s.group) && !s.hidden) ?? out.find(s => ROLE_GROUPS[role].includes(s.group))
      if (fit) fit.roles = ROLES.filter(r => r === role || fit.roles.includes(r))
    }
  }
  return out
}

/** Why a list cannot be saved, in words; null when it can. */
export function stagesProblem(list: PipelineStageDef[]): string | null {
  if (!list.length) return 'Keep at least one stage.'
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const s of list) {
    if (!s.id) return 'Every stage needs an id.'
    if (ids.has(s.id)) return `Two stages have the same id (${s.id}).`
    ids.add(s.id)
    const n = s.name.trim().toLowerCase()
    if (!n) return 'Every stage needs a name.'
    if (names.has(n)) return `Two stages are called "${s.name.trim()}". Give each its own name.`
    names.add(n)
    if (!isGroup(s.group)) return `"${s.name}" needs a group.`
    if (!Number.isInteger(s.chancePct) || s.chancePct < 0 || s.chancePct > 100) return `"${s.name}": the chance of closing is a whole number from 0 to 100.`
  }
  for (const role of ROLES) {
    const has = list.filter(s => s.roles.includes(role))
    const word = ROLE_LABEL[role]
    if (has.length > 1) return `Only one stage can be the "${word}" stage (${has.map(s => s.name).join(', ')}).`
    if (!has.length && (REQUIRED_ROLES as string[]).includes(role)) return `Mark one stage as the "${word}" stage.`
    const s = has[0]
    if (!s) continue
    if (!ROLE_GROUPS[role].includes(s.group)) return `The "${word}" stage must be in ${ROLE_GROUPS[role].map(g => GROUP_LABEL[g]).join(' or ')}.`
    if (s.hidden && (REQUIRED_ROLES as string[]).includes(role)) return `The "${word}" stage cannot be hidden.`
  }
  return null
}

export const stageById = (list: PipelineStageDef[], id: string | null | undefined) => (id ? list.find(s => s.id === id) : undefined)
/** A stage's name; a word that is not in the list shows as it is. */
export const stageNameOf = (list: PipelineStageDef[], id: string | null | undefined) => stageById(list, id)?.name ?? (id || '')
export const stageColorOf = (list: PipelineStageDef[], id: string | null | undefined) => stageById(list, id)?.color ?? '#9ca3af'
/** The stage that has a role. */
export const roleStage = (list: PipelineStageDef[], role: PipelineRole) => list.find(s => s.roles.includes(role))
export const roleStageId = (list: PipelineStageDef[], role: PipelineRole): string | null => roleStage(list, role)?.id ?? null
export const hasRole = (list: PipelineStageDef[], id: string | null | undefined, role: PipelineRole) => !!stageById(list, id)?.roles.includes(role)
/** A stage's group; null for a word not in the list. */
export const groupOf = (list: PipelineStageDef[], id: string | null | undefined): PipelineGroup | null => stageById(list, id)?.group ?? null
/** Sold: the Signed stage and every stage after it (both Sold groups). */
export const isSoldStage = (list: PipelineStageDef[], id: string | null | undefined) => { const g = groupOf(list, id); return g === 'sold_ahead' || g === 'sold_done' }
export const isDeadStage = (list: PipelineStageDef[], id: string | null | undefined) => groupOf(list, id) === 'dead'
/** Still being sold: not sold, not lost or dead. A word not in the list counts as open. */
export const isOpenStage = (list: PipelineStageDef[], id: string | null | undefined) => !isSoldStage(list, id) && !isDeadStage(list, id)
/** Done with: a customer's newer card is the one in play. */
export const isFinishedStage = (list: PipelineStageDef[], id: string | null | undefined) => !!stageById(list, id)?.finished
export const needsFollowUpStage = (list: PipelineStageDef[], id: string | null | undefined) => !!stageById(list, id)?.needsFollowUp
/** Chance of closing, 0 to 1 (an open word not in the list: 10%). */
export const chanceOf = (list: PipelineStageDef[], id: string | null | undefined) => (stageById(list, id)?.chancePct ?? 10) / 100

/** The shown stages, in board order: what pickers offer. */
export const pickableStages = (list: PipelineStageDef[]) => sortedStages(list).filter(s => !s.hidden)

export interface BoardColumn { id: string; name: string; color: string; group: PipelineGroup | null; hidden: boolean; unknown: boolean }

/**
 * The board's columns: the shown stages in order, a hidden stage while cards
 * are in it, and (so no card ever vanishes) a column for any word a card has
 * that is not in the list.
 */
export function boardColumns(list: PipelineStageDef[], cardStages: Iterable<string>): BoardColumn[] {
  const used = new Set<string>()
  for (const s of cardStages) if (s) used.add(s)
  const cols: BoardColumn[] = sortedStages(list)
    .filter(s => !s.hidden || used.has(s.id))
    .map(s => ({ id: s.id, name: s.name, color: s.color, group: s.group, hidden: s.hidden, unknown: false }))
  const known = new Set(list.map(s => s.id))
  for (const w of [...used].filter(w => !known.has(w)).sort()) cols.push({ id: w, name: w, color: '#9ca3af', group: null, hidden: false, unknown: true })
  return cols
}

/** a comes before b on the board (both in the list). */
export function isBefore(list: PipelineStageDef[], a: string | null | undefined, b: string | null | undefined): boolean {
  const sorted = sortedStages(list)
  const i = sorted.findIndex(s => s.id === a), j = sorted.findIndex(s => s.id === b)
  return i >= 0 && j >= 0 && i < j
}

/** The next shown stage on the board after this one; null at the end. */
export function nextStageOf(list: PipelineStageDef[], id: string): PipelineStageDef | null {
  const sorted = sortedStages(list)
  const at = sorted.findIndex(s => s.id === id)
  if (at < 0) return null
  return sorted.slice(at + 1).find(s => !s.hidden) ?? null
}

/** Where booking an estimate moves a card: to the Appointment stage when the card is still before it. */
export function stageAfterBooking(list: PipelineStageDef[], current: string | null | undefined, type: string): string | null {
  if (type !== 'estimate' || !current) return null
  const target = roleStageId(list, 'appointment')
  return target && isBefore(list, current, target) ? target : null
}

/** What closing out an appointment does to the card: Ready to quote moves it on; Not interested offers Lost. */
export function stageAfterOutcome(list: PipelineStageDef[], current: string | null | undefined, outcome: string): { move?: string; offer?: string } {
  if (!current) return {}
  if (outcome === 'ready_to_quote') {
    const target = roleStageId(list, 'ready_to_quote')
    return target && isBefore(list, current, target) ? { move: target } : {}
  }
  const lost = roleStageId(list, 'lost')
  if (outcome === 'not_interested' && lost && current !== lost) return { offer: lost }
  return {}
}

/** Booking from a card in the first or the Appointment stage (or no card) is an estimate; later, a follow up visit. */
export function bookingTypeFor(list: PipelineStageDef[], stage: string | null | undefined): 'estimate' | 'follow_up' {
  return !stage || hasRole(list, stage, 'first') || hasRole(list, stage, 'appointment') ? 'estimate' : 'follow_up'
}

/** A customer's card in play: an open one (most recently moved), else their most recent card. */
export function cardInPlay<T extends { stage?: string; lastMoved?: string; createdAt?: string }>(list: PipelineStageDef[], cards: T[]): T | null {
  if (cards.length < 2) return cards[0] ?? null
  const recent = (a: T, b: T) => String(b.lastMoved || b.createdAt || '').localeCompare(String(a.lastMoved || a.createdAt || ''))
  const open = cards.filter(c => !isFinishedStage(list, c.stage)).sort(recent)
  return open[0] ?? [...cards].sort(recent)[0]
}

export interface CardForJob { cardId: string | null; why: string }

/**
 * The card a job marked complete moves to the Job complete stage, or why none
 * does (Jonathan, Oct 20 2026): the card carrying the job's quote id (or job
 * id); else, for a card from before cards carried it, only the quote's
 * customer's ONE card in a "Sold, work ahead" stage. Never by name, phone or
 * email, never "the most recent", never a finished card.
 */
export function cardForCompletedJob(
  job: { id: string; quoteId?: string | null; customerId?: string | null },
  quoteCustomerId: string | null,
  cards: Array<{ id: string; stage: string; customerId?: string; quoteId?: string; jobId?: string }>,
  stages: PipelineStageDef[],
): CardForJob {
  const open = (c: { stage: string }) => !stageById(stages, c.stage)?.finished
  const byQuote = cards.filter(c => (job.quoteId && c.quoteId === job.quoteId) || c.jobId === job.id)
  if (byQuote.length) {
    const live = byQuote.filter(open)
    if (live.length === 1) return { cardId: live[0].id, why: 'the card for this job\'s quote' }
    if (!live.length) return { cardId: null, why: 'the card for this job\'s quote is in a finished stage' }
    return { cardId: null, why: `${live.length} cards carry this job's quote` }
  }
  const customer = quoteCustomerId ?? job.customerId ?? null
  if (!customer) return { cardId: null, why: 'the job\'s quote has no customer record, and no card carries the quote' }
  const ahead = cards.filter(c => c.customerId === customer && !c.quoteId && stageById(stages, c.stage)?.group === 'sold_ahead')
  if (ahead.length === 1) return { cardId: ahead[0].id, why: 'the customer\'s only card in a Sold, work ahead stage' }
  if (!ahead.length) return { cardId: null, why: 'no card carries this job\'s quote, and the customer has no card in a Sold, work ahead stage' }
  return { cardId: null, why: `no card carries this job's quote, and the customer has ${ahead.length} cards in Sold, work ahead stages` }
}

/** What the follow up rules (followUpRules.ts) need to know of the list. */
export interface FollowUpStages {
  /** Where a Signed answer moves the card. */
  signed: string
  /** Where a Lost answer moves the card. */
  lost: string
  /** Every Sold stage: steps stop there (signed). */
  sold: string[]
  /** Stages that show "No follow up set". */
  mustHave: string[]
  /** Stages that start with the standard steps when nothing is saved yet. */
  withSteps: string[]
}
export function followUpStagesOf(list: PipelineStageDef[]): FollowUpStages {
  return {
    signed: roleStageId(list, 'signed') ?? '',
    lost: roleStageId(list, 'lost') ?? '',
    sold: list.filter(s => s.group === 'sold_ahead' || s.group === 'sold_done').map(s => s.id),
    mustHave: list.filter(s => s.needsFollowUp).map(s => s.id),
    withSteps: sortedStages(list).filter(s => s.group === 'selling' && !s.roles.includes('first')).map(s => s.id),
  }
}

/** Ids a sales automation rule uses: its trigger stage, stage conditions and move steps. */
export function stageIdsInSalesRule(rule: { board?: string; trigger?: any; conditions?: any; steps?: any }): string[] {
  if ((rule.board ?? 'sales') !== 'sales') return []
  const ids = new Set<string>()
  if (rule.trigger && typeof rule.trigger.stage === 'string' && rule.trigger.stage) ids.add(rule.trigger.stage)
  for (const c of Array.isArray(rule.conditions) ? rule.conditions : []) if (c?.field === 'stage' && typeof c.value === 'string' && c.value) ids.add(c.value)
  for (const s of Array.isArray(rule.steps) ? rule.steps : []) if (s?.type === 'move_card' && typeof s.stage === 'string' && s.stage) ids.add(s.stage)
  return [...ids]
}

/** A new id for an added stage: never one of the list's, never a name. */
export function newStageId(list: PipelineStageDef[], rand: () => string = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0')): string {
  for (;;) {
    const id = `stage_${rand()}`
    if (!list.some(s => s.id === id)) return id
  }
}

/** The form of an id for a stage added in Settings. */
export const ADDED_STAGE_ID = /^stage_[a-z0-9_]{4,40}$/

/**
 * The list the one-time step writes: the start list, with the board's old
 * lists (the pipeline's own and Settings' plain list of words) and the words
 * on the cards. A start stage missing from the list the board showed is
 * hidden; a word in those lists the start list lacks is kept as its own
 * stage in the group of the stage before it; a word found only on cards is a
 * hidden Selling stage under its own word. Nothing is matched to a "close"
 * name. Returns what was added, for the log.
 */
export function stagesFromOldLists(shown: unknown, cardWords: Iterable<string>): { stages: PipelineStageDef[]; added: string[]; hiddenStart: string[]; fromCards: string[] } {
  const stages = START_PIPELINE_STAGES.map(s => ({ ...s, roles: [...s.roles] }))
  const words = (Array.isArray(shown) ? shown : []).map((w: any) => (typeof w === 'string' ? w : w?.name)).filter((w: unknown): w is string => typeof w === 'string' && !!w.trim()).map(w => w.trim())
  const added: string[] = [], hiddenStart: string[] = [], fromCards: string[] = []
  if (words.length) {
    for (const s of stages) {
      if (words.includes(s.id) || s.roles.some(r => (REQUIRED_ROLES as string[]).includes(r))) continue
      s.hidden = true
      hiddenStart.push(s.id)
    }
    let group: PipelineGroup = 'selling'
    for (const w of words) {
      const known = stages.find(s => s.id === w)
      if (known) { group = known.group; continue }
      const order = Math.max(-1, ...stages.filter(s => s.group === group).map(s => s.order)) + 1
      stages.push({ ...S(w, '#9ca3af', group, order), name: w.slice(0, 60) })
      added.push(w)
    }
  }
  for (const w of cardWords) {
    if (!w || stages.some(s => s.id === w)) continue
    const order = Math.max(-1, ...stages.filter(s => s.group === 'selling').map(s => s.order)) + 1
    stages.push({ ...S(w, '#9ca3af', 'selling', order), name: w.slice(0, 60), hidden: true })
    fromCards.push(w)
  }
  return { stages: renumber(stages), added, hiddenStart, fromCards }
}
