/**
 * The Google side of calendar sync: OAuth, the dedicated calendar, and the
 * three event calls the engine needs.
 *
 * Scope: calendar.app.created lets the app make its own secondary calendar
 * and manage events on calendars it made, and nothing else. It cannot read or
 * change the owner's main calendar.
 */

import { google, type calendar_v3 } from 'googleapis'
import prisma from '../prisma.js'
import type { CalendarApi } from './engine.js'
import { addDays, eventKey, type CalendarEventSpec } from './spec.js'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.app.created',
  'https://www.googleapis.com/auth/userinfo.email',
]
const TIME_ZONE = 'America/New_York'

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI)
}

function oauthClient() {
  if (!googleConfigured()) throw new Error('Google Calendar is not set up: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI are missing from the settings file.')
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI)
}

export function consentUrl(state: string): string {
  // prompt=consent makes Google hand back a refresh token every time.
  return oauthClient().generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent', state })
}

/** Trade the code from Google's redirect for tokens, store them, and say whose account it is. */
export async function exchangeCode(code: string): Promise<string> {
  const client = oauthClient()
  const { tokens } = await client.getToken(code)
  client.setCredentials(tokens)
  const { data } = await google.oauth2({ version: 'v2', auth: client }).userinfo.get()
  const email = data.email
  if (!email) throw new Error('Google did not say which account was connected.')
  if (!tokens.refresh_token) throw new Error('Google did not return a long lived token. Disconnect EZ Biz under your Google Account, Security, Third party access, then connect again.')
  const fields = {
    accessToken: tokens.access_token || '',
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(tokens.expiry_date || Date.now() + 3600_000),
    scope: tokens.scope || SCOPES.join(' '),
  }
  await prisma.googleCalendarToken.upsert({ where: { email }, create: { email, ...fields }, update: fields })
  return email
}

export async function forgetTokens(email: string): Promise<void> {
  const row = await prisma.googleCalendarToken.findUnique({ where: { email } })
  if (!row) return
  try { await oauthClient().revokeToken(row.refreshToken) } catch { /* already revoked, or Google is unreachable */ }
  await prisma.googleCalendarToken.deleteMany({ where: { email } })
}

async function calendarFor(email: string): Promise<calendar_v3.Calendar> {
  const row = await prisma.googleCalendarToken.findUnique({ where: { email } })
  if (!row) throw new Error(`No Google sign in is stored for ${email}. Connect Google Calendar again in Settings.`)
  const client = oauthClient()
  client.setCredentials({ access_token: row.accessToken, refresh_token: row.refreshToken, expiry_date: row.expiresAt.getTime() })
  client.on('tokens', t => {
    prisma.googleCalendarToken.update({
      where: { email },
      data: {
        accessToken: t.access_token || row.accessToken,
        expiresAt: new Date(t.expiry_date || Date.now() + 3600_000),
        ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
      },
    }).catch(err => console.error('[calendar] could not store the refreshed Google token:', (err as Error).message))
  })
  return google.calendar({ version: 'v3', auth: client })
}

function eventBody(spec: CalendarEventSpec): calendar_v3.Schema$Event {
  const body: calendar_v3.Schema$Event = {
    summary: spec.summary,
    location: spec.location || undefined,
    description: spec.description,
    status: 'confirmed',                                   // also brings back an event deleted by hand
    extendedProperties: { private: { ezbiz: eventKey(spec) } },
  }
  if (spec.startDate && spec.endDate) {
    body.start = { date: spec.startDate }
    body.end = { date: addDays(spec.endDate, 1) }          // Google's end date is the day after the last day
  } else {
    body.start = { dateTime: spec.startAt, timeZone: TIME_ZONE }
    body.end = { dateTime: spec.endAt, timeZone: TIME_ZONE }
  }
  return body
}

export interface GoogleCalendarApi extends CalendarApi {
  createCalendar(name: string): Promise<string>
  calendarExists(calendarId: string): Promise<boolean>
}

export async function googleApiFor(email: string): Promise<GoogleCalendarApi> {
  const cal = await calendarFor(email)
  return {
    async insert(calendarId, eventId, spec) {
      await cal.events.insert({ calendarId, requestBody: { ...eventBody(spec), id: eventId } })
    },
    async update(calendarId, eventId, spec) {
      await cal.events.update({ calendarId, eventId, requestBody: eventBody(spec) })
    },
    async remove(calendarId, eventId) {
      await cal.events.delete({ calendarId, eventId })
    },
    async createCalendar(name) {
      const { data } = await cal.calendars.insert({ requestBody: { summary: name, timeZone: TIME_ZONE, description: 'Estimates and installs from EZ Biz. Managed by EZ Biz: changes made here are overwritten.' } })
      if (!data.id) throw new Error('Google did not return an id for the new calendar.')
      return data.id
    },
    async calendarExists(calendarId) {
      try { await cal.calendars.get({ calendarId }); return true }
      catch (err) {
        const code = Number((err as { code?: unknown; response?: { status?: unknown } }).code ?? (err as { response?: { status?: unknown } }).response?.status)
        if (code === 404 || code === 410 || code === 403) return false
        throw err
      }
    },
  }
}
