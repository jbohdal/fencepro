/**
 * The Florida lien notice addendum for contracts signed before the notice (lib/lienNoticeAddendum.ts; Jonathan,
 * Nov 6 2026). Owner and office (billing.change); never the Salesman or the Installer.
 *
 *   GET  /api/lien-addenda                  every contract that gets one now, with its state, and the review mark
 *   GET  /api/lien-addenda/job/:jobId       the job's addendum: applies, state, the contract it names, the words
 *   POST /api/lien-addenda/reviewed         { reviewed } the owner only: the attorney review mark (its own record)
 *   POST /api/lien-addenda/job/:jobId/send  { channel: email | text | copy }: refused until the owner marked it
 *                                           attorney reviewed (POST /reviewed: Subcontractors → Settings, or on the job)
 */

import { Router } from 'express'
import express from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { requireCan, roleOf } from '../lib/permissions.js'
import { audit } from '../lib/auditLog.js'
import { plainZod } from '../lib/plainZod.js'
import { SubError } from '../lib/subcontractors.js'
import { addendumCandidates, addendumForJob, addendumReview, setAddendumReview, sendAddendum, stateOf, summaryOf } from '../lib/lienNoticeAddendum.js'

const router = Router()
router.use(requireUser, requireAccount, requireCan('billing.change'))

async function nameOf(req: any) {
  const u = await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } }).catch(() => null)
  return u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || req.user.email : req.user.email
}
function fail(res: any, err: unknown, what: string) {
  if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
  if (err instanceof SubError) { res.status(err.status).json({ success: false, error: err.message }); return }
  console.error(`[lien-addenda] ${what}:`, err)
  res.status(500).json({ success: false, error: `Could not ${what}` })
}

router.get('/', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const [{ list, older }, review] = await Promise.all([addendumCandidates(accountId), addendumReview(accountId)])
    const rows = await prisma.lienNoticeAddendum.findMany({ where: { accountId } })
    res.json({ success: true, data: {
      reviewed: review, older,
      list: list.map(c => { const r = rows.find(x => x.quoteId === c.quoteId) ?? null; return { ...c, state: stateOf(r, !!review), addendum: r ? summaryOf(r) : null } }),
    } })
  } catch (err) { fail(res, err, 'read the lien notice addenda') }
})

/** The owner marks the addendum reviewed by an attorney (or takes the mark off): only then can it be sent or shown. */
router.post('/reviewed', express.json({ limit: '4kb' }), async (req: any, res) => {
  try {
    if (roleOf(req) !== 'super_admin') throw new SubError(403, 'Only the owner can mark the addendum reviewed.')
    const b = z.object({ reviewed: z.boolean() }).parse(req.body)
    const was = await addendumReview(req.user.crmAccountId)
    const now = await setAddendumReview(req.user.crmAccountId, b.reviewed, { userId: req.user.id, name: await nameOf(req) })
    await audit(req, 'update', 'LienNoticeAddendumReview', req.user.crmAccountId, { oldValues: { reviewed: was }, newValues: { reviewed: now } })
    res.json({ success: true, data: { reviewed: now } })
  } catch (err) { fail(res, err, 'mark the addendum') }
})

router.get('/job/:jobId', async (req: any, res) => {
  try { res.json({ success: true, data: await addendumForJob(req.user.crmAccountId, String(req.params.jobId)) }) } catch (err) { fail(res, err, 'read the lien notice addendum') }
})

router.post('/job/:jobId/send', express.json({ limit: '4kb' }), async (req: any, res) => {
  try {
    const b = z.object({ channel: z.enum(['email', 'text', 'copy']) }).parse(req.body)
    const out = await sendAddendum(req.user.crmAccountId, String(req.params.jobId), b.channel, await nameOf(req))
    await audit(req, 'update', 'LienNoticeAddendum', out.addendum.id, { newValues: { jobId: String(req.params.jobId), channel: b.channel, sent: out.sent, how: out.how } })
    res.json({ success: true, data: { ...out, view: await addendumForJob(req.user.crmAccountId, String(req.params.jobId)) } })
  } catch (err) { fail(res, err, 'send the lien notice addendum') }
})

export default router
