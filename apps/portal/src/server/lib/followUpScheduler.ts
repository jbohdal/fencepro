/**
 * Follow-Up Scheduler
 *
 * Creates and processes follow-up sequences for leads
 * who haven't booked an appointment.
 *
 * Sequence: 24h → 3 day → 7 day
 */

import prisma from './prisma.js'
import { sendFollowUp } from './sms.js'

const COMPANY_NAME = process.env.COMPANY_NAME || 'FencePro'

interface FollowUpTemplate {
  delayHours: number
  type: string
  message: (firstName: string) => string
}

const FOLLOW_UP_SEQUENCE: FollowUpTemplate[] = [
  {
    delayHours: 24,
    type: '24h_followup',
    message: (name) =>
      `Hi ${name}, this is ${COMPANY_NAME}. We noticed you were looking into fence options — would you like to schedule a free estimate? Just reply with a good time! Reply STOP to opt out.`,
  },
  {
    delayHours: 72,
    type: '3d_reminder',
    message: (name) =>
      `Hey ${name}, just following up from ${COMPANY_NAME}. We'd love to help with your fence project. Want us to swing by for a quick estimate? Reply STOP to opt out.`,
  },
  {
    delayHours: 168,
    type: '7d_last_touch',
    message: (name) =>
      `Hi ${name}, last check-in from ${COMPANY_NAME}! If you're still considering a fence, we're here to help. Feel free to reach out anytime. Reply STOP to opt out.`,
  },
]

/** Schedule the follow-up sequence for a lead that hasn't booked */
export async function scheduleFollowUps(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead || !lead.phone) return

  const firstName = lead.firstName || 'there'
  const now = new Date()

  for (const template of FOLLOW_UP_SEQUENCE) {
    const scheduledFor = new Date(now.getTime() + template.delayHours * 60 * 60 * 1000)

    // Don't create if one of this type already exists
    const existing = await prisma.followUp.findFirst({
      where: { leadId, type: template.type },
    })
    if (existing) continue

    await prisma.followUp.create({
      data: {
        leadId,
        type: template.type,
        channel: 'sms',
        message: template.message(firstName),
        scheduledFor,
      },
    })
  }
}

/** Cancel pending follow-ups for a lead (e.g., when they book an appointment) */
export async function cancelFollowUps(leadId: string): Promise<void> {
  await prisma.followUp.updateMany({
    where: { leadId, status: 'pending' },
    data: { status: 'cancelled' },
  })
}

/**
 * Process due follow-ups.
 * Call this on a timer (e.g., every 5 minutes).
 */
export async function processFollowUps(): Promise<number> {
  const now = new Date()
  const due = await prisma.followUp.findMany({
    where: {
      status: 'pending',
      scheduledFor: { lte: now },
    },
    include: { lead: true },
    take: 50,
  })

  let sent = 0

  for (const followUp of due) {
    // Skip if lead has already booked or been contacted
    if (['appointment_scheduled', 'won', 'lost'].includes(followUp.lead.stage)) {
      await prisma.followUp.update({
        where: { id: followUp.id },
        data: { status: 'cancelled' },
      })
      continue
    }

    if (!followUp.lead.phone) {
      await prisma.followUp.update({
        where: { id: followUp.id },
        data: { status: 'failed', errorMessage: 'No phone number' },
      })
      continue
    }

    const result = await sendFollowUp(followUp.lead.phone, followUp.message)

    await prisma.followUp.update({
      where: { id: followUp.id },
      data: {
        status: result.success ? 'sent' : 'failed',
        sentAt: result.success ? now : null,
        errorMessage: result.error || null,
      },
    })

    if (result.success) sent++
  }

  if (sent > 0) console.log(`[FollowUp] Processed ${sent} follow-up messages`)
  return sent
}
