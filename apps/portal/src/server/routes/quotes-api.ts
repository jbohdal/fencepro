/**
 * Quote Engine API
 *
 * Estimates from the quote builder's own math (lib/estimates.ts: material
 * kits, Inventory costs, Settings), always labeled as estimates. Staff only:
 * /calculate returns costs and margins. The website uses /api/quoting and
 * the chat calls lib/estimates directly.
 *
 * Endpoints (staff sign in required):
 *   POST /api/quotes/quick-estimate  — fast estimate from type + footage
 *   POST /api/quotes/calculate       — full quote with all job details
 *   GET  /api/quotes/styles          — list available fence styles
 */

import { Router } from 'express'
import { z } from 'zod'
import { estimateJob, quickEstimate, estimateStyleList, isNotQuotable, NOT_QUOTABLE_MESSAGE, type Estimate } from '../lib/estimates.js'
import { plainZod } from '../lib/plainZod.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth, requireRole('admin', 'support_agent'))

// ── Available fence styles ──
router.get('/styles', async (_req, res) => {
  try {
    res.json({ success: true, data: await estimateStyleList() })
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Could not list styles' })
  }
})

// ── Quick estimate (Botpress calls this during conversation) ──
const quickEstimateSchema = z.object({
  fenceStyle: z.string(),
  linearFootage: z.number().min(1).max(10000),
  walkGates: z.number().int().min(0).default(1),
  dblGates: z.number().int().min(0).default(0),
})

router.post('/quick-estimate', async (req, res) => {
  try {
    const data = quickEstimateSchema.parse(req.body)
    const quote = await quickEstimate(data.fenceStyle, data.linearFootage, data.walkGates, data.dblGates)
    const price = Math.round(quote.price)

    // Return customer-facing data only (no internal costs/margins)
    res.json({
      success: true,
      data: {
        label: 'Estimate',
        fenceStyle: quote.style.name,
        category: quote.style.category,
        totalFootage: quote.totalFootage,
        sections: quote.sections,
        estimatedPrice: price,
        pricePerFoot: quote.pricePerFoot,
        walkGates: data.walkGates,
        dblGates: data.dblGates,
        message: `Based on ${quote.totalFootage} linear feet of ${quote.style.name} with ${data.walkGates} walk gate${data.walkGates !== 1 ? 's' : ''}${data.dblGates > 0 ? ` and ${data.dblGates} double gate${data.dblGates !== 1 ? 's' : ''}` : ''}, your estimated project cost is around $${price.toLocaleString()}. That's about $${quote.pricePerFoot.toFixed(2)} per linear foot installed. We can confirm the exact price with a free in-person estimate — want to schedule one?`,
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: plainZod(err) })
      return
    }
    if (isNotQuotable(err)) { res.json({ success: false, notQuotable: true, error: NOT_QUOTABLE_MESSAGE, data: { message: NOT_QUOTABLE_MESSAGE } }); return }
    const msg = err instanceof Error ? err.message : 'Failed to calculate estimate'
    res.status(400).json({ success: false, error: msg })
  }
})

// ── Full quote calculation (internal / admin use) ──
const fullQuoteSchema = z.object({
  fenceStyle: z.string(),
  runs: z.array(z.number().min(1)).min(1),
  corners: z.number().int().min(0),
  ends: z.number().int().min(0),
  walkGates: z.number().int().min(0).default(0),
  dblGates: z.number().int().min(0).default(0),
  tearOutSections: z.number().int().min(0).default(0),
  tearOutGates: z.number().int().min(0).default(0),
  adjLaborHrs: z.number().min(0).default(0),
  priceAdjust: z.number().min(-0.5).max(0.5).default(0),
  hasSalesman: z.boolean().default(false),
})

router.post('/calculate', async (req, res) => {
  try {
    const data = fullQuoteSchema.parse(req.body)
    const quote: Estimate = await estimateJob({ ...data, extraLaborHrs: data.adjLaborHrs })
    res.json({ success: true, data: quote })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: plainZod(err) })
      return
    }
    if (isNotQuotable(err)) { res.status(400).json({ success: false, notQuotable: true, error: NOT_QUOTABLE_MESSAGE }); return }
    const msg = err instanceof Error ? err.message : 'Failed to calculate quote'
    res.status(400).json({ success: false, error: msg })
  }
})

export default router
