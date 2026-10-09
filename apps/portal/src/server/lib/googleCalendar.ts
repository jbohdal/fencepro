/**
 * Google Calendar Integration
 *
 * Kept for the older callers (the chat appointment route and the integrations
 * adapter). Calendar sync itself lives in lib/calendarSync: one way, to a
 * dedicated calendar, driven from the database. The push, update and pull
 * functions here no longer touch anyone's main calendar.
 *
 * Setup:
 *   1. Create a Google Cloud project with Calendar API enabled
 *   2. Create OAuth 2.0 credentials (Web application)
 *   3. Set redirect URI to: {BASE_URL}/api/google-calendar/callback
 *   4. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI to .env
 */

import { google, calendar_v3 } from 'googleapis'
import prisma from './prisma.js'
import { requestCalendarSync } from './calendarSync/index.js'

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
  // Appointments now go to the dedicated calendar through calendarSync, which
  // reads them from the database. Nothing is written to anyone's main calendar.
  void params
  requestCalendarSync()
  return null
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
  void params
  requestCalendarSync()
  return true
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

/**
 * The sync is one way (EZ Biz to Google) and has no access to main calendars,
 * so there is nothing to pull. Kept so the integrations adapter still loads.
 */
export async function pullCalendarEvents(params: {
  repEmail: string
  daysAhead?: number
}): Promise<Array<{
  eventId: string
  summary: string
  start: Date
  end: Date
  cancelled: boolean
  description?: string
}>> {
  void params
  return []
}
