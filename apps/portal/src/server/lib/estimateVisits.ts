/**
 * The customer signed: their estimate visits still booked (round 3 walkthrough,
 * Oct 26 2026: WT3 Robert Hayes signed, and his estimate visit Tue 10/27 8:30
 * stayed booked on the salesman's day).
 *
 *   past     a visit whose time has passed is marked done ("Customer signed"),
 *            in its history, so it leaves "Needs outcome" and the open lists;
 *   future   a visit still to come is left booked (it may be wanted) and the
 *            owner and the office are told once, with the customer's
 *            Appointments tab to cancel it from.
 *
 * Runs after every signing (lib/contractBilling.ts scheduleAfterSigning);
 * running it again changes nothing.
 */

import prisma from './prisma.js'

const OPEN = ['scheduled', 'confirmed', 'rescheduled', 'on_my_way']

const when = (d: Date) => d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export async function estimateVisitsAfterSigning(accountId: string, quoteId: string, by: string, now = new Date()): Promise<{ done: string[]; future: string[] }> {
  const q = await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId }, select: { crmContactId: true, customerName: true, soldAt: true, acceptedAt: true } })
  if (!q?.crmContactId) return { done: [], future: [] }
  // Only visits booked before this sale (a visit booked after it is for something new).
  const signedAt = q.acceptedAt ?? q.soldAt ?? now
  const visits = await prisma.appointment.findMany({ where: { accountId, crmContactId: q.crmContactId, deletedAt: null, type: 'estimate', status: { in: OPEN }, startAt: { not: null }, createdAt: { lte: signedAt } } })
  const done: string[] = [], future: string[] = []
  for (const v of visits) {
    if (v.startAt! <= now) {
      const history = [...(Array.isArray(v.history) ? (v.history as any[]) : []), { at: now.toISOString(), by: by || 'EZ Biz', kind: 'status', from: v.status, to: 'completed', reason: 'Customer signed' }]
      const r = await prisma.appointment.updateMany({ where: { id: v.id, version: v.version }, data: { status: 'completed', completedAt: now, history, version: { increment: 1 } } })
      if (r.count) done.push(v.id)
      continue
    }
    future.push(v.id)
    const link = `/customers/${encodeURIComponent(q.crmContactId)}?tab=appointments`
    const title = `${q.customerName || 'The customer'} signed: an estimate visit is still booked`
    if (await prisma.notification.findFirst({ where: { title, link, body: { contains: when(v.startAt!) } }, select: { id: true } })) continue
    const body = `Their estimate visit ${when(v.startAt!)}${v.assignedTo ? ` with ${v.assignedTo}` : ''} is still on the schedule. Cancel it if it is not needed any more.`
    for (const recipientRole of ['admin', 'office_staff']) await prisma.notification.create({ data: { recipientRole, title, body, type: 'info', link } })
  }
  return { done, future }
}
