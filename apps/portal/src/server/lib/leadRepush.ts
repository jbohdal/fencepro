/**
 * A lead still not assigned pushes the owner again (Jonathan, Oct 29 2026,
 * D8: "Push again once after 2 hours, then once at 8 am the next day. No more
 * after that.").
 *
 * Each website or phone lead on the waiting list (lib/leadAssign.ts
 * waitingLeads: no rep on the customer, its cards or an appointment) gets at
 * most two repeat pushes, with the same Assign buttons as the first:
 *
 *   - "2h": 2 hours after it came in.
 *   - "8am": 8:00 am Florida time (America/New_York) the day after it came in.
 *
 * None once it is assigned (checked again right before each push). Never
 * more than those two: each one is written down (AutomationEffect, key
 * `lead-repush:<customer>:<2h|8am>`, unique) before it is sent, so a restart,
 * two servers or two passes at once cannot send one twice. One that was being
 * sent when the server stopped is not sent again (at most once, never twice).
 *
 * Run by the automation worker every 30 seconds (lib/automations/queue.ts
 * tick), so it survives restarts: whatever came due while the app was down is
 * decided on the first pass after it starts:
 *   - the 2 hour push is sent late, unless the 8 am one has come due by then
 *     (then only the 8 am one goes, and the 2 hour one is written down as
 *     skipped: one push, not two at once);
 *   - the 8 am push is sent until noon that day; after that it is skipped (a
 *     "good morning" push at 4 pm is noise; the lead is still on the waiting
 *     list on the Dashboard, Today and Sales Pipeline).
 *
 * No quiet hours: the app has none for pushes. A lead that comes in after
 * 10 pm gets its 2 hour push after midnight (11 pm -> 1 am), as asked.
 */

import prisma from './prisma.js'
import { addDays, floridaDay } from './followUpRules.js'
import { floridaTime } from './appointments.js'
import { deliverLeadPush, leadRepOf, waitingLeads, type LeadPushDeps, type WaitingLead } from './leadAssign.js'

export type RepushSlot = '2h' | '8am'

const TWO_HOURS_MS = 2 * 3_600_000
/** Leads older than this cannot have a repeat push left (8 am the next day, sent by noon, is at most ~38 hours). */
const LOOK_BACK_MS = 2 * 86_400_000
export const REPUSH_RUN_ID = 'lead-repush'

export const repushKey = (contactId: string, slot: RepushSlot) => `${REPUSH_RUN_ID}:${contactId}:${slot}`

/** When each repeat push is due, and the last moment the 8 am one is still sent. */
export function repushTimes(arrivedAt: Date): { twoHours: Date; nextMorning: Date; morningUntil: Date } {
  const nextDay = addDays(floridaDay(arrivedAt), 1)
  return {
    twoHours: new Date(arrivedAt.getTime() + TWO_HOURS_MS),
    nextMorning: floridaTime(nextDay, '08:00'),
    morningUntil: floridaTime(nextDay, '12:00'),
  }
}

/**
 * What to do now for one lead, given which slots are already written down
 * (sent, being sent or skipped). Pure, for the tests. At most one push per call.
 */
export function repushPlan(arrivedAt: Date, now: Date, done: ReadonlySet<RepushSlot>): { send: RepushSlot | null; skip: RepushSlot[] } {
  const t = repushTimes(arrivedAt)
  const skip: RepushSlot[] = []
  if (now.getTime() >= t.nextMorning.getTime()) {
    if (!done.has('2h')) skip.push('2h')
    if (done.has('8am')) return { send: null, skip }
    if (now.getTime() < t.morningUntil.getTime()) return { send: '8am', skip }
    return { send: null, skip: [...skip, '8am'] }
  }
  if (now.getTime() >= t.twoHours.getTime() && !done.has('2h')) return { send: '2h', skip }
  return { send: null, skip }
}

const timeWords = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d)

/** What a repeat push says. */
export function repushWords(lead: Pick<WaitingLead, 'name' | 'sourceWords' | 'town' | 'what'>, arrivedAt: Date, now: Date): { title: string; body: string } {
  const day = floridaDay(arrivedAt) === floridaDay(now) ? '' : floridaDay(arrivedAt) === addDays(floridaDay(now), -1) ? 'yesterday ' : `${floridaDay(arrivedAt)} `
  const what = [lead.sourceWords, lead.town, lead.what].filter(Boolean).join(' · ')
  return { title: `Still not assigned: ${lead.name || 'New lead'}`, body: `${what}. Came in ${day}at ${timeWords(arrivedAt)}. Tap to assign.` }
}

/** Write a slot down; false when it already was (by this pass, an earlier one or another server). */
async function claim(contactId: string, slot: RepushSlot, status: 'sending' | 'skipped', result: Record<string, unknown>): Promise<boolean> {
  // skipDuplicates: the key is unique, so of two at once only one writes it (and nothing is logged as an error).
  const r = await prisma.automationEffect.createMany({ data: [{ key: repushKey(contactId, slot), runId: REPUSH_RUN_ID, status, result: result as any }], skipDuplicates: true })
  return r.count === 1
}

export interface RepushOutcome { contactId: string; slot: RepushSlot; pushed: boolean; held?: boolean; why?: string }

/**
 * One pass over the leads waiting to be assigned: send the repeat pushes that
 * are due. `accountIds` limits it (the tests use their own company).
 */
export async function leadRepushSweep(now = new Date(), deps: LeadPushDeps & { accountIds?: string[] } = {}): Promise<RepushOutcome[]> {
  const out: RepushOutcome[] = []
  const since = new Date(now.getTime() - LOOK_BACK_MS)
  const recent = await prisma.intakeLead.findMany({
    where: { deletedAt: null, crmContactId: { not: null }, createdAt: { gte: since, lte: new Date(now.getTime() - TWO_HOURS_MS) }, ...(deps.accountIds ? { accountId: { in: deps.accountIds } } : {}) },
    distinct: ['accountId'], select: { accountId: true },
  })
  for (const { accountId } of recent) {
    const waiting = (await waitingLeads(accountId, now)).filter(l => {
      const at = new Date(l.at).getTime()
      return at >= since.getTime() && at <= now.getTime() - TWO_HOURS_MS
    })
    if (!waiting.length) continue
    const written = await prisma.automationEffect.findMany({
      where: { key: { in: waiting.flatMap(l => [repushKey(l.customerId, '2h'), repushKey(l.customerId, '8am')]) } }, select: { key: true },
    })
    const have = new Set(written.map(e => e.key))
    for (const lead of waiting) {
      const arrivedAt = new Date(lead.at)
      const done = new Set<RepushSlot>((['2h', '8am'] as const).filter(s => have.has(repushKey(lead.customerId, s))))
      const plan = repushPlan(arrivedAt, now, done)
      for (const s of plan.skip) await claim(lead.customerId, s, 'skipped', { at: now.toISOString(), why: s === '2h' ? 'the 8 am push came due first' : 'past noon' })
      if (!plan.send) continue
      const slot = plan.send
      try {
        // Assigned since the list was read: no push (and nothing written down; it is off the list from now on).
        if (await leadRepOf(accountId, lead.customerId)) continue
        if (!(await claim(lead.customerId, slot, 'sending', { at: now.toISOString() }))) continue
        const r = await deliverLeadPush(accountId, lead.customerId, repushWords(lead, arrivedAt, now), deps, { renotify: true })
        await prisma.automationEffect.update({ where: { key: repushKey(lead.customerId, slot) }, data: { status: 'done', result: { at: now.toISOString(), pushed: r.pushed, held: !!r.held, why: r.why ?? null, sent: r.result?.sent ?? null } as any } })
        out.push({ contactId: lead.customerId, slot, pushed: r.pushed, ...(r.held ? { held: true } : {}), ...(r.why ? { why: r.why } : {}) })
      } catch (err) {
        console.error(`[lead-repush] ${lead.customerId} ${slot}:`, String((err as Error)?.message || err).slice(0, 200))
      }
    }
  }
  return out
}
