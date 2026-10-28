/**
 * Operations stages: the one list (Settings > Operations Stages), and the
 * rules every screen and the server use to read it.
 *
 * This file is kept byte for byte the same in apps/web/src/opsStageModel.ts
 * and apps/portal/src/server/lib/opsStageModel.ts (tests/opsStages.test.ts
 * checks it). It has no imports so both sides can use it as it is.
 *
 *   - Every stage has a permanent id. Jobs, automations and stage rules keep
 *     the id, never the name, so a rename changes nothing else.
 *   - The ids of the stages the board had before the list was editable are
 *     the board's old keys (awaiting_locates, scheduled, completed...). A job
 *     saved before then has no stage of its own (opsStage ''): it shows where
 *     the old board put it (legacyStageOfJob), so no job moved.
 *   - A job also has a status (staging, scheduled, in_progress, completed,
 *     invoiced, paid, on_hold) that billing, reports and the calendar read.
 *     Moving a job into a stage sets the status that stage stands for
 *     (phaseOf); a status changed elsewhere (a payment, the phone) moves the
 *     job the way the old board did (reconcileOpsStage).
 */

export type OpsLane = 'main' | 'side'
export type JobPhase = 'staging' | 'scheduled' | 'in_progress' | 'completed' | 'invoiced' | 'paid' | 'on_hold'

export interface OpsStageDef {
  /** Permanent; never changes, never reused. */
  id: string
  name: string
  /** #rrggbb */
  color: string
  /** Position on the board, 0 first. */
  order: number
  /** Not a column and not offered in pickers; jobs already in it still show. */
  hidden: boolean
  /** Where new jobs land (one stage). */
  isFirst: boolean
  /** Counts as Complete: moving a job here marks it completed (one stage). */
  isComplete: boolean
  /** main: the columns left to right; side: the waiting lanes (on hold and the like). */
  lane: OpsLane
}

/** The minimum a job needs for its stage to be worked out. */
export interface OpsJobLike {
  status: string
  opsStage?: string | null
  materialsStatus?: string | null
  drawingComplete?: boolean | null
  locatesDate?: string | null
  completedDate?: string | null
  previousStatus?: string | null
}

const S = (id: string, name: string, color: string, order: number, lane: OpsLane = 'main', more: Partial<OpsStageDef> = {}): OpsStageDef =>
  ({ id, name, color, order, hidden: false, isFirst: false, isComplete: false, lane, ...more })

/** The start list (Jonathan, Oct 20 2026). Colors are the board's where it had one, else the old Settings list's. */
export const START_OPS_STAGES: OpsStageDef[] = [
  S('awaiting_locates', 'Awaiting Locates', '#3b82f6', 0, 'main', { isFirst: true }),
  S('permit_pending', 'Permit Pending', '#f59e0b', 1),
  S('need_drawing', 'Need Drawing', '#eab308', 2),
  S('materials_ordered', 'Materials Ordered', '#f97316', 3),
  S('ready_to_pull', 'Ready to Pull', '#a855f7', 4),
  S('scheduled', 'Scheduled', '#10b981', 5),
  S('in_progress', 'In Progress', '#14b8a6', 6),
  S('punch_list', 'Punch List', '#8b5cf6', 7),
  S('completed', 'Complete', '#22c55e', 8, 'main', { isComplete: true }),
  S('invoiced', 'Invoiced', '#60a5fa', 9),
  S('paid', 'Paid', '#34d399', 10),
  S('on_hold', 'On Hold', '#ef4444', 11, 'side'),
  S('customer_delay', 'Customer Delay', '#f43f5e', 12, 'side'),
  S('backorder', 'Backorder', '#f59e0b', 13, 'side'),
]

/** What each of the start stages stands for. A stage added later takes the one of the stage before it. */
const BUILT_IN_PHASE: Record<string, JobPhase> = {
  awaiting_locates: 'staging', permit_pending: 'staging', need_drawing: 'staging', materials_ordered: 'staging', ready_to_pull: 'staging',
  scheduled: 'scheduled', in_progress: 'in_progress', punch_list: 'in_progress',
  completed: 'completed', invoiced: 'invoiced', paid: 'paid',
  on_hold: 'on_hold', customer_delay: 'on_hold', backorder: 'on_hold',
}

const PHASES: JobPhase[] = ['staging', 'scheduled', 'in_progress', 'completed', 'invoiced', 'paid', 'on_hold']
export const isPhase = (s: unknown): s is JobPhase => typeof s === 'string' && (PHASES as string[]).includes(s)
/** Completed, invoiced or paid: the work is done. */
export const isDonePhase = (p: string | null | undefined) => p === 'completed' || p === 'invoiced' || p === 'paid'

/** The stage the board showed a job in before stages were saved on the job (the old fixed board). */
export function legacyStageOfJob(job: OpsJobLike): string {
  if (job.status === 'on_hold') return 'on_hold'
  if (job.status === 'staging') {
    if (job.materialsStatus === 'ordered') return 'materials_ordered'
    if (job.materialsStatus === 'received' || job.materialsStatus === 'loaded') return 'ready_to_pull'
    if (job.drawingComplete === false && job.materialsStatus === 'not_ordered') return job.locatesDate ? 'need_drawing' : 'awaiting_locates'
    return 'awaiting_locates'
  }
  if (['scheduled', 'in_progress', 'completed', 'invoiced', 'paid'].includes(job.status)) return job.status
  return 'awaiting_locates'
}

const HEX = /^#[0-9a-f]{6}$/i

/** Known fields only, in order, one entry per id; the first and Complete marks as sent (stagesProblem checks them). */
export function cleanStages(raw: unknown): OpsStageDef[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: OpsStageDef[] = []
  raw.forEach((r: any, i) => {
    const id = typeof r?.id === 'string' ? r.id.trim() : ''
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push({
      id,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 60) : id,
      color: typeof r.color === 'string' && HEX.test(r.color) ? r.color.toLowerCase() : '#9ca3af',
      order: Number.isFinite(r.order) ? Number(r.order) : i,
      hidden: r.hidden === true,
      isFirst: r.isFirst === true,
      isComplete: r.isComplete === true,
      lane: r.lane === 'side' ? 'side' : 'main',
    })
  })
  out.sort((a, b) => a.order - b.order)
  out.forEach((s, i) => { s.order = i })
  return out
}

/** A saved list made safe to use: known fields only, sorted, one first and one complete stage. */
export function normalizeStages(raw: unknown): OpsStageDef[] {
  const out = cleanStages(raw)
  if (!out.length) return START_OPS_STAGES.map(s => ({ ...s }))
  const main = out.filter(s => s.lane === 'main')
  const pick = (flag: 'isFirst' | 'isComplete', fallback: OpsStageDef | undefined) => {
    const marked = out.filter(s => s[flag])
    const keep = marked.find(s => s.lane === 'main') ?? fallback
    for (const s of out) s[flag] = s === keep
  }
  pick('isFirst', main.find(s => !s.hidden) ?? main[0] ?? out[0])
  pick('isComplete', main.find(s => s.id === 'completed') ?? main[main.length - 1] ?? out[out.length - 1])
  return out
}

/** Why a list cannot be saved, in words; null when it can. */
export function stagesProblem(list: OpsStageDef[]): string | null {
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
  }
  const first = list.filter(s => s.isFirst)
  const done = list.filter(s => s.isComplete)
  if (first.length !== 1) return 'Mark one stage as the first stage.'
  if (done.length !== 1) return 'Mark one stage as the Complete stage.'
  if (first[0].lane !== 'main') return 'The first stage must be on the board, not a side lane.'
  if (done[0].lane !== 'main') return 'The Complete stage must be on the board, not a side lane.'
  if (first[0].hidden) return 'The first stage cannot be hidden.'
  if (done[0].hidden) return 'The Complete stage cannot be hidden.'
  if (first[0].id === done[0].id) return 'The first stage and the Complete stage must be different stages.'
  return null
}

export const sortedStages = (list: OpsStageDef[]) => list.slice().sort((a, b) => a.order - b.order)
export const stageById = (list: OpsStageDef[], id: string | null | undefined) => (id ? list.find(s => s.id === id) : undefined)
export const firstStage = (list: OpsStageDef[]) => list.find(s => s.isFirst) ?? sortedStages(list).find(s => s.lane === 'main') ?? list[0]
export const completeStage = (list: OpsStageDef[]) => list.find(s => s.isComplete)
/** The columns left to right (hidden ones left out). */
export const boardStages = (list: OpsStageDef[]) => sortedStages(list).filter(s => !s.hidden && s.lane === 'main')
export const sideStages = (list: OpsStageDef[]) => sortedStages(list).filter(s => !s.hidden && s.lane === 'side')
/** Main stages then side lanes, hidden ones left out: what a picker offers. */
export const pickableStages = (list: OpsStageDef[]) => [...boardStages(list), ...sideStages(list)]

/** The job status a stage stands for. */
export function phaseOf(list: OpsStageDef[], id: string): JobPhase | null {
  const sorted = sortedStages(list)
  const at = sorted.findIndex(s => s.id === id)
  if (at < 0) return null
  const s = sorted[at]
  if (s.lane === 'side') return 'on_hold'
  if (s.isComplete) return 'completed'
  if (BUILT_IN_PHASE[s.id] && BUILT_IN_PHASE[s.id] !== 'on_hold') return BUILT_IN_PHASE[s.id]
  // An added stage: the status of the nearest board stage before it.
  for (let i = at - 1; i >= 0; i--) {
    const p = sorted[i]
    if (p.lane !== 'main') continue
    if (p.isComplete) return 'completed'
    const b = BUILT_IN_PHASE[p.id]
    if (b && b !== 'on_hold') return b
  }
  return 'staging'
}

/**
 * The stage a job is in: its own when it has one in the list, else where the
 * old board put it, else the first stage that stands for its status, else the
 * first stage.
 */
export function stageOfJob(list: OpsStageDef[], job: OpsJobLike): string {
  if (job.opsStage && stageById(list, job.opsStage)) return job.opsStage
  const legacy = legacyStageOfJob(job)
  if (stageById(list, legacy)) return legacy
  return firstStageFor(list, job.status) ?? firstStage(list)?.id ?? legacy
}

/** The first shown stage that stands for a status. */
export function firstStageFor(list: OpsStageDef[], status: string): string | null {
  const order = [...boardStages(list), ...sideStages(list), ...sortedStages(list).filter(s => s.hidden)]
  return order.find(s => phaseOf(list, s.id) === status)?.id ?? null
}

/** The next stage on the board after this one (Advance); null at the end or from a side lane. */
export function nextStage(list: OpsStageDef[], id: string): OpsStageDef | null {
  const cols = boardStages(list)
  const at = cols.findIndex(s => s.id === id)
  if (at < 0) {
    const s = stageById(list, id)
    if (!s || s.lane === 'side') return null
    // A hidden stage: the next shown one after it.
    return cols.find(c => c.order > s.order) ?? null
  }
  return cols[at + 1] ?? null
}

/** A permit that does not hold the job up: not needed, or issued (approved, inspection scheduled, passed). */
export const permitIsOk = (status: string | null | undefined) => status === 'not_needed' || status === 'approved' || status === 'inspection_scheduled' || status === 'passed'

/**
 * Advance: the next stage on the board, none from a done stage (Complete,
 * Invoiced, Paid). Permit Pending is passed over when the job's permit is not
 * needed or already issued (a repair, round 5 review Oct 26 2026: "Advance to
 * Permit Pending" on a repair with permit Not needed), as waitingStageOf does.
 * Need Drawing is passed over for a repair (`repair`): a repair has no drawing
 * to make (recheck Oct 27 2026: "Advance to Need Drawing" on a repair). Only
 * the button's next stage; a job can still be put in any stage by hand.
 */
export function advanceStageOf(list: OpsStageDef[], id: string, opts: { permitOk?: boolean; repair?: boolean } = {}): OpsStageDef | null {
  if (isDonePhase(phaseOf(list, id))) return null
  let next = nextStage(list, id)
  while (next && ((opts.permitOk && next.id === 'permit_pending') || (opts.repair && next.id === 'need_drawing'))) next = nextStage(list, next.id)
  return next
}

/**
 * What moving a job into a stage changes on the job: the stage, the status it
 * stands for, and what the old board also set (materials ordered, received,
 * drawing not done, the completed date, the status to go back to after a hold).
 *
 * `stageOnly`: the materials and drawing stay as recorded; only the stage and
 * the status (with its dates) change. Every move nobody is asked about uses
 * it: jobs moved out of a stage deleted in Settings, an automation's Move
 * step, a move the server makes by itself (review Oct 28 2026: deleting a
 * stage and moving its jobs to Ready to Pull marked their materials
 * Received). Only a hand move, which asks first (web materialsMoveQuestion),
 * records materials.
 */
export function fieldsForStage(list: OpsStageDef[], id: string, job: OpsJobLike, today: string, opts: { stageOnly?: boolean } = {}): Record<string, unknown> | null {
  const phase = phaseOf(list, id)
  if (!phase) return null
  const out: Record<string, unknown> = { opsStage: id, status: phase }
  if (!opts.stageOnly) {
    if (id === 'materials_ordered') out.materialsStatus = 'ordered'
    if (id === 'ready_to_pull') out.materialsStatus = 'received'
    if (id === 'need_drawing') out.drawingComplete = false
  }
  if (phase === 'completed' && (!job.completedDate || !isDonePhase(job.status))) out.completedDate = today
  if (phase === 'on_hold' && job.status !== 'on_hold') out.previousStatus = isPhase(job.status) ? job.status : 'staging'
  if (phase !== 'on_hold' && job.status === 'on_hold') out.previousStatus = null
  return out
}

/**
 * The stage a job is in after a save.
 *   - It was moved to a stage on purpose (its stage changed): that stage.
 *   - Its status or other fields changed in a way that moved it on the old
 *     board (a payment marks it paid, materials marked ordered): it moves the
 *     same way, unless it waits in a side lane and is still on hold.
 *   - Otherwise it stays where it was.
 */
export function reconcileOpsStage(list: OpsStageDef[], before: OpsJobLike | null, after: OpsJobLike): string {
  if (!before) {
    if (after.opsStage && stageById(list, after.opsStage)) return after.opsStage
    if (after.status === 'staging' && legacyStageOfJob(after) === 'awaiting_locates') return firstStage(list)?.id ?? 'awaiting_locates'
    return stageOfJob(list, { ...after, opsStage: null })
  }
  const was = stageOfJob(list, before)
  if (after.opsStage && after.opsStage !== was && stageById(list, after.opsStage)) return after.opsStage
  const d0 = legacyStageOfJob(before)
  const d1 = legacyStageOfJob(after)
  if (d0 === d1 && before.status === after.status) return was
  if (after.status === 'on_hold' && phaseOf(list, was) === 'on_hold') return was
  if (phaseOf(list, was) === after.status && d0 === d1) return was
  if (stageById(list, d1)) return d1
  return firstStageFor(list, after.status) ?? was
}

/**
 * The waiting stage a job really is in, from what is recorded on it (Take off
 * the schedule, when the stage it came from is not known). Never one that
 * claims a step is done when it is not: no 811 ticket → Awaiting Locates;
 * permit not issued (or not set) → Permit Pending; materials in → Ready to
 * Pull; ordered → Materials Ordered; else Need Drawing. A stage not in the
 * list: the first one that stands for staging.
 */
export function waitingStageOf(list: OpsStageDef[], job: { locatesDate?: string | null; materialsStatus?: string | null }, permitStatus: string | null): string | null {
  const permitOk = permitIsOk(permitStatus)
  const want = !job.locatesDate ? 'awaiting_locates'
    : !permitOk ? 'permit_pending'
    : job.materialsStatus === 'received' || job.materialsStatus === 'loaded' ? 'ready_to_pull'
    : job.materialsStatus === 'ordered' ? 'materials_ordered'
    : 'need_drawing'
  return stageById(list, want) ? want : firstStageFor(list, 'staging')
}

/** A stage name as typed, for matching: any letter case; spaces at the ends or doubled do not count. */
export const stageNameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

/** The name of the stage repairs go to once their locate is clear and permit in (Jonathan, Oct 27 and 28 2026). */
export const READY_TO_SCHEDULE_KEY = 'ready to schedule'

/**
 * The stage that stands for ready to schedule: a shown board stage named
 * "Ready to Schedule" (added in Settings > Operations Stages; any letter case,
 * extra spaces) that is a waiting stage, i.e. on the board before Scheduled.
 * One placed after Scheduled stands for scheduled (phaseOf), and a move by
 * itself never schedules a job, so it is not used. Else Ready to Pull (by
 * id, renamed or not), else the last board stage before the scheduled ones.
 * Another stage added after Ready to Pull ("Waiting on HOA") is never taken
 * for it.
 */
export function readyStageOf(list: OpsStageDef[]): string | null {
  const waiting = boardStages(list).filter(s => phaseOf(list, s.id) === 'staging')
  const named = waiting.find(s => stageNameKey(s.name) === READY_TO_SCHEDULE_KEY)
  if (named) return named.id
  return (waiting.find(s => s.id === 'ready_to_pull') ?? waiting[waiting.length - 1])?.id ?? null
}

/**
 * Settings: where a stage named Ready to Schedule has to move for repairs to
 * go to it: the place (index in `list`, in its order) just before the first
 * board stage that is not a waiting stage (Scheduled). Null when it is
 * already a waiting stage, is not so named, or is hidden or a side lane (it
 * says so another way).
 */
export function readyToScheduleMoveTo(list: OpsStageDef[], id: string): number | null {
  const sorted = sortedStages(list)
  const s = stageById(sorted, id)
  if (!s || stageNameKey(s.name) !== READY_TO_SCHEDULE_KEY || s.lane !== 'main' || s.hidden) return null
  if (phaseOf(sorted, id) === 'staging') return null
  const rest = sorted.filter(x => x.id !== id)
  const at = rest.findIndex(x => x.lane === 'main' && phaseOf(rest, x.id) !== 'staging')
  return at < 0 ? null : at
}

/** Jobs that are in a stage (by the same rule the board uses). */
export function jobsInStage<T extends OpsJobLike>(list: OpsStageDef[], jobs: T[], id: string): T[] {
  return jobs.filter(j => stageOfJob(list, j) === id)
}

/** Ids an automation rule uses: its trigger stage, stage conditions and move steps. Ops rules only. */
export function stageIdsInRule(rule: { board?: string; trigger?: any; conditions?: any; steps?: any }): string[] {
  if (rule.board !== 'ops') return []
  const ids = new Set<string>()
  if (rule.trigger && typeof rule.trigger.stage === 'string') ids.add(rule.trigger.stage)
  for (const c of Array.isArray(rule.conditions) ? rule.conditions : []) if (c?.field === 'stage' && typeof c.value === 'string') ids.add(c.value)
  for (const s of Array.isArray(rule.steps) ? rule.steps : []) if (s?.type === 'move_card' && typeof s.stage === 'string') ids.add(s.stage)
  return [...ids]
}

/** The same rule with one stage id swapped for another (used when a stage is deleted). */
export function swapStageInRule<R extends { trigger?: any; conditions?: any; steps?: any }>(rule: R, from: string, to: string): R {
  const sw = (v: unknown) => (v === from ? to : v)
  return {
    ...rule,
    trigger: rule.trigger && typeof rule.trigger === 'object' ? { ...rule.trigger, ...(rule.trigger.stage !== undefined ? { stage: sw(rule.trigger.stage) } : {}) } : rule.trigger,
    conditions: Array.isArray(rule.conditions) ? rule.conditions.map((c: any) => (c?.field === 'stage' ? { ...c, value: sw(c.value) } : c)) : rule.conditions,
    steps: Array.isArray(rule.steps) ? rule.steps.map((s: any) => (s?.type === 'move_card' ? { ...s, stage: sw(s.stage) } : s)) : rule.steps,
  }
}

/** A new id for an added stage: never one of the list's, never a name. */
export function newStageId(list: OpsStageDef[], rand: () => string = () => Math.random().toString(36).slice(2, 10)): string {
  for (;;) {
    const id = `stage_${rand()}`
    if (!list.some(s => s.id === id)) return id
  }
}

/** The form of an id for a stage added in Settings. Old board keys can never come back as new stages. */
export const ADDED_STAGE_ID = /^stage_[a-z0-9_]{4,40}$/

/** The old Settings list's default colors (before Oct 20 2026): a color that differs was chosen by hand. */
const OLD_SETTINGS_DEFAULT_COLOR: Record<string, string> = {
  'awaiting locates': '#3b82f6', 'permit pending': '#f59e0b', 'materials ordered': '#f97316', 'scheduled': '#10b981',
  'in progress': '#06b6d4', 'punch list': '#8b5cf6', 'complete': '#16a34a', 'on hold': '#6b7280',
}

/**
 * The start list, from what the old Settings screen saved (fencepro_ops_stages,
 * which nothing read). Matched by name: a color chosen there by hand is kept,
 * and a stage the start list does not have stays as its own stage under its
 * old name (hidden if it was switched off there), listed in `kept`. Nothing
 * else of the old list is used: its ids were never on a job.
 */
export function stagesFromOldList(old: unknown): { stages: OpsStageDef[]; kept: string[]; colors: string[] } {
  const stages = START_OPS_STAGES.map(s => ({ ...s }))
  const kept: string[] = []
  const colors: string[] = []
  const rows = Array.isArray(old) ? old.filter((r: any) => r && typeof r.name === 'string' && r.name.trim()) : []
  rows.sort((a: any, b: any) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0))
  for (const r of rows as any[]) {
    const key = r.name.trim().toLowerCase()
    const match = stages.find(s => s.name.toLowerCase() === key)
    const color = typeof r.color === 'string' && HEX.test(r.color) ? r.color.toLowerCase() : null
    if (match) {
      if (color && OLD_SETTINGS_DEFAULT_COLOR[key] && color !== OLD_SETTINGS_DEFAULT_COLOR[key]) { match.color = color; colors.push(match.name) }
      continue
    }
    const oldId = String(r.id ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '')
    let id = `stage_old_${oldId || key.replace(/[^a-z0-9]+/g, '_')}`.slice(0, 46)
    while (stages.some(s => s.id === id)) id = `${id}_`
    const at = stages.findIndex(s => s.lane === 'side')
    stages.splice(at, 0, { id, name: r.name.trim().slice(0, 60), color: color ?? '#9ca3af', order: 0, hidden: r.isActive === false, isFirst: false, isComplete: false, lane: 'main' })
    kept.push(r.name.trim())
  }
  stages.forEach((s, i) => { s.order = i })
  return { stages, kept, colors }
}
