/**
 * The one way anything tells automations that something happened.
 *
 * recordEvent saves the event to the database (AutomationEvent) before any
 * rule runs, so nothing is lost if the app stops a moment later; the
 * automation worker (lib/automationQueue.ts) picks it up from there. The
 * dedupeKey names the real happening (a card's move at one pipeline version,
 * one walkthrough's signing): recording it again is a no-op, never a second
 * event. Recording never throws into the caller: a failure is logged and the
 * caller's own save still stands.
 */

import prisma from './prisma.js'

export type AutomationEventType =
  | 'card_entered' | 'card_left'
  | 'proposal_accepted' | 'walkthrough_signed' | 'walkthrough_completed' | 'punch_list_cleared'
  | 'payment_received' | 'photo_uploaded' | 'permit_changed' | 'time'

export interface RecordEventInput {
  accountId: string
  type: AutomationEventType
  /** sales (pipeline cards) or ops (Operations jobs) */
  board?: 'sales' | 'ops'
  entityKind: 'card' | 'job' | 'quote' | 'customer' | 'walkthrough'
  entityId: string
  data?: Record<string, unknown>
  /** Names the real happening; the same key twice is one event. */
  dedupeKey: string
  occurredAt?: Date
}

/** Listeners (the worker) are woken at once; the queue is the record either way. */
const listeners = new Set<() => void>()
export function onEventRecorded(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn) } }

/** A database handle: the app's client, or a transaction so the event is saved with the change itself. */
type Db = Pick<typeof prisma, 'automationEvent'>

/**
 * Save an event for automations. Returns its id, or null if it was already
 * recorded (or could not be saved). Pass `db` (a transaction) to save the event
 * in the same step as the change that caused it: then it is there exactly when
 * the change is. A duplicate is skipped without aborting the transaction.
 */
export async function recordEvent(e: RecordEventInput, db: Db = prisma): Promise<string | null> {
  try {
    const made = await db.automationEvent.createMany({
      data: [{
        accountId: e.accountId, type: e.type, board: e.board ?? null, entityKind: e.entityKind, entityId: e.entityId,
        data: (e.data ?? {}) as any, dedupeKey: e.dedupeKey, occurredAt: e.occurredAt ?? new Date(),
      }],
      skipDuplicates: true,
    })
    if (made.count === 0) return null // already recorded: the same happening
    const row = await db.automationEvent.findUnique({ where: { accountId_dedupeKey: { accountId: e.accountId, dedupeKey: e.dedupeKey } }, select: { id: true } })
    // Inside a transaction the worker is woken once it commits (it also polls).
    if (db === prisma) wake()
    else setTimeout(wake, 50)
    return row?.id ?? null
  } catch (err) {
    console.error(`[automations] could not record ${e.type} for ${e.entityKind} ${e.entityId}:`, String((err as Error)?.message || err).slice(0, 300))
    if (db !== prisma) throw err // the caller's transaction must not commit without its event
    return null
  }
}

function wake() { for (const fn of listeners) { try { fn() } catch { /* the worker also polls */ } } }
