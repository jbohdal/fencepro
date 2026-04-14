/**
 * Google Calendar OAuth Routes
 *
 * GET  /api/google-calendar/auth          — start OAuth flow (redirects to Google)
 * GET  /api/google-calendar/callback      — OAuth callback (exchanges code for tokens)
 * GET  /api/google-calendar/status        — list connected calendars
 * DELETE /api/google-calendar/:email      — disconnect a calendar
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import {
  getAuthUrl,
  handleAuthCallback,
  listConnectedCalendars,
  disconnectCalendar,
} from '../lib/googleCalendar.js'

const router = Router()

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'

// ── Start OAuth flow ──
router.get('/auth', requireAuth, (req, res) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  const url = getAuthUrl()
  if (!url) {
    res.status(500).json({
      success: false,
      error: 'Google Calendar not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env',
    })
    return
  }

  res.json({ success: true, data: { url } })
})

// ── OAuth callback (Google redirects here) ──
router.get('/callback', async (req, res) => {
  const code = req.query.code as string
  if (!code) {
    res.status(400).send('Missing authorization code')
    return
  }

  try {
    const result = await handleAuthCallback(code)
    if (!result) {
      res.status(500).send('Failed to complete Google authorization')
      return
    }

    // Redirect back to the app with success message
    res.redirect(`${CLIENT_URL}?gcal_connected=${encodeURIComponent(result.email)}`)
  } catch (err) {
    console.error('[GCal] OAuth callback error:', err)
    res.redirect(`${CLIENT_URL}?gcal_error=auth_failed`)
  }
})

// ── List connected calendars ──
router.get('/status', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    const calendars = await listConnectedCalendars()
    res.json({ success: true, data: calendars })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load calendar status' })
  }
})

// ── Disconnect a calendar ──
router.delete('/:email', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    await disconnectCalendar(String(req.params.email))
    res.json({ success: true })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to disconnect calendar' })
  }
})

export default router
