import { Router } from 'express'
import { processFollowUps } from '../lib/followUpScheduler.js'

const router = Router()

/**
 * POST /api/cron/follow-ups
 * Called by Vercel Cron every 5 minutes.
 * Protected by CRON_SECRET header to prevent unauthorized invocations.
 */
router.post('/follow-ups', async (req, res) => {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers['x-cron-secret'] !== secret) {
    res.status(401).json({ success: false, error: 'Unauthorized' })
    return
  }

  try {
    await processFollowUps()
    res.json({ success: true, message: 'Follow-ups processed' })
  } catch (err) {
    console.error('[Cron] follow-ups error:', err)
    res.status(500).json({ success: false, error: 'Internal error' })
  }
})

export default router
