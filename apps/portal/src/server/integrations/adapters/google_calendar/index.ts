/**
 * Google Calendar Adapter
 *
 * Capabilities:
 *  - sync_calendar  — two-way sync between CRM schedule and Google Calendar
 *  - push_events    — push new appointments to assigned reps' calendars
 *  - pull_blocks    — pull busy/blocked times and calendar changes back into appointments
 *
 * Two-way sync behaviour:
 *  - PUSH: upcoming appointments without a googleCalendarEventId are created on the calendar
 *  - PULL: events that already have a googleCalendarEventId are reconciled:
 *      • if the calendar event was cancelled  → cancelledAt set on the appointment
 *      • if the calendar event was rescheduled → scheduledAt updated on the appointment
 *
 * Config fields:
 *  - repEmail   The Google account email of the rep to connect
 */

import type { IntegrationAdapter } from '../../types.js'
import {
  getAuthUrl,
  isCalendarConnected,
  listConnectedCalendars,
  disconnectCalendar,
  pushAppointmentToCalendar,
  updateCalendarEvent,
  pullCalendarEvents,
} from '../../../lib/googleCalendar.js'
import prisma from '../../../lib/prisma.js'

/** Appointment fields selected for sync operations */
type SyncedAppointment = {
  id: string
  googleCalendarEventId: string | null
  scheduledAt: Date
  duration: number
}

const adapter: IntegrationAdapter = {
  slug: 'google_calendar',
  name: 'Google Calendar',
  category: 'Scheduling',
  description: 'Two-way sync between CRM schedule and Google Calendar.',
  capabilities: ['sync_calendar', 'push_events', 'pull_blocks'],
  configFields: [
    {
      key: 'repEmail',
      label: 'Rep / Salesman Email',
      type: 'email',
      required: true,
      helpText: 'Google account email of the rep whose calendar to sync. They must complete the OAuth flow first via Settings → Google Calendar.',
    },
  ],

  async connect(config) {
    return this.test(config)
  },

  async disconnect() {
    // Disconnect is per-rep and managed through /api/google-calendar/disconnect
  },

  async test(config) {
    const { repEmail } = config as { repEmail: string }
    if (!repEmail) return { success: false, message: 'Rep email is required' }

    const connected = await isCalendarConnected(repEmail)
    if (connected) {
      return { success: true, message: `Google Calendar connected for ${repEmail}` }
    }

    const authUrl = getAuthUrl(`rep:${repEmail}`)
    if (!authUrl) {
      return {
        success: false,
        message: 'Google Calendar OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      }
    }

    return {
      success: false,
      message: `${repEmail} has not authorized Google Calendar. Direct them to: ${authUrl}`,
    }
  },

  async sync(config) {
    const { repEmail } = config as { repEmail?: string }

    const connectedCalendars = await listConnectedCalendars()
    if (connectedCalendars.length === 0) {
      return { synced: 0, errors: 0, message: 'No Google Calendars connected. Complete OAuth flow first.' }
    }

    const targetEmails = repEmail
      ? connectedCalendars.filter(c => c.email === repEmail).map(c => c.email)
      : connectedCalendars.map(c => c.email)

    let synced = 0
    let errors = 0

    for (const email of targetEmails) {
      // ── PUSH: upcoming appointments without a calendar event ──
      try {
        const appointments = await prisma.appointment.findMany({
          where: {
            assignedRepEmail: email,
            scheduledAt: { gte: new Date() },
            cancelledAt: null,
            googleCalendarEventId: null,
          },
          include: {
            lead: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                fenceType: true,
                linearFootage: true,
              },
            },
          },
          take: 50,
        })

        for (const appt of appointments) {
          try {
            const eventId = await pushAppointmentToCalendar({
              repEmail: email,
              scheduledAt: appt.scheduledAt,
              duration: appt.duration,
              type: appt.type,
              location: appt.location || undefined,
              customerName: [appt.lead.firstName, appt.lead.lastName].filter(Boolean).join(' ') || 'New Lead',
              customerPhone: appt.lead.phone || undefined,
              customerEmail: appt.lead.email || undefined,
              fenceType: appt.lead.fenceType || undefined,
              linearFootage: appt.lead.linearFootage || undefined,
              notes: appt.notes || undefined,
            })

            if (eventId) {
              await prisma.appointment.update({
                where: { id: appt.id },
                data: { googleCalendarEventId: eventId },
              })
              synced++
            } else {
              errors++
            }
          } catch {
            errors++
          }
        }
      } catch (err) {
        console.error(`[GoogleCalendar] Push error for ${email}:`, err)
        errors++
      }

      // ── PULL: reconcile existing calendar events back into appointments ──
      try {
        const calEvents = await pullCalendarEvents({ repEmail: email, daysAhead: 60 })
        const eventMap = new Map(calEvents.map(ev => [ev.eventId, ev]))

        const syncedAppointments: SyncedAppointment[] = await prisma.appointment.findMany({
          where: {
            assignedRepEmail: email,
            googleCalendarEventId: { not: null },
            cancelledAt: null,
            scheduledAt: { gte: new Date() },
          },
          select: {
            id: true,
            googleCalendarEventId: true,
            scheduledAt: true,
            duration: true,
          },
        })

        for (const appt of syncedAppointments) {
          // googleCalendarEventId is non-null here because of the 'not: null' filter above
          const eventId = appt.googleCalendarEventId as string
          const calEvent = eventMap.get(eventId)

          if (!calEvent) continue // event not in the pull window, skip

          if (calEvent.cancelled) {
            // Event was deleted in Google Calendar — cancel the appointment
            await prisma.appointment.update({
              where: { id: appt.id },
              data: { cancelledAt: new Date() },
            })
            console.log(`[GoogleCalendar] Appointment ${appt.id} cancelled (GCal event deleted)`)
            synced++
          } else {
            // Check if the event time was changed in Google Calendar
            const diffMs = Math.abs(calEvent.start.getTime() - appt.scheduledAt.getTime())
            if (diffMs > 60_000) {
              // More than 1 minute difference — rep rescheduled in Google Calendar
              await prisma.appointment.update({
                where: { id: appt.id },
                data: { scheduledAt: calEvent.start },
              })
              console.log(`[GoogleCalendar] Appointment ${appt.id} rescheduled to ${calEvent.start.toISOString()} (pulled from GCal)`)
              synced++
            }
          }
        }
      } catch (err) {
        console.error(`[GoogleCalendar] Pull error for ${email}:`, err)
        errors++
      }
    }

    const calStr = targetEmails.join(', ')
    return {
      synced,
      errors,
      message: synced > 0
        ? `Two-way sync complete: ${synced} change(s) for ${calStr}`
        : `No sync changes needed for ${calStr || 'any connected calendar'}`,
    }
  },

  async handleInbound(payload, headers) {
    // Google Calendar push notifications via Channel/Watch
    const resourceState = headers['x-goog-resource-state'] || ''
    const channelId = headers['x-goog-channel-id'] || ''

    console.log(`[GoogleCalendar] Push notification: state=${resourceState} channel=${channelId}`)

    if (resourceState === 'sync') {
      return { processed: true, message: 'Google Calendar sync verification received' }
    }

    if (resourceState === 'exists') {
      // A calendar resource changed — run a pull sync for all connected reps
      const connectedCalendars = await listConnectedCalendars()
      let updated = 0
      let errors = 0

      for (const cal of connectedCalendars) {
        try {
          const calEvents = await pullCalendarEvents({ repEmail: cal.email, daysAhead: 60 })
          const eventMap = new Map(calEvents.map(ev => [ev.eventId, ev]))

          const syncedAppointments: SyncedAppointment[] = await prisma.appointment.findMany({
            where: {
              assignedRepEmail: cal.email,
              googleCalendarEventId: { not: null },
              cancelledAt: null,
              scheduledAt: { gte: new Date() },
            },
            select: {
              id: true,
              googleCalendarEventId: true,
              scheduledAt: true,
              duration: true,
            },
          })

          for (const appt of syncedAppointments) {
            const eventId = appt.googleCalendarEventId as string
            const calEvent = eventMap.get(eventId)
            if (!calEvent) continue

            if (calEvent.cancelled) {
              await prisma.appointment.update({ where: { id: appt.id }, data: { cancelledAt: new Date() } })
              updated++
            } else {
              const diffMs = Math.abs(calEvent.start.getTime() - appt.scheduledAt.getTime())
              if (diffMs > 60_000) {
                await prisma.appointment.update({ where: { id: appt.id }, data: { scheduledAt: calEvent.start } })
                updated++
              }
            }
          }
        } catch {
          errors++
        }
      }

      return {
        processed: true,
        message: `Calendar change synced: ${updated} appointment(s) updated${errors > 0 ? `, ${errors} error(s)` : ''}`,
      }
    }

    return { processed: true, message: `Google Calendar notification: ${resourceState}` }
  },
}

export { pushAppointmentToCalendar, updateCalendarEvent, disconnectCalendar, listConnectedCalendars }

export default adapter
