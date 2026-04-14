/**
 * Pricing Rules API
 *
 * Public:
 *   GET /api/pricing-rules — Botpress fetches to show price ranges
 *
 * Admin:
 *   POST  /api/pricing-rules     — create/update pricing rule
 *   DELETE /api/pricing-rules/:id — deactivate a rule
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { str } from '../lib/helpers.js'

const router = Router()

// ── Get all active pricing rules (public — Botpress calls this) ──
router.get('/', async (_req, res) => {
  try {
    const rules = await prisma.pricingRule.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    })

    res.json({
      success: true,
      data: rules.map(r => ({
        fenceType: r.fenceType,
        displayName: r.displayName,
        minPerFoot: r.minPerFoot,
        maxPerFoot: r.maxPerFoot,
        description: r.description,
      })),
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load pricing rules' })
  }
})

// ── Get estimate for specific parameters (public — Botpress calls this) ──
const estimateSchema = z.object({
  fenceType: z.string(),
  linearFootage: z.number().min(1),
})

router.post('/estimate', async (req, res) => {
  try {
    const { fenceType, linearFootage } = estimateSchema.parse(req.body)

    const rule = await prisma.pricingRule.findUnique({
      where: { fenceType },
    })

    if (!rule || !rule.active) {
      res.json({
        success: true,
        data: {
          available: false,
          message: 'We\'d need to evaluate your project in person to give an accurate estimate for that fence type. Want to schedule a free estimate?',
        },
      })
      return
    }

    const minTotal = (rule.minPerFoot * linearFootage) / 100
    const maxTotal = (rule.maxPerFoot * linearFootage) / 100

    res.json({
      success: true,
      data: {
        available: true,
        fenceType: rule.displayName,
        linearFootage,
        minPerFoot: (rule.minPerFoot / 100).toFixed(2),
        maxPerFoot: (rule.maxPerFoot / 100).toFixed(2),
        estimateMin: Math.round(minTotal),
        estimateMax: Math.round(maxTotal),
        message: `Based on what you shared, most ${rule.displayName.toLowerCase()} projects at ${linearFootage} linear feet fall between $${Math.round(minTotal).toLocaleString()} and $${Math.round(maxTotal).toLocaleString()}. We can confirm with a free in-person estimate.`,
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    res.status(500).json({ success: false, error: 'Failed to calculate estimate' })
  }
})

// ── Admin: Create or update pricing rule ──
const upsertSchema = z.object({
  fenceType: z.string(),
  displayName: z.string(),
  minPerFoot: z.number().int().min(0), // cents
  maxPerFoot: z.number().int().min(0), // cents
  description: z.string().optional(),
  sortOrder: z.number().int().default(0),
})

router.post('/', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    const data = upsertSchema.parse(req.body)

    const rule = await prisma.pricingRule.upsert({
      where: { fenceType: data.fenceType },
      update: {
        displayName: data.displayName,
        minPerFoot: data.minPerFoot,
        maxPerFoot: data.maxPerFoot,
        description: data.description,
        sortOrder: data.sortOrder,
      },
      create: data,
    })

    res.json({ success: true, data: rule })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    res.status(500).json({ success: false, error: 'Failed to save pricing rule' })
  }
})

// ── Admin: Deactivate a pricing rule ──
router.delete('/:id', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    await prisma.pricingRule.update({
      where: { id: str(req.params.id) },
      data: { active: false },
    })
    res.json({ success: true })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to deactivate pricing rule' })
  }
})

export default router
