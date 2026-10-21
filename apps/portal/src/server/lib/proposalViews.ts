/**
 * Proposal opens, one row per open (ProposalView). The rules are in
 * lib/proposalViewRules.ts; this file saves them and sends the push.
 *
 *   POST /p/<link>/view       the page's script, once it is on screen: starts
 *                             an open (a reload on the same device within 10
 *                             minutes is the same open) and returns its id
 *   POST /p/<link>/view/<id>  a heartbeat every 15 s and a last one as the
 *                             page closes (sendBeacon): time on screen, time
 *                             per option, whether the signature was reached
 *
 * Nothing is kept in the customer's browser: the open's id lives in the page's
 * memory only. A link preview or prefetch runs no script, so it is never an
 * open. The address is never stored, only a keyed hash of it.
 *
 * Staff opens are recorded, marked "Staff view", never counted in viewCount
 * and never pushed. Staff is told apart by (first that matches):
 *   1. a staff sign in on the request (Bearer token);
 *   2. the app's own preview link: the app adds ?sp=<signed, 15 minute token>
 *      when staff tap Open on a quote (routes/saved-quotes.ts share-token);
 *   3. the same device: the address and browser a staff login used the app
 *      from in the last day (lib/staffDevices.ts, in memory);
 *   4. the same device as a staff sign in session in the database (address and
 *      browser saved at sign in), for after a restart.
 * Limits: 3 and 4 need the same address and the same browser name; a staff
 * phone on another network (cell data vs the office Wi-Fi), or a different
 * browser than the one used for the app, is not recognised unless the link was
 * opened from the app (2). Two people on one Wi-Fi with the same phone model
 * and the same iOS version look like one device.
 *
 * The push (to the card's owner, through web push like the 7 am follow up
 * push): on the first customer open, and on an open two or more days after the
 * last one; Settings > Proposals "Tell me when a proposal is opened" (per
 * company, on unless turned off). Each is saved once under its key
 * (AutomationEffect) with the bell notification; on the dev copy it is logged,
 * never delivered (pushDeliveryAllowed). The automation worker also sends any
 * that were missed (a restart between the open and the push).
 */

import jwt from 'jsonwebtoken'
import type { Request } from 'express'
import prisma from './prisma.js'
import { resolveSecret, verifyStaffBearer } from './secrets.js'
import { clientIpOf, keyedHash, recentStaffOn } from './staffDevices.js'
import {
  BEAT_WINDOW_MS, REUSE_MS, deviceOf, isBot, mergeBeat, openTrigger, staffDecision,
  type Beat, type StaffHow,
} from './proposalViewRules.js'
import { peopleOf, pushDeliveryAllowed, type Person } from './followUps.js'
import { stopsSteps } from './followUpRules.js'
import { followUpStagesFor } from './followUps.js'

const secret = () => resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
const PREVIEW_PURPOSE = 'proposal-preview'
export const PREVIEW_MINUTES = 15
const SESSION_MATCH_DAYS = 14

// ── The app's preview link ───────────────────────────────────────────────────

/** Signed and short-lived: "this open is staff X, from the app, of this quote". */
export function makePreviewToken(userId: string, quoteId: string): string {
  return jwt.sign({ sub: userId, q: quoteId, purpose: PREVIEW_PURPOSE }, secret(), { expiresIn: `${PREVIEW_MINUTES}m` })
}

export function readPreviewToken(token: unknown, quoteId: string): { userId: string } | null {
  if (typeof token !== 'string' || !token || token.length > 2000) return null
  try {
    const p = jwt.verify(token, secret()) as any
    if (p?.purpose !== PREVIEW_PURPOSE || p.q !== quoteId || typeof p.sub !== 'string') return null
    return { userId: p.sub }
  } catch { return null }
}

// ── Staff or customer ────────────────────────────────────────────────────────

interface QuoteRow { id: string; accountId: string; crmContactId: string | null; ownerId: string | null; customerName: string; viewCount: number; firstViewedAt: Date | null; lastViewedAt: Date | null; acceptedAt: Date | null; proposal: unknown }

async function inAccount(userId: string, accountId: string): Promise<boolean> {
  const u = await prisma.crmUser.findUnique({ where: { id: userId }, select: { crmAccountId: true, status: true, role: true } }).catch(() => null)
  return !!u && u.crmAccountId === accountId && String(u.status) !== 'deleted' && !['customer', 'portal_customer'].includes(String(u.role))
}

export async function staffOf(req: Request, quote: { id: string; accountId: string }, previewToken: unknown, now = new Date()): Promise<{ staff: boolean; userId: string | null; how: StaffHow | null }> {
  const bearer = verifyStaffBearer(req)
  if (bearer && await inAccount(bearer.sub, quote.accountId)) return staffDecision({ bearer: { userId: bearer.sub } })
  const preview = readPreviewToken(previewToken, quote.id)
  if (preview && await inAccount(preview.userId, quote.accountId)) return staffDecision({ preview })
  const ip = clientIpOf(req), ua = String(req.headers['user-agent'] || '')
  const recent = recentStaffOn(ip, ua, now.getTime())
  if (recent && (!recent.accountId || recent.accountId === quote.accountId)) return staffDecision({ device: recent })
  if (ip && ua) {
    const s = await prisma.crmUserSession.findFirst({
      where: { ipAddress: ip, userAgent: ua, revokedAt: null, expiresAt: { gt: now }, createdAt: { gt: new Date(now.getTime() - SESSION_MATCH_DAYS * 86_400_000) }, user: { crmAccountId: quote.accountId } },
      orderBy: { createdAt: 'desc' }, select: { userId: true },
    }).catch(() => null)
    if (s) return staffDecision({ session: { userId: s.userId } })
  }
  return staffDecision({})
}

// ── The card and its owner ───────────────────────────────────────────────────

/** The quote's customer's card: an open one first, then the one moved last. */
export async function cardForContact(accountId: string, contactId: string | null, db: any = prisma): Promise<any | null> {
  if (!contactId) return null
  const pipe = await db.pipelineState.findUnique({ where: { accountId }, select: { leads: true } })
  const cards = (((pipe?.leads as any[]) ?? []).filter(l => l?.id && l.customerId === contactId))
  if (!cards.length) return null
  const when = (l: any) => String(l.lastMoved || l.createdAt || '')
  const st = await followUpStagesFor(accountId, db)
  return cards.sort((a, b) => Number(!!stopsSteps(a.stage, st)) - Number(!!stopsSteps(b.stage, st)) || when(b).localeCompare(when(a)))[0]
}

/** Who gets the push: the card's owner as Follow ups has it (salesman on the card, else who followed it up), else whoever made the quote, else the owner of the company. */
export async function ownerFor(accountId: string, card: any | null, quoteOwnerId: string | null): Promise<Person | null> {
  const who = await peopleOf(accountId)
  const byCard = card ? who.byName(card.assignedRep) : null
  if (byCard) return byCard
  if (card) {
    const row = await prisma.cardFollowUp.findUnique({ where: { accountId_cardId: { accountId, cardId: card.id } }, select: { ownerUserId: true } }).catch(() => null)
    const p = who.people.find(x => x.id === row?.ownerUserId)
    if (p) return p
  }
  return who.people.find(x => x.id === quoteOwnerId) ?? who.owner
}

// ── Opens ────────────────────────────────────────────────────────────────────

export interface StartResult { id: string; base: { o: Record<string, number>; a: number; sig: boolean } | null; staff: boolean; push: boolean }

/** Should this request be ignored outright (a crawler, a prefetch)? */
export function ignoredRequest(req: Request): boolean {
  const purpose = `${req.headers['sec-purpose'] ?? ''} ${req.headers.purpose ?? ''} ${req.headers['x-moz'] ?? ''}`
  return /prefetch|prerender/i.test(purpose) || isBot(String(req.headers['user-agent'] || ''))
}

/** The page is on screen: start an open (or carry on the same device's open from a moment ago). */
export async function startView(req: Request, quote: QuoteRow, previewToken: unknown, now = new Date()): Promise<StartResult> {
  const ua = String(req.headers['user-agent'] || '').slice(0, 400)
  const ipHash = keyedHash(`ip:${clientIpOf(req)}`)
  const who = await staffOf(req, quote, previewToken, now)
  const out = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'proposal-view:' + quote.id}))`
    const recent = await tx.proposalView.findFirst({
      where: { quoteId: quote.id, ipHash, userAgent: ua, staff: who.staff, lastSeenAt: { gt: new Date(now.getTime() - REUSE_MS) } },
      orderBy: { lastSeenAt: 'desc' },
    })
    if (recent) {
      await tx.proposalView.update({ where: { id: recent.id }, data: { lastSeenAt: now } })
      return { id: recent.id, base: { o: (recent.optionMs ?? {}) as Record<string, number>, a: recent.activeMs, sig: recent.reachedSignature }, staff: who.staff, push: false }
    }
    const card = await cardForContact(quote.accountId, quote.crmContactId, tx)
    let trig: ReturnType<typeof openTrigger> = null
    if (!who.staff) {
      const prev = await tx.proposalView.findFirst({ where: { quoteId: quote.id, staff: false }, orderBy: { lastSeenAt: 'desc' }, select: { id: true, lastSeenAt: true } })
      const legacy = quote.viewCount > 0 && (quote.lastViewedAt || quote.firstViewedAt) ? { id: null, at: (quote.lastViewedAt ?? quote.firstViewedAt)! } : null
      trig = openTrigger(quote.id, prev ? { id: prev.id, at: prev.lastSeenAt } : legacy, now)
      // Accepted already: nothing to chase.
      if (quote.acceptedAt) trig = null
    }
    const v = await tx.proposalView.create({
      data: {
        accountId: quote.accountId, quoteId: quote.id, cardId: card?.id ?? null, crmContactId: quote.crmContactId,
        startedAt: now, lastSeenAt: now, staff: who.staff, staffUserId: who.userId, staffHow: who.how,
        userAgent: ua, device: deviceOf(ua), ipHash, pushTrigger: trig?.trigger ?? null, pushKey: trig?.key ?? null,
      },
    })
    // Only customers' opens count (viewCount and lastViewedAt stay for the screens that read them).
    if (!who.staff) await tx.savedQuote.update({ where: { id: quote.id }, data: { firstViewedAt: quote.firstViewedAt ?? now, lastViewedAt: now, viewCount: { increment: 1 } } })
    return { id: v.id, base: null, staff: who.staff, push: !!trig }
  }, { timeout: 15_000 })
  if (who.staff) console.log(`[proposal] staff view of quote ${quote.id} (${who.how}), not counted`)
  return out
}

const lastBeat = new Map<string, number>()

/** A heartbeat: running totals since the open began. Returns false when there is no such open (or it is too old). */
export async function beatView(quote: { id: string; proposal: unknown }, viewId: string, beat: Beat, now = new Date()): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(viewId)) return false
  const v = await prisma.proposalView.findUnique({ where: { id: viewId } })
  if (!v || v.quoteId !== quote.id) return false
  if (now.getTime() - v.startedAt.getTime() > BEAT_WINDOW_MS) return false
  // Two within a second (a heartbeat and the page closing): the first is enough.
  const was = lastBeat.get(viewId) ?? 0
  if (now.getTime() - was < 1000) return true
  if (lastBeat.size > 10_000) lastBeat.clear()
  lastBeat.set(viewId, now.getTime())
  const optionCount = Array.isArray((quote.proposal as any)?.options) ? (quote.proposal as any).options.length : 0
  const next = mergeBeat({ optionMs: (v.optionMs ?? {}) as Record<string, number>, activeMs: v.activeMs, reachedSignature: v.reachedSignature }, beat, { startedAt: v.startedAt, now, optionCount })
  await prisma.proposalView.update({ where: { id: v.id }, data: { optionMs: next.optionMs, activeMs: next.activeMs, reachedSignature: next.reachedSignature, lastSeenAt: now } })
  return true
}

/** The customer signed on the page: that open (else their latest) is marked signed. */
export async function markSigned(quoteId: string, viewId: unknown, now = new Date()): Promise<void> {
  if (typeof viewId === 'string' && /^[0-9a-f-]{36}$/i.test(viewId)) {
    const n = await prisma.proposalView.updateMany({ where: { id: viewId, quoteId }, data: { signed: true, reachedSignature: true, lastSeenAt: now } })
    if (n.count) return
  }
  const v = await prisma.proposalView.findFirst({ where: { quoteId, staff: false, startedAt: { gt: new Date(now.getTime() - BEAT_WINDOW_MS) } }, orderBy: { startedAt: 'desc' }, select: { id: true } })
  if (v) await prisma.proposalView.update({ where: { id: v.id }, data: { signed: true, reachedSignature: true } })
}

// ── The push ─────────────────────────────────────────────────────────────────

export type PushSend = (accountId: string, msg: { title: string; body: string; url: string; tag: string }, userIds: string[]) => Promise<unknown>

async function notifyOn(accountId: string): Promise<boolean> {
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }).catch(() => null)
  return (b?.config as any)?.proposal?.notifyOpened !== false
}

/** What the push says. */
export function pushWords(trigger: 'first' | 'reopen', name: string, device: string, daysAway: number | null): { title: string; body: string } {
  if (trigger === 'first') return { title: `Proposal opened: ${name}`, body: `${name} opened the proposal for the first time, on ${device}.` }
  return { title: `${name} opened the proposal again`, body: `Back after ${daysAway && daysAway >= 2 ? `${daysAway} days` : '2 days or more'}, on ${device}.` }
}

/**
 * Send the push this open earned, once (its key). Saved with the bell
 * notification in one step; on the dev copy logged, never delivered.
 */
export async function proposalOpenedPush(viewId: string, deps: { send?: PushSend; allowed?: boolean } = {}): Promise<{ made: boolean; delivered: boolean; logged?: string; why?: string }> {
  const v = await prisma.proposalView.findUnique({ where: { id: viewId } })
  if (!v || v.staff || !v.pushTrigger || !v.pushKey) return { made: false, delivered: false, why: 'nothing to send' }
  const key = v.pushKey
  if (await prisma.automationEffect.findUnique({ where: { key }, select: { key: true } })) return { made: false, delivered: false, why: 'already sent' }
  const q = await prisma.savedQuote.findUnique({ where: { id: v.quoteId }, select: { id: true, accountId: true, customerName: true, ownerId: true, crmContactId: true } })
  if (!q) return { made: false, delivered: false, why: 'no quote' }
  if (!(await notifyOn(q.accountId))) {
    await prisma.automationEffect.create({ data: { key, runId: 'proposal-opened', status: 'done', result: { viewId, skipped: 'turned off in Settings' } as any } }).catch(() => null)
    return { made: false, delivered: false, why: 'turned off' }
  }
  const pipe = await prisma.pipelineState.findUnique({ where: { accountId: q.accountId }, select: { leads: true } })
  const card = (((pipe?.leads as any[]) ?? []).find(l => l?.id && l.id === v.cardId)) ?? await cardForContact(q.accountId, q.crmContactId)
  const owner = await ownerFor(q.accountId, card, q.ownerId)
  if (!owner) {
    await prisma.automationEffect.create({ data: { key, runId: 'proposal-opened', status: 'done', result: { viewId, skipped: 'nobody to tell' } as any } }).catch(() => null)
    return { made: false, delivered: false, why: 'no owner' }
  }
  const name = card ? `${card.firstName ?? ''} ${card.lastName ?? ''}`.trim() || q.customerName || 'A customer' : q.customerName || 'A customer'
  let daysAway: number | null = null
  if (v.pushTrigger === 'reopen') {
    const prev = await prisma.proposalView.findFirst({ where: { quoteId: q.id, staff: false, startedAt: { lt: v.startedAt } }, orderBy: { startedAt: 'desc' }, select: { lastSeenAt: true } })
    if (prev) daysAway = Math.floor((v.startedAt.getTime() - prev.lastSeenAt.getTime()) / 86_400_000)
  }
  const { title, body } = pushWords(v.pushTrigger as 'first' | 'reopen', name, v.device || 'a device', daysAway)
  const link = card ? `/pipeline?card=${encodeURIComponent(card.id)}` : '/quotes'
  try {
    await prisma.$transaction(async tx => {
      await tx.automationEffect.create({ data: { key, runId: 'proposal-opened', status: 'done', result: { viewId, trigger: v.pushTrigger, to: owner.id } as any } })
      await tx.notification.create({ data: { recipientId: owner.email, title, body, type: 'info', link } })
    })
  } catch { return { made: false, delivered: false, why: 'already sent' } }
  const allowed = deps.allowed ?? pushDeliveryAllowed()
  if (!allowed) {
    const line = `[proposal-opened] dev copy: push not delivered to ${owner.name}: ${title}. ${body}`
    console.log(line)
    await prisma.automationEffect.update({ where: { key }, data: { result: { viewId, trigger: v.pushTrigger, to: owner.id, logged: line } as any } }).catch(() => null)
    return { made: true, delivered: false, logged: line }
  }
  try {
    const send: PushSend = deps.send ?? (async (a, msg, userIds) => (await import('./automations/push.js')).sendPush(a, msg, { userIds }))
    await send(q.accountId, { title, body, url: link, tag: `proposal-opened-${q.id}` }, [owner.id])
    return { made: true, delivered: true }
  } catch (err) {
    console.error('[proposal-opened] push:', String((err as Error)?.message || err).slice(0, 200))
    return { made: true, delivered: false }
  }
}

/** The automation worker: pushes earned in the last day that were never made (a restart in between). */
export async function proposalOpenedSweep(now = new Date(), deps: { send?: PushSend; allowed?: boolean } = {}): Promise<number> {
  const views = await prisma.proposalView.findMany({ where: { staff: false, pushKey: { not: null }, startedAt: { gt: new Date(now.getTime() - 86_400_000) } }, select: { id: true, pushKey: true }, take: 500 })
  if (!views.length) return 0
  const done = new Set((await prisma.automationEffect.findMany({ where: { key: { in: views.map(v => v.pushKey!) } }, select: { key: true } })).map(e => e.key))
  let n = 0
  for (const v of views) {
    if (done.has(v.pushKey!)) continue
    // Sent at the same moment by the open itself: the key keeps it to one.
    const r = await proposalOpenedPush(v.id, deps).catch(() => null)
    if (r?.made) n++
  }
  return n
}
