/**
 * Free web push to Jonathan's phone (Android Chrome; iPhone Safari when the
 * app is installed to the home screen, iOS 16.4 or later). No paid service:
 * the browser makers' push servers carry the message, signed with this
 * company's VAPID key pair, which is made once and kept in the database
 * (AccountKeyValue "push_vapid"), never in the settings file.
 */

import webpush from 'web-push'
import prisma from '../prisma.js'
import { getFrontendBase } from '../urls.js'
import { holdOutbound, outboundBlockReason } from '../outboundGate.js'

const KEY = 'push_vapid'

export interface PushMessage { title: string; body: string; url?: string; tag?: string }
export interface PushSender {
  /** Resolves 'held' when the outbound gate kept it back (not the live install). */
  send(sub: { endpoint: string; p256dh: string; auth: string }, payload: string, vapid: { publicKey: string; privateKey: string; subject: string }): Promise<void | 'held'>
}

const realSender: PushSender = {
  async send(sub, payload, vapid) {
    // The outbound gate (lib/outboundGate.ts): only the live install reaches a phone.
    const blocked = outboundBlockReason()
    if (blocked) {
      let p: { title?: string; body?: string } = {}
      try { p = JSON.parse(payload) } catch { /* not ours */ }
      holdOutbound('push', `phone ${(sub as { userId?: string }).userId ?? ''} ${hostOf(sub.endpoint)}`.replace(/\s+/g, ' ').trim(), p.title ?? '', p.body, blocked)
      return 'held'
    }
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { vapidDetails: vapid, TTL: 24 * 3600, timeout: 15_000, urgency: 'high' },
    )
  },
}
function hostOf(url: string): string { try { return new URL(url).host } catch { return '' } }
let sender: PushSender = realSender
export function setPushSenderForTests(s: PushSender | null) { sender = s ?? realSender }

/** This company's VAPID keys, made on first use. */
export async function vapidKeys(accountId: string): Promise<{ publicKey: string; privateKey: string; subject: string }> {
  const subject = await vapidSubject(accountId)
  const row = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: KEY } } })
  const v = row?.value as any
  if (v?.publicKey && v?.privateKey) return { publicKey: v.publicKey, privateKey: v.privateKey, subject }
  const made = webpush.generateVAPIDKeys()
  try {
    await prisma.accountKeyValue.create({ data: { accountId, key: KEY, value: { publicKey: made.publicKey, privateKey: made.privateKey, createdAt: new Date().toISOString() }, updatedBy: 'automations' } })
    return { ...made, subject }
  } catch {
    // Made at the same moment elsewhere: that pair is the one.
    const again = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: KEY } } })
    const a = again?.value as any
    return { publicKey: a.publicKey, privateKey: a.privateKey, subject }
  }
}

/** Push services want a contact: the app's https address, else the owner's email. */
async function vapidSubject(accountId: string): Promise<string> {
  const base = getFrontendBase()
  if (/^https:\/\//.test(base)) return base
  const owner = await prisma.crmUser.findFirst({ where: { crmAccountId: accountId, role: { in: ['super_admin', 'admin'] as any } }, orderBy: { createdAt: 'asc' }, select: { email: true } })
  return `mailto:${owner?.email || 'owner@example.com'}`
}

export async function saveSubscription(accountId: string, userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string) {
  return prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { accountId, userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null },
    update: { accountId, userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null },
  })
}

/** The owner and admins of the company: who gets automation pushes. */
async function adminUserIds(accountId: string): Promise<string[]> {
  const users = await prisma.crmUser.findMany({ where: { crmAccountId: accountId, role: { in: ['super_admin', 'admin'] as any } }, select: { id: true } })
  return users.map(u => u.id)
}

/** held: kept back by the outbound gate (dev copy, tests): written to the dev outbox, not sent. */
export interface PushResult { sent: number; failed: number; removed: number; held: number; subscribers: number; errors: string[] }

/** Send to every phone the owner and admins turned push on for (or to one user's phones). */
export async function sendPush(accountId: string, msg: PushMessage, opts: { userIds?: string[] } = {}): Promise<PushResult> {
  const userIds = opts.userIds ?? await adminUserIds(accountId)
  const subs = await prisma.pushSubscription.findMany({ where: { accountId, userId: { in: userIds } } })
  const out: PushResult = { sent: 0, failed: 0, removed: 0, held: 0, subscribers: subs.length, errors: [] }
  if (!subs.length) return out
  const vapid = await vapidKeys(accountId)
  const payload = JSON.stringify({ title: msg.title.slice(0, 120), body: msg.body.slice(0, 400), url: msg.url || '/', tag: msg.tag })
  for (const s of subs) {
    try {
      if (await sender.send(s, payload, vapid) === 'held') out.held++
      else out.sent++
    } catch (err) {
      const code = Number((err as any)?.statusCode)
      if (code === 404 || code === 410) { await prisma.pushSubscription.deleteMany({ where: { id: s.id } }); out.removed++; continue }
      out.failed++
      out.errors.push(`${code || ''} ${String((err as Error)?.message || err).slice(0, 160)}`.trim())
    }
  }
  return out
}
