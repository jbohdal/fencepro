/**
 * Appointment API
 *
 * Public (Botpress webhook):
 *   POST /api/appointments — book an estimate
 *
 * Admin:
 *   GET  /api/appointments          — list upcoming appointments
 *   PATCH /api/appointments/:id     — confirm/cancel/complete
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { sendAppointmentConfirmation } from '../lib/sms.js'
import { cancelFollowUps } from '../lib/followUpScheduler.js'
import { writeAuditLog } from '../middleware/audit.js'
import { str } from '../lib/helpers.js'
import { pushAppointmentToCalendar, updateCalendarEvent } from '../lib/googleCalendar.js'

const router = Router()

const BOTPRESS_WEBHOOK_SECRET = process.env.BOTPRESS_WEBHOOK_SECRET || ''

function verifyBotpressWebhook(req: any, res: any, next: any) {
  if (!BOTPRESS_WEBHOOK_SECRET) { next(); return }
  const secret = req.headers['x-botpress-secret'] || req.headers['x-webhook-secret']
  if (secret === BOTPRESS_WEBHOOK_SECRET) { next(); return }
  res.status(401).json({ success: false, error: 'Invalid webhook secret' })
}

// ── Book appointment (from Botpress) ──
const bookSchema = z.object({
  leadId: z.string().uuid().optional(),
  botpressConversationId: z.string().optional(),
  // If no leadId, create/find lead from these fields
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  // Appointment details
  scheduledAt: z.string(), // ISO date string
  duration: z.number().default(60),
  type: z.string().default('estimate'),
  notes: z.string().optional(),
  assignedRepEmail: z.string().email().optional(),
})

router.post('/', verifyBotpressWebhook, async (req, res) => {
  try {
    const data = bookSchema.parse(req.body)

    // Find or resolve the lead
    let leadId = data.leadId

    if (!leadId && data.botpressConversationId) {
      const lead = await prisma.lead.findUnique({
        where: { botpressConversationId: data.botpressConversationId },
      })
      if (lead) leadId = lead.id
    }

    if (!leadId && data.email) {
      const lead = await prisma.lead.findFirst({
        where: { email: data.email },
        orderBy: { createdAt: 'desc' },
      })
      if (lead) leadId = lead.id
    }

    // If still no lead, create one
    if (!leadId) {
      const lead = await prisma.lead.create({
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          address: data.address,
          botpressConversationId: data.botpressConversationId,
          source: 'website_chat',
          stage: 'appointment_scheduled',
          score: 50, // default for someone booking
        },
      })
      leadId = lead.id
    }

    // Create appointment
    const appointment = await prisma.appointment.create({
      data: {
        leadId,
        scheduledAt: new Date(data.scheduledAt),
        duration: data.duration,
        type: data.type,
        location: data.address,
        notes: data.notes,
      },
    })

    // Update lead stage
    await prisma.lead.update({
      where: { id: leadId },
      data: { stage: 'appointment_scheduled' },
    })

    // Cancel follow-up sequence — they booked
    await cancelFollowUps(leadId)

    // Send SMS confirmation
    const lead = await prisma.lead.findUnique({ where: { id: leadId } })
    if (lead?.phone) {
      const dateStr = new Date(data.scheduledAt).toLocaleString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      })
      sendAppointmentConfirmation(lead.phone, dateStr, lead.firstName || undefined).catch(() => {})
    }

    // Push to assigned rep's Google Calendar (fire and forget)
    const repEmail = lead?.assignedRepEmail || data.assignedRepEmail
    if (repEmail) {
      pushAppointmentToCalendar({
        repEmail,
        scheduledAt: new Date(data.scheduledAt),
        duration: data.duration,
        type: data.type,
        location: data.address,
        customerName: [lead?.firstName, lead?.lastName].filter(Boolean).join(' ') || 'New Lead',
        customerPhone: lead?.phone || undefined,
        customerEmail: lead?.email || undefined,
        fenceType: lead?.fenceType || undefined,
        linearFootage: lead?.linearFootage || undefined,
        notes: data.notes,
      }).then(async (eventId) => {
        if (eventId) {
          // Fields added in migration — regenerate Prisma client after migration
          await prisma.appointment.update({
            where: { id: appointment.id },
            data: { googleCalendarEventId: eventId, assignedRepEmail: repEmail } as any,
          })
        }
      }).catch(err => console.error('[GCal] Push failed:', err))
    }

    await writeAuditLog(null, 'appointment_booked', {
      leadId,
      appointmentId: appointment.id,
      scheduledAt: data.scheduledAt,
    })

    console.log(`[Appointment] Booked: ${appointment.id} for lead ${leadId}`)

    res.status(201).json({
      success: true,
      data: {
        id: appointment.id,
        leadId,
        scheduledAt: appointment.scheduledAt,
        type: appointment.type,
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    console.error('[Appointment] Book error:', err)
    res.status(500).json({ success: false, error: 'Failed to book appointment' })
  }
})

// ── List appointments (admin) ──
router.get('/', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin' && req.user!.role !== 'support_agent') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    const upcoming = req.query.upcoming === 'true'
    const where: any = {}
    if (upcoming) {
      where.scheduledAt = { gte: new Date() }
      where.cancelledAt = null
    }

    const appointments = await prisma.appointment.findMany({
      where,
      include: {
        lead: {
          select: {
            id: true, firstName: true, lastName: true, email: true, phone: true,
            address: true, fenceType: true, score: true, stage: true,
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 50,
    })

    res.json({
      success: true,
      data: appointments.map(a => ({
        id: a.id,
        leadId: a.leadId,
        leadName: [a.lead.firstName, a.lead.lastName].filter(Boolean).join(' ') || 'Unknown',
        leadEmail: a.lead.email,
        leadPhone: a.lead.phone,
        leadAddress: a.lead.address,
        fenceType: a.lead.fenceType,
        leadScore: a.lead.score,
        scheduledAt: a.scheduledAt,
        duration: a.duration,
        type: a.type,
        location: a.location,
        notes: a.notes,
        confirmed: a.confirmed,
        cancelledAt: a.cancelledAt,
        completedAt: a.completedAt,
      })),
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load appointments' })
  }
})

// ── Update appointment (confirm/cancel/complete) ──
const updateSchema = z.object({
  confirmed: z.boolean().optional(),
  cancelled: z.boolean().optional(),
  completed: z.boolean().optional(),
  notes: z.string().optional(),
  scheduledAt: z.string().optional(),
})

router.patch('/:id', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin' && req.user!.role !== 'support_agent') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    const data = updateSchema.parse(req.body)
    const now = new Date()

    const existing = await prisma.appointment.findUnique({ where: { id: str(req.params.id) } })

    const updated = await prisma.appointment.update({
      where: { id: str(req.params.id) },
      data: {
        ...(data.confirmed !== undefined ? { confirmed: data.confirmed } : {}),
        ...(data.cancelled ? { cancelledAt: now } : {}),
        ...(data.completed ? { completedAt: now } : {}),
        ...(data.notes ? { notes: data.notes } : {}),
        ...(data.scheduledAt ? { scheduledAt: new Date(data.scheduledAt) } : {}),
      },
    })

    // Sync changes to Google Calendar (fire and forget)
    const repEmail = (existing as any)?.assignedRepEmail
    const eventId = (existing as any)?.googleCalendarEventId
    if (repEmail && eventId) {
      updateCalendarEvent({
        repEmail,
        eventId,
        ...(data.cancelled ? { cancelled: true } : {}),
        ...(data.scheduledAt ? { scheduledAt: new Date(data.scheduledAt), duration: existing?.duration } : {}),
      }).catch(err => console.error('[GCal] Update failed:', err))
    }

    res.json({ success: true, data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    res.status(500).json({ success: false, error: 'Failed to update appointment' })
  }
})

export default router
