/**
 * Quote Engine API
 *
 * Exposes the CRM's quote calculator as a REST API.
 * Botpress calls this to generate real quotes from project details.
 *
 * Public endpoints (Botpress webhook):
 *   POST /api/quotes/quick-estimate  — fast estimate from type + footage
 *   POST /api/quotes/calculate       — full quote with all job details
 *   GET  /api/quotes/styles          — list available fence styles
 */

import { Router } from 'express'
import { z } from 'zod'
import { calculateQuote, quickEstimate, getAvailableStyles } from '../lib/quoteEngine.js'

const router = Router()

// ── Available fence styles ──
router.get('/styles', (_req, res) => {
  res.json({
    success: true,
    data: getAvailableStyles(),
  })
})

// ── Quick estimate (Botpress calls this during conversation) ──
const quickEstimateSchema = z.object({
  fenceStyle: z.string(),
  linearFootage: z.number().min(1).max(10000),
  walkGates: z.number().int().min(0).default(1),
  dblGates: z.number().int().min(0).default(0),
})

router.post('/quick-estimate', (req, res) => {
  try {
    const data = quickEstimateSchema.parse(req.body)
    const quote = quickEstimate(data.fenceStyle, data.linearFootage, data.walkGates, data.dblGates)

    // Return customer-facing data only (no internal costs/margins)
    res.json({
      success: true,
      data: {
        fenceStyle: quote.fenceStyleDisplay,
        category: quote.category,
        totalFootage: quote.totalFootage,
        sections: quote.sections,
        estimatedPrice: quote.finalPrice,
        pricePerFoot: quote.pricePerFoot,
        walkGates: data.walkGates,
        dblGates: data.dblGates,
        message: `Based on ${quote.totalFootage} linear feet of ${quote.fenceStyleDisplay} with ${data.walkGates} walk gate${data.walkGates !== 1 ? 's' : ''}${data.dblGates > 0 ? ` and ${data.dblGates} double gate${data.dblGates !== 1 ? 's' : ''}` : ''}, your estimated project cost is around $${quote.finalPrice.toLocaleString()}. That's about $${quote.pricePerFoot.toFixed(2)} per linear foot installed. We can confirm the exact price with a free in-person estimate — want to schedule one?`,
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
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

router.post('/calculate', (req, res) => {
  try {
    const data = fullQuoteSchema.parse(req.body)
    const quote = calculateQuote(data)

    res.json({
      success: true,
      data: quote,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    const msg = err instanceof Error ? err.message : 'Failed to calculate quote'
    res.status(400).json({ success: false, error: msg })
  }
})

export default router
