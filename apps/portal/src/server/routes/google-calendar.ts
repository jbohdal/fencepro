/**
 * Google Calendar sync: connect, status, push, disconnect.
 *
 *   GET  /api/google-calendar/status        what is connected and how the sync is doing
 *   GET  /api/google-calendar/connect-url   where to send the browser to connect
 *   GET  /api/google-calendar/callback      Google sends the browser back here
 *   POST /api/google-calendar/push-all      send everything dated today or later; switches syncing on
 *   POST /api/google-calendar/disconnect    stop syncing and forget the Google sign in
 *
 * Everything but the callback needs a signed in CRM admin. The callback is
 * opened by Google's redirect, so it carries a short lived signed `state`
 * that says which company and which page the request came from.
 */

import { Router } from 'express'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { resolveSecret } from '../lib/secrets.js'
import { consentUrl, googleConfigured } from '../lib/calendarSync/google.js'
import { calendarStatus, connectCalendar, disconnectCalendar, syncCalendarNow } from '../lib/calendarSync/index.js'
import { connectGmail } from '../lib/automations/gmail.js'

const router = Router()
const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
const ADMIN_ROLES = new Set(['super_admin', 'admin'])

async function requireAdmin(req: any, res: any, next: any) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any
    if (!ADMIN_ROLES.has(payload.role)) { res.status(403).json({ success: false, error: 'Only an admin can manage the calendar connection.' }); return }
    let crmAccountId: string | null = payload.crmAccountId ?? null
    if (!crmAccountId) {
      const u = await prisma.crmUser.findUnique({ where: { id: payload.sub }, select: { crmAccountId: true } })
      crmAccountId = u?.crmAccountId ?? null
    }
    if (!crmAccountId) { res.status(403).json({ success: false, error: 'No tenant' }); return }
    req.user = { id: payload.sub, email: payload.email, role: payload.role, crmAccountId }
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
}

/** Pages the browser may be sent back to after connecting: this server, the web app, or localhost on this machine. */
function safeReturnTo(value: unknown): string {
  const fallback = (process.env.CLIENT_URL || process.env.APP_URL || '').replace(/\/+$/, '')
  if (typeof value !== 'string') return fallback
  try {
    const u = new URL(value)
    const allowed = [process.env.CLIENT_URL, process.env.APP_URL].filter(Boolean).map(x => new URL(x as string).origin)
    if (allowed.includes(u.origin) || ['localhost', '127.0.0.1'].includes(u.hostname)) return u.origin
  } catch { /* fall through */ }
  return fallback
}

router.get('/status', requireAdmin, async (req: any, res) => {
  try {
    res.json({ success: true, data: await calendarStatus(req.user.crmAccountId) })
  } catch (err) {
    console.error('[calendar] status error:', err)
    res.status(500).json({ success: false, error: 'Could not read the calendar status' })
  }
})

router.get('/connect-url', requireAdmin, (req: any, res) => {
  if (!googleConfigured()) {
    res.status(400).json({ success: false, error: 'Google Calendar is not set up yet: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI are missing from the settings file.' })
    return
  }
  const state = jwt.sign({ purpose: 'gcal', accountId: req.user.crmAccountId, returnTo: safeReturnTo(req.query.returnTo) }, JWT_SECRET, { expiresIn: '10m' })
  res.json({ success: true, data: { url: consentUrl(state) } })
})

router.get('/callback', async (req, res) => {
  let returnTo = safeReturnTo(undefined)
  const back = (result: string, detail = '') =>
    res.redirect(`${returnTo}/?settings=calendar&gcal=${result}${detail ? `&detail=${encodeURIComponent(detail.slice(0, 200))}` : ''}`)
  try {
    const state = jwt.verify(String(req.query.state || ''), JWT_SECRET) as { purpose?: string; accountId?: string; returnTo?: string }
    // Connect Gmail (Automations) uses the same Google project and redirect address.
    if (state.purpose === 'gmail' && state.accountId) {
      returnTo = safeReturnTo(state.returnTo)
      const toAutomations = (result: string, detail = '') => res.redirect(`${returnTo}/automations?gmail=${result}${detail ? `&detail=${encodeURIComponent(detail.slice(0, 200))}` : ''}`)
      if (req.query.error) { toAutomations('error', `Google said: ${String(req.query.error)}`); return }
      try { toAutomations('connected', await connectGmail(state.accountId, String(req.query.code || ''))) } catch (err) { toAutomations('error', String((err as Error)?.message || 'Could not connect Gmail')) }
      return
    }
    if (state.purpose !== 'gcal' || !state.accountId) throw new Error('bad state')
    returnTo = safeReturnTo(state.returnTo)
    if (req.query.error) { back('error', `Google said: ${String(req.query.error)}`); return }
    const code = String(req.query.code || '')
    if (!code) { back('error', 'Google did not send a code.'); return }
    const { email } = await connectCalendar(state.accountId, code)
    back('connected', email)
  } catch (err) {
    console.error('[calendar] connect failed:', err)
    const expired = /jwt|state/i.test(String((err as Error)?.message))
    back('error', expired ? 'The connect link expired. Press Connect again.' : String((err as Error)?.message || 'Could not connect'))
  }
})

router.post('/push-all', requireAdmin, async (req: any, res) => {
  try {
    const result = await syncCalendarNow(req.user.crmAccountId, { activate: true })
    if (!result) { res.status(400).json({ success: false, error: 'Connect Google Calendar first.' }); return }
    res.json({ success: true, data: result })
  } catch (err) {
    res.status(502).json({ success: false, error: `Google Calendar could not be reached: ${String((err as Error)?.message || err).slice(0, 200)}. Nothing in EZ Biz was affected; it will be tried again.` })
  }
})

router.post('/disconnect', requireAdmin, async (req: any, res) => {
  try {
    await disconnectCalendar(req.user.crmAccountId)
    res.json({ success: true })
  } catch (err) {
    console.error('[calendar] disconnect error:', err)
    res.status(500).json({ success: false, error: 'Could not disconnect' })
  }
})

export default router
