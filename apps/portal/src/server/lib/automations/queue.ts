/**
 * The automation worker: turns saved events into runs and runs their steps.
 *
 * - Events (AutomationEvent) are saved before anything runs. Each event is
 *   matched against the enabled rules once; each match becomes one
 *   AutomationRun, unique per rule and event, so a rule never runs twice for
 *   one event.
 * - "Card entered a stage" waits a settle time (2 minutes by default) and runs
 *   only if the card is still there; the same rule runs at most once per card
 *   and stage within 24 hours, so dragging back and forth does nothing extra.
 * - Steps run in order from the database; a wait step parks the run until its
 *   time. A failed step is tried again after 1 min, 5 min, 15 min and 1 hour;
 *   then the run fails and Jonathan gets a notification (and a push) with the
 *   reason and a Run again button.
 * - A run that was running when the app stopped is picked up again; steps
 *   already done are not done twice (see steps.ts).
 * - Time triggers (in a stage X days, X days before or after a date) are
 *   worked out from the data every few minutes, so after the Mac or the app was
 *   down the missed ones happen once on start (one event per rule, card and
 *   date).
 *
 * Started from index.ts; DISABLE_CRON=1 leaves it off.
 */

import prisma from '../prisma.js'
import { onEventRecorded, recordEvent } from '../automationEvents.js'
import { buildContext, cardForJob, CLOSED_SALES, evalConditions, floridaDay, jobForCard, loadLeads, opsStageOfJob, type EntityContext } from './context.js'
import { describeSteps, runStep, type DryStep } from './steps.js'
import { MAX_ATTEMPTS, RETRY_BACKOFF_MS, SAME_STAGE_WINDOW_MS, STARTER_RULES, STARTER_STAGE_RULES, ruleSchema, stepSchema, triggerSchema, conditionSchema, type Board, type Condition, type Step, type Trigger } from './types.js'
import { sendPush } from './push.js'
import { PERMIT_STATUS_LABEL, portalFor, type PermitStatus } from './permits.js'
import type { AutomationEvent, AutomationRule, AutomationRun } from '@prisma/client'

export interface LogEntry { at: string; step: number | null; result: string; detail: string; link?: string; until?: string }

const STALE_RUNNING_MS = 10 * 60_000

export function parseRule(rule: AutomationRule): { trigger: Trigger; conditions: Condition[]; steps: Step[] } {
  return {
    trigger: triggerSchema.parse(rule.trigger),
    conditions: ((rule.conditions as unknown[]) ?? []).map(c => conditionSchema.parse(c)),
    steps: ((rule.steps as unknown[]) ?? []).map(s => stepSchema.parse(s)),
  }
}

// ── Events into runs ─────────────────────────────────────────────────────────

function ruleMatches(rule: AutomationRule, trigger: Trigger, ev: AutomationEvent): boolean {
  const data = (ev.data ?? {}) as any
  switch (trigger.type) {
    case 'card_entered': return ev.type === 'card_entered' && ev.board === rule.board && data.stage === trigger.stage
    case 'card_left': return ev.type === 'card_left' && ev.board === rule.board && data.stage === trigger.stage
    case 'event': return ev.type === trigger.event
    case 'in_stage_days': case 'date_offset': return ev.type === 'time' && data.ruleId === rule.id
  }
}

/** The card (sales rule) or job (ops rule) an event is about. */
async function entityFor(rule: AutomationRule, ev: AutomationEvent): Promise<string | null> {
  const board = rule.board as Board
  const kind = board === 'sales' ? 'card' : 'job'
  if (ev.entityKind === kind) return ev.entityId
  const data = (ev.data ?? {}) as any
  const { leads } = await loadLeads(rule.accountId)
  if (board === 'ops') {
    if (data.jobId) return String(data.jobId)
    if (ev.entityKind === 'card') {
      const card = leads.find(l => l?.id === ev.entityId)
      return (await jobForCard(rule.accountId, card))?.id ?? null
    }
    const customerId = data.customerId ?? (ev.entityKind === 'customer' ? ev.entityId : null)
    if (!customerId) return null
    const job = await prisma.savedJob.findFirst({ where: { accountId: rule.accountId, crmContactId: customerId, archivedAt: null }, orderBy: { createdAt: 'desc' } })
    return job?.id ?? null
  }
  if (data.cardId && leads.some(l => l?.id === data.cardId)) return String(data.cardId)
  let customerId = data.customerId ?? (ev.entityKind === 'customer' ? ev.entityId : null)
  if (!customerId && ev.entityKind === 'job') customerId = (await prisma.savedJob.findUnique({ where: { id: ev.entityId }, select: { crmContactId: true } }))?.crmContactId ?? null
  if (!customerId) return null
  return cardForJob(leads, { crmContactId: customerId })?.id ?? null
}

const entry = (step: number | null, result: string, detail: string, extra: Partial<LogEntry> = {}): LogEntry => ({ at: new Date().toISOString(), step, result, detail, ...extra })

/** Match one saved event against the rules and queue the runs. Safe to repeat: (rule, event) is unique. */
export async function processEvent(ev: AutomationEvent): Promise<number> {
  const rules = await prisma.automationRule.findMany({ where: { accountId: ev.accountId, enabled: true } })
  let made = 0
  for (const rule of rules) {
    let trigger: Trigger
    try { trigger = triggerSchema.parse(rule.trigger) } catch { continue }
    if (!ruleMatches(rule, trigger, ev)) continue
    const entityId = await entityFor(rule, ev)
    const kind = rule.board === 'sales' ? 'card' : 'job'
    const base = { accountId: ev.accountId, ruleId: rule.id, eventId: ev.id, entityKind: entityId ? kind : ev.entityKind, entityId: entityId ?? ev.entityId }
    let status = 'queued'
    // From the moment it happened (a time trigger caught up after downtime runs at once).
    let nextRunAt = ev.occurredAt
    const log: LogEntry[] = [entry(null, 'queued', describeEvent(ev))]
    if (!entityId) {
      status = 'skipped'
      log.push(entry(null, 'skipped', `No ${kind === 'card' ? 'pipeline card' : 'Operations job'} goes with this ${ev.entityKind}.`))
    } else if (trigger.type === 'card_entered') {
      nextRunAt = new Date(ev.occurredAt.getTime() + trigger.settleMinutes * 60_000)
      const since = new Date(ev.occurredAt.getTime() - SAME_STAGE_WINDOW_MS)
      const earlier = await prisma.automationRun.findFirst({ where: { ruleId: rule.id, entityId, createdAt: { gte: since }, status: { not: 'skipped' }, NOT: { eventId: ev.id } } })
      if (earlier) {
        status = 'skipped'
        log.push(entry(null, 'skipped', `This rule already ran for this ${kind} in ${trigger.stage} within the last 24 hours.`))
      } else if (trigger.settleMinutes > 0) {
        log.push(entry(null, 'settling', `Waits ${trigger.settleMinutes} min, then runs if it is still in ${trigger.stage}.`))
      }
    }
    const res = await prisma.automationRun.createMany({ data: [{ ...base, status, nextRunAt, log: log as any }], skipDuplicates: true })
    made += res.count
  }
  await prisma.automationEvent.update({ where: { id: ev.id }, data: { processedAt: new Date() } })
  return made
}

function describeEvent(ev: AutomationEvent): string {
  const d = (ev.data ?? {}) as any
  const who = d.name ? `${d.name}: ` : ''
  switch (ev.type) {
    case 'card_entered': return `${who}moved into ${d.stage}${d.from ? ` from ${d.from}` : ''}`
    case 'card_left': return `${who}moved out of ${d.stage}${d.to ? ` to ${d.to}` : ''}`
    case 'time': return String(d.why || 'time reached')
    case 'payment_received': return `payment received${d.amountCents ? ` ($${(d.amountCents / 100).toFixed(2)})` : ''}`
    default: return ev.type.replace(/_/g, ' ')
  }
}

// ── Running ──────────────────────────────────────────────────────────────────

async function save(run: AutomationRun, data: Partial<Pick<AutomationRun, 'status' | 'stepIndex' | 'nextRunAt' | 'attempts' | 'lastError'>>, add: LogEntry[]) {
  const log = [...((run.log as unknown as LogEntry[]) ?? []), ...add].slice(-200)
  const updated = await prisma.automationRun.update({ where: { id: run.id }, data: { ...data, log: log as any } })
  Object.assign(run, updated)
}

/** Run a queued run as far as it can go now. Returns its status after. */
export async function executeRun(runId: string, now = new Date()): Promise<string> {
  // Take it: only one worker, and only when it is due.
  const claimed = await prisma.automationRun.updateMany({ where: { id: runId, status: { in: ['queued', 'waiting'] }, nextRunAt: { lte: now } }, data: { status: 'running' } })
  if (claimed.count === 0) return 'not_due'
  const run = (await prisma.automationRun.findUnique({ where: { id: runId } }))!
  const rule = await prisma.automationRule.findUnique({ where: { id: run.ruleId } })
  if (!rule) { await save(run, { status: 'skipped' }, [entry(null, 'skipped', 'The rule was deleted.')]); return 'skipped' }
  if (!rule.enabled) { await save(run, { status: 'skipped' }, [entry(run.stepIndex, 'skipped', 'The rule is paused; the remaining steps were not run.')]); return 'skipped' }
  let parsed: ReturnType<typeof parseRule>
  try { parsed = parseRule(rule) } catch { await save(run, { status: 'failed', lastError: 'The rule is not valid any more.' }, [entry(null, 'failed', 'The rule is not valid any more. Open it and save it again.')]); return 'failed' }
  const { trigger, conditions, steps } = parsed
  const board = rule.board as Board
  const log = (run.log as unknown as LogEntry[]) ?? []

  const ctx = await buildContext(rule.accountId, board, run.entityId)
  if (!ctx) { await save(run, { status: 'skipped' }, [entry(run.stepIndex, 'skipped', `The ${board === 'sales' ? 'card' : 'job'} is not there any more.`)]); return 'skipped' }

  if (!log.some(l => l.result === 'started')) {
    if (trigger.type === 'card_entered' && ctx.stage !== trigger.stage) {
      await save(run, { status: 'skipped' }, [entry(null, 'skipped', `It left ${trigger.stage} before the settle time was up (now in ${ctx.stageLabel}).`)])
      return 'skipped'
    }
    const cond = evalConditions(conditions, ctx)
    if (!cond.ok) {
      const miss = cond.results.filter(r => !r.ok).map(r => `${r.condition.field.replace('_', ' ')} is ${r.actual}`).join('; ')
      await save(run, { status: 'skipped' }, [entry(null, 'skipped', `Conditions not met: ${miss}.`)])
      return 'skipped'
    }
    await save(run, {}, [entry(null, 'started', `Running "${rule.name}" for ${ctx.name}.`)])
  }

  for (let i = run.stepIndex; i < steps.length; i++) {
    const step = steps[i]
    if (step.type === 'wait') {
      const parked = ((run.log as unknown as LogEntry[]) ?? []).some(l => l.step === i && l.result === 'waiting')
      if (!parked) {
        const until = new Date(now.getTime() + step.minutes * 60_000)
        await save(run, { status: 'waiting', stepIndex: i, nextRunAt: until, attempts: 0 }, [entry(i, 'waiting', `waiting until ${until.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`, { until: until.toISOString() })])
        return 'waiting'
      }
      await save(run, { stepIndex: i + 1 }, [entry(i, 'done', 'wait over')])
      continue
    }
    if (trigger.type === 'card_entered' && trigger.onlyWhileInStage && i > 0 && ctx.stage !== trigger.stage) {
      await save(run, { status: 'skipped' }, [entry(i, 'skipped', `It is no longer in ${trigger.stage} (now ${ctx.stageLabel}); the remaining steps were not run.`)])
      return 'skipped'
    }
    try {
      const out = await runStep({ accountId: rule.accountId, runId: run.id, ruleId: rule.id, ruleName: rule.name, stepIndex: i, step, entity: ctx, now })
      await save(run, { stepIndex: i + 1, attempts: 0, lastError: null, status: 'running' }, [entry(i, 'done', out.detail, out.link ? { link: out.link } : {})])
    } catch (err) {
      const reason = String((err as Error)?.message || err).slice(0, 500)
      const attempts = run.attempts + 1
      if ((err as any)?.permanent || attempts >= MAX_ATTEMPTS) {
        await save(run, { status: 'failed', attempts, lastError: reason }, [entry(i, 'failed', reason)])
        await tellFailure(rule, run, ctx, i, step, reason)
        return 'failed'
      }
      const wait = RETRY_BACKOFF_MS[attempts - 1]
      await save(run, { status: 'queued', attempts, lastError: reason, nextRunAt: new Date(now.getTime() + wait) }, [entry(i, 'retry', `${reason} Trying again in ${wait >= 3600_000 ? `${wait / 3600_000} hour` : `${wait / 60_000} min`} (try ${attempts + 1} of ${MAX_ATTEMPTS}).`)])
      return 'queued'
    }
  }
  await save(run, { status: 'succeeded' }, [entry(null, 'succeeded', 'All steps done.')])
  return 'succeeded'
}

const STEP_WORDS: Record<Step['type'], string> = {
  create_task: 'Make a task', notify: 'Notify', email_customer: 'Email the customer', prepare_text: 'Prepare a text', move_card: 'Move the card',
  add_checklist: 'Add a checklist', request_signature: 'Request a signature', start_walkthrough: 'Start the final walkthrough',
  final_invoice: 'Final invoice', permit_packet: 'Permit packet', wait: 'Wait', webhook: 'Webhook',
}

/** A step that still fails: Jonathan is told why, with the way to Run again. */
async function tellFailure(rule: AutomationRule, run: AutomationRun, ctx: EntityContext, i: number, step: Step, reason: string) {
  const title = `Automation failed: ${rule.name}`
  const body = `${ctx.name}: step ${i + 1} (${STEP_WORDS[step.type]}) did not work. ${reason} Open it and press Run again.`
  const link = `/automations?run=${run.id}`
  try {
    // One notice per failure (a Run again that fails again tells again).
    const key = `${run.id}:fail:${run.attempts}:${i}`
    const had = await prisma.automationEffect.findUnique({ where: { key } })
    if (had) return
    await prisma.$transaction(async tx => {
      await tx.notification.create({ data: { title, body, type: 'error', link, jobId: ctx.job?.id ?? null } })
      await tx.automationEffect.create({ data: { key, runId: run.id, status: 'done' } })
    })
    await sendPush(rule.accountId, { title, body, url: link, tag: `fail-${run.id}` }).catch(() => null)
  } catch (err) {
    console.error('[automations] could not report a failed run:', err)
  }
}

/** Run again: carries on from the step that failed (steps done stay done). */
export async function runAgain(runId: string, accountId: string): Promise<AutomationRun | null> {
  const run = await prisma.automationRun.findFirst({ where: { id: runId, accountId } })
  if (!run || !['failed', 'skipped'].includes(run.status)) return run
  // A step left "sending" (email, push) is sent on Jonathan's say so.
  await prisma.automationEffect.deleteMany({ where: { runId, status: 'sending' } })
  const log = [...((run.log as unknown as LogEntry[]) ?? []), entry(run.stepIndex, 'run_again', 'Run again pressed.')]
  const updated = await prisma.automationRun.update({ where: { id: runId }, data: { status: 'queued', attempts: 0, nextRunAt: new Date(), lastError: null, log: log as any } })
  wake()
  return updated
}

// ── Time triggers, from the data ─────────────────────────────────────────────

const ymdPlus = (ymd: string, days: number) => floridaDay(new Date(new Date(`${ymd}T12:00:00Z`).getTime() + days * 86_400_000))
const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10))

/** Record a time event for every card or job whose moment has come (and not before the rule was switched on). Returns how many were new. */
export async function scanTimeTriggers(now = new Date()): Promise<number> {
  const rules = await prisma.automationRule.findMany({ where: { enabled: true } })
  const today = floridaDay(now)
  let made = 0
  for (const rule of rules) {
    let trigger: Trigger
    try { trigger = triggerSchema.parse(rule.trigger) } catch { continue }
    if (trigger.type !== 'in_stage_days' && trigger.type !== 'date_offset') continue
    const enabledDay = floridaDay(rule.enabledAt ?? rule.updatedAt)
    const board = rule.board as Board
    const fire = async (entityId: string, key: string, why: string) => {
      const id = await recordEvent({ accountId: rule.accountId, type: 'time', board, entityKind: board === 'sales' ? 'card' : 'job', entityId, data: { ruleId: rule.id, why }, dedupeKey: `time:${rule.id}:${entityId}:${key}`, occurredAt: now })
      if (id) made++
    }
    const { leads } = await loadLeads(rule.accountId)
    if (trigger.type === 'in_stage_days') {
      if (board === 'sales') {
        for (const l of leads) {
          if (l?.stage !== trigger.stage) continue
          const since = isYmd(l.lastMoved) ? l.lastMoved.slice(0, 10) : isYmd(l.createdAt) ? l.createdAt.slice(0, 10) : null
          if (!since) continue
          const due = ymdPlus(since, trigger.days)
          if (today >= due && due >= enabledDay) await fire(l.id, `${trigger.stage}:${since}`, `${trigger.days} days in ${trigger.stage} (since ${since})`)
        }
      } else {
        const jobs = await prisma.savedJob.findMany({ where: { accountId: rule.accountId, archivedAt: null } })
        for (const j of jobs) {
          if (opsStageOfJob(j) !== trigger.stage) continue
          const ev = await prisma.automationEvent.findFirst({ where: { accountId: rule.accountId, type: 'card_entered', board: 'ops', entityId: j.id }, orderBy: { occurredAt: 'desc' } })
          const since = floridaDay(ev?.occurredAt ?? j.updatedAt)
          const due = ymdPlus(since, trigger.days)
          if (today >= due && due >= enabledDay) await fire(j.id, `${trigger.stage}:${since}`, `${trigger.days} days in ${trigger.stage} (since ${since})`)
        }
      }
      continue
    }
    // X days before or after a date.
    const dates = await datesFor(rule.accountId, board, trigger.dateField, leads, today)
    for (const { entityId, date } of dates) {
      const due = ymdPlus(date, trigger.when === 'before' ? -trigger.days : trigger.days)
      if (today < due) continue
      // Before: only while the date is still ahead. After: only once switched on, and within a week of being due.
      if (trigger.when === 'before' ? today >= date && trigger.days > 0 : (due < enabledDay || today > ymdPlus(due, 7))) continue
      const label = trigger.dateField === 'install' ? 'install' : trigger.dateField === 'appointment' ? 'appointment' : 'proposal sent'
      await fire(entityId, `${trigger.dateField}:${date}`, `${trigger.days} day${trigger.days === 1 ? '' : 's'} ${trigger.when} ${label} (${date})`)
    }
  }
  return made
}

async function datesFor(accountId: string, board: Board, field: 'install' | 'appointment' | 'proposal_sent', leads: any[], today: string): Promise<Array<{ entityId: string; date: string }>> {
  const from = new Date(Date.now() - 60 * 86_400_000)
  const out: Array<{ entityId: string; date: string }> = []
  const toEntity = async (customerId: string | null, job: any | null): Promise<string | null> => {
    if (board === 'ops') {
      if (job) return job.id
      if (!customerId) return null
      return (await prisma.savedJob.findFirst({ where: { accountId, crmContactId: customerId, archivedAt: null }, orderBy: { createdAt: 'desc' } }))?.id ?? null
    }
    return cardForJob(leads, { crmContactId: customerId ?? job?.crmContactId })?.id ?? null
  }
  if (field === 'install') {
    const jobs = await prisma.savedJob.findMany({ where: { accountId, archivedAt: null, scheduledDate: { gte: ymdPlus(today, -60) } } })
    for (const j of jobs) { if (!isYmd(j.scheduledDate)) continue; const id = await toEntity(j.crmContactId, j); if (id) out.push({ entityId: id, date: j.scheduledDate.slice(0, 10) }) }
  } else if (field === 'appointment') {
    const appts = await prisma.appointment.findMany({ where: { accountId, startAt: { gte: from }, status: { notIn: ['cancelled'] } } })
    for (const a of appts) { const id = await toEntity(a.crmContactId, a.jobId ? { id: a.jobId, crmContactId: a.crmContactId } : null); if (id) out.push({ entityId: id, date: floridaDay(a.startAt!) }) }
  } else {
    const quotes = await prisma.savedQuote.findMany({ where: { accountId, status: 'SENT', archivedAt: null, updatedAt: { gte: from } } })
    for (const q of quotes) {
      const date = String((q.proposal as any)?.createdAt || q.date || '').slice(0, 10)
      if (!isYmd(date)) continue
      const id = await toEntity(q.crmContactId, null)
      if (id) out.push({ entityId: id, date })
    }
  }
  return out
}

// ── Permit reminders: until it is Approved ───────────────────────────────────

const PERMIT_REMIND_EVERY_DAYS = 3

export async function permitReminders(now = new Date()): Promise<number> {
  const open = await prisma.permit.findMany({ where: { status: { in: ['needed', 'applied'] } } })
  let sent = 0
  const today = floridaDay(now)
  for (const p of open) {
    const job = await prisma.savedJob.findFirst({ where: { id: p.jobId, archivedAt: null, status: { notIn: ['completed', 'invoiced', 'paid'] } } })
    if (!job) continue
    const ageDays = (now.getTime() - p.updatedAt.getTime()) / 86_400_000
    if (ageDays < PERMIT_REMIND_EVERY_DAYS) continue
    const last = await prisma.automationEffect.findFirst({ where: { key: { startsWith: `permit-reminder:${p.id}:` } }, orderBy: { createdAt: 'desc' } })
    if (last && now.getTime() - last.createdAt.getTime() < PERMIT_REMIND_EVERY_DAYS * 86_400_000 - 3600_000) continue
    const key = `permit-reminder:${p.id}:${today}`
    const portal = portalFor(p.county)
    const title = `Permit still ${PERMIT_STATUS_LABEL[p.status as PermitStatus]}: ${job.customerName}`
    const body = `${job.customerAddress}. ${p.status === 'needed' ? 'Not applied for yet.' : `Applied${p.appliedAt ? ` ${p.appliedAt}` : ''}; check for approval.`}${portal ? ` ${portal.name}: ${portal.url}` : ''}`
    try {
      await prisma.$transaction(async tx => {
        await tx.automationEffect.create({ data: { key, runId: 'permit-reminders', status: 'done' } })
        await tx.notification.create({ data: { title, body, type: 'warning', link: `/operations?job=${job.id}`, jobId: job.id } })
      })
    } catch { continue } // already reminded today
    await sendPush(p.accountId, { title, body, url: `/operations?job=${job.id}`, tag: `permit-${p.id}` }).catch(() => null)
    sent++
  }
  return sent
}

// ── Dry run ──────────────────────────────────────────────────────────────────

export interface DryRunResult {
  entity: { board: Board; id: string; name: string; stage: string }
  trigger: string
  conditions: Array<{ field: string; ok: boolean; actual: string }>
  wouldRun: boolean
  steps: DryStep[]
}

/** What the rule would do for this card or job, right now. Writes nothing. */
export async function dryRun(accountId: string, rule: { board: Board; trigger: unknown; conditions: unknown; steps: unknown; name?: string }, entityId: string, now = new Date()): Promise<DryRunResult | null> {
  const r = ruleSchema.parse({ name: rule.name || 'Test', board: rule.board, trigger: rule.trigger, conditions: rule.conditions ?? [], steps: rule.steps, enabled: false })
  const ctx = await buildContext(accountId, r.board, entityId)
  if (!ctx) return null
  const cond = evalConditions(r.conditions, ctx)
  const t = r.trigger
  const trig = t.type === 'card_entered' ? `when it moves into ${t.stage} (runs ${t.settleMinutes} min later if it is still there)`
    : t.type === 'card_left' ? `when it moves out of ${t.stage}`
    : t.type === 'in_stage_days' ? `when it has been in ${t.stage} for ${t.days} days`
    : t.type === 'date_offset' ? `${t.days} days ${t.when} the ${t.dateField.replace('_', ' ')} date`
    : `when ${t.event.replace(/_/g, ' ')}`
  return {
    entity: { board: r.board, id: entityId, name: ctx.name, stage: ctx.stageLabel },
    trigger: trig,
    conditions: cond.results.map(x => ({ field: x.condition.field, ok: x.ok, actual: x.actual })),
    wouldRun: cond.ok,
    steps: await describeSteps(accountId, r.steps, ctx, now),
  }
}

// ── Starter rules ────────────────────────────────────────────────────────────

/**
 * Jonathan's starter rules and stage rules, switched off, made once per company.
 *
 * Each starter has a fixed key (`starter`) and the database allows one row per
 * company per key (@@unique([accountId, starter])), so this is a plain insert
 * that skips whatever is already there, in one transaction. Two screens asking
 * at the same moment (Rules and Stage rules both load on open) cannot make a
 * second copy: the database refuses it and the insert skips it.
 */
export async function ensureStarters(accountId: string): Promise<void> {
  await prisma.$transaction([
    prisma.automationRule.createMany({
      data: STARTER_RULES.map(s => ({ accountId, name: s.name, board: s.board, enabled: false, trigger: s.trigger as any, conditions: s.conditions as any, steps: s.steps as any, starter: s.starter, createdBy: 'starter' })),
      skipDuplicates: true,
    }),
    prisma.stageRule.createMany({
      data: STARTER_STAGE_RULES.map(s => ({ accountId, board: s.board, stage: s.stage, requirements: s.requirements as any, enabled: false, starter: s.starter })),
      skipDuplicates: true,
    }),
  ])
}

// ── The worker ───────────────────────────────────────────────────────────────

let busy = false
let again = false
let timer: ReturnType<typeof setInterval> | null = null
let wakeTimer: ReturnType<typeof setTimeout> | null = null
let lastScan = 0
const SCAN_EVERY_MS = 5 * 60_000

function wake() {
  if (!timer) return
  if (wakeTimer) return
  wakeTimer = setTimeout(() => { wakeTimer = null; void tick() }, 200)
}

/** One pass: stale runs back in the queue, new events into runs, due runs run, time triggers checked. */
export async function tick(now = new Date(), opts: { scan?: boolean } = {}): Promise<{ events: number; runs: number; time: number }> {
  if (busy) { again = true; return { events: 0, runs: 0, time: 0 } }
  busy = true
  const out = { events: 0, runs: 0, time: 0 }
  try {
    // A run left "running" by a worker that stopped carries on (its done steps stay done).
    await prisma.automationRun.updateMany({ where: { status: 'running', updatedAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) } }, data: { status: 'queued' } })
    if (opts.scan ?? (now.getTime() - lastScan >= SCAN_EVERY_MS)) {
      lastScan = now.getTime()
      try { out.time = await scanTimeTriggers(now) } catch (err) { console.error('[automations] time triggers:', err) }
      try { await permitReminders(now) } catch (err) { console.error('[automations] permit reminders:', err) }
    }
    for (let guard = 0; guard < 20; guard++) {
      const events = await prisma.automationEvent.findMany({ where: { processedAt: null }, orderBy: { occurredAt: 'asc' }, take: 100 })
      if (!events.length) break
      for (const ev of events) {
        try { await processEvent(ev); out.events++ } catch (err) { console.error(`[automations] event ${ev.id}:`, err) }
      }
    }
    for (let guard = 0; guard < 20; guard++) {
      const due = await prisma.automationRun.findMany({ where: { status: { in: ['queued', 'waiting'] }, nextRunAt: { lte: now } }, orderBy: { nextRunAt: 'asc' }, take: 50, select: { id: true } })
      if (!due.length) break
      for (const r of due) {
        try { await executeRun(r.id, now); out.runs++ } catch (err) {
          console.error(`[automations] run ${r.id}:`, err)
          await prisma.automationRun.updateMany({ where: { id: r.id, status: 'running' }, data: { status: 'queued', nextRunAt: new Date(now.getTime() + RETRY_BACKOFF_MS[0]), lastError: String((err as Error)?.message || err).slice(0, 300) } }).catch(() => {})
        }
      }
      if (due.length < 50) break
    }
  } finally {
    busy = false
  }
  if (again) { again = false; setTimeout(() => void tick(), 50) }
  return out
}

export function startAutomationWorker(): void {
  if (process.env.DISABLE_CRON === '1') { console.log('[automations] worker off (DISABLE_CRON=1)'); return }
  if (timer) return
  // The app just started: whatever was mid-run when it stopped goes back in the queue now.
  prisma.automationRun.updateMany({ where: { status: 'running' }, data: { status: 'queued' } })
    .catch(err => console.error('[automations] could not resume runs:', err))
    .finally(() => { lastScan = 0; void tick() })
  timer = setInterval(() => void tick(), 30_000)
  timer.unref?.()
  onEventRecorded(wake)
  console.log('[automations] worker started')
}

export function stopAutomationWorkerForTests() { if (timer) clearInterval(timer); timer = null }
