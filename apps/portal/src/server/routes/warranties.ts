/**
 * Warranties on jobs, at /api/warranties (lib/warranties.ts). Staff only.
 *
 *   GET  /job/:jobId                   the job's warranty: name, words, start (install date) and end,
 *                                      and each service or warranty call on the job, covered or not
 *   POST /service/:appointmentId/override  { covered: true | false | null, reason } staff decide a
 *                                      call is covered or not (null: back to the warranty's dates)
 *   GET  /quote/:quoteId/contract.pdf  the signed contract with the accepted option's warranty
 *   GET  /quote/:quoteId/update        "Send updated warranty": what it would send (each option's
 *                                      warranty now and before) and the last one sent
 *   POST /quote/:quoteId/update        make it (a new customer link, /p/wu/<link>), or give back the
 *                                      last one when it would be the same (lib/warrantyUpdates.ts)
 *   POST /update/:id/sent              { channel: text | email | copy } staff sent it from their phone
 *
 * Settings → Warranties themselves are saved with the rest of Settings
 * (business-state config.warranties, settings.change, the change log).
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { requireCan } from '../lib/permissions.js'
import { plainZod } from '../lib/plainZod.js'
import { audit } from '../lib/auditLog.js'
import { jobWarranty, SERVICE_TYPES } from '../lib/warranties.js'
import { contractForQuote, CONTRACT_SELECT } from '../lib/contractPdf.js'
import { previewUpdate, createUpdate, markSent, summaryOf } from '../lib/warrantyUpdates.js'
import { makePreviewToken } from '../lib/proposalViews.js'

const router = Router()
router.use(requireUser, requireAccount)

router.get('/job/:jobId', async (req: any, res) => {
  try {
    const w = await jobWarranty(req.user.crmAccountId, String(req.params.jobId))
    if (!w) { res.status(404).json({ success: false, error: 'Job not found' }); return }
    res.json({ success: true, data: w })
  } catch (err) {
    console.error('[warranties] job:', err)
    res.status(500).json({ success: false, error: 'Could not read the warranty' })
  }
})

const overrideSchema = z.object({
  covered: z.boolean().nullable(),
  reason: z.string().trim().max(500),
}).refine(v => v.covered === null || v.reason.length > 0, { message: 'Please say why', path: ['reason'] })

router.post('/service/:appointmentId/override', requireCan('schedule.change'), async (req: any, res) => {
  try {
    const body = overrideSchema.parse(req.body)
    const accountId = req.user.crmAccountId
    const a = await prisma.appointment.findFirst({ where: { id: String(req.params.appointmentId), accountId }, select: { id: true, jobId: true, type: true, warrantyOverride: true } })
    if (!a || !a.jobId || !(SERVICE_TYPES as readonly string[]).includes(a.type)) { res.status(404).json({ success: false, error: 'Service call not found' }); return }
    const by = String(req.user.email || 'staff')
    const value = body.covered === null ? null : { covered: body.covered, reason: body.reason, by, at: new Date().toISOString() }
    // The version goes up, so a phone holding this appointment loads it again before its next save.
    await prisma.appointment.updateMany({ where: { id: a.id }, data: { warrantyOverride: value === null ? (null as any) : value, version: { increment: 1 } } })
    await audit(req, 'update', 'Appointment', a.id, { oldValues: { warrantyOverride: a.warrantyOverride }, newValues: { warrantyOverride: value } })
    res.json({ success: true, data: await jobWarranty(accountId, a.jobId) })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[warranties] override:', err)
    res.status(500).json({ success: false, error: 'Could not save' })
  }
})

router.get('/quote/:quoteId/contract.pdf', async (req: any, res) => {
  try {
    const q = await prisma.savedQuote.findFirst({ where: { id: String(req.params.quoteId), accountId: req.user.crmAccountId }, select: CONTRACT_SELECT })
    const pdf = q ? await contractForQuote(q) : null
    if (!pdf) { res.status(404).json({ success: false, error: 'This quote has no signed contract' }); return }
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline; filename="Signed contract.pdf"')
    res.setHeader('Cache-Control', 'private, no-store')
    res.end(pdf)
  } catch (err) {
    console.error('[warranties] contract:', err)
    res.status(500).json({ success: false, error: 'Could not make the contract' })
  }
})

// ── Send updated warranty (lib/warrantyUpdates.ts) ──

router.get('/quote/:quoteId/update', async (req: any, res) => {
  try {
    const p = await previewUpdate(req.user.crmAccountId, String(req.params.quoteId))
    if (!p) { res.status(404).json({ success: false, error: 'Quote not found' }); return }
    res.json({ success: true, data: { ...p, preview: makePreviewToken(req.user.id, p.quoteId) } })
  } catch (err) {
    console.error('[warranties] update preview:', err)
    res.status(500).json({ success: false, error: 'Could not read the warranty' })
  }
})

router.post('/quote/:quoteId/update', requireCan('quotes.change'), async (req: any, res) => {
  try {
    const me = await prisma.crmUser.findUnique({ where: { id: String(req.user.id) }, select: { firstName: true, lastName: true } }).catch(() => null)
    const name = `${me?.firstName || ''} ${me?.lastName || ''}`.trim() || String(req.user.email || 'Staff')
    const out = await createUpdate(req.user.crmAccountId, String(req.params.quoteId), { userId: req.user.id ?? null, name })
    if ('error' in out) { res.status(out.status).json({ success: false, error: out.error }); return }
    if (!out.reused) await audit(req, 'create', 'WarrantyUpdate', out.update.id, { newValues: { quoteId: out.update.quoteId, kind: out.update.kind, warrantyName: out.update.warrantyName } })
    res.status(out.reused ? 200 : 201).json({ success: true, data: { ...out.preview, latest: summaryOf(out.update), reused: out.reused, preview: makePreviewToken(req.user.id, out.update.quoteId) } })
  } catch (err) {
    console.error('[warranties] update create:', err)
    res.status(500).json({ success: false, error: 'Could not make the warranty update' })
  }
})

const sentSchema = z.object({ channel: z.enum(['text', 'email', 'copy']) })

router.post('/update/:id/sent', requireCan('quotes.change'), async (req: any, res) => {
  try {
    const { channel } = sentSchema.parse(req.body)
    const u = await markSent(req.user.crmAccountId, String(req.params.id), channel)
    if (!u) { res.status(404).json({ success: false, error: 'Warranty update not found' }); return }
    res.json({ success: true, data: summaryOf(u) })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[warranties] update sent:', err)
    res.status(500).json({ success: false, error: 'Could not save' })
  }
})

export default router
