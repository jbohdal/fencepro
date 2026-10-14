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
} from '../../../lib/googleCalendar.js'

const adapter: IntegrationAdapter = {
  slug: 'google_calendar',
  name: 'Google Calendar',
  category: 'Scheduling',
  description: 'Superseded by Settings → Google Calendar (one way, every appointment).',
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

  // Appointments now go to Google one way, through Settings → Google Calendar
  // (lib/calendarSync). This older two-way link no longer moves them, so the
  // CRM stays the one record of every appointment.
  async sync() {
    return { synced: 0, errors: 0, message: 'Appointments are sent to Google Calendar from Settings → Google Calendar. Nothing to do here.' }
  },

  async handleInbound(_payload, headers) {
    return { processed: true, message: `Google Calendar notification ignored (${headers['x-goog-resource-state'] || 'unknown'}); changes made in Google are not brought back.` }
  },
}

export { pushAppointmentToCalendar, updateCalendarEvent, disconnectCalendar, listConnectedCalendars }

export default adapter
