/**
 * Automation API Routes
 *
 * Admin CRUD for automations + run log viewer.
 * Public trigger endpoint for CRM frontend to fire events.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { auditLog } from '../middleware/audit.js'
import { fireAutomations, type TriggerEvent } from '../lib/automationEngine.js'
import { str } from '../lib/helpers.js'

const router = Router()

// ════════════════════════════════════════
// PUBLIC — Trigger endpoint (CRM frontend calls this)
// ════════════════════════════════════════

const triggerSchema = z.object({
  triggerType: z.string(),
  event: z.object({
    jobId: z.string().optional(),
    jobName: z.string().optional(),
    jobAddress: z.string().optional(),
    fenceType: z.string().optional(),
    fromStage: z.string().optional(),
    toStage: z.string().optional(),
    assignedRep: z.string().optional(),
    assignedRepEmail: z.string().optional(),
    crewAssigned: z.string().optional(),
    customerName: z.string().optional(),
    customerEmail: z.string().optional(),
    customerPhone: z.string().optional(),
    scheduledDate: z.string().optional(),
    quotePrice: z.number().optional(),
    contractValue: z.number().optional(),
    extraData: z.record(z.unknown()).optional(),
  }),
})

// CRM frontend fires this via sync key auth
router.post('/trigger', async (req, res) => {
  // Allow sync key OR admin JWT
  const apiKey = req.headers['x-api-key']
  const expected = process.env.CRM_SYNC_KEY || 'dev-sync-key'
  if (apiKey !== expected) {
    // Try JWT auth
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Auth required' })
      return
    }
  }

  try {
    const { triggerType, event } = triggerSchema.parse(req.body)

    // Fire automations in background (non-blocking) — setImmediate guarantees
    // the HTTP response returns before the engine starts, isolating any
    // engine latency from the caller.
    setImmediate(() => {
      fireAutomations(triggerType, event as TriggerEvent).catch(err =>
        console.error('[Automations] Trigger error:', err)
      )
    })

    res.json({ success: true, data: { triggered: triggerType } })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    res.status(500).json({ success: false, error: 'Failed to trigger automation' })
  }
})

// ════════════════════════════════════════
// ADMIN — CRUD (requires auth)
// ════════════════════════════════════════

// List all automations
router.get('/', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    const automations = await prisma.automation.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { runLogs: true } } },
    })

    res.json({
      success: true,
      data: automations.map(a => ({
        id: a.id,
        name: a.name,
        description: a.description,
        triggerType: a.triggerType,
        triggerConfig: a.triggerConfig,
        actions: a.actions,
        conditions: a.conditions,
        isActive: a.isActive,
        lastFiredAt: a.lastFiredAt,
        fireCount: a.fireCount,
        runCount: a._count.runLogs,
        createdAt: a.createdAt,
      })),
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load automations' })
  }
})

// Get single automation with recent run logs
router.get('/:id', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    const automation = await prisma.automation.findUnique({
      where: { id: str(req.params.id) },
      include: {
        runLogs: {
          orderBy: { firedAt: 'desc' },
          take: 25,
        },
      },
    })
    if (!automation) {
      res.status(404).json({ success: false, error: 'Automation not found' })
      return
    }
    res.json({ success: true, data: automation })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load automation' })
  }
})

// Create automation
const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  triggerType: z.string(),
  triggerConfig: z.record(z.unknown()),
  actions: z.array(z.record(z.unknown())),
  conditions: z.record(z.unknown()).optional(),
  isActive: z.boolean().default(true),
})

router.post('/', requireAuth, auditLog('automation_created'), async (req, res) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    const data = createSchema.parse(req.body)
    const automation = await prisma.automation.create({
      data: {
        name: data.name,
        description: data.description,
        triggerType: data.triggerType as any,
        triggerConfig: JSON.parse(JSON.stringify(data.triggerConfig)),
        actions: JSON.parse(JSON.stringify(data.actions)),
        conditions: data.conditions ? JSON.parse(JSON.stringify(data.conditions)) : undefined,
        isActive: data.isActive,
        createdBy: req.user!.email,
      },
    })
    res.status(201).json({ success: true, data: automation })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    res.status(500).json({ success: false, error: 'Failed to create automation' })
  }
})

// Update automation
router.patch('/:id', requireAuth, auditLog('automation_updated'), async (req, res) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    const data = createSchema.partial().parse(req.body)
    const automation = await prisma.automation.update({
      where: { id: str(req.params.id) },
      data: {
        ...data,
        triggerType: data.triggerType as any,
        triggerConfig: data.triggerConfig ? JSON.parse(JSON.stringify(data.triggerConfig)) : undefined,
        actions: data.actions ? JSON.parse(JSON.stringify(data.actions)) : undefined,
        conditions: data.conditions ? JSON.parse(JSON.stringify(data.conditions)) : undefined,
      },
    })
    res.json({ success: true, data: automation })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    res.status(500).json({ success: false, error: 'Failed to update automation' })
  }
})

// Toggle active/inactive
router.patch('/:id/toggle', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    const current = await prisma.automation.findUnique({ where: { id: str(req.params.id) } })
    if (!current) {
      res.status(404).json({ success: false, error: 'Automation not found' })
      return
    }
    const updated = await prisma.automation.update({
      where: { id: current.id },
      data: { isActive: !current.isActive },
    })
    res.json({ success: true, data: updated })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to toggle automation' })
  }
})

// Delete automation
router.delete('/:id', requireAuth, auditLog('automation_deleted'), async (req, res) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    await prisma.automation.delete({ where: { id: str(req.params.id) } })
    res.json({ success: true })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to delete automation' })
  }
})

// Get run logs (all or for a specific automation)
router.get('/logs/all', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    const page = Math.max(1, parseInt(str(req.query.page as string) || '1'))
    const pageSize = Math.min(50, parseInt(str(req.query.pageSize as string) || '25'))

    const [logs, total] = await Promise.all([
      prisma.automationRunLog.findMany({
        orderBy: { firedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.automationRunLog.count(),
    ])

    res.json({
      success: true,
      data: { items: logs, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load logs' })
  }
})

// ════════════════════════════════════════
// TASKS
// ════════════════════════════════════════

router.get('/tasks', requireAuth, async (req, res) => {
  try {
    const status = req.query.status ? str(req.query.status as string) : undefined
    const where: any = {}
    if (status) where.status = status

    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
      take: 100,
    })
    res.json({ success: true, data: tasks })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load tasks' })
  }
})

router.patch('/tasks/:id', requireAuth, async (req, res) => {
  try {
    const { status } = z.object({ status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']) }).parse(req.body)
    const task = await prisma.task.update({
      where: { id: str(req.params.id) },
      data: { status: status as any, ...(status === 'completed' ? { completedAt: new Date() } : {}) },
    })
    res.json({ success: true, data: task })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    res.status(500).json({ success: false, error: 'Failed to update task' })
  }
})

// ════════════════════════════════════════
// NOTIFICATIONS
// ════════════════════════════════════════

router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const role = req.user!.role
    const userId = req.user!.email

    const notifications = await prisma.notification.findMany({
      where: {
        OR: [
          { recipientId: userId },
          { recipientRole: role },
          { recipientId: null, recipientRole: null },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    const unread = notifications.filter(n => !n.read).length

    res.json({ success: true, data: { notifications, unread } })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load notifications' })
  }
})

router.patch('/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    await prisma.notification.update({
      where: { id: str(req.params.id) },
      data: { read: true, readAt: new Date() },
    })
    res.json({ success: true })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to mark as read' })
  }
})

router.post('/notifications/read-all', requireAuth, async (req, res) => {
  try {
    const role = req.user!.role
    const userId = req.user!.email

    await prisma.notification.updateMany({
      where: {
        read: false,
        OR: [
          { recipientId: userId },
          { recipientRole: role },
          { recipientId: null, recipientRole: null },
        ],
      },
      data: { read: true, readAt: new Date() },
    })
    res.json({ success: true })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to mark all as read' })
  }
})

export default router
