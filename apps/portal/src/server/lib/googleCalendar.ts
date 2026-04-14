/**
 * Google Calendar Integration
 *
 * Pushes appointment/estimate events to the assigned salesman's Google Calendar.
 * Uses OAuth2 with per-user refresh tokens stored in the database.
 *
 * Setup:
 *   1. Create a Google Cloud project with Calendar API enabled
 *   2. Create OAuth 2.0 credentials (Web application)
 *   3. Set redirect URI to: {BASE_URL}/api/google-calendar/callback
 *   4. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI to .env
 */

import { google, calendar_v3 } from 'googleapis'
import prisma from './prisma.js'

const SCOPES = ['https://www.googleapis.com/auth/calendar.events']

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI

  if (!clientId || !clientSecret) {
    return null
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

/**
 * Generate the OAuth consent URL for a user to authorize calendar access
 */
export function getAuthUrl(state?: string): string | null {
  const client = getOAuth2Client()
  if (!client) return null

  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // force refresh token on every auth
    state: state || '',
  })
}

/**
 * Exchange authorization code for tokens and store them
 */
export async function handleAuthCallback(code: string): Promise<{ email: string } | null> {
  const client = getOAuth2Client()
  if (!client) return null

  const { tokens } = await client.getToken(code)
  client.setCredentials(tokens)

  // Get the user's email
  const oauth2 = google.oauth2({ version: 'v2', auth: client })
  const { data } = await oauth2.userinfo.get()
  const email = data.email

  if (!email || !tokens.refresh_token) {
    throw new Error('Could not get email or refresh token from Google')
  }

  // Upsert token record
  await prisma.googleCalendarToken.upsert({
    where: { email },
    create: {
      email,
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(tokens.expiry_date || Date.now() + 3600_000),
      scope: tokens.scope || SCOPES.join(' '),
    },
    update: {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(tokens.expiry_date || Date.now() + 3600_000),
      scope: tokens.scope || SCOPES.join(' '),
    },
  })

  return { email }
}

/**
 * Get an authenticated calendar client for a specific user email
 */
async function getCalendarClient(email: string): Promise<calendar_v3.Calendar | null> {
  const client = getOAuth2Client()
  if (!client) return null

  const tokenRecord = await prisma.googleCalendarToken.findUnique({
    where: { email },
  })

  if (!tokenRecord) {
    console.warn(`[GCal] No token found for ${email}`)
    return null
  }

  client.setCredentials({
    access_token: tokenRecord.accessToken,
    refresh_token: tokenRecord.refreshToken,
    expiry_date: tokenRecord.expiresAt.getTime(),
  })

  // Auto-refresh: listen for new tokens
  client.on('tokens', async (newTokens) => {
    try {
      await prisma.googleCalendarToken.update({
        where: { email },
        data: {
          accessToken: newTokens.access_token || tokenRecord.accessToken,
          expiresAt: new Date(newTokens.expiry_date || Date.now() + 3600_000),
          ...(newTokens.refresh_token ? { refreshToken: newTokens.refresh_token } : {}),
        },
      })
    } catch (err) {
      console.error('[GCal] Failed to persist refreshed token:', err)
    }
  })

  return google.calendar({ version: 'v3', auth: client })
}

/**
 * Push an appointment to a salesman's Google Calendar
 */
export async function pushAppointmentToCalendar(params: {
  repEmail: string
  scheduledAt: Date
  duration: number      // minutes
  type: string          // estimate, follow_up, consultation
  location?: string
  customerName: string
  customerPhone?: string
  customerEmail?: string
  fenceType?: string
  linearFootage?: number
  notes?: string
}): Promise<string | null> {
  const calendar = await getCalendarClient(params.repEmail)
  if (!calendar) return null

  const endTime = new Date(params.scheduledAt.getTime() + params.duration * 60_000)

  const typeLabel = params.type === 'estimate' ? 'Fence Estimate'
    : params.type === 'follow_up' ? 'Follow-Up'
    : 'Consultation'

  // Build description with job details
  const descParts = [
    `${typeLabel} — ${params.customerName}`,
    '',
  ]
  if (params.fenceType) descParts.push(`Fence Type: ${params.fenceType}`)
  if (params.linearFootage) descParts.push(`Linear Footage: ~${params.linearFootage} ft`)
  if (params.customerPhone) descParts.push(`Phone: ${params.customerPhone}`)
  if (params.customerEmail) descParts.push(`Email: ${params.customerEmail}`)
  if (params.notes) descParts.push(`\nNotes: ${params.notes}`)
  descParts.push('\n---\nCreated by FencePro CRM')

  try {
    const event = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: `${typeLabel}: ${params.customerName}`,
        description: descParts.join('\n'),
        location: params.location || undefined,
        start: {
          dateTime: params.scheduledAt.toISOString(),
          timeZone: 'America/New_York', // FL timezone
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: 'America/New_York',
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 60 },
            { method: 'popup', minutes: 15 },
          ],
        },
        colorId: params.type === 'estimate' ? '9' : '5', // blueberry for estimates, banana for others
      },
    })

    console.log(`[GCal] Event created: ${event.data.id} for ${params.repEmail}`)
    return event.data.id || null
  } catch (err) {
    console.error(`[GCal] Failed to create event for ${params.repEmail}:`, err)
    return null
  }
}

/**
 * Update an existing calendar event (e.g., reschedule, cancel)
 */
export async function updateCalendarEvent(params: {
  repEmail: string
  eventId: string
  scheduledAt?: Date
  duration?: number
  cancelled?: boolean
  notes?: string
}): Promise<boolean> {
  const calendar = await getCalendarClient(params.repEmail)
  if (!calendar) return false

  try {
    if (params.cancelled) {
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: params.eventId,
      })
      console.log(`[GCal] Event deleted: ${params.eventId}`)
      return true
    }

    const updates: calendar_v3.Schema$Event = {}
    if (params.scheduledAt) {
      const duration = params.duration || 60
      const endTime = new Date(params.scheduledAt.getTime() + duration * 60_000)
      updates.start = { dateTime: params.scheduledAt.toISOString(), timeZone: 'America/New_York' }
      updates.end = { dateTime: endTime.toISOString(), timeZone: 'America/New_York' }
    }

    await calendar.events.patch({
      calendarId: 'primary',
      eventId: params.eventId,
      requestBody: updates,
    })
    console.log(`[GCal] Event updated: ${params.eventId}`)
    return true
  } catch (err) {
    console.error(`[GCal] Failed to update event ${params.eventId}:`, err)
    return false
  }
}

/**
 * Check if a Google Calendar is connected for a given email
 */
export async function isCalendarConnected(email: string): Promise<boolean> {
  const token = await prisma.googleCalendarToken.findUnique({
    where: { email },
  })
  return !!token
}

/**
 * Disconnect a Google Calendar (remove stored tokens)
 */
export async function disconnectCalendar(email: string): Promise<void> {
  await prisma.googleCalendarToken.deleteMany({
    where: { email },
  })
}

/**
 * List connected Google Calendar accounts
 */
export async function listConnectedCalendars(): Promise<{ email: string; connectedAt: Date }[]> {
  const tokens = await prisma.googleCalendarToken.findMany({
    select: { email: true, createdAt: true },
    orderBy: { email: 'asc' },
  })
  return tokens.map(t => ({ email: t.email, connectedAt: t.createdAt }))
}
