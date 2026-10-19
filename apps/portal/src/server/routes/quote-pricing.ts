/**
 * POST /api/quote-pricing — the quote builder's prices worked out on the
 * server (lib/quotePricing.ts), for a Salesman or Installer whose phone never
 * gets costs: sections, the 6 / 8 ft choice, the parts list, every price, the
 * tiers, Compare options and the proposal's options. Any staff login of the
 * company may ask; the answer is prices only either way.
 *
 * Body: { quoteId?: the saved quote being edited, request: the quote builder's inputs }
 */

import { Router } from 'express'
import { requireUser, requireAccount } from './saved-quotes.js'
import { quoteViewFor } from '../lib/quotePricing.js'

const router = Router()

router.post('/', requireUser, requireAccount, async (req: any, res) => {
  try {
    const request = req.body?.request
    if (!request || typeof request !== 'object' || typeof request.fenceStyle !== 'string') {
      res.status(400).json({ success: false, error: 'Pick a fence style to price.' })
      return
    }
    const quoteId = typeof req.body?.quoteId === 'string' ? req.body.quoteId : null
    res.json({ success: true, data: await quoteViewFor(req.user.crmAccountId, request, quoteId) })
  } catch (err) {
    console.error('[quote-pricing] error:', err)
    res.status(500).json({ success: false, error: 'Could not price this quote. Try again.' })
  }
})

export default router
