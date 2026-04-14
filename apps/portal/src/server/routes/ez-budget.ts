/**
 * EZ Budget API Routes
 *
 * Admin-only CRUD for the instant quoting module.
 * Four resource areas: services, quotes, settings, dashboard stats.
 *
 * All routes are mounted at /api/ez-budget/
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { auditLog } from '../middleware/audit.js'
import { str } from '../lib/helpers.js'

const router = Router()

// All EZ Budget routes require admin auth
router.use(requireAuth)
router.use((req, res, next) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }
  next()
})

// ════════════════════════════════════════
// DASHBOARD — aggregate stats
// ════════════════════════════════════════

router.get('/dashboard', async (_req, res) => {
  try {
    const [
      totalServices,
      activeServices,
      totalQuotes,
      quotesByStatus,
      recentQuotes,
      revenue,
    ] = await Promise.all([
      prisma.ezBudgetService.count(),
      prisma.ezBudgetService.count({ where: { active: true } }),
      prisma.ezBudgetQuote.count(),
      prisma.ezBudgetQuote.groupBy({ by: ['status'], _count: true }),
      prisma.ezBudgetQuote.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { lineItems: true },
      }),
      prisma.ezBudgetQuote.aggregate({
        where: { status: 'accepted' },
        _sum: { totalCents: true },
      }),
    ])

    res.json({
      success: true,
      data: {
        totalServices,
        activeServices,
        totalQuotes,
        quotesByStatus: quotesByStatus.map(s => ({ status: s.status, count: s._count })),
        recentQuotes: recentQuotes.map(q => ({
          id: q.id,
          quoteNumber: q.quoteNumber,
          customerName: q.customerName,
          customerEmail: q.customerEmail,
          totalCents: q.totalCents,
          status: q.status,
          lineItemCount: q.lineItems.length,
          createdAt: q.createdAt,
        })),
        totalRevenueCents: revenue._sum.totalCents || 0,
      },
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load dashboard' })
  }
})

// ════════════════════════════════════════
// SERVICES — fence types / service catalog
// ════════════════════════════════════════

const serviceSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  category: z.string().optional(),
  unitLabel: z.string().default('per linear foot'),
  basePriceCents: z.number().int().min(0),
  minQty: z.number().int().min(0).optional(),
  maxQty: z.number().int().min(0).optional(),
  imageUrl: z.string().url().optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  metadata: z.record(z.unknown()).optional(),
})

router.get('/services', async (_req, res) => {
  try {
    const services = await prisma.ezBudgetService.findMany({
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    })
    res.json({ success: true, data: services })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load services' })
  }
})

router.get('/services/:id', async (req, res) => {
  try {
    const service = await prisma.ezBudgetService.findUnique({ where: { id: str(req.params.id) } })
    if (!service) { res.status(404).json({ success: false, error: 'Service not found' }); return }
    res.json({ success: true, data: service })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load service' })
  }
})

router.post('/services', auditLog('ezbudget_service_created'), async (req, res) => {
  try {
    const data = serviceSchema.parse(req.body)
    const service = await prisma.ezBudgetService.create({
      data: {
        ...data,
        metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
      },
    })
    res.status(201).json({ success: true, data: service })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    res.status(500).json({ success: false, error: 'Failed to create service' })
  }
})

router.patch('/services/:id', auditLog('ezbudget_service_updated'), async (req, res) => {
  try {
    const data = serviceSchema.partial().parse(req.body)
    const service = await prisma.ezBudgetService.update({
      where: { id: str(req.params.id) },
      data: {
        ...data,
        metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
      },
    })
    res.json({ success: true, data: service })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    res.status(500).json({ success: false, error: 'Failed to update service' })
  }
})

router.delete('/services/:id', auditLog('ezbudget_service_deleted'), async (req, res) => {
  try {
    await prisma.ezBudgetService.delete({ where: { id: str(req.params.id) } })
    res.json({ success: true })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to delete service' })
  }
})

// ════════════════════════════════════════
// QUOTES — quote inbox
// ════════════════════════════════════════

router.get('/quotes', async (req, res) => {
  try {
    const status = req.query.status ? str(req.query.status as string) : undefined
    const page = Math.max(1, parseInt(str(req.query.page as string) || '1'))
    const pageSize = Math.min(50, parseInt(str(req.query.pageSize as string) || '25'))

    const where: any = {}
    if (status) where.status = status

    const [quotes, total] = await Promise.all([
      prisma.ezBudgetQuote.findMany({
        where,
        include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.ezBudgetQuote.count({ where }),
    ])

    res.json({
      success: true,
      data: {
        items: quotes.map(q => ({
          id: q.id,
          quoteNumber: q.quoteNumber,
          status: q.status,
          customerName: q.customerName,
          customerEmail: q.customerEmail,
          customerPhone: q.customerPhone,
          totalCents: q.totalCents,
          lineItemCount: q.lineItems.length,
          source: q.source,
          createdAt: q.createdAt,
          viewedAt: q.viewedAt,
          respondedAt: q.respondedAt,
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load quotes' })
  }
})

router.get('/quotes/:id', async (req, res) => {
  try {
    const quote = await prisma.ezBudgetQuote.findUnique({
      where: { id: str(req.params.id) },
      include: { lineItems: { include: { service: true }, orderBy: { sortOrder: 'asc' } } },
    })
    if (!quote) { res.status(404).json({ success: false, error: 'Quote not found' }); return }
    res.json({ success: true, data: quote })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load quote' })
  }
})

const updateQuoteSchema = z.object({
  status: z.enum(['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired']).optional(),
  internalNotes: z.string().optional(),
  customerName: z.string().optional(),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().optional(),
})

router.patch('/quotes/:id', auditLog('ezbudget_quote_updated'), async (req, res) => {
  try {
    const data = updateQuoteSchema.parse(req.body)
    const quote = await prisma.ezBudgetQuote.update({
      where: { id: str(req.params.id) },
      data: {
        ...data,
        ...(data.status === 'accepted' || data.status === 'declined' ? { respondedAt: new Date() } : {}),
      },
    })
    res.json({ success: true, data: quote })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    res.status(500).json({ success: false, error: 'Failed to update quote' })
  }
})

router.delete('/quotes/:id', auditLog('ezbudget_quote_deleted'), async (req, res) => {
  try {
    await prisma.ezBudgetQuote.delete({ where: { id: str(req.params.id) } })
    res.json({ success: true })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to delete quote' })
  }
})

// ════════════════════════════════════════
// SETTINGS — key-value config store
// ════════════════════════════════════════

router.get('/settings', async (_req, res) => {
  try {
    const settings = await prisma.ezBudgetSettings.findMany({
      orderBy: { key: 'asc' },
    })
    // Return as flat object for easy consumption
    const obj: Record<string, unknown> = {}
    for (const s of settings) obj[s.key] = s.value
    res.json({ success: true, data: { settings: obj, raw: settings } })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load settings' })
  }
})

const settingSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.unknown(),
  description: z.string().optional(),
})

router.post('/settings', auditLog('ezbudget_setting_saved'), async (req, res) => {
  try {
    const data = settingSchema.parse(req.body)
    const setting = await prisma.ezBudgetSettings.upsert({
      where: { key: data.key },
      update: {
        value: JSON.parse(JSON.stringify(data.value)),
        description: data.description,
      },
      create: {
        key: data.key,
        value: JSON.parse(JSON.stringify(data.value)),
        description: data.description,
      },
    })
    res.json({ success: true, data: setting })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    res.status(500).json({ success: false, error: 'Failed to save setting' })
  }
})

router.delete('/settings/:key', auditLog('ezbudget_setting_deleted'), async (req, res) => {
  try {
    await prisma.ezBudgetSettings.delete({ where: { key: str(req.params.key) } })
    res.json({ success: true })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to delete setting' })
  }
})

// ════════════════════════════════════════
// PUBLIC WIDGET — no auth required
// These are mounted BEFORE the auth middleware
// ════════════════════════════════════════

const publicRouter = Router()

// Widget config — returns services + settings for the embeddable widget
publicRouter.get('/widget/config', async (_req, res) => {
  try {
    const [services, settingsRaw] = await Promise.all([
      prisma.ezBudgetService.findMany({
        where: { active: true },
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
      }),
      prisma.ezBudgetSettings.findMany(),
    ])

    const settings: Record<string, unknown> = {}
    for (const s of settingsRaw) settings[s.key] = s.value

    res.json({
      success: true,
      data: { services, settings },
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load widget config' })
  }
})

// Widget quote submission
const widgetSubmitSchema = z.object({
  customerName: z.string().min(1),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().optional(),
  customerAddress: z.string().optional(),
  material: z.string().optional(),
  style: z.string().optional(),
  height: z.string().optional(),
  color: z.string().optional(),
  linearFeet: z.number().optional(),
  requestOnSite: z.boolean().default(false),
  mapData: z.record(z.unknown()).optional(),
  photos: z.array(z.string()).default([]),
  lineItems: z.array(z.object({
    serviceId: z.string().optional(),
    label: z.string(),
    quantity: z.number().default(1),
    unitPriceCents: z.number().int(),
    totalCents: z.number().int(),
  })).default([]),
})

publicRouter.post('/widget/submit', async (req, res) => {
  try {
    const data = widgetSubmitSchema.parse(req.body)

    const subtotalCents = data.lineItems.reduce((sum, li) => sum + li.totalCents, 0)
    const totalCents = subtotalCents // no tax/discount from widget

    const quote = await prisma.ezBudgetQuote.create({
      data: {
        status: 'draft',
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        customerPhone: data.customerPhone,
        customerAddress: data.customerAddress,
        material: data.material,
        style: data.style,
        height: data.height,
        color: data.color,
        linearFeet: data.linearFeet,
        requestOnSite: data.requestOnSite,
        mapData: data.mapData ? JSON.parse(JSON.stringify(data.mapData)) : undefined,
        photos: data.photos,
        subtotalCents,
        totalCents,
        source: 'widget',
        lineItems: {
          create: data.lineItems.map((li, i) => ({
            serviceId: li.serviceId,
            label: li.label,
            quantity: li.quantity,
            unitPriceCents: li.unitPriceCents,
            totalCents: li.totalCents,
            sortOrder: i,
          })),
        },
      },
      include: { lineItems: true },
    })

    res.status(201).json({ success: true, data: { id: quote.id, quoteNumber: quote.quoteNumber } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    res.status(500).json({ success: false, error: 'Failed to submit quote' })
  }
})

// Attach public routes to main router BEFORE auth middleware
// Note: these must be registered in the server index BEFORE the auth-protected router
export { publicRouter as ezBudgetPublicRoutes }

export default router
