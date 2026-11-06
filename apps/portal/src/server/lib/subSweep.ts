/**
 * The sub's clock (Jonathan, Nov 6 2026), every automation scan (lib/automations/queue.ts):
 *
 *   - the day before the install (from 7 am): the job link emailed to the sub, once;
 *   - the end of the last install day (from 6 pm) and not signed off: a reminder to the sub and a push to the owner, once;
 *   - no 811 ticket 2 business days before the install: a push to the owner, once; the install running past the
 *     ticket's expiry: a push, once per expiry date;
 *   - a paper expiring within 30 days (or expired) on an active sub: a push to the owner, once per paper.
 *
 * Each is written down (the sub job's events, or AccountKeyValue), so never twice, and a restart never repeats one.
 */

import prisma from './prisma.js'
import { floridaDay } from './automations/context.js'
import { sendPush } from './automations/push.js'
import { usDate, isYmd } from './installDays.js'
import { businessDaysBefore, papersOf, docKindsOf, subSettingsOf } from './subcontractors.js'
import { tellSub } from './subAssign.js'
import { plusDays } from './installDays.js'

type Json = any

const hourInFlorida = (now: Date) => Number(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })) % 24
const has = (sj: Json, what: string) => ((sj.events as Json[]) ?? []).some(e => e?.what === what)

async function markEvent(sjId: string, what: string, how: string) {
  const cur = await prisma.subJob.findUnique({ where: { id: sjId }, select: { events: true } })
  await prisma.subJob.update({ where: { id: sjId }, data: { events: [...((cur?.events as Json[]) ?? []), { at: new Date().toISOString(), what, how, to: 'owner' }] as Json } })
}

async function onceKey(accountId: string, key: string): Promise<boolean> {
  const done = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key } } })
  if (done) return false
  await prisma.accountKeyValue.create({ data: { accountId, key, value: { at: new Date().toISOString() } } }).catch(() => null)
  return true
}

export async function subSweep(now = new Date()): Promise<{ sent: number; reminded: number; pushed: number }> {
  const out = { sent: 0, reminded: 0, pushed: 0 }
  const today = floridaDay(now)
  const hour = hourInFlorida(now)
  const rows = await prisma.subJob.findMany({ where: { linkDisabledAt: null, confirmedAt: null }, include: { sub: true } })
  if (rows.length) {
    const jobs = await prisma.savedJob.findMany({ where: { id: { in: rows.map(r => r.jobId) }, deletedAt: null, archivedAt: null } })
    for (const sj of rows) {
      const job = jobs.find(j => j.id === sj.jobId)
      if (!job || !isYmd(job.scheduledDate)) continue
      const start = job.scheduledDate
      const end = isYmd(job.scheduledEndDate) ? job.scheduledEndDate : start
      // The day before (or the morning of a job booked for today): the link, once per install day.
      const sentKey = `Job link sent for ${start}`
      if (!has(sj, sentKey) && today >= plusDays(start, -1) && today <= end && hour >= 7) {
        await tellSub(sj.accountId, sj, `Your job ${today < start ? 'tomorrow' : 'today'}: ${job.customerAddress}`, `Your install at ${job.customerAddress} starts ${usDate(start)}. Open the link for the job sheet, the pull sheet, the 811 ticket and your pay. Check out the material at the shop first.`, sentKey)
        out.sent++
      }
      // The end of the last day, not signed off: the sub is reminded and the owner told, once.
      const remindKey = `Reminder: sign off ${end}`
      if (!sj.submittedAt && !has(sj, remindKey) && (today > end || (today === end && hour >= 18))) {
        await tellSub(sj.accountId, sj, `Sign off the job at ${job.customerAddress}`, `The install at ${job.customerAddress} was booked through ${usDate(end)}. Open the link and sign off what you installed, with after photos.`, remindKey)
        await sendPush(sj.accountId, { title: `Not signed off: ${job.customerName}`, body: `${sj.sub.businessName} has not signed off the install (booked through ${usDate(end)}).`, url: `/operations?job=${job.id}`, tag: `sub-late-${job.id}` }).catch(() => null)
        out.reminded++
      }
      // 811: no ticket 2 business days before the install.
      const noTicketKey = `811 warning for ${start}`
      if (!job.locateTicket?.trim() && today >= businessDaysBefore(start, 2) && today <= end && !has(sj, noTicketKey)) {
        await sendPush(sj.accountId, { title: `No 811 ticket: ${job.customerName}`, body: `The install starts ${usDate(start)} with ${sj.sub.businessName}, and no 811 ticket is entered.`, url: `/operations?job=${job.id}`, tag: `sub-811-${job.id}` }).catch(() => null)
        await markEvent(sj.id, noTicketKey, 'push')
        out.pushed++
      }
      // The install runs past the ticket's expiry.
      const exp = job.locatesExpDate
      const expKey = `811 expires ${exp} before the install ends`
      if (job.locateTicket?.trim() && isYmd(exp) && exp < end && today <= end && !has(sj, expKey)) {
        await sendPush(sj.accountId, { title: `811 ticket expires first: ${job.customerName}`, body: `Ticket ${job.locateTicket} expires ${usDate(exp)}; the install runs to ${usDate(end)}. Renew it.`, url: `/operations?job=${job.id}`, tag: `sub-811exp-${job.id}` }).catch(() => null)
        await markEvent(sj.id, expKey, 'push')
        out.pushed++
      }
    }
  }
  // Ready to pay a sub: the customer's final payment cleared (a sub assigned after it did, a job paid before states were kept).
  const unpaid = await prisma.subJob.findMany({ where: { paidAt: null, readyToPayAt: null, confirmedAt: { not: null } }, select: { accountId: true, jobId: true } })
  const { checkReadyToPaySub } = await import('./paymentClearing.js')
  for (const u of unpaid) await checkReadyToPaySub(u.accountId, u.jobId).catch(e => console.error('[sub sweep] ready to pay:', e))
  // Papers expiring within 30 days, or expired, on an active sub: one push each.
  const subs = await prisma.subcontractor.findMany({ where: { deletedAt: null, status: 'active' }, include: { documents: { where: { deletedAt: null } } } })
  const configs = new Map<string, Json>()
  for (const s of subs) {
    if (!configs.has(s.accountId)) configs.set(s.accountId, await subSettingsOf(s.accountId))
    const p = papersOf(s.documents as Json, today, docKindsOf(configs.get(s.accountId)))
    for (const d of [...p.expiring.map(x => ({ ...x, gone: false })), ...p.expired.map(x => ({ ...x, days: 0, gone: true }))]) {
      const doc = p.current[d.kind]
      if (!doc || !(await onceKey(s.accountId, `sub-doc-warned:${doc.id}:${d.gone ? 'expired' : 'soon'}`))) continue
      await sendPush(s.accountId, {
        title: `${s.businessName}: ${d.label} ${d.gone ? 'expired' : 'expires soon'}`,
        body: d.gone ? `It expired ${usDate(d.expiresOn)}. Ask them for the new one.` : `It expires ${usDate(d.expiresOn)} (${d.days} day${d.days === 1 ? '' : 's'}). Ask them for the new one.`,
        url: `/subcontractors?subcontractor=${s.id}`, tag: `sub-doc-${doc.id}`,
      }).catch(() => null)
      out.pushed++
    }
  }
  return out
}
