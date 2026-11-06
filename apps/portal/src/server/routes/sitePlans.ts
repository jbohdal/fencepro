/**
 * The office site plan of a job (lib/sitePlans.ts):
 *
 *   GET    /api/site-plans/:jobId                 the plan, its revisions, the job, the quote's layout, Settings
 *   PUT    /api/site-plans/:jobId                 { plan, baseRevision, note? } → { revision, updatedAt }; 409 when saved since
 *   POST   /api/site-plans/:jobId/done            { revision } → done; 409 while a flag is open
 *   DELETE /api/site-plans/:jobId/done            reopen
 *   POST   /api/site-plans/:jobId/survey          the survey (JPEG, PNG or PDF bytes) → { url, w, h }
 *   GET    /api/site-plans/:jobId/survey/:file    that picture
 *   POST   /api/site-plans/:jobId/permit-sheet    { size, aerial } → { url } (the PDF, kept with the job)
 *   GET    /api/site-plans/:jobId/permit-sheet.pdf the latest permit sheet
 *   GET    /api/parcels?lat=&lng=&county=         the county's parcel at a spot and its neighbors (lib/parcels.ts)
 *
 * The owner and the office change plans; a Salesman reads the plans of the
 * Salesman's own jobs; the Installer gets a 403 (the crew reads the plan on
 * the install packet).
 */

import { Router } from 'express'
import express from 'express'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { plainZod } from '../lib/plainZod.js'
import { roleOf } from '../lib/permissions.js'
import {
  planAccess, planPayload, planSchemaFor, savePlan, markDone, reopen, nameOf, PlanConflict, surveyFileOf, surveyUrl, planDir,
  SURVEY_FILE, editsPlans, sitePlanSettings, siteModule, chosenStyleOf,
} from '../lib/sitePlans.js'
import { parcelsAt } from '../lib/parcels.js'
import { renderPermitSheet } from '../lib/sitePlanSheet.js'
import { contractorOf } from '../lib/automations/permits.js'
import { plainStyleName } from '../lib/estimates.js'
import { floridaDay, countyOf } from '../lib/automations/context.js'
import { usDate } from '../lib/installDays.js'
import { tiles } from './aerialTiles.js'

const run = promisify(execFile)
export const sitePlanRoutes = Router()
export const parcelRoutes = Router()
sitePlanRoutes.use(requireUser, requireAccount)
parcelRoutes.use(requireUser, requireAccount)

const fail = (res: any, err: unknown, what: string) => {
  console.error(`[site-plans] ${what}:`, err)
  if (!res.headersSent) res.status(500).json({ success: false, error: `Could not ${what}. Try again.` })
}

sitePlanRoutes.get('/:jobId', async (req: any, res) => {
  try {
    const a = await planAccess(req, res, String(req.params.jobId))
    if (!a) return
    res.json({ success: true, data: await planPayload(req.user.crmAccountId, a.job, a.canEdit) })
  } catch (err) { fail(res, err, 'open the site plan') }
})

const putBody = z.object({ plan: z.unknown(), baseRevision: z.number().int().min(0), note: z.string().max(500).optional() })

sitePlanRoutes.put('/:jobId', express.json({ limit: '6mb' }), async (req: any, res) => {
  try {
    const a = await planAccess(req, res, String(req.params.jobId))
    if (!a) return
    if (!a.canEdit) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: 'Only the office changes site plans.' }); return }
    const body = putBody.parse(req.body)
    const plan = planSchemaFor(a.job.id).parse(body.plan)
    const accountId = req.user.crmAccountId
    if (plan.survey && !surveyFileOf(accountId, a.job.id, plan.survey.url)) { res.status(400).json({ success: false, error: 'The survey picture is not on this job any more. Upload it again.' }); return }
    try {
      const out = await savePlan(accountId, a.job, plan, body.baseRevision, await nameOf(req), body.note ?? '')
      res.json({ success: true, data: out })
    } catch (e) {
      if (!(e instanceof PlanConflict)) throw e
      res.status(409).json({ success: false, error: `${e.message} Your changes are not saved: the plan as it is now is loaded.`, current: await planPayload(accountId, a.job, a.canEdit) })
    }
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    fail(res, err, 'save the site plan')
  }
})

sitePlanRoutes.post('/:jobId/done', express.json({ limit: '8kb' }), async (req: any, res) => {
  try {
    const a = await planAccess(req, res, String(req.params.jobId))
    if (!a) return
    if (!a.canEdit) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: 'Only the office marks a site plan done.' }); return }
    const { revision } = z.object({ revision: z.number().int().min(0) }).parse(req.body)
    const accountId = req.user.crmAccountId
    let out
    try { out = await markDone(accountId, a.job, revision, await nameOf(req)) } catch (e) {
      if (!(e instanceof PlanConflict)) throw e
      out = { ok: false as const, status: 409, error: e.message }
    }
    if (!out.ok) {
      res.status(out.status).json({ success: false, error: out.error, ...(out.open ? { open: out.open } : {}), ...(out.open ? {} : { current: await planPayload(accountId, a.job, a.canEdit) }) })
      return
    }
    res.json({ success: true, data: { doneAt: out.doneAt } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    fail(res, err, 'mark the site plan done')
  }
})

sitePlanRoutes.delete('/:jobId/done', async (req: any, res) => {
  try {
    const a = await planAccess(req, res, String(req.params.jobId))
    if (!a) return
    if (!a.canEdit) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: 'Only the office reopens a site plan.' }); return }
    if (!(await reopen(req.user.crmAccountId, a.job))) { res.status(404).json({ success: false, error: 'This job has no site plan yet.' }); return }
    res.json({ success: true, data: { doneAt: null } })
  } catch (err) { fail(res, err, 'reopen the site plan') }
})

// ── The survey ──

const SURVEY_TYPES = ['image/jpeg', 'image/png', 'application/pdf']
const MAX_SURVEY = 20 * 1024 * 1024

/** A PNG's or JPEG's size in pixels from its header, or null. */
export function pictureSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) }
      i += 2 + len
    }
  }
  return null
}

const rawSurvey = express.raw({ type: () => true, limit: MAX_SURVEY })

sitePlanRoutes.post('/:jobId/survey', (req: any, res, next) => {
  rawSurvey(req, res, (err?: any) => {
    if (err?.type === 'entity.too.large') { res.status(413).json({ success: false, error: 'The survey is over 20 MB. Save a smaller copy and upload that.' }); return }
    next(err)
  })
}, async (req: any, res) => {
  try {
    const a = await planAccess(req, res, String(req.params.jobId))
    if (!a) return
    if (!a.canEdit) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: 'Only the office adds a survey.' }); return }
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    const body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (!SURVEY_TYPES.includes(type)) { res.status(415).json({ success: false, error: 'Send the survey as a JPEG, PNG or PDF.' }); return }
    if (!body.length) { res.status(400).json({ success: false, error: 'The survey file was empty.' }); return }
    const dir = planDir(req.user.crmAccountId, a.job.id)
    const id = crypto.randomUUID()
    let file = `${id}.${type === 'image/jpeg' ? 'jpg' : 'png'}`
    const out = path.join(dir, file)
    if (type === 'application/pdf') {
      if (body.toString('latin1', 0, 5) !== '%PDF-') { res.status(400).json({ success: false, error: 'That file is not a PDF.' }); return }
      const pdf = path.join(dir, `${id}.pdf`)
      fs.writeFileSync(pdf, body)
      try {
        // The survey's first page as a picture, 3000 px on its long side so its dimensions read (macOS sips; no shell).
        await run('sips', ['-s', 'format', 'png', '-Z', '3000', pdf, '--out', out], { timeout: 60_000 })
      } catch (e) {
        fs.rmSync(out, { force: true })
        console.warn('[site-plans] survey PDF:', (e as Error).message)
        res.status(422).json({ success: false, error: 'This PDF could not be made into a picture on the server. Save the survey page as a JPEG or PNG (a phone photo of it works) and upload that.' })
        return
      } finally { fs.rmSync(pdf, { force: true }) }
      file = `${id}.png`
    } else {
      fs.writeFileSync(out, body)
    }
    const size = pictureSize(fs.readFileSync(out))
    if (!size || size.w < 1 || size.h < 1) { fs.rmSync(out, { force: true }); res.status(400).json({ success: false, error: 'That picture could not be read. Save it again as a JPEG or PNG and upload it.' }); return }
    res.json({ success: true, data: { url: surveyUrl(a.job.id, file), w: size.w, h: size.h } })
  } catch (err) { fail(res, err, 'save the survey') }
})

sitePlanRoutes.get('/:jobId/survey/:file', async (req: any, res) => {
  try {
    const a = await planAccess(req, res, String(req.params.jobId))
    if (!a) return
    const file = String(req.params.file)
    const full = SURVEY_FILE.test(file) ? surveyFileOf(req.user.crmAccountId, a.job.id, surveyUrl(a.job.id, file)) : null
    if (!full) { res.status(404).json({ success: false, error: 'That survey is not there.' }); return }
    res.setHeader('Content-Type', file.endsWith('.png') ? 'image/png' : 'image/jpeg')
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    fs.createReadStream(full).pipe(res)
  } catch (err) { fail(res, err, 'open the survey') }
})

// ── The permit sheet ──

sitePlanRoutes.post('/:jobId/permit-sheet', express.json({ limit: '8kb' }), async (req: any, res) => {
  try {
    const a = await planAccess(req, res, String(req.params.jobId))
    if (!a) return
    if (!a.canEdit) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: 'Only the office makes the permit sheet.' }); return }
    const b = z.object({ size: z.enum(['letter', 'tabloid']).default('letter'), aerial: z.boolean().default(false) }).parse(req.body ?? {})
    const accountId = req.user.crmAccountId
    const row = await prisma.sitePlan.findUnique({ where: { jobId: a.job.id } })
    if (!row || row.accountId !== accountId) { res.status(409).json({ success: false, error: 'Save the plan first.' }); return }
    const plan = row.data as any
    if (!plan?.sides?.length) { res.status(409).json({ success: false, error: 'Draw the fence on the plan first.' }); return }
    const [rev, quote, permit, company, m] = await Promise.all([
      prisma.sitePlanRevision.findFirst({ where: { planId: row.id, revision: row.revision }, select: { by: true } }),
      a.job.quoteId ? prisma.savedQuote.findFirst({ where: { id: a.job.quoteId, accountId }, select: { fenceStyle: true, chosenOption: true, proposal: true } }) : null,
      prisma.permit.findUnique({ where: { jobId: a.job.id }, select: { parcelId: true, county: true } }),
      contractorOf(accountId),
      siteModule(),
    ])
    const style = chosenStyleOf(quote as any) || a.job.fenceStyle
    const { pdf, note } = await renderPermitSheet(m, {
      size: b.size, plan, revision: row.revision, drawnBy: rev?.by || 'Office',
      date: usDate(floridaDay(new Date())),
      company: { name: company.name, address: company.address, phone: company.phone },
      customerName: a.job.customerName, address: a.job.customerAddress,
      county: countyOf(a.job.customerAddress, permit?.county) || permit?.county || 'Marion',
      parcelId: plan.parcel?.id || permit?.parcelId || '',
      fenceText: (await plainStyleName(style)) || style,
      aerial: b.aerial ? async (z, x, y) => (await tiles.naip(z, x, y)).body : null,
    })
    const file = path.join(planDir(accountId, a.job.id), `permit-sheet-r${row.revision}-${Date.now()}.pdf`)
    fs.writeFileSync(file, pdf)
    await prisma.sitePlan.update({ where: { id: row.id }, data: { permitPdfPath: file } })
    res.json({ success: true, data: { url: `/api/site-plans/${encodeURIComponent(a.job.id)}/permit-sheet.pdf`, ...(note ? { note } : {}) } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    fail(res, err, 'make the permit sheet')
  }
})

sitePlanRoutes.get('/:jobId/permit-sheet.pdf', async (req: any, res) => {
  try {
    const a = await planAccess(req, res, String(req.params.jobId))
    if (!a) return
    const row = await prisma.sitePlan.findUnique({ where: { jobId: a.job.id }, select: { accountId: true, permitPdfPath: true } })
    const file = row && row.accountId === req.user.crmAccountId ? row.permitPdfPath : null
    if (!file || !fs.existsSync(file)) { res.status(404).json({ success: false, error: 'No permit sheet was made for this plan yet.' }); return }
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="site-plan-${(a.job.customerName || 'job').replace(/[^a-z0-9]+/gi, '-')}.pdf"`)
    res.setHeader('Cache-Control', 'private, no-store')
    fs.createReadStream(file).pipe(res)
  } catch (err) { fail(res, err, 'open the permit sheet') }
})

// ── Property lines ──

parcelRoutes.get('/', async (req: any, res) => {
  try {
    if (!editsPlans(roleOf(req))) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: 'Property lines are for the office\'s site plans.' }); return }
    const lat = Number(req.query.lat), lng = Number(req.query.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { res.status(400).json({ success: false, error: 'Give a spot on the map (lat and lng).' }); return }
    const s = await sitePlanSettings(req.user.crmAccountId)
    res.json({ success: true, data: await parcelsAt({ lat, lng }, String(req.query.county || 'Marion').slice(0, 60), s.parcelSources) })
  } catch (err) { fail(res, err, 'look up the property lines') }
})
