/**
 * Signed documents for staff (lib/signedDocuments.ts): the stored signed PDFs
 * of contracts and change orders, for the Documents section of the customer
 * page, the quote and the job.
 *
 *   GET /?customerId=<id> | ?quoteId=<id> | ?jobId=<id>   the list (newest first):
 *        kind, title, what was signed, signed date, signer, quote, job, in the portal
 *   GET /:id/pdf                                           the stored signed PDF, as it was stored
 *
 * Only this company's. Read only: the documents are made at signing and by
 * scripts/signed-contracts-backfill.ts, never from here.
 */

import { Router } from 'express'
import { requireUser, requireAccount } from './saved-quotes.js'
import { signedForCustomer, signedForQuote, signedForJob, storedPdf } from '../lib/signedDocuments.js'

const router = Router()
router.use(requireUser, requireAccount)

router.get('/', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId as string
    const one = (k: string) => (typeof req.query[k] === 'string' && req.query[k] ? String(req.query[k]).slice(0, 100) : null)
    const customerId = one('customerId'), quoteId = one('quoteId'), jobId = one('jobId')
    if (!customerId && !quoteId && !jobId) { res.status(400).json({ success: false, error: 'Say which customer, quote or job' }); return }
    const data = customerId ? await signedForCustomer(accountId, customerId) : quoteId ? await signedForQuote(accountId, quoteId) : await signedForJob(accountId, jobId!)
    res.json({ success: true, data })
  } catch (err) {
    console.error('[signed-documents] list:', err)
    res.status(500).json({ success: false, error: 'Could not load the signed documents' })
  }
})

router.get('/:id/pdf', async (req: any, res) => {
  try {
    const out = await storedPdf(req.user.crmAccountId, String(req.params.id))
    if (!out) { res.status(404).json({ success: false, error: 'Not found' }); return }
    const name = out.doc.kind === 'contract' ? 'Signed contract.pdf' : 'Signed change order.pdf'
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${name}"`)
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.end(out.pdf)
  } catch (err) {
    console.error('[signed-documents] pdf:', err)
    res.status(500).json({ success: false, error: 'Could not open the PDF' })
  }
})

export default router
