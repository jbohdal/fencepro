/**
 * "Send feedback" from inside the app, at /api/feedback.
 *
 *   POST   /                 any signed-in staff: one feedback, with an
 *                            optional screenshot (a JPEG data URL). The id is
 *                            chosen on the phone and the send comes from the
 *                            save queue, so it may arrive more than once: a
 *                            repeat answers with the one already saved.
 *   GET    /                 owner/admin: the list, newest first
 *   PATCH  /:id              owner/admin: { status: new | seen | done | needs_jonathan }
 *                            (New, Looked at, Fixed, Needs Jonathan)
 *   GET    /:id/screenshot   owner/admin: the screenshot image
 *
 * Each feedback also keeps the screen's name, the record the screen or its
 * open window was on (from the page address: lib/feedbackModel.ts; its name is
 * looked up here, in the sender's company only), and the app's version.
 *
 * Screenshots are files under UPLOAD_DIR/feedback/<accountId>/<id>.jpg. A new
 * feedback puts a notification in the owner's and admins' bell.
 *
 * Read it from a terminal: scripts/feedback-report.ts (GO_LIVE.md).
 */

import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { plainZod } from '../lib/plainZod.js'
import { FEEDBACK_STATUSES, recordFromAddress, recordText, type FeedbackRecordRef } from '../lib/feedbackModel.js'

const router = Router()
router.use(requireUser, requireAccount)

export const FEEDBACK_ADMIN_ROLES = new Set(['super_admin', 'admin'])
const STATUSES = FEEDBACK_STATUSES
/** A screenshot is at most this big once decoded (the phone sends ~100-500 KB). */
const MAX_SHOT_BYTES = 5 * 1024 * 1024

export const feedbackDir = (accountId: string) => path.resolve(process.env.UPLOAD_DIR || './uploads', 'feedback', accountId)

const idSchema = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Invalid id')
const createSchema = z.object({
  id: idSchema,
  text: z.string().max(5000).default(''),
  path: z.string().max(2000).default(''),
  screen: z.string().max(100).default(''),
  userAgent: z.string().max(1000).default(''),
  appFile: z.string().max(300).nullable().optional(),
  screenshot: z.string().max(8_000_000).regex(/^data:image\/jpeg;base64,/, 'The screenshot must be a JPEG').nullable().optional(),
  errors: z.array(z.object({ at: z.string().max(40), message: z.string().max(500) })).max(10).default([]),
  screenTitle: z.string().max(200).default(''),
  appVersion: z.string().max(100).default(''),
})

const isAdmin = (req: any) => FEEDBACK_ADMIN_ROLES.has(String(req.user?.role))
function adminOnly(req: any, res: any, next: any) {
  if (!isAdmin(req)) { res.status(403).json({ success: false, error: 'Only the owner or an admin can see feedback.' }); return }
  next()
}

function view(f: any) {
  return {
    id: f.id, userId: f.userId, userName: f.userName, role: f.role, path: f.path, screen: f.screen,
    userAgent: f.userAgent, appFile: f.appFile, text: f.text, errors: f.errors, status: f.status,
    statusAt: f.statusAt, statusBy: f.statusBy, createdAt: f.createdAt, hasScreenshot: !!f.screenshotPath,
    screenTitle: f.screenTitle ?? '', recordType: f.recordType ?? '', recordId: f.recordId ?? '', recordName: f.recordName ?? '',
    appVersion: f.appVersion ?? '',
  }
}

const personName = (first?: string | null, last?: string | null) => `${first ?? ''} ${last ?? ''}`.trim()

/** The record's name, looked up in this company only ("" when it is not found). */
export async function recordName(accountId: string, ref: FeedbackRecordRef): Promise<string> {
  try {
    switch (ref.type) {
      case 'customer': {
        const c = await prisma.crmContact.findFirst({ where: { id: ref.id, accountId }, select: { firstName: true, lastName: true } })
        return c ? personName(c.firstName, c.lastName) : ''
      }
      case 'quote': {
        const q = await prisma.savedQuote.findFirst({ where: { id: ref.id, accountId }, select: { customerName: true } })
        return q?.customerName ?? ''
      }
      case 'job': {
        const j = await prisma.savedJob.findFirst({ where: { id: ref.id, accountId }, select: { customerName: true } })
        return j?.customerName ?? ''
      }
      case 'change_order': {
        const co = await prisma.changeOrder.findFirst({ where: { id: ref.id, accountId }, select: { number: true, quoteId: true } })
        if (!co) return ''
        const q = await prisma.savedQuote.findFirst({ where: { id: co.quoteId, accountId }, select: { customerName: true } })
        return `CO-${co.number}${q?.customerName ? ` for ${q.customerName}` : ''}`
      }
      case 'card': {
        const rows = await prisma.$queryRaw<Array<{ first: string | null; last: string | null }>>`
          SELECT l->>'firstName' AS first, l->>'lastName' AS last
          FROM "PipelineState" s, jsonb_array_elements(s.leads) l
          WHERE s."accountId" = ${accountId} AND l->>'id' = ${ref.id} LIMIT 1`
        return rows[0] ? personName(rows[0].first, rows[0].last) : ''
      }
      default:
        return ''
    }
  } catch (err) {
    console.error('[feedback] record name:', (err as Error).message)
    return ''
  }
}

async function nameOf(req: any): Promise<string> {
  const u = await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } }).catch(() => null)
  return (u ? `${u.firstName} ${u.lastName}`.trim() : '') || req.user.email || ''
}

const fail = (res: any, err: unknown, what: string) => {
  if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
  console.error(`[feedback] ${what}:`, err)
  res.status(500).json({ success: false, error: `Could not ${what}` })
}

router.post('/', async (req: any, res) => {
  try {
    const b = createSchema.parse(req.body)
    const accountId = req.user.crmAccountId as string
    const existing = await prisma.feedback.findUnique({ where: { id: b.id } })
    if (existing) {
      // A repeat from the save queue. An id from another company is never revealed.
      if (existing.accountId !== accountId) { res.status(409).json({ success: false, error: 'Please send it again.' }); return }
      res.json({ success: true, data: view(existing) }); return
    }

    let screenshotPath: string | null = null
    if (b.screenshot) {
      const buf = Buffer.from(b.screenshot.slice(b.screenshot.indexOf(',') + 1), 'base64')
      if (buf.length > MAX_SHOT_BYTES) { res.status(413).json({ success: false, error: 'The screenshot is too big.' }); return }
      if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) { res.status(400).json({ success: false, error: 'The screenshot is not a JPEG.' }); return }
      const dir = feedbackDir(accountId)
      fs.mkdirSync(dir, { recursive: true })
      screenshotPath = path.join(dir, `${b.id}.jpg`)
      // Written whole, then put in place: a repeat at the same moment writes the same picture.
      const tmp = `${screenshotPath}.${process.pid}.${Date.now()}.tmp`
      fs.writeFileSync(tmp, buf)
      fs.renameSync(tmp, screenshotPath)
    }

    const userName = await nameOf(req)
    const ref = recordFromAddress(b.path)
    const refName = ref ? await recordName(accountId, ref) : ''
    let row
    try {
      row = await prisma.feedback.create({
        data: {
          id: b.id, accountId, userId: req.user.id, userName, role: String(req.user.role || ''),
          path: b.path, screen: b.screen, userAgent: b.userAgent || String(req.headers['user-agent'] || '').slice(0, 1000),
          appFile: b.appFile || '', text: b.text.trim(), screenshotPath, errors: b.errors,
          screenTitle: b.screenTitle.trim(), appVersion: b.appVersion.trim(),
          recordType: ref?.type ?? '', recordId: ref?.id ?? '', recordName: refName,
        },
      })
    } catch (err) {
      // The same feedback arrived twice at once: the first one is kept.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const first = await prisma.feedback.findUnique({ where: { id: b.id } })
        if (first && first.accountId === accountId) { res.json({ success: true, data: view(first) }); return }
      }
      throw err
    }

    const snippet = row.text.length > 140 ? row.text.slice(0, 137) + '...' : row.text
    await prisma.notification.create({
      data: {
        recipientRole: 'admin', type: 'info', link: '/feedback',
        title: `Feedback from ${userName || 'someone'}`,
        body: `${snippet || '(no text, screenshot only)'}${row.screenTitle || row.path ? `  (on ${row.screenTitle || row.path.split('?')[0]}${row.recordType ? `, ${recordText(row.recordType, row.recordName)}` : ''})` : ''}`,
      },
    }).catch(err => console.error('[feedback] notification failed:', err))

    res.status(201).json({ success: true, data: view(row) })
  } catch (err) { fail(res, err, 'save the feedback') }
})

router.get('/', adminOnly, async (req: any, res) => {
  try {
    const status = typeof req.query.status === 'string' && (STATUSES as readonly string[]).includes(req.query.status) ? req.query.status : undefined
    const rows = await prisma.feedback.findMany({
      where: { accountId: req.user.crmAccountId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' }, take: 300,
    })
    res.json({ success: true, data: rows.map(view) })
  } catch (err) { fail(res, err, 'load feedback') }
})

router.patch('/:id', adminOnly, async (req: any, res) => {
  try {
    const { status } = z.object({ status: z.enum(STATUSES) }).parse(req.body)
    const f = await prisma.feedback.findUnique({ where: { id: String(req.params.id) } })
    if (!f || f.accountId !== req.user.crmAccountId) { res.status(404).json({ success: false, error: 'Feedback not found' }); return }
    const row = f.status === status ? f : await prisma.feedback.update({ where: { id: f.id }, data: { status, statusAt: new Date(), statusBy: await nameOf(req) } })
    res.json({ success: true, data: view(row) })
  } catch (err) { fail(res, err, 'change the feedback') }
})

router.get('/:id/screenshot', adminOnly, async (req: any, res) => {
  const f = await prisma.feedback.findUnique({ where: { id: String(req.params.id) } }).catch(() => null)
  if (!f || f.accountId !== req.user.crmAccountId || !f.screenshotPath || !fs.existsSync(f.screenshotPath)) { res.status(404).end(); return }
  res.setHeader('Content-Type', 'image/jpeg')
  res.setHeader('Cache-Control', 'private, max-age=86400')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  fs.createReadStream(f.screenshotPath).pipe(res)
})

export default router
