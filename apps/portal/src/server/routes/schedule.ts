/**
 * Schedule API
 *
 * Three sub resources, all account scoped:
 *   /api/schedule/settings           — singleton: workDays + crews per account
 *   /api/schedule/jobs               — ScheduledGridJob CRUD + sync
 *   /api/schedule/rain-log           — append only RainDay log
 */

import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/auditLog.js'
import { baseVersionOf, refuseStale, refuseUnversioned } from '../lib/versioned.js'
import { resolveSecret } from '../lib/secrets.js'

const router = Router()
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
    let s = await prisma.scheduleSettings.findUnique({ where: { accountId: req.user.crmAccountId } })
    if (!s) {
      s = await prisma.scheduleSettings.create({
        data: {
          accountId: req.user.crmAccountId,
          workDays: [1, 2, 3, 4],
          crews: DEFAULT_CREWS,
        },
      })
    }
    res.json({ success: true, data: s })
  } catch (err) {
    console.error('[schedule] settings get error:', err)
    res.status(500).json({ success: false, error: 'Failed to load settings' })
  }
})

router.put('/settings', async (req: any, res) => {
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
      await prisma.scheduleSettings.create({ data: { accountId, ...fields } })
    }
    const s = (await prisma.scheduleSettings.findUnique({ where: { accountId } }))!
    await audit(req, 'update', 'ScheduleSettings', s.id, { newValues: s })
    res.json({ success: true, data: s })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
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
      where: { accountId: req.user.crmAccountId },
      orderBy: { date: 'asc' },
    })
    res.json({ success: true, data: jobs })
  } catch (err) {
    console.error('[schedule] jobs list error:', err)
    res.status(500).json({ success: false, error: 'Failed to list scheduled jobs' })
  }
})

router.post('/jobs', async (req: any, res) => {
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
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[schedule] jobs create error:', err)
    res.status(500).json({ success: false, error: 'Failed to create scheduled job' })
  }
})

router.patch('/jobs/:id', async (req: any, res) => {
  try {
    const data = jobSchema.partial().parse(req.body)
    const existing = await prisma.scheduledGridJob.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.accountId !== req.user.crmAccountId) {
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
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[schedule] jobs update error:', err)
    res.status(500).json({ success: false, error: 'Failed to update scheduled job' })
  }
})

router.delete('/jobs/:id', async (req: any, res) => {
  try {
    const existing = await prisma.scheduledGridJob.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.accountId !== req.user.crmAccountId) {
      res.status(404).json({ success: false, error: 'Scheduled job not found' })
      return
    }
    await prisma.scheduledGridJob.delete({ where: { id: existing.id } })
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
router.post('/jobs/sync', async (req: any, res) => {
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
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
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
    prisma.scheduledGridJob.findMany({ where: { accountId }, orderBy: { date: 'asc' } }),
  ])
  return { settings, jobs, version: settings?.version ?? 0 }
}

router.get('/board', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    let board = await readBoard(accountId)
    if (!board.settings) {
      await prisma.scheduleSettings.create({ data: { accountId, workDays: [1, 2, 3, 4], crews: DEFAULT_CREWS } })
      board = await readBoard(accountId)
    }
    res.json({ success: true, data: board })
  } catch (err) {
    console.error('[schedule] board get error:', err)
    res.status(500).json({ success: false, error: 'Failed to load the schedule' })
  }
})

router.put('/board', async (req: any, res) => {
  try {
    const { settings, jobs } = z.object({ settings: settingsSchema, jobs: z.array(jobSchema) }).parse(req.body)
    const base = baseVersionOf(req.body)
    if (base === null) { refuseUnversioned(res); return }
    const accountId = req.user.crmAccountId
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
        if (existing && existing.accountId === accountId) {
          await tx.scheduledGridJob.update({ where: { id: existing.id }, data })
          keptIds.push(existing.id)
        } else {
          // A new job keeps the id the browser gave it, unless that id belongs to another company.
          const row = await tx.scheduledGridJob.create({ data: { ...(clientId && !existing ? { id: clientId } : {}), accountId, ...data } })
          keptIds.push(row.id)
        }
      }
      await tx.scheduledGridJob.deleteMany({ where: { accountId, id: { notIn: keptIds } } })
      return true
    })
    const board = await readBoard(accountId)
    if (!saved) { refuseStale(res, board, board.version); return }
    if (board.settings) await audit(req, 'update', 'ScheduleSettings', board.settings.id, { newValues: { jobsCount: board.jobs.length, version: board.version } })
    res.json({ success: true, data: board })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
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

router.post('/rain-log', async (req: any, res) => {
  try {
    const data = rainSchema.parse(req.body)
    const created = await prisma.scheduleRainDay.create({
      data: {
        accountId: req.user.crmAccountId,
        jobId: data.jobId,
        clientName: data.clientName,
        originalDate: data.originalDate,
        rescheduleDate: data.rescheduleDate,
        reason: data.reason,
        flaggedAt: data.flaggedAt ? new Date(data.flaggedAt) : new Date(),
      },
    })
    await audit(req, 'create', 'ScheduleRainDay', created.id, { newValues: created })
    res.status(201).json({ success: true, data: created })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[schedule] rain log create error:', err)
    res.status(500).json({ success: false, error: 'Failed to log rain day' })
  }
})

router.delete('/rain-log/:id', async (req: any, res) => {
  try {
    const existing = await prisma.scheduleRainDay.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.accountId !== req.user.crmAccountId) {
      res.status(404).json({ success: false, error: 'Rain day entry not found' })
      return
    }
    await prisma.scheduleRainDay.delete({ where: { id: existing.id } })
    res.json({ success: true })
  } catch (err) {
    console.error('[schedule] rain log delete error:', err)
    res.status(500).json({ success: false, error: 'Failed to delete rain day entry' })
  }
})

router.post('/rain-log/sync', async (req: any, res) => {
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
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[schedule] rain log sync error:', err)
    res.status(500).json({ success: false, error: 'Failed to sync rain log' })
  }
})

export default router
