/**
 * Warranties on jobs, at /api/warranties (lib/warranties.ts). Staff only.
 *
 *   GET  /job/:jobId                   the job's warranty: name, words, start (install date) and end,
 *                                      and each service or warranty call on the job, covered or not
 *   POST /service/:appointmentId/override  { covered: true | false | null, reason } staff decide a
 *                                      call is covered or not (null: back to the warranty's dates)
 *   GET  /quote/:quoteId/contract.pdf  the signed contract with the accepted option's warranty
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

export default router
