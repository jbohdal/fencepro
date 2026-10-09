/**
 * Makes the calendar match the CRM. Given the events that should exist and
 * the links recorded from earlier runs, it creates, updates and deletes
 * Google events and keeps the links current.
 *
 * Rules:
 *   - A record that already has a link is updated in place, never created again.
 *   - A record with no link gets an event only if it is upcoming (ends today
 *     or later); history is not back filled.
 *   - A link whose record is gone, or no longer has a date, has its event deleted.
 *   - Event ids are derived from the record (googleEventId), so even a lost
 *     link cannot produce a second event.
 *   - A failed call is recorded on the link and tried again on the next run.
 *     Nothing here throws to the caller.
 */

import { type CalendarEventSpec, eventKey, googleEventId, lastDayOf, specHash } from './spec.js'

export interface EventLink {
  source: string
  recordId: string
  calendarId: string
  eventId: string
  contentHash: string
  status: string            // 'synced' | 'error'
  attempts: number
  lastError: string | null
}

/** The few Google Calendar calls the sync needs. `code` on a thrown error is the HTTP status. */
export interface CalendarApi {
  insert(calendarId: string, eventId: string, spec: CalendarEventSpec): Promise<void>
  update(calendarId: string, eventId: string, spec: CalendarEventSpec): Promise<void>
  remove(calendarId: string, eventId: string): Promise<void>
}

export interface LinkStore {
  save(link: EventLink): Promise<void>
  remove(source: string, recordId: string): Promise<void>
}

export interface ReconcileResult {
  created: number
  updated: number
  deleted: number
  unchanged: number
  failed: number
  errors: Array<{ key: string; summary: string; error: string }>
}

const statusOf = (err: unknown): number => {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } }
  const n = Number(e?.code ?? e?.status ?? e?.response?.status)
  return Number.isFinite(n) ? n : 0
}
const messageOf = (err: unknown): string => String((err as { message?: unknown })?.message ?? err).slice(0, 300)

export async function reconcile(opts: {
  accountId: string
  calendarId: string
  today: string
  desired: CalendarEventSpec[]
  links: EventLink[]
  api: CalendarApi
  store: LinkStore
}): Promise<ReconcileResult> {
  const { accountId, calendarId, today, api, store } = opts
  const res: ReconcileResult = { created: 0, updated: 0, deleted: 0, unchanged: 0, failed: 0, errors: [] }
  const want = new Map(opts.desired.map(e => [eventKey(e), e]))
  const have = new Map(opts.links.map(l => [eventKey(l), l]))

  const fail = async (spec: { source: string; recordId: string; summary?: string }, link: EventLink | undefined, eventId: string, err: unknown) => {
    res.failed++
    res.errors.push({ key: eventKey(spec), summary: spec.summary || '', error: messageOf(err) })
    try {
      await store.save({
        source: spec.source, recordId: spec.recordId, calendarId, eventId,
        contentHash: link?.contentHash ?? '', status: 'error',
        attempts: (link?.attempts ?? 0) + 1, lastError: messageOf(err),
      })
    } catch { /* the next run starts from the old link */ }
  }

  // ── events that should no longer exist ──
  for (const [key, link] of have) {
    if (want.has(key)) continue
    try {
      try { await api.remove(link.calendarId, link.eventId) }
      catch (err) { if (![404, 410].includes(statusOf(err))) throw err }   // already gone is fine
      await store.remove(link.source, link.recordId)
      res.deleted++
    } catch (err) {
      await fail({ source: link.source, recordId: link.recordId, summary: '(delete)' }, link, link.eventId, err)
    }
  }

  // ── events that should exist ──
  for (const [key, spec] of want) {
    const link = have.get(key)
    const hash = specHash(spec)
    if (link && link.status === 'synced' && link.contentHash === hash && link.calendarId === calendarId) { res.unchanged++; continue }
    if (!link && lastDayOf(spec) < today) continue                        // history is not back filled
    const eventId = googleEventId(accountId, spec)
    const existsInGoogle = !!link && link.contentHash !== '' && link.calendarId === calendarId
    try {
      if (existsInGoogle) {
        try { await api.update(calendarId, eventId, spec) }
        catch (err) { if (statusOf(err) !== 404) throw err; await api.insert(calendarId, eventId, spec) }
        res.updated++
      } else {
        // 409: the event is already there (a lost link, or one deleted by hand in Google). Take it over.
        try { await api.insert(calendarId, eventId, spec); res.created++ }
        catch (err) { if (statusOf(err) !== 409) throw err; await api.update(calendarId, eventId, spec); res.updated++ }
      }
      await store.save({ source: spec.source, recordId: spec.recordId, calendarId, eventId, contentHash: hash, status: 'synced', attempts: 0, lastError: null })
    } catch (err) {
      await fail(spec, link, eventId, err)
    }
  }
  return res
}
