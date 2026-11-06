/**
 * Liens, the owner only (liens.manage; Jonathan, Nov 6 2026). lib/liens.ts.
 *
 *   GET  /api/liens                    open lien clocks; signed contracts over $2,500 without the 713.015 notice
 *   GET  /api/liens/job/:jobId         the job's clock, case and which papers are reviewed
 *   PUT  /api/liens/job/:jobId         the typed facts and the checklist
 *   POST /api/liens/job/:jobId/papers  make a paper (kind, how sent): kept on the job
 *   GET  /api/liens/job/:jobId/papers/:actionId   that paper's PDF
 */

import { Router } from 'express'
import express from 'express'
import fs from 'fs'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { requireCan } from '../lib/permissions.js'
import { audit } from '../lib/auditLog.js'
import { plainZod } from '../lib/plainZod.js'
import { getFilePath } from '../lib/storage/index.js'
import { floridaDay } from '../lib/automations/context.js'
import { SubError } from '../lib/subcontractors.js'
import { lienView, saveLienFacts, makePaper, clockOf, ffdOf, sampleWords, LIEN_KIND_LABEL, LIEN_DEADLINE_DAYS } from '../lib/liens.js'
import { plusDays } from '../lib/installDays.js'
import { clearedCover } from '../lib/paymentClearing.js'

type Json = any
const router = Router()
router.use(requireUser, requireAccount, requireCan('liens.manage'))

async function nameOf(req: any) {
  const u = await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } }).catch(() => null)
  return u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || req.user.email : req.user.email
}
function fail(res: any, err: unknown, what: string) {
  if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
  if (err instanceof SubError) { res.status(err.status).json({ success: false, error: err.message }); return }
  console.error(`[liens] ${what}:`, err)
  res.status(500).json({ success: false, error: `Could not ${what}` })
}

router.get('/', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const today = floridaDay(new Date())
    const jobs = (await prisma.savedJob.findMany({ where: { accountId, deletedAt: null, archivedAt: null, OR: [{ finalFurnishingDate: { not: null } }, { completedDate: { gte: plusDays(today, -LIEN_DEADLINE_DAYS - 365) } }] }, select: { id: true, customerName: true, customerAddress: true, finalFurnishingDate: true, completedDate: true } }))
      .map(j => ({ ...j, finalFurnishingDate: ffdOf(j) })).filter(j => j.finalFurnishingDate)
    const cases = jobs.length ? await prisma.lienCase.findMany({ where: { accountId, jobId: { in: jobs.map(j => j.id) } } }) : []
    const clocks = []
    for (const j of jobs) {
      const c = cases.find(x => x.jobId === j.id) ?? null
      const k = clockOf(j.finalFurnishingDate, await clearedCover(accountId, j.id), c, today)
      if (k.open || (c?.recordedOn && !c.releasedOn)) clocks.push({ jobId: j.id, customerName: j.customerName, address: j.customerAddress, ...k, recordedOn: c?.recordedOn ?? null, lastAction: (c?.actions as Json[] | undefined)?.slice(-1)[0] ?? null })
    }
    clocks.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999))
    // Signed contracts over $2,500 whose proposal did not carry Florida's 713.015 notice (signed before Nov 6 2026).
    // Only the ones that can still be acted on: work not finished yet (a signed notice can still be had before the
    // install); the rest are counted, not listed (Nov 6 2026 review: 537 old contracts were noise).
    const signed = await prisma.savedQuote.findMany({ where: { accountId, deletedAt: null, OR: [{ status: 'SOLD' }, { acceptedAt: { not: null } }] }, select: { id: true, customerName: true, customerAddress: true, finalPrice: true, proposal: true, acceptedAt: true, soldAt: true } })
    const missing = signed.filter(q => Math.round((q.finalPrice || 0) * 100) > 2_500_00 && !(q.proposal as Json)?.lienNotice)
    const open = missing.length ? await prisma.savedJob.findMany({ where: { accountId, deletedAt: null, archivedAt: null, quoteId: { in: missing.map(q => q.id) }, completedDate: null, status: { notIn: ['completed', 'invoiced', 'paid'] as Json } }, select: { quoteId: true } }) : []
    const noNotice = missing.filter(q => open.some(j => j.quoteId === q.id))
      .map(q => ({ quoteId: q.id, customerName: q.customerName, address: q.customerAddress, priceCents: Math.round((q.finalPrice || 0) * 100), signedOn: (q.acceptedAt ?? q.soldAt)?.toISOString().slice(0, 10) ?? null }))
    res.json({ success: true, data: { clocks, noNotice, noNoticeOlder: missing.length - noNotice.length } })
  } catch (err) { fail(res, err, 'read the liens') }
})

/** A paper's words with blanks, for the attorney to read before the owner marks it reviewed. */
router.get('/sample/:kind', async (req: any, res) => {
  try {
    const kind = z.enum(['reminder', 'notice_of_intent', 'claim_of_lien', 'final_affidavit', 'release']).parse(req.params.kind)
    res.json({ success: true, data: await sampleWords(req.user.crmAccountId, kind) })
  } catch (err) { fail(res, err, 'show the words') }
})

router.get('/job/:jobId', async (req: any, res) => {
  try { res.json({ success: true, data: await lienView(req.user.crmAccountId, String(req.params.jobId)) }) } catch (err) { fail(res, err, 'read the lien') }
})

router.put('/job/:jobId', express.json({ limit: '64kb' }), async (req: any, res) => {
  try {
    const d = z.string().nullable().optional()
    const b = z.object({
      legalDescription: z.string().max(4000).optional(), parcelId: z.string().max(60).optional(), furnished: z.string().max(500).optional(),
      notarizedOn: d, recordedOn: d, instrumentNumber: z.string().max(60).optional(), servedOn: d, serveMethod: z.string().max(80).optional(), serveTracking: z.string().max(80).optional(),
      contestOn: d, suitFiledOn: d,
      // The final furnishing date, typed by the owner (our own crew's job, or a correction).
      finalFurnishingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.body)
    if (b.finalFurnishingDate) {
      if (b.finalFurnishingDate > floridaDay(new Date())) throw new SubError(400, 'The final furnishing date is after today.')
      await prisma.savedJob.updateMany({ where: { id: String(req.params.jobId), accountId: req.user.crmAccountId }, data: { finalFurnishingDate: b.finalFurnishingDate } })
      delete (b as Json).finalFurnishingDate
    }
    const row = await saveLienFacts(req.user.crmAccountId, String(req.params.jobId), b)
    await audit(req, 'update', 'LienCase', row.id, { newValues: b })
    res.json({ success: true, data: await lienView(req.user.crmAccountId, String(req.params.jobId)) })
  } catch (err) { fail(res, err, 'save the lien') }
})

router.post('/job/:jobId/papers', express.json({ limit: '8kb' }), async (req: any, res) => {
  try {
    const b = z.object({ kind: z.enum(['reminder', 'notice_of_intent', 'claim_of_lien', 'final_affidavit', 'release']), how: z.string().max(120).default(''), note: z.string().max(500).default('') }).parse(req.body)
    const out = await makePaper(req.user.crmAccountId, String(req.params.jobId), b.kind, b.how, await nameOf(req), b.note)
    await audit(req, 'create', 'LienCase', String(req.params.jobId), { newValues: { paper: LIEN_KIND_LABEL[b.kind], how: b.how } })
    res.json({ success: true, data: { action: { ...out.action, documentPath: undefined }, view: await lienView(req.user.crmAccountId, String(req.params.jobId)) } })
  } catch (err) { fail(res, err, 'make the paper') }
})

router.get('/job/:jobId/papers/:actionId', async (req: any, res) => {
  try {
    const c = await prisma.lienCase.findFirst({ where: { accountId: req.user.crmAccountId, jobId: String(req.params.jobId) } })
    const a = ((c?.actions as Json[]) ?? []).find(x => x.id === req.params.actionId)
    const p = a?.documentPath ? getFilePath(a.documentPath) : ''
    if (!a || !p || !fs.existsSync(p)) throw new SubError(404, 'That paper is not there.')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${LIEN_KIND_LABEL[a.kind as keyof typeof LIEN_KIND_LABEL] ?? 'Lien paper'}.pdf"`)
    res.setHeader('Cache-Control', 'private, no-store')
    fs.createReadStream(p).pipe(res)
  } catch (err) { fail(res, err, 'open the paper') }
})

export default router
