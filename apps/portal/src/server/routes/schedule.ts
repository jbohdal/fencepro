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

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'dev-crm-jwt-secret-change-me'

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
    const data = settingsSchema.parse(req.body)
    const s = await prisma.scheduleSettings.upsert({
      where: { accountId: req.user.crmAccountId },
      create: {
        accountId: req.user.crmAccountId,
        workDays: data.workDays,
        crews: JSON.parse(JSON.stringify(data.crews)),
        lat: data.lat ?? null,
        lng: data.lng ?? null,
      },
      update: {
        workDays: data.workDays,
        crews: JSON.parse(JSON.stringify(data.crews)),
        lat: data.lat ?? null,
        lng: data.lng ?? null,
      },
    })
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

router.post('/jobs/sync', async (req: any, res) => {
  try {
    const { jobs } = z.object({ jobs: z.array(jobSchema) }).parse(req.body)
    let created = 0, updated = 0
    for (const j of jobs) {
      if (j.id) {
        const existing = await prisma.scheduledGridJob.findUnique({ where: { id: j.id } })
        if (existing && existing.accountId === req.user.crmAccountId) {
          await prisma.scheduledGridJob.update({
            where: { id: existing.id },
            data: { ...j, id: undefined as any, stagingJobId: j.stagingJobId || null },
          })
          updated++
          continue
        }
      }
      try {
        await prisma.scheduledGridJob.create({
          data: {
            accountId: req.user.crmAccountId,
            stagingJobId: j.stagingJobId || null,
            ...j,
            id: undefined as any,
          },
        })
        created++
      } catch {}
    }
    res.json({ success: true, data: { created, updated, total: jobs.length } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[schedule] jobs sync error:', err)
    res.status(500).json({ success: false, error: 'Failed to sync scheduled jobs' })
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
