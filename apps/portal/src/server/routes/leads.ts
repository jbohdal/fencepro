/**
 * Lead Management API
 *
 * Public endpoints (no auth) — called by Botpress webhooks:
 *   POST /api/leads              — create/update lead from chatbot
 *   POST /api/leads/conversation — store transcript from Botpress
 *
 * Admin endpoints (auth required):
 *   GET  /api/leads              — list all leads
 *   GET  /api/leads/:id          — get lead detail
 *   PATCH /api/leads/:id         — update lead stage/assignment
 *   GET  /api/leads/stats        — lead pipeline stats
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { scoreLead, suggestStage, leadPriority } from '../lib/leadScoring.js'
import { sendLeadConfirmation } from '../lib/sms.js'
import { scheduleFollowUps } from '../lib/followUpScheduler.js'
import { writeAuditLog } from '../middleware/audit.js'
import { str } from '../lib/helpers.js'

const router = Router()

// Botpress webhook secret for verifying requests
const BOTPRESS_WEBHOOK_SECRET = process.env.BOTPRESS_WEBHOOK_SECRET || ''

/** Optional webhook auth — if secret is set, verify it */
function verifyBotpressWebhook(req: any, res: any, next: any) {
  if (!BOTPRESS_WEBHOOK_SECRET) { next(); return }
  const secret = req.headers['x-botpress-secret'] || req.headers['x-webhook-secret']
  if (secret === BOTPRESS_WEBHOOK_SECRET) { next(); return }
  res.status(401).json({ success: false, error: 'Invalid webhook secret' })
}

// ════════════════════════════════════════
// PUBLIC — Botpress webhook endpoints
// ════════════════════════════════════════

const createLeadSchema = z.object({
  // Contact
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  // Project
  fenceType: z.string().optional(),
  linearFootage: z.number().optional(),
  propertyType: z.enum(['residential', 'commercial']).optional(),
  timeline: z.enum(['asap', 'one_to_three_months', 'three_to_six_months', 'just_looking']).optional(),
  budgetMin: z.number().optional(),
  budgetMax: z.number().optional(),
  notes: z.string().optional(),
  // Botpress
  botpressConversationId: z.string().optional(),
  source: z.string().default('website_chat'),
})

router.post('/', verifyBotpressWebhook, async (req, res) => {
  try {
    const data = createLeadSchema.parse(req.body)

    // Check if lead already exists by botpress conversation or email
    let existingLead = null
    if (data.botpressConversationId) {
      existingLead = await prisma.lead.findUnique({
        where: { botpressConversationId: data.botpressConversationId },
      })
    }
    if (!existingLead && data.email) {
      existingLead = await prisma.lead.findFirst({
        where: { email: data.email },
        orderBy: { createdAt: 'desc' },
      })
    }

    // Score the lead
    const scoring = scoreLead({
      fenceType: data.fenceType,
      linearFootage: data.linearFootage,
      propertyType: data.propertyType,
      timeline: data.timeline,
      budgetMin: data.budgetMin,
      budgetMax: data.budgetMax,
      email: data.email,
      phone: data.phone,
      address: data.address,
      zipCode: data.zipCode,
    })

    const stage = suggestStage(scoring.total, false)

    // Build tags
    const tags: string[] = []
    if (data.fenceType) tags.push(data.fenceType)
    if (data.timeline) tags.push(data.timeline)
    if (data.propertyType) tags.push(data.propertyType)
    if (scoring.total >= 70) tags.push('high_priority')

    if (existingLead) {
      // Update existing lead with new data
      const updated = await prisma.lead.update({
        where: { id: existingLead.id },
        data: {
          ...(data.firstName && { firstName: data.firstName }),
          ...(data.lastName && { lastName: data.lastName }),
          ...(data.email && { email: data.email }),
          ...(data.phone && { phone: data.phone }),
          ...(data.address && { address: data.address }),
          ...(data.city && { city: data.city }),
          ...(data.state && { state: data.state }),
          ...(data.zipCode && { zipCode: data.zipCode }),
          ...(data.fenceType && { fenceType: data.fenceType }),
          ...(data.linearFootage && { linearFootage: data.linearFootage }),
          ...(data.propertyType && { propertyType: data.propertyType }),
          ...(data.timeline && { timeline: data.timeline }),
          ...(data.budgetMin && { budgetMin: data.budgetMin }),
          ...(data.budgetMax && { budgetMax: data.budgetMax }),
          ...(data.notes && { notes: data.notes }),
          score: scoring.total,
          scoringDetails: JSON.parse(JSON.stringify(scoring)),
          tags,
          stage: stage as any,
        },
      })

      res.json({
        success: true,
        data: {
          id: updated.id,
          action: 'updated',
          score: scoring.total,
          priority: leadPriority(scoring.total),
          stage,
        },
      })
      return
    }

    // Create new lead
    const lead = await prisma.lead.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        address: data.address,
        city: data.city,
        state: data.state,
        zipCode: data.zipCode,
        fenceType: data.fenceType,
        linearFootage: data.linearFootage,
        propertyType: data.propertyType,
        timeline: data.timeline,
        budgetMin: data.budgetMin,
        budgetMax: data.budgetMax,
        notes: data.notes,
        botpressConversationId: data.botpressConversationId,
        source: data.source,
        score: scoring.total,
        scoringDetails: JSON.parse(JSON.stringify(scoring)),
        tags,
        stage: stage as any,
      },
    })

    // Fire-and-forget: SMS confirmation + follow-up scheduling
    if (data.phone) {
      sendLeadConfirmation(data.phone, data.firstName).catch(() => {})
      // Only schedule follow-ups if they didn't book yet
      scheduleFollowUps(lead.id).catch(() => {})
    }

    await writeAuditLog(null, 'lead_created', {
      leadId: lead.id,
      score: scoring.total,
      source: data.source,
      fenceType: data.fenceType,
    })

    console.log(`[Lead] New lead created: ${lead.id} | Score: ${scoring.total} | Priority: ${leadPriority(scoring.total)}`)

    res.status(201).json({
      success: true,
      data: {
        id: lead.id,
        action: 'created',
        score: scoring.total,
        priority: leadPriority(scoring.total),
        stage,
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    console.error('[Lead] Create error:', err)
    res.status(500).json({ success: false, error: 'Failed to create lead' })
  }
})

// Store conversation transcript from Botpress
const transcriptSchema = z.object({
  botpressConversationId: z.string(),
  transcript: z.array(z.object({
    role: z.string(),
    content: z.string(),
    timestamp: z.string().optional(),
  })),
})

router.post('/conversation', verifyBotpressWebhook, async (req, res) => {
  try {
    const data = transcriptSchema.parse(req.body)

    const lead = await prisma.lead.findUnique({
      where: { botpressConversationId: data.botpressConversationId },
    })

    if (!lead) {
      res.status(404).json({ success: false, error: 'Lead not found for this conversation' })
      return
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: { transcript: JSON.parse(JSON.stringify(data.transcript)) },
    })

    res.json({ success: true })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    res.status(500).json({ success: false, error: 'Failed to store transcript' })
  }
})

// ════════════════════════════════════════
// ADMIN — Authenticated endpoints
// ════════════════════════════════════════

// List leads with filtering
router.get('/', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin' && req.user!.role !== 'support_agent') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    const stage = req.query.stage ? str(req.query.stage as string) : undefined
    const minScore = req.query.minScore ? parseInt(str(req.query.minScore as string)) : undefined
    const page = parseInt(str(req.query.page as string) || '1')
    const pageSize = parseInt(str(req.query.pageSize as string) || '25')

    const where: any = {}
    if (stage) where.stage = stage
    if (minScore) where.score = { gte: minScore }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        include: {
          appointments: { orderBy: { scheduledAt: 'asc' }, take: 1 },
          _count: { select: { followUps: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.lead.count({ where }),
    ])

    res.json({
      success: true,
      data: {
        items: leads.map(l => ({
          id: l.id,
          name: [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Unknown',
          email: l.email,
          phone: l.phone,
          fenceType: l.fenceType,
          linearFootage: l.linearFootage,
          propertyType: l.propertyType,
          timeline: l.timeline,
          stage: l.stage,
          score: l.score,
          priority: leadPriority(l.score),
          tags: l.tags,
          source: l.source,
          assignedRepName: l.assignedRepName,
          nextAppointment: l.appointments[0]?.scheduledAt || null,
          followUpCount: l._count.followUps,
          createdAt: l.createdAt,
          updatedAt: l.updatedAt,
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load leads' })
  }
})

// Lead pipeline stats
router.get('/stats', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin' && req.user!.role !== 'support_agent') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    const [byStage, byFenceType, avgScore, totalThisMonth, highPriority] = await Promise.all([
      prisma.lead.groupBy({ by: ['stage'], _count: true }),
      prisma.lead.groupBy({ by: ['fenceType'], _count: true, where: { fenceType: { not: null } } }),
      prisma.lead.aggregate({ _avg: { score: true } }),
      prisma.lead.count({
        where: {
          createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
      prisma.lead.count({ where: { score: { gte: 70 } } }),
    ])

    res.json({
      success: true,
      data: {
        pipeline: byStage.map(s => ({ stage: s.stage, count: s._count })),
        fenceTypes: byFenceType.map(f => ({ type: f.fenceType, count: f._count })),
        averageScore: Math.round(avgScore._avg.score || 0),
        totalThisMonth,
        highPriority,
      },
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load stats' })
  }
})

// Get single lead detail
router.get('/:id', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin' && req.user!.role !== 'support_agent') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    const lead = await prisma.lead.findUnique({
      where: { id: str(req.params.id) },
      include: {
        appointments: { orderBy: { scheduledAt: 'desc' } },
        followUps: { orderBy: { scheduledFor: 'asc' } },
      },
    })

    if (!lead) {
      res.status(404).json({ success: false, error: 'Lead not found' })
      return
    }

    res.json({ success: true, data: lead })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load lead' })
  }
})

// Update lead (stage, assignment, notes)
const updateLeadSchema = z.object({
  stage: z.enum(['new_lead', 'qualified', 'appointment_scheduled', 'contacted', 'proposal_sent', 'won', 'lost']).optional(),
  assignedRepName: z.string().optional(),
  assignedRepEmail: z.string().optional(),
  notes: z.string().optional(),
  lostReason: z.string().optional(),
}).strict()

router.patch('/:id', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin' && req.user!.role !== 'support_agent') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    const data = updateLeadSchema.parse(req.body)

    const updated = await prisma.lead.update({
      where: { id: str(req.params.id) },
      data: {
        ...data,
        stage: data.stage as any,
        ...(data.stage === 'won' ? { convertedAt: new Date() } : {}),
      },
    })

    // Cancel follow-ups if lead is won or has appointment
    if (data.stage === 'won' || data.stage === 'appointment_scheduled' || data.stage === 'lost') {
      const { cancelFollowUps } = await import('../lib/followUpScheduler.js')
      await cancelFollowUps(updated.id)
    }

    res.json({ success: true, data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    res.status(500).json({ success: false, error: 'Failed to update lead' })
  }
})

export default router
