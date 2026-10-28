/**
 * Follow ups: /api/follow-ups (see lib/followUps.ts).
 *
 *   GET  /settings            steps per stage and text templates (everyone signed in)
 *   PUT  /settings            change them (settings.change)
 *   GET  /board               every card's follow up badge, for the pipeline (everyone)
 *   GET  /list?rep=<userId>   the Follow ups screen: a salesman gets only their own
 *                             cards; the owner and office everyone, or one rep
 *                             (opened24h: proposals a customer opened in the last day)
 *   POST /calls               an answer to "How'd it go?" or Log a call (id from the phone; sent again is one row)
 *   PUT  /cards/:id/next      one tap to change the next date ({ dueOn } or { keep: true })
 *   GET  /history             one customer's history (?customerId=&cardId=)
 *   GET  /report?from=&to=    done vs missed per rep, touches to close, dollars with no follow up
 *   GET  /pending             a call started from the app and not answered yet (this person)
 *   PUT  /pending             one was just started; DELETE /pending: skipped
 *   GET  /first-follow-up     how many open cards in stages that need a follow up have none, by owner
 *   POST /first-follow-up     set one on each, due tomorrow (settings.change, with the count shown)
 */

import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { resolveSecret } from '../lib/secrets.js'
import { requireCan, roleOf, can } from '../lib/permissions.js'
import { plainZod } from '../lib/plainZod.js'
import { audit } from '../lib/auditLog.js'
import { auditSettingChange } from '../lib/settingsAudit.js'
import {
  loadConfig, saveConfig, cardRows, followUpList, logCall, changeNext, customerHistory, followUpReport,
  firstFollowUpPreview, runFirstFollowUp, floridaDay,
} from '../lib/followUps.js'
import { addDays, isDay } from '../lib/followUpRules.js'
import { toTable } from '../lib/listTable.js'

const router = Router()
const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

async function requireUser(req: any, res: any, next: any) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any
    let crmAccountId: string | null = payload.crmAccountId ?? null
    if (!crmAccountId) {
      const u = await prisma.crmUser.findUnique({ where: { id: payload.sub }, select: { crmAccountId: true } })
      crmAccountId = u?.crmAccountId ?? null
    }
    if (!crmAccountId) { res.status(403).json({ success: false, error: 'No tenant' }); return }
    const name = `${payload.firstName ?? ''} ${payload.lastName ?? ''}`.trim() || String(payload.email ?? 'Staff')
    req.user = { id: payload.sub, email: payload.email, role: payload.role, crmAccountId, name }
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
}
router.use(requireUser)

const fail = (res: any, err: unknown, what: string) => {
  if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
  const status = Number((err as any)?.status)
  if (status >= 400 && status < 500) { res.status(status).json({ success: false, error: String((err as Error).message) }); return }
  console.error(`[follow-ups] ${what}:`, err)
  res.status(500).json({ success: false, error: `Could not ${what}. Try again.` })
}

// ── Settings ──

router.get('/settings', async (req: any, res) => {
  try {
    const s = await loadConfig(req.user.crmAccountId)
    res.json({ success: true, data: s.config, version: s.version })
  } catch (err) { fail(res, err, 'load the follow up settings') }
})

router.put('/settings', requireCan('settings.change'), async (req: any, res) => {
  try {
    const base = Number(req.body?.baseVersion)
    if (!Number.isInteger(base) || base < 0) { res.status(400).json({ success: false, error: 'Missing baseVersion.' }); return }
    const before = await loadConfig(req.user.crmAccountId)
    let saved
    try { saved = await saveConfig(req.user.crmAccountId, req.body, base, req.user.id) } catch (e) { res.status(400).json({ success: false, error: String((e as Error).message) }); return }
    if (!saved) {
      const now = await loadConfig(req.user.crmAccountId)
      res.status(409).json({ success: false, code: 'STALE', error: 'Someone else changed these settings. Your screen now shows theirs; make your change again.', data: now.config, version: now.version })
      return
    }
    await audit(req, 'update', 'FollowUpSettings', req.user.crmAccountId, { newValues: { stages: Object.keys(saved.config.steps), templates: saved.config.templates.length } })
    await auditSettingChange(req, 'follow-ups/settings', before.config, saved.config, { version: saved.version })
    res.json({ success: true, data: saved.config, version: saved.version })
  } catch (err) { fail(res, err, 'save the follow up settings') }
})

// ── The pipeline's badges ──

router.get('/board', async (req: any, res) => {
  try {
    const { rows, today } = await cardRows(req.user.crmAccountId)
    const card = (r: (typeof rows)[number]) => ({ dueOn: r.dueOn, dueKind: r.dueKind, status: r.status, days: r.days, badge: r.badge, stepIndex: r.stepIndex, stepCount: r.stepCount, lastOutcome: r.lastOutcome, lastContactAt: r.lastContactAt, ownerName: r.ownerName, state: r.state, opened: r.opened })
    // ?shape=table: the cards as one table, the field names once (lib/listTable.ts; web followUpStore.ts turns it
    // back into the same cards). Every card of the board is here, so the names were most of the 0.7 MB (audit #17).
    if (req.query.shape === 'table') {
      const table = toTable(rows.map(r => ({ id: r.cardId, ...card(r) })))
      if (table) { res.json({ success: true, data: { today, cards: table } }); return }
    }
    const cards: Record<string, unknown> = {}
    for (const r of rows) cards[r.cardId] = card(r)
    res.json({ success: true, data: { today, cards } })
  } catch (err) { fail(res, err, 'load the follow ups') }
})

// ── The Follow ups screen ──

router.get('/list', async (req: any, res) => {
  try {
    const rep = typeof req.query.rep === 'string' && req.query.rep ? req.query.rep : null
    const out = await followUpList(req.user.crmAccountId, { id: req.user.id, role: roleOf(req) }, rep)
    res.json({ success: true, data: out })
  } catch (err) { fail(res, err, 'load the follow ups') }
})

// ── Answers ──

const callSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'The answer needs an id.'),
  cardId: z.string().min(1).max(120),
  channel: z.enum(['call', 'text', 'other']).default('call'),
  outcome: z.enum(['no_answer', 'voicemail', 'deciding', 'not_now', 'booked', 'signed', 'lost']),
  lostReason: z.enum(['price', 'competitor', 'not_needed', 'other']).nullable().optional(),
  note: z.string().max(1000).optional(),
  pickedOn: z.string().nullable().optional(),
  at: z.string().nullable().optional(),
})

router.post('/calls', async (req: any, res) => {
  try {
    const input = callSchema.parse(req.body)
    if (input.outcome === 'not_now' && !(isDay(input.pickedOn) && input.pickedOn > floridaDay(new Date(Date.now() - 2 * 86_400_000)))) {
      res.status(400).json({ success: false, error: 'Pick the day to call back.' }); return
    }
    if (input.outcome === 'lost' && !input.lostReason) { res.status(400).json({ success: false, error: 'Pick why it was lost.' }); return }
    const r = await logCall(req.user.crmAccountId, { id: req.user.id, name: req.user.name }, input)
    if (!r.already) await audit(req, 'create', 'CallLog', input.id, { newValues: { cardId: input.cardId, channel: input.channel, outcome: input.outcome, nextFollowUpOn: r.state.dueOn } })
    res.status(r.already ? 200 : 201).json({ success: true, data: { log: r.log, state: r.state } })
  } catch (err) { fail(res, err, 'save the answer') }
})

const nextSchema = z.object({ dueOn: z.string().nullable().optional(), keep: z.boolean().optional() })

router.put('/cards/:cardId/next', async (req: any, res) => {
  try {
    const body = nextSchema.parse(req.body ?? {})
    if (!body.keep && body.dueOn != null && !isDay(body.dueOn)) { res.status(400).json({ success: false, error: 'Pick a day.' }); return }
    const state = await changeNext(req.user.crmAccountId, req.user.id, String(req.params.cardId), body)
    await audit(req, 'update', 'CardFollowUp', String(req.params.cardId), { newValues: { dueOn: state.dueOn, keep: !!body.keep } })
    res.json({ success: true, data: state })
  } catch (err) { fail(res, err, 'change the date') }
})

// ── History and report ──

router.get('/history', async (req: any, res) => {
  try {
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : null
    const cardId = typeof req.query.cardId === 'string' ? req.query.cardId : null
    if (customerId) {
      const c = await prisma.crmContact.findFirst({ where: { id: customerId, accountId: req.user.crmAccountId, deletedAt: null }, select: { id: true } }).catch(() => null)
      if (!c) { res.json({ success: true, data: await customerHistory(req.user.crmAccountId, { cardId }) }); return }
    }
    // A login that does not see prices (the Installer) gets the payments without their amounts.
    res.json({ success: true, data: await customerHistory(req.user.crmAccountId, { customerId, cardId, prices: can(roleOf(req), 'prices.view') }) })
  } catch (err) { fail(res, err, 'load the history') }
})

router.get('/report', async (req: any, res) => {
  try {
    const today = floridaDay(new Date())
    const to = isDay(req.query.to) ? req.query.to : today
    const from = isDay(req.query.from) && req.query.from <= to ? req.query.from : addDays(to, -29)
    res.json({ success: true, data: await followUpReport(req.user.crmAccountId, { id: req.user.id, role: roleOf(req) }, from, to) })
  } catch (err) { fail(res, err, 'make the report') }
})

// ── A call started from the app ──

/** Asked about for this long after it started. */
const PENDING_FOR_MS = 3 * 3600_000

router.get('/pending', async (req: any, res) => {
  try {
    const p = await prisma.pendingTouch.findUnique({ where: { userId: req.user.id } })
    const live = p && p.accountId === req.user.crmAccountId && Date.now() - p.startedAt.getTime() < PENDING_FOR_MS
    res.json({ success: true, data: live ? p : null })
  } catch (err) { fail(res, err, 'check for a call') }
})

const pendingSchema = z.object({ cardId: z.string().min(1).max(120), crmContactId: z.string().max(120).nullable().optional(), channel: z.enum(['call', 'text']).default('call'), name: z.string().max(120).default('') })

router.put('/pending', async (req: any, res) => {
  try {
    const b = pendingSchema.parse(req.body)
    const data = { accountId: req.user.crmAccountId, cardId: b.cardId, crmContactId: b.crmContactId ?? null, channel: b.channel, name: b.name, startedAt: new Date() }
    await prisma.pendingTouch.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id, ...data }, update: data })
    res.json({ success: true })
  } catch (err) { fail(res, err, 'note the call') }
})

router.delete('/pending', async (req: any, res) => {
  try {
    await prisma.pendingTouch.deleteMany({ where: { userId: req.user.id } })
    res.json({ success: true })
  } catch (err) { fail(res, err, 'clear the call') }
})

// ── Item j: the first follow up on open cards ──

router.get('/first-follow-up', async (req: any, res) => {
  try {
    const p = await firstFollowUpPreview(req.user.crmAccountId)
    res.json({ success: true, data: { count: p.count, dueOn: p.dueOn, byOwner: p.byOwner } })
  } catch (err) { fail(res, err, 'count the cards') }
})

router.post('/first-follow-up', requireCan('settings.change'), async (req: any, res) => {
  try {
    const p = await firstFollowUpPreview(req.user.crmAccountId)
    // The count the owner saw and confirmed: if it changed meanwhile, show the new one first.
    if (Number(req.body?.confirmCount) !== p.count) {
      res.status(409).json({ success: false, code: 'COUNT_CHANGED', error: `The count is now ${p.count}. Check it and confirm again.`, data: { count: p.count, dueOn: p.dueOn, byOwner: p.byOwner } })
      return
    }
    const r = await runFirstFollowUp(req.user.crmAccountId)
    await audit(req, 'update', 'CardFollowUp', 'first-follow-up', { newValues: { set: r.set, dueOn: r.dueOn } })
    res.json({ success: true, data: r })
  } catch (err) { fail(res, err, 'set the first follow ups') }
})

export default router
