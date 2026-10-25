/**
 * Schedule API
 *
 * Three sub resources, all account scoped:
 *   /api/schedule/settings           — singleton: workDays + crews per account
 *   /api/schedule/jobs               — ScheduledGridJob CRUD + sync
 *   /api/schedule/rain-log           — append only RainDay log
 */

import { cardFollowsJob } from '../lib/jobTruth.js'
import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { emptySnapshot, logDeletion, softDeleteLogged } from '../lib/deletion.js'

const actorOf = (req: any) => ({ accountId: req.user.crmAccountId as string, userId: (req.user.id ?? req.user.sub ?? null) as string | null })
import { findOrCreate, isUniqueViolation } from '../lib/once.js'
import { clientIdSchema, decideClientId } from '../lib/clientId.js'
import { audit } from '../lib/auditLog.js'
import { baseVersionOf, refuseStale, refuseUnversioned } from '../lib/versioned.js'
import { resolveSecret } from '../lib/secrets.js'
import { syncCalendarAfterWrite } from '../lib/calendarSync/index.js'
import { plainZod } from '../lib/plainZod.js'
import { can, refuse, requireCan, roleOf, sameJson } from '../lib/permissions.js'
import { readyToSchedule, jobScheduleFacts, scheduleInstall, unscheduleInstall, rainDayPreview, applyRainDay, ScheduleError, weekendJobIds } from '../lib/installScheduling.js'
import { afterJobSaved } from '../lib/contractBilling.js'

const router = Router()

// Anything saved here may carry a date: keep Google Calendar in step, in the background.
router.use(syncCalendarAfterWrite as any)
const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

async function requireUser(req: any, res: any, next: any) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any
    let crmAccountId: string | null = payload.crmAccountId ?? null
    if (!crmAccountId) {
      const u = await prisma.crmUser.findUnique({ where: { id: payload.sub }, select: { crmAccountId: true } })
      crmAccountId = u?.crmAccountId ?? null
    }
    req.user = { id: payload.sub, email: payload.email, role: payload.role, crmAccountId }
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
}

function requireAccount(req: any, res: any, next: any) {
  if (!req.user?.crmAccountId) { res.status(403).json({ success: false, error: 'No tenant' }); return }
  next()
}

router.use(requireUser, requireAccount)

// ── Schedule Settings (singleton per account) ──

const settingsSchema = z.object({
  workDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4]),
  crews: z.array(z.object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
  })).default([]),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
})

const DEFAULT_CREWS = [{ id: 'crew1', name: 'Crew 1', color: 'bg-blue-500' }]

router.get('/settings', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const s = await findOrCreate(
      () => prisma.scheduleSettings.findUnique({ where: { accountId } }),
      () => prisma.scheduleSettings.create({ data: { accountId, workDays: [1, 2, 3, 4], crews: DEFAULT_CREWS } }),
    )
    res.json({ success: true, data: s })
  } catch (err) {
    console.error('[schedule] settings get error:', err)
    res.status(500).json({ success: false, error: 'Failed to load settings' })
  }
})

router.put('/settings', requireCan('settings.change'), async (req: any, res) => {
  try {
    // The board (settings and jobs) is saved through PUT /board with a version
    // check. A tab still calling this is running the app from before that.
    const base = baseVersionOf(req.body)
    if (base === null) { refuseUnversioned(res); return }
    const data = settingsSchema.parse(req.body)
    const accountId = req.user.crmAccountId
    const fields = { workDays: data.workDays, crews: JSON.parse(JSON.stringify(data.crews)), lat: data.lat ?? null, lng: data.lng ?? null }
    const done = await prisma.scheduleSettings.updateMany({ where: { accountId, version: base }, data: { ...fields, version: { increment: 1 } } })
    if (done.count === 0) {
      const current = await prisma.scheduleSettings.findUnique({ where: { accountId } })
      if (current || base !== 0) { refuseStale(res, current, current?.version ?? 0); return }
      try { await prisma.scheduleSettings.create({ data: { accountId, ...fields } }) } catch (e) {
        if (!isUniqueViolation(e)) throw e
        const now = await prisma.scheduleSettings.findUnique({ where: { accountId } })
        refuseStale(res, now, now?.version ?? 0); return
      }
    }
    const s = (await prisma.scheduleSettings.findUnique({ where: { accountId } }))!
    await audit(req, 'update', 'ScheduleSettings', s.id, { newValues: s })
    res.json({ success: true, data: s })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[schedule] settings put error:', err)
    res.status(500).json({ success: false, error: 'Failed to update settings' })
  }
})

// ── Scheduled Grid Jobs CRUD ──

const STATUSES = ['Scheduled', 'InProgress', 'Complete', 'RainDay', 'RolledOver'] as const
const jobSchema = z.object({
  id: z.string().optional(),
  stagingJobId: z.string().optional().nullable(),
  clientName: z.string().default(''),
  area: z.string().default(''),
  sections: z.number().int().default(0),
  fenceType: z.string().default(''),
  jobPrice: z.number().default(0),
  tearout: z.boolean().default(false),
  crewId: z.string().default(''),
  date: z.string().default(''),
  notes: z.string().default(''),
  status: z.enum(STATUSES).default('Scheduled'),
})

router.get('/jobs', async (req: any, res) => {
  try {
    const jobs = await prisma.scheduledGridJob.findMany({
      where: { accountId: req.user.crmAccountId, deletedAt: null },
      orderBy: { date: 'asc' },
    })
    res.json({ success: true, data: jobs })
  } catch (err) {
    console.error('[schedule] jobs list error:', err)
    res.status(500).json({ success: false, error: 'Failed to list scheduled jobs' })
  }
})

router.post('/jobs', requireCan('schedule.change'), async (req: any, res) => {
  try {
    const data = jobSchema.parse(req.body)
    const created = await prisma.scheduledGridJob.create({
      data: {
        accountId: req.user.crmAccountId,
        stagingJobId: data.stagingJobId || null,
        clientName: data.clientName,
        area: data.area,
        sections: data.sections,
        fenceType: data.fenceType,
        jobPrice: data.jobPrice,
        tearout: data.tearout,
        crewId: data.crewId,
        date: data.date,
        notes: data.notes,
        status: data.status,
      },
    })
    await audit(req, 'create', 'ScheduledGridJob', created.id, { newValues: created })
    res.status(201).json({ success: true, data: created })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[schedule] jobs create error:', err)
    res.status(500).json({ success: false, error: 'Failed to create scheduled job' })
  }
})

router.patch('/jobs/:id', requireCan('schedule.change'), async (req: any, res) => {
  try {
    const data = jobSchema.partial().parse(req.body)
    const existing = await prisma.scheduledGridJob.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.accountId !== req.user.crmAccountId || existing.deletedAt) {
      res.status(404).json({ success: false, error: 'Scheduled job not found' })
      return
    }
    const updated = await prisma.scheduledGridJob.update({
      where: { id: existing.id },
      data: {
        ...data,
        stagingJobId: data.stagingJobId === undefined ? undefined : (data.stagingJobId || null),
        id: undefined as any,
      },
    })
    await audit(req, 'update', 'ScheduledGridJob', updated.id, { oldValues: existing, newValues: updated })
    res.json({ success: true, data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[schedule] jobs update error:', err)
    res.status(500).json({ success: false, error: 'Failed to update scheduled job' })
  }
})

router.delete('/jobs/:id', requireCan('schedule.change'), requireCan('ops.delete'), async (req: any, res) => {
  try {
    const existing = await prisma.scheduledGridJob.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.accountId !== req.user.crmAccountId || existing.deletedAt) {
      res.status(404).json({ success: false, error: 'Scheduled job not found' })
      return
    }
    // Soft delete, in Settings > Deleted Records until restored.
    await prisma.$transaction(tx => softDeleteLogged(tx, actorOf(req), 'scheduledGridJob', 'schedule_entry', [existing.id]))
    await audit(req, 'delete', 'ScheduledGridJob', existing.id, { oldValues: existing })
    res.json({ success: true })
  } catch (err) {
    console.error('[schedule] jobs delete error:', err)
    res.status(500).json({ success: false, error: 'Failed to delete scheduled job' })
  }
})

//
// The schedule page keeps the whole board in memory and saves the whole board.
//   - A new job keeps the id the browser gave it. (It used to get a fresh
//     server id, so the next save did not recognize it and created it again:
//     every save duplicated every job added since the page loaded.)
//   - With replace: true the list is authoritative, so a job removed from the
//     board is removed here too. (It used to come back on the next reload.)
router.post('/jobs/sync', requireCan('schedule.change'), async (req: any, res) => {
  try {
    const { jobs, replace } = z.object({
      jobs: z.array(jobSchema),
      replace: z.boolean().optional(),
    }).parse(req.body)
    const accountId = req.user.crmAccountId
    // Replacing the whole list is only done through PUT /board, which checks
    // the version first. Without that an old tab would delete newer jobs.
    if (replace) { refuseUnversioned(res); return }
    let created = 0, updated = 0, removed = 0
    const keptIds: string[] = []
    for (const j of jobs) {
      const { id: clientId, ...fields } = j
      const data = { ...fields, stagingJobId: j.stagingJobId || null }
      if (clientId) {
        const existing = await prisma.scheduledGridJob.findUnique({ where: { id: clientId } })
        // A deleted entry sent again by an older screen stays deleted (Settings > Deleted Records restores it).
        if (existing && existing.accountId === accountId && existing.deletedAt) continue
        if (existing && existing.accountId === accountId) {
          await prisma.scheduledGridJob.update({ where: { id: existing.id }, data })
          keptIds.push(existing.id)
          updated++
          continue
        }
        if (existing) {
          // The id belongs to another company. Never touch it; make a new row.
          const row = await prisma.scheduledGridJob.create({ data: { accountId, ...data } })
          keptIds.push(row.id)
          created++
          continue
        }
      }
      try {
        const row = await prisma.scheduledGridJob.create({
          data: { ...(clientId ? { id: clientId } : {}), accountId, ...data },
        })
        keptIds.push(row.id)
        created++
      } catch (err) {
        console.error('[schedule] jobs sync create failed:', err)
      }
    }
    if (replace) {
      const del = await prisma.scheduledGridJob.deleteMany({
        where: { accountId, id: { notIn: keptIds } },
      })
      removed = del.count
    }
    res.json({ success: true, data: { created, updated, removed, total: jobs.length } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[schedule] jobs sync error:', err)
    res.status(500).json({ success: false, error: 'Failed to sync scheduled jobs' })
  }
})

// ── The whole board in one versioned save ──
//
// Settings and the full job list, applied together and only if nobody else
// saved the board since `baseVersion`. The version lives on ScheduleSettings.
async function readBoard(accountId: string) {
  const [settings, jobs] = await Promise.all([
    prisma.scheduleSettings.findUnique({ where: { accountId } }),
    prisma.scheduledGridJob.findMany({ where: { accountId, deletedAt: null }, orderBy: { date: 'asc' } }),
  ])
  return { settings, jobs, version: settings?.version ?? 0 }
}

router.get('/board', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    let board = await readBoard(accountId)
    if (!board.settings) {
      await prisma.scheduleSettings.createMany({ data: [{ accountId, workDays: [1, 2, 3, 4], crews: DEFAULT_CREWS }], skipDuplicates: true })
      board = await readBoard(accountId)
    }
    res.json({ success: true, data: board })
  } catch (err) {
    console.error('[schedule] board get error:', err)
    res.status(500).json({ success: false, error: 'Failed to load the schedule' })
  }
})

router.put('/board', requireCan('schedule.change'), async (req: any, res) => {
  try {
    const { settings, jobs } = z.object({ settings: settingsSchema, jobs: z.array(jobSchema) }).parse(req.body)
    const base = baseVersionOf(req.body)
    if (base === null) { refuseUnversioned(res); return }
    const accountId = req.user.crmAccountId
    // The working days are a setting (Monday to Thursday); the office moves jobs and crews.
    if (!can(roleOf(req), 'settings.change')) {
      const current = await prisma.scheduleSettings.findUnique({ where: { accountId } })
      if (!sameJson(current?.workDays ?? [1, 2, 3, 4], settings.workDays)) { const board = await readBoard(accountId); refuse(res, 'settings.change', { data: board, version: board.version }); return }
    }
    const saved = await prisma.$transaction(async tx => {
      const settingsData = { workDays: settings.workDays, crews: JSON.parse(JSON.stringify(settings.crews)) }
      const claimed = await tx.scheduleSettings.updateMany({ where: { accountId, version: base }, data: { ...settingsData, version: { increment: 1 } } })
      if (claimed.count === 0) {
        const current = await tx.scheduleSettings.findUnique({ where: { accountId } })
        if (current || base !== 0) return false
        await tx.scheduleSettings.create({ data: { accountId, ...settingsData } })
      }
      const keptIds: string[] = []
      for (const j of jobs) {
        const { id: clientId, ...fields } = j
        const data = { ...fields, stagingJobId: j.stagingJobId || null }
        const existing = clientId ? await tx.scheduledGridJob.findUnique({ where: { id: clientId } }) : null
        if (existing && existing.accountId === accountId && existing.deletedAt) continue
        if (existing && existing.accountId === accountId) {
          await tx.scheduledGridJob.update({ where: { id: existing.id }, data })
          keptIds.push(existing.id)
        } else {
          // A new job keeps the id the browser gave it, unless that id belongs to another company.
          const row = await tx.scheduledGridJob.create({ data: { ...(clientId && !existing ? { id: clientId } : {}), accountId, ...data } })
          keptIds.push(row.id)
        }
      }
      // Entries taken off the board are soft deleted, one Deleted Records row each.
      const dropped = await tx.scheduledGridJob.findMany({ where: { accountId, deletedAt: null, id: { notIn: keptIds } }, select: { id: true } })
      await softDeleteLogged(tx, actorOf(req), 'scheduledGridJob', 'schedule_entry', dropped.map(d => d.id))
      return true
    })
    const board = await readBoard(accountId)
    if (!saved) { refuseStale(res, board, board.version); return }
    if (board.settings) await audit(req, 'update', 'ScheduleSettings', board.settings.id, { newValues: { jobsCount: board.jobs.length, version: board.version } })
    res.json({ success: true, data: board })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[schedule] board put error:', err)
    res.status(500).json({ success: false, error: 'Failed to save the schedule' })
  }
})

// ── Rain Day Log (append only with delete for corrections) ──

const rainSchema = z.object({
  jobId: z.string(),
  clientName: z.string().default(''),
  originalDate: z.string().default(''),
  rescheduleDate: z.string().default(''),
  reason: z.string().default(''),
  flaggedAt: z.string().optional(),
})

router.get('/rain-log', async (req: any, res) => {
  try {
    const rows = await prisma.scheduleRainDay.findMany({
      where: { accountId: req.user.crmAccountId },
      orderBy: { flaggedAt: 'desc' },
    })
    res.json({ success: true, data: rows })
  } catch (err) {
    console.error('[schedule] rain log error:', err)
    res.status(500).json({ success: false, error: 'Failed to read rain log' })
  }
})

router.post('/rain-log', requireCan('schedule.change'), async (req: any, res) => {
  try {
    const data = rainSchema.parse(req.body)
    const accountId = req.user.crmAccountId
    // The id the screen chose: the same rain day sent again returns the one already logged.
    const decision = await decideClientId(clientIdSchema.parse(req.body?.id), accountId, id => prisma.scheduleRainDay.findUnique({ where: { id } }))
    if (decision.kind === 'exists') { res.status(200).json({ success: true, data: decision.row }); return }
    let created
    try {
      created = await prisma.scheduleRainDay.create({
      data: {
        ...(decision.kind === 'use' ? { id: decision.id } : {}),
        accountId,
        jobId: data.jobId,
        clientName: data.clientName,
        originalDate: data.originalDate,
        rescheduleDate: data.rescheduleDate,
        reason: data.reason,
        flaggedAt: data.flaggedAt ? new Date(data.flaggedAt) : new Date(),
      },
      })
    } catch (e) {
      if (!isUniqueViolation(e) || decision.kind !== 'use') throw e
      const won = await prisma.scheduleRainDay.findUnique({ where: { id: decision.id } })
      if (!won || won.accountId !== accountId) throw e
      res.status(200).json({ success: true, data: won }); return
    }
    await audit(req, 'create', 'ScheduleRainDay', created.id, { newValues: created })
    res.status(201).json({ success: true, data: created })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[schedule] rain log create error:', err)
    res.status(500).json({ success: false, error: 'Failed to log rain day' })
  }
})

router.delete('/rain-log/:id', requireCan('schedule.change'), requireCan('ops.delete'), async (req: any, res) => {
  try {
    const existing = await prisma.scheduleRainDay.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.accountId !== req.user.crmAccountId) {
      res.status(404).json({ success: false, error: 'Rain day entry not found' })
      return
    }
    // Removed, and kept in Settings > Deleted Records to put back.
    await prisma.$transaction(async tx => {
      const snap = emptySnapshot()
      snap.hard.push({ model: 'scheduleRainDay', id: existing.id, row: JSON.parse(JSON.stringify(existing)) })
      await logDeletion(tx, actorOf(req), { entityType: 'rain_day', entityId: existing.id, entityLabel: `Rain day ${existing.originalDate}${existing.clientName ? `, ${existing.clientName}` : ''}`, snapshot: snap })
      await tx.scheduleRainDay.delete({ where: { id: existing.id } })
    })
    res.json({ success: true })
  } catch (err) {
    console.error('[schedule] rain log delete error:', err)
    res.status(500).json({ success: false, error: 'Failed to delete rain day entry' })
  }
})

router.post('/rain-log/sync', requireCan('schedule.change'), async (req: any, res) => {
  try {
    const { entries } = z.object({ entries: z.array(rainSchema) }).parse(req.body)
    let created = 0
    for (const e of entries) {
      try {
        await prisma.scheduleRainDay.create({
          data: {
            accountId: req.user.crmAccountId,
            jobId: e.jobId,
            clientName: e.clientName,
            originalDate: e.originalDate,
            rescheduleDate: e.rescheduleDate,
            reason: e.reason,
            flaggedAt: e.flaggedAt ? new Date(e.flaggedAt) : new Date(),
          },
        })
        created++
      } catch {}
    }
    res.json({ success: true, data: { created, total: entries.length } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[schedule] rain log sync error:', err)
    res.status(500).json({ success: false, error: 'Failed to sync rain log' })
  }
})

// ── Scheduling installs (lib/installScheduling.ts) ──
//   GET  /ready              every sold job not scheduled yet, with its crew days, permit, 811, deposit, materials
//   GET  /ready/:jobId       the same for one job (scheduled or not): its Schedule install window
//   POST /install            { jobId, start, crew?, days?, allowWeekend? }: book it (or move it) on crew days
//   POST /install/:jobId/off off the schedule, back to waiting
//   POST /rain-day/preview   { date, shift? }: what would move, and the prepared texts
//   POST /rain-day           { date, shift?, reason? }: move it
// Texts are prepared, never sent: the office sends them from their own phone.

function scheduleFail(res: any, err: unknown, what: string) {
  if (err instanceof ScheduleError) { res.status(err.status).json({ success: false, error: err.message, ...err.extra }); return }
  if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
  console.error(`[schedule] ${what}:`, err)
  res.status(500).json({ success: false, error: `Could not ${what}. Try again.` })
}
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a day.')

// The jobs booked "The crew works weekends on this job" (a booked day on a weekend is then not a warning).
router.get('/weekend-jobs', async (req: any, res) => {
  try { res.json({ success: true, data: await weekendJobIds(req.user.crmAccountId) }) }
  catch (err) { scheduleFail(res, err, 'load the schedule') }
})

router.get('/ready', async (req: any, res) => {
  try { res.json({ success: true, data: await readyToSchedule(req.user.crmAccountId) }) }
  catch (err) { scheduleFail(res, err, 'load the jobs ready to schedule') }
})

router.get('/ready/:jobId', async (req: any, res) => {
  try {
    const row = await jobScheduleFacts(req.user.crmAccountId, String(req.params.jobId))
    if (!row) { res.status(404).json({ success: false, error: 'That job is not there any more.' }); return }
    res.json({ success: true, data: row })
  } catch (err) { scheduleFail(res, err, 'load the job') }
})

router.post('/install', requireCan('schedule.change'), async (req: any, res) => {
  try {
    const b = z.object({ jobId: z.string().min(1), start: day, crew: z.string().optional().nullable(), days: z.number().int().min(1).max(60).optional().nullable(), allowWeekend: z.boolean().optional() }).parse(req.body)
    const accountId = req.user.crmAccountId
    const r = await scheduleInstall(accountId, { accountId, userId: req.user.id ?? null }, b)
    await cardFollowsJob(accountId, r.job.id)
    await audit(req, 'update', 'SavedJob', r.job.id, { newValues: { scheduledDate: r.days[0], scheduledEndDate: r.days[r.days.length - 1], crewAssigned: r.crew.name, opsStage: r.job.opsStage, days: r.days } })
    // The Final's due date and the payment schedule follow the job (lib/contractBilling.ts).
    await afterJobSaved(accountId, r.job.id, { userId: req.user.id ?? null, name: req.user.email ?? '' })
    res.json({ success: true, data: r })
  } catch (err) { scheduleFail(res, err, 'schedule the install') }
})

router.post('/install/:jobId/off', requireCan('schedule.change'), async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const row = await unscheduleInstall(accountId, { accountId, userId: req.user.id ?? null }, String(req.params.jobId))
    await cardFollowsJob(accountId, String(req.params.jobId))
    await audit(req, 'update', 'SavedJob', row.job.id, { newValues: { scheduledDate: '', opsStage: row.job.opsStage } })
    res.json({ success: true, data: row })
  } catch (err) { scheduleFail(res, err, 'take the install off the schedule') }
})

router.post('/rain-day/preview', async (req: any, res) => {
  try {
    const b = z.object({ date: day, shift: z.number().int().min(1).max(10).optional() }).parse(req.body)
    res.json({ success: true, data: await rainDayPreview(req.user.crmAccountId, b.date, b.shift ?? 1) })
  } catch (err) { scheduleFail(res, err, 'work out the rain day') }
})

router.post('/rain-day', requireCan('schedule.change'), async (req: any, res) => {
  try {
    const b = z.object({ date: day, shift: z.number().int().min(1).max(10).optional(), reason: z.string().max(200).optional() }).parse(req.body)
    const moves = await applyRainDay(req.user.crmAccountId, b.date, b.shift ?? 1, (b.reason || 'Weather — rain').trim())
    await audit(req, 'update', 'ScheduleRainDay', null, { newValues: { date: b.date, shift: b.shift ?? 1, moved: moves.length } })
    res.json({ success: true, data: moves })
  } catch (err) { scheduleFail(res, err, 'move the schedule for the rain day') }
})

export default router
