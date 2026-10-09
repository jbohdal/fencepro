/**
 * Calendar sync, server side. One way: EZ Biz → Google Calendar.
 *
 * Route handlers call requestCalendarSync(accountId) after a save. That
 * returns at once; the sync runs a moment later in the background, so a slow
 * or unreachable Google can never hold up or fail a save in the CRM. Failures
 * are kept on the event link and retried (on the next save, and every few
 * minutes by startCalendarSyncRetry).
 */

import os from 'os'
import path from 'path'
import prisma from '../prisma.js'
import { reconcile, type EventLink, type ReconcileResult } from './engine.js'
import { exchangeCode, forgetTokens, googleApiFor, googleConfigured } from './google.js'
import { buildDesiredEvents, type LeadRow, type SpecInputs } from './spec.js'

const DEBOUNCE_MS = 2_000
const RETRY_EVERY_MS = 5 * 60_000

/** Only the live install (~/ezbiz) may write to the real calendar. Every other copy gets "(TEST)". */
export function calendarName(cwd: string = process.cwd(), home: string = os.homedir(), configured: string | null | undefined = process.env.GOOGLE_CALENDAR_NAME): string {
  const base = (configured || 'GD Fence Pro').trim()
  const liveRoot = path.join(home, 'ezbiz')
  const here = path.resolve(cwd)
  const isLive = here === liveRoot || here.startsWith(liveRoot + path.sep)
  return isLive || /\(TEST\)/i.test(base) ? base : `${base} (TEST)`
}

const floridaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const baseUrl = () => (process.env.CLIENT_URL || process.env.APP_URL || '').replace(/\/+$/, '')

async function loadInputs(accountId: string): Promise<SpecInputs> {
  const [gridJobs, pipeline, contacts, settings, appointments] = await Promise.all([
    prisma.scheduledGridJob.findMany({ where: { accountId } }),
    prisma.pipelineState.findUnique({ where: { accountId }, select: { leads: true } }),
    prisma.crmContact.findMany({
      where: { accountId, archivedAt: null, AND: [{ firstApptDate: { not: null } }, { firstApptDate: { not: '' } }] },
      select: { id: true, firstName: true, lastName: true, phone: true, email: true, serviceAddress: true, firstApptDate: true, notes: true },
    }),
    prisma.scheduleSettings.findUnique({ where: { accountId } }),
    // Chat appointments belong to no company in the schema; there is one company on this install.
    prisma.appointment.findMany({
      where: { scheduledAt: { gte: new Date(Date.now() - 60 * 86_400_000) } },
      include: { lead: { select: { firstName: true, lastName: true, phone: true, email: true, address: true, city: true, state: true, zipCode: true, fenceType: true, linearFootage: true } } },
    }),
  ])
  const onBoard = gridJobs.map(g => g.stagingJobId).filter((x): x is string => !!x)
  const jobs = await prisma.savedJob.findMany({
    where: { accountId, archivedAt: null, OR: [{ scheduledDate: { not: '' } }, { id: { in: onBoard } }] },
  })
  const leads = (Array.isArray(pipeline?.leads) ? pipeline!.leads : []) as unknown as LeadRow[]
  return {
    baseUrl: baseUrl(),
    workDays: Array.isArray(settings?.workDays) ? (settings!.workDays as number[]) : [1, 2, 3, 4],
    crews: Array.isArray(settings?.crews) ? (settings!.crews as Array<{ id: string; name: string }>) : [],
    jobs, gridJobs, contacts, appointments,
    leads: leads.filter(l => l && typeof l === 'object' && l.scheduledDate),
  }
}

export interface CalendarStatus {
  configured: boolean
  connected: boolean
  /** True once "Push all upcoming" has run; from then on saves sync by themselves. */
  active: boolean
  email: string | null
  calendarName: string | null
  expectedCalendarName: string
  lastSyncAt: Date | null
  lastError: string | null
  eventsOnCalendar: number
  failing: Array<{ source: string; recordId: string; attempts: number; error: string | null }>
}

export async function calendarStatus(accountId: string): Promise<CalendarStatus> {
  const [state, synced, failing] = await Promise.all([
    prisma.calendarSyncState.findUnique({ where: { accountId } }),
    prisma.calendarEventLink.count({ where: { accountId, status: 'synced' } }),
    prisma.calendarEventLink.findMany({ where: { accountId, status: 'error' }, orderBy: { updatedAt: 'desc' }, take: 10 }),
  ])
  const connected = !!state?.googleEmail && !!state?.calendarId
  return {
    configured: googleConfigured(), connected, active: connected && !!state?.activatedAt,
    email: state?.googleEmail ?? null, calendarName: connected ? state!.calendarName : null, expectedCalendarName: calendarName(),
    lastSyncAt: state?.lastSyncAt ?? null, lastError: state?.lastError ?? null, eventsOnCalendar: synced,
    failing: failing.map(f => ({ source: f.source, recordId: f.recordId, attempts: f.attempts, error: f.lastError })),
  }
}

/** Finish the OAuth flow: store the sign in and make sure the dedicated calendar exists. Sends no events. */
export async function connectCalendar(accountId: string, code: string): Promise<{ email: string; calendarName: string }> {
  const email = await exchangeCode(code)
  const api = await googleApiFor(email)
  const name = calendarName()
  const prev = await prisma.calendarSyncState.findUnique({ where: { accountId } })
  // Reuse the calendar made last time if it is still there and still the right one.
  let calendarId = prev?.calendarId && prev.calendarName === name && (await api.calendarExists(prev.calendarId)) ? prev.calendarId : null
  if (!calendarId) calendarId = await api.createCalendar(name)
  const fields = { googleEmail: email, calendarId, calendarName: name, connectedAt: new Date(), activatedAt: null, lastError: null }
  await prisma.calendarSyncState.upsert({ where: { accountId }, create: { accountId, ...fields }, update: fields })
  console.log(`[calendar] connected ${email}, calendar "${name}"`)
  return { email, calendarName: name }
}

/** Stop syncing and forget the Google sign in. Events already on the calendar stay there. */
export async function disconnectCalendar(accountId: string): Promise<void> {
  const state = await prisma.calendarSyncState.findUnique({ where: { accountId } })
  if (state?.googleEmail) await forgetTokens(state.googleEmail)
  if (state) await prisma.calendarSyncState.update({ where: { accountId }, data: { googleEmail: null, connectedAt: null, activatedAt: null, lastError: null } })
}

const running = new Map<string, Promise<unknown>>()

/**
 * Bring the calendar in line with the CRM now. One run at a time per company.
 * `activate` is what "Push all upcoming" passes: it switches syncing on.
 * Returns null when there is nothing to do (not connected, or not switched on).
 */
export function syncCalendarNow(accountId: string, opts: { activate?: boolean } = {}): Promise<ReconcileResult | null> {
  const prev = running.get(accountId) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(async () => {
    let state = await prisma.calendarSyncState.findUnique({ where: { accountId } })
    if (!googleConfigured() || !state?.googleEmail || !state.calendarId) return null
    if (!state.activatedAt) {
      if (!opts.activate) return null
      state = await prisma.calendarSyncState.update({ where: { accountId }, data: { activatedAt: new Date() } })
    }
    const calendarId = state.calendarId as string
    try {
      const [api, inputs, links] = await Promise.all([
        googleApiFor(state.googleEmail as string),
        loadInputs(accountId),
        prisma.calendarEventLink.findMany({ where: { accountId } }),
      ])
      const result = await reconcile({
        accountId, calendarId, today: floridaToday(),
        desired: buildDesiredEvents(inputs), links: links as EventLink[], api,
        store: {
          async save(l) {
            const data = { calendarId: l.calendarId, eventId: l.eventId, contentHash: l.contentHash, status: l.status, attempts: l.attempts, lastError: l.lastError }
            await prisma.calendarEventLink.upsert({
              where: { accountId_source_recordId: { accountId, source: l.source, recordId: l.recordId } },
              create: { accountId, source: l.source, recordId: l.recordId, ...data }, update: data,
            })
          },
          async remove(source, recordId) { await prisma.calendarEventLink.deleteMany({ where: { accountId, source, recordId } }) },
        },
      })
      await prisma.calendarSyncState.update({ where: { accountId }, data: { lastSyncAt: new Date(), lastError: result.failed ? `${result.failed} event(s) could not be sent: ${result.errors[0]?.error}` : null } })
      if (result.created || result.updated || result.deleted || result.failed) {
        console.log(`[calendar] sync: ${result.created} created, ${result.updated} updated, ${result.deleted} deleted, ${result.failed} failed`)
        for (const e of result.errors) console.error(`[calendar] failed ${e.key} (${e.summary}): ${e.error}`)
      }
      return result
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 300)
      console.error('[calendar] sync could not run:', message)
      await prisma.calendarSyncState.update({ where: { accountId }, data: { lastError: message } }).catch(() => {})
      throw err
    }
  })
  running.set(accountId, next)
  return next
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Ask for a sync soon. Safe to call from any request handler: it never
 * throws, never waits on Google, and several calls close together make one run.
 * With no accountId it covers every connected company.
 */
export function requestCalendarSync(accountId?: string | null): void {
  if (!googleConfigured()) return
  if (!accountId) {
    prisma.calendarSyncState.findMany({ where: { activatedAt: { not: null } }, select: { accountId: true } })
      .then(rows => rows.forEach(r => requestCalendarSync(r.accountId))).catch(() => {})
    return
  }
  const existing = timers.get(accountId)
  if (existing) clearTimeout(existing)
  timers.set(accountId, setTimeout(() => {
    timers.delete(accountId)
    syncCalendarNow(accountId).catch(() => { /* logged and kept for the retry */ })
  }, DEBOUNCE_MS))
}

/** Every few minutes, retry companies that have a failed event or a failed run. */
export function startCalendarSyncRetry(): void {
  const tick = async () => {
    if (!googleConfigured()) return
    try {
      const states = await prisma.calendarSyncState.findMany({ where: { activatedAt: { not: null }, googleEmail: { not: null } } })
      for (const s of states) {
        const failing = s.lastError || (await prisma.calendarEventLink.count({ where: { accountId: s.accountId, status: 'error' } })) > 0
        if (failing) await syncCalendarNow(s.accountId).catch(() => {})
      }
    } catch (err) { console.error('[calendar] retry pass failed:', (err as Error).message) }
  }
  setInterval(tick, RETRY_EVERY_MS).unref()
}

/** Express middleware: after any successful write on this router, ask for a calendar sync. */
export function syncCalendarAfterWrite(req: { method: string; user?: { crmAccountId?: string | null } }, res: { statusCode: number; on: (e: string, fn: () => void) => void }, next: () => void): void {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    res.on('finish', () => {
      if (res.statusCode < 400) { try { requestCalendarSync(req.user?.crmAccountId ?? null) } catch { /* never affects the save */ } }
    })
  }
  next()
}
