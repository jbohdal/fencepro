/**
 * A customer's pull sheets, at /api/pull-sheets (lib/customerPullSheets.ts).
 * Any staff login of the company; by the customer's id, never by name.
 *
 *   GET /customer/:contactId             every quote's and job's pull sheet, newest first
 *   GET /customer/:contactId/:entry.pdf  one of them as a PDF (lib/pullSheetPdf.ts)
 *
 * Owner and office (costs.view) get unit costs and totals. A Salesman's or
 * Installer's login gets quantities only: taken out here (quantitiesOnly), on
 * top of the cost filter every /api answer to such a login goes through
 * (lib/costRedact.ts, index.ts), and the PDF is made without them.
 */

import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { roleOf } from '../lib/permissions.js'
import { hidesCosts } from '../lib/costRedact.js'
import { customerPullSheets, quantitiesOnly } from '../lib/customerPullSheets.js'
import { pullSheetPdf } from '../lib/pullSheetPdf.js'

const router = Router()
router.use(requireUser, requireAccount)

router.get('/customer/:contactId', async (req: any, res) => {
  try {
    const list = await customerPullSheets(req.user.crmAccountId, String(req.params.contactId))
    if (!list) { res.status(404).json({ success: false, error: 'Customer not found' }); return }
    const costs = !hidesCosts(roleOf(req))
    // "quantitiesOnly", not a name with "cost" in it: the answer filter would take that out for a Salesman.
    res.json({ success: true, data: { quantitiesOnly: !costs, entries: costs ? list : quantitiesOnly(list) } })
  } catch (err) {
    console.error('[pull-sheets] list:', err)
    res.status(500).json({ success: false, error: 'Could not load the pull sheets' })
  }
})

router.get('/customer/:contactId/:entry.pdf', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const contactId = String(req.params.contactId)
    const list = await customerPullSheets(accountId, contactId)
    const entry = list?.find(e => e.id === String(req.params.entry))
    if (!entry) { res.status(404).json({ success: false, error: 'Pull sheet not found' }); return }
    const costs = !hidesCosts(roleOf(req))
    const [contact, b] = await Promise.all([
      prisma.crmContact.findUnique({ where: { id: contactId }, select: { firstName: true, lastName: true, serviceAddress: true } }),
      prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }),
    ])
    const co = (b?.config as any)?.company ?? {}
    const pdf = await pullSheetPdf({
      company: { name: String(co.name || 'Getter Done Fence'), phone: String(co.phone || ''), email: String(co.email || '') },
      customerName: [contact?.firstName, contact?.lastName].filter(Boolean).join(' '), address: contact?.serviceAddress || '',
      entry: costs ? entry : quantitiesOnly([entry])[0], withCosts: costs,
    })
    const name = `Pull sheet - ${[contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || 'customer'}`.replace(/[^\w .-]/g, '')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`)
    res.setHeader('Cache-Control', 'private, no-store')
    res.end(pdf)
  } catch (err) {
    console.error('[pull-sheets] pdf:', err)
    res.status(500).json({ success: false, error: 'Could not make the PDF' })
  }
})

export default router
