/**
 * Follow ups: the rules, with no database and no screen. The server
 * (apps/portal/src/server/lib/followUpRules.ts) and the app
 * (apps/web/src/followUpRules.ts) hold the same copy of this file, so an
 * answer given with no signal shows the same next date the server will save;
 * tests/followUps.test.ts checks the two files are the same.
 *
 *   - An answer sets the next follow up: No answer tomorrow, Left voicemail in
 *     2 days, Talked still deciding in 3 days, Talked not now the date picked.
 *   - Each stage has its steps (Settings > Follow ups), kept under the
 *     stage's permanent id, counted in days from the day the card entered the
 *     stage: the standard steps call on day 2, text on day 5, call on days 10
 *     and 21, then ask "Going cold, keep or close?". A step comes up sooner
 *     than an answer's date when it is due first; "Not now" with a date always
 *     wins.
 *   - The steps stop on any Sold stage (the Signed stage and every stage
 *     after it) and on the Lost stage, and start again when the card moves to
 *     another stage. Which stages those are comes from Settings > Pipeline
 *     Stages (FollowUpStages, made by pipelineStageModel.followUpStagesOf);
 *     this file never names a stage.
 *
 * Dates are plain days (YYYY-MM-DD) in Florida.
 */

export type Outcome = 'no_answer' | 'voicemail' | 'deciding' | 'not_now' | 'booked' | 'signed' | 'lost'
export type Channel = 'call' | 'text' | 'other'
export type StepKind = 'call' | 'text'
export type DueKind = StepKind | 'decide'
export type LostReason = 'price' | 'competitor' | 'not_needed' | 'other'

export interface Step { day: number; kind: StepKind }

/** What the rules need to know of the stage list (pipelineStageModel.followUpStagesOf). */
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
export interface Template { id: string; name: string; body: string }
export interface FollowUpConfig {
  /** Steps per stage id. A stage not listed has none. */
  steps: Record<string, Step[]>
  templates: Template[]
}

export const OUTCOMES: Array<{ key: Outcome; label: string }> = [
  { key: 'no_answer', label: 'No answer' },
  { key: 'voicemail', label: 'Left voicemail' },
  { key: 'deciding', label: 'Talked, still deciding' },
  { key: 'not_now', label: 'Talked, not now' },
  { key: 'booked', label: 'Booked appointment' },
  { key: 'signed', label: 'Signed' },
  { key: 'lost', label: 'Lost' },
]
export const OUTCOME_LABEL: Record<Outcome, string> = Object.fromEntries(OUTCOMES.map(o => [o.key, o.label])) as Record<Outcome, string>

export const LOST_REASONS: Array<{ key: LostReason; label: string }> = [
  { key: 'price', label: 'Price' },
  { key: 'competitor', label: 'Went with someone else' },
  { key: 'not_needed', label: 'No longer needed' },
  { key: 'other', label: 'Other' },
]
export const LOST_REASON_LABEL: Record<LostReason, string> = Object.fromEntries(LOST_REASONS.map(o => [o.key, o.label])) as Record<LostReason, string>

/** Days an answer puts the next follow up out. */
export const OUTCOME_DAYS: Partial<Record<Outcome, number>> = { no_answer: 1, voicemail: 2, deciding: 3 }

/** Steps stop here: sold, or lost. */
export function stopsSteps(stage: string, st: FollowUpStages): 'signed' | 'lost' | null {
  if (st.sold.includes(stage)) return 'signed'
  if (stage === st.lost) return 'lost'
  return null
}

/** Shows "No follow up set" when a card in it has none. */
export const mustHaveFollowUp = (stage: string, st: FollowUpStages) => st.mustHave.includes(stage)

const STANDARD_STEPS: Step[] = [
  { day: 2, kind: 'call' }, { day: 5, kind: 'text' }, { day: 10, kind: 'call' }, { day: 21, kind: 'call' },
]

export const DEFAULT_TEMPLATES: Template[] = [
  { id: 'checking-in', name: 'Checking in', body: 'Hi {first name}, this is {my name} with {company}. Just checking in on your fence. Any questions I can answer?' },
  { id: 'proposal', name: 'Proposal reminder', body: 'Hi {first name}, {my name} with {company} here. Did you get a chance to look over the fence proposal? Happy to go over it or change anything.' },
  { id: 'after-voicemail', name: 'After a voicemail', body: 'Hi {first name}, it is {my name} with {company}. I just tried to call about your fence. Call or text me back whenever it suits you.' },
  { id: 'going-cold', name: 'Still interested?', body: 'Hi {first name}, {my name} with {company}. Are you still thinking about the fence? If the timing is not right, just let me know and I will check back later.' },
]

/** Before anything is saved: call day 2, text day 5, call day 10, call day 21 on every Selling stage after the first. */
export function defaultConfig(st: FollowUpStages): FollowUpConfig {
  return {
    steps: Object.fromEntries(st.withSteps.map(id => [id, STANDARD_STEPS.map(s => ({ ...s }))])),
    templates: DEFAULT_TEMPLATES.map(t => ({ ...t })),
  }
}

// ── Days ─────────────────────────────────────────────────────────────────────

export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

export function addDays(day: string, n: number): string {
  const t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) + n * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/** Whole days from `a` to `b` (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** The Florida day of a moment. */
export function floridaDay(d: Date | string | number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d))
}

/** The hour (0 to 23) in Florida. */
export function floridaHour(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(d))
}

// ── State ────────────────────────────────────────────────────────────────────

export interface FollowUpState {
  stage: string
  stageSince: string
  stepIndex: number
  dueOn: string | null
  dueKind: DueKind
  setBy: 'steps' | 'answer' | 'manual' | 'first'
  stoppedReason: 'signed' | 'lost' | null
  lastOutcome: Outcome | null
  lastContactAt: string | null
  touches: number
}

export interface CardLike { stage: string; lastMoved?: string; createdAt?: string }

/** The day a card entered its stage, as the board records it. */
export function stageSinceOf(card: CardLike, today: string): string {
  const raw = String(card.lastMoved || card.createdAt || '')
  const d = raw.slice(0, 10)
  return isDay(d) && d <= today ? d : today
}

const stepsFor = (cfg: FollowUpConfig, stage: string): Step[] => (Array.isArray(cfg.steps?.[stage]) ? cfg.steps[stage] : [])

/** A card that just entered `stage` on `since`: the stage's first step, or nothing when it has none; stopped on Signed or Lost. */
export function startState(stage: string, since: string, cfg: FollowUpConfig, st: FollowUpStages, keep?: Partial<FollowUpState>): FollowUpState {
  const stop = stopsSteps(stage, st)
  const steps = stepsFor(cfg, stage)
  const first = !stop && steps.length ? steps[0] : null
  return {
    stage, stageSince: since, stepIndex: 0,
    dueOn: first ? addDays(since, first.day) : null,
    dueKind: first ? first.kind : 'call',
    setBy: 'steps',
    stoppedReason: stop,
    lastOutcome: keep?.lastOutcome ?? null,
    lastContactAt: keep?.lastContactAt ?? null,
    touches: keep?.touches ?? 0,
  }
}

/**
 * The state as it stands for the card now. A card that moved to another stage
 * since it was saved starts that stage's steps (from the day it moved). A card
 * never followed up (no state) has none.
 */
export function reconcile(state: FollowUpState | null, card: CardLike, cfg: FollowUpConfig, today: string, st: FollowUpStages): FollowUpState | null {
  if (!state) return null
  if (state.stage === card.stage) return state
  return startState(card.stage, stageSinceOf(card, today), cfg, st, state)
}

export interface Answer {
  outcome: Outcome
  /** Talked, not now: the day picked. */
  pickedOn?: string | null
  /** The day it happened. */
  today: string
  /** When it happened (ISO). */
  at: string
}

/** The next follow up an answer sets, before the stage's steps are looked at. */
export function nextDateForOutcome(outcome: Outcome, today: string, pickedOn?: string | null): string | null {
  if (outcome === 'not_now') return isDay(pickedOn) && pickedOn > today ? pickedOn : null
  const n = OUTCOME_DAYS[outcome]
  return n ? addDays(today, n) : null
}

/** What an answer does to a card's follow ups. */
export function applyAnswer(state: FollowUpState | null, card: CardLike, cfg: FollowUpConfig, a: Answer, st: FollowUpStages): FollowUpState {
  const base = reconcile(state, card, cfg, a.today, st) ?? startState(card.stage, stageSinceOf(card, a.today), cfg, st)
  const touched = { lastOutcome: a.outcome, lastContactAt: a.at, touches: base.touches + 1 }
  if (a.outcome === 'signed') return { ...base, ...touched, stage: st.signed, dueOn: null, dueKind: 'call', setBy: 'answer', stoppedReason: 'signed' }
  if (a.outcome === 'lost') return { ...base, ...touched, stage: st.lost, dueOn: null, dueKind: 'call', setBy: 'answer', stoppedReason: 'lost' }
  if (base.stoppedReason) return { ...base, ...touched }
  const steps = stepsFor(cfg, base.stage)
  // Every step due by today is done (this touch covered it).
  let i = base.stepIndex
  while (i < steps.length && addDays(base.stageSince, steps[i].day) <= a.today) i++
  const stepOn = i < steps.length ? addDays(base.stageSince, steps[i].day) : null
  const answerOn = nextDateForOutcome(a.outcome, a.today, a.pickedOn)
  const allDone = steps.length > 0 && i >= steps.length
  let dueOn: string | null
  let dueKind: DueKind = 'call'
  if (a.outcome === 'not_now' && answerOn) { dueOn = answerOn }
  else if (answerOn && stepOn) { if (stepOn < answerOn) { dueOn = stepOn; dueKind = steps[i].kind } else dueOn = answerOn }
  else if (answerOn) { dueOn = answerOn; if (allDone) dueKind = 'decide' }
  else if (stepOn) { dueOn = stepOn; dueKind = steps[i].kind }
  else if (allDone) { dueOn = addDays(a.today, 1); dueKind = 'decide' }
  else dueOn = null
  return { ...base, ...touched, stepIndex: i, dueOn, dueKind, setBy: 'answer' }
}

/** One tap to change the date (or clear it). */
export function setNext(state: FollowUpState | null, card: CardLike, cfg: FollowUpConfig, dueOn: string | null, today: string, st: FollowUpStages): FollowUpState {
  const base = reconcile(state, card, cfg, today, st) ?? startState(card.stage, stageSinceOf(card, today), cfg, st)
  const kind: DueKind = base.dueKind === 'decide' ? 'call' : base.dueKind
  return { ...base, dueOn: isDay(dueOn) ? dueOn : null, dueKind: kind, setBy: 'manual', stoppedReason: base.stoppedReason }
}

/** "Going cold, keep": the stage's steps start again from today. */
export function keepGoing(state: FollowUpState | null, card: CardLike, cfg: FollowUpConfig, today: string, st: FollowUpStages): FollowUpState {
  return startState(card.stage, today, cfg, st, state ?? undefined)
}

// ── What the screens show ────────────────────────────────────────────────────

export type DueStatus = 'overdue' | 'today' | 'upcoming' | 'none' | 'stopped'

export function dueStatus(state: FollowUpState | null, today: string): { status: DueStatus; days: number } {
  if (state?.stoppedReason) return { status: 'stopped', days: 0 }
  if (!state?.dueOn) return { status: 'none', days: 0 }
  const d = daysBetween(state.dueOn, today)
  if (d > 0) return { status: 'overdue', days: d }
  if (d === 0) return { status: 'today', days: 0 }
  return { status: 'upcoming', days: -d }
}

/** The badge on a pipeline card, or null for a card with nothing to show. */
export function badgeFor(state: FollowUpState | null, stage: string, today: string, st: FollowUpStages): { text: string; tone: 'red' | 'orange' | 'gray' } | null {
  if (stopsSteps(stage, st)) return null
  const s = dueStatus(state, today)
  if (s.status === 'overdue') return { text: `Overdue ${s.days}d`, tone: 'red' }
  if (s.status === 'today') return { text: state?.dueKind === 'text' ? 'Text today' : state?.dueKind === 'decide' ? 'Keep or close?' : 'Call today', tone: 'orange' }
  if (s.status === 'none' && mustHaveFollowUp(stage, st)) return { text: 'No follow up set', tone: 'gray' }
  return null
}

/** Needs a follow up now: overdue, due today, or a card in a stage that needs one with none set. */
export function needsFollowUp(state: FollowUpState | null, stage: string, today: string, st: FollowUpStages): boolean {
  const b = badgeFor(state, stage, today, st)
  return !!b
}

/** A template with the customer's first name (and the sender and company) filled in. */
export function fillTemplate(body: string, v: { firstName?: string; myName?: string; company?: string }): string {
  const first = (v.firstName || '').trim().split(/\s+/)[0] || 'there'
  const me = (v.myName || '').trim().split(/\s+/)[0] || 'the team'
  return body
    .replace(/\{\s*first[ _]?name\s*\}/gi, first)
    .replace(/\{\s*my[ _]?name\s*\}/gi, me)
    .replace(/\{\s*company\s*\}/gi, (v.company || '').trim() || 'Getter Done Fence')
}

// ── Settings, checked ────────────────────────────────────────────────────────

/**
 * Settings as sent: steps sorted by day, whole days 0 to 365, at most 12 a
 * stage, keyed by stage ids from the list (`stageIds`, with their names for
 * the message); templates at most 20. Throws a plain sentence.
 */
export function cleanConfig(input: unknown, stageIds?: Record<string, string>): FollowUpConfig {
  const v = (input ?? {}) as any
  const steps: Record<string, Step[]> = {}
  if (v.steps && typeof v.steps === 'object' && !Array.isArray(v.steps)) {
    for (const [stage, list] of Object.entries(v.steps as Record<string, unknown>)) {
      if (!stage.trim() || stage.length > 60) throw new Error('A stage name is not valid.')
      if (stageIds && !(stage in stageIds)) throw new Error(`"${stage}" is not one of the pipeline stages (Settings > Pipeline Stages). Reload the page and try again.`)
      if (!Array.isArray(list)) throw new Error(`The steps for ${stage} are not a list.`)
      const named = stageIds?.[stage] ?? stage
      if (list.length > 12) throw new Error(`${named} has more than 12 steps.`)
      const out: Step[] = []
      for (const s of list as any[]) {
        const day = Number(s?.day)
        if (!Number.isInteger(day) || day < 0 || day > 365) throw new Error(`${named}: a step's day must be a whole number from 0 to 365.`)
        if (s?.kind !== 'call' && s?.kind !== 'text') throw new Error(`${named}: a step is a call or a text.`)
        out.push({ day, kind: s.kind })
      }
      out.sort((a, b) => a.day - b.day)
      steps[stage] = out
    }
  }
  const templates: Template[] = []
  if (Array.isArray(v.templates)) {
    if (v.templates.length > 20) throw new Error('At most 20 text templates.')
    for (const t of v.templates as any[]) {
      const name = String(t?.name ?? '').trim(), body = String(t?.body ?? '').trim()
      if (!name || name.length > 60) throw new Error('Each template needs a name of up to 60 letters.')
      if (!body || body.length > 600) throw new Error(`The template "${name}" needs words, up to 600 letters.`)
      const id = String(t?.id ?? '').trim().slice(0, 60) || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      templates.push({ id, name, body })
    }
  }
  return { steps, templates }
}
