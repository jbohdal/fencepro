/**
 * Paying a sub (Jonathan, Nov 6 2026): only after the customer's final
 * payment has cleared (lib/paymentClearing.ts: "Ready to pay sub"), and only
 * once the sub has signed Florida's statutory final release of lien for the job
 * on their link (lib/subSign.ts). Backcharges (damage, wasted or missing
 * material) and advances come off their pay, each with a reason. Mark paid
 * keeps the day, amount, method and check number; the amount paid is the job's
 * actual labor in job costing (the takeoff's "Sub paid").
 */

import crypto from 'crypto'
import prisma from './prisma.js'
import { floridaDay } from './automations/context.js'
import { SubError, subSettingsOf, subLienReleaseWords, newLink, TEMPLATES } from './subcontractors.js'
import { netPay } from './paymentClearing.js'
import { tellSub } from './subAssign.js'

type Json = any
/** How a sub is paid (Mark paid): a check needs its number. */
export const PAY_METHODS = ['Check', 'Zelle', 'Cash', 'Bank transfer'] as const
const usDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function subJobOf(accountId: string, jobId: string) {
  const sj = await prisma.subJob.findFirst({ where: { accountId, jobId }, include: { sub: true } })
  if (!sj) throw new SubError(404, 'No sub on this job.')
  return sj
}

async function event(sjId: string, what: string, by: string) {
  const cur = await prisma.subJob.findUnique({ where: { id: sjId }, select: { events: true } })
  await prisma.subJob.update({ where: { id: sjId }, data: { events: [...((cur?.events as Json[]) ?? []), { at: new Date().toISOString(), what, how: 'app', to: by }] as Json } })
}

/** A backcharge or an advance off the sub's pay, with its reason. */
export async function addDeduction(accountId: string, jobId: string, d: { kind: 'backcharge' | 'advance'; cents: number; reason: string }, by: string) {
  const sj = await subJobOf(accountId, jobId)
  if (sj.paidAt) throw new SubError(409, 'This sub is paid already.')
  if (!Number.isInteger(d.cents) || d.cents <= 0) throw new SubError(400, 'Enter the amount in dollars and cents.')
  if (!sj.confirmedAt && d.kind === 'backcharge') throw new SubError(409, 'Backcharges come off once the install is confirmed.')
  if (!d.reason.trim()) throw new SubError(400, d.kind === 'advance' ? 'Say when and how the advance was paid.' : 'Say why: damage, wasted or missing material.')
  const list = [...((sj.deductions as Json[]) ?? []), { id: crypto.randomUUID(), kind: d.kind, cents: d.cents, reason: d.reason.trim().slice(0, 300), at: new Date().toISOString(), by }]
  if (sj.payCents - list.reduce((t, x) => t + x.cents, 0) < 0) throw new SubError(400, 'That takes their pay below $0.')
  await prisma.subJob.update({ where: { id: sj.id }, data: { deductions: list as Json } })
  await event(sj.id, `${d.kind === 'advance' ? 'Advance' : 'Backcharge'} ${money(d.cents)}: ${d.reason.trim()}`, by)
  await withdrawRelease(accountId, jobId, sj.id, by)
  return list
}

export async function removeDeduction(accountId: string, jobId: string, id: string, by: string) {
  const sj = await subJobOf(accountId, jobId)
  if (sj.paidAt) throw new SubError(409, 'This sub is paid already.')
  const list = ((sj.deductions as Json[]) ?? [])
  const gone = list.find(x => x.id === id)
  if (!gone) return list
  const next = list.filter(x => x.id !== id)
  await prisma.subJob.update({ where: { id: sj.id }, data: { deductions: next as Json } })
  await event(sj.id, `Took off the ${gone.kind} of ${money(gone.cents)} (${gone.reason})`, by)
  await withdrawRelease(accountId, jobId, sj.id, by)
  return next
}

/** Their pay changed: a release sent for the old amount (signed or not) is withdrawn; send a new one. */
async function withdrawRelease(accountId: string, jobId: string, sjId: string, by: string) {
  const open = await prisma.subSignRequest.findMany({ where: { accountId, jobId, kind: 'lien_release', voidedAt: null }, select: { id: true, documentId: true } })
  if (!open.length) return
  await prisma.subSignRequest.updateMany({ where: { id: { in: open.map(o => o.id) } }, data: { voidedAt: new Date() } })
  // A signed one stays filed on the sub, marked withdrawn (it was for the old amount).
  for (const o of open) if (o.documentId) {
    const d = await prisma.subDocument.findUnique({ where: { id: o.documentId }, select: { label: true } })
    if (d && !/withdrawn/.test(d.label)) await prisma.subDocument.update({ where: { id: o.documentId }, data: { label: `${d.label} (withdrawn: their pay changed)`.slice(0, 200) } })
  }
  await event(sjId, 'Lien release withdrawn: their pay changed; send a new one', by)
}

/** The job's final lien release for this sub (the newest one sent, signed or not), or null. */
export async function lienReleaseOf(accountId: string, jobId: string, subId: string) {
  return prisma.subSignRequest.findFirst({ where: { accountId, jobId, subId, kind: 'lien_release', voidedAt: null }, orderBy: { sentAt: 'desc' } })
}

/**
 * Send the sub their final release of lien to sign, for their pay less deductions (refused while the template still
 * needs the attorney's review, or while the customer's final payment has not cleared).
 */
export async function sendLienRelease(accountId: string, jobId: string, by: string) {
  const sj = await subJobOf(accountId, jobId)
  if (sj.paidAt) throw new SubError(409, 'This sub is paid already.')
  if (!sj.confirmedAt || !sj.readyToPayAt) throw new SubError(409, 'Not yet: the install is not confirmed, or the customer\'s final payment has not cleared.')
  const settings = await subSettingsOf(accountId)
  if (!settings.reviews.sub_lien_release) throw new SubError(409, `Attorney review required: the ${TEMPLATES.sub_lien_release} is locked until the owner marks it reviewed (Subcontractors → Settings).`)
  const [job, company] = await Promise.all([
    prisma.savedJob.findUnique({ where: { id: jobId }, select: { customerName: true, customerAddress: true } }),
    prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }).then(b => String((b?.config as Json)?.company?.name || 'Getter Done Fence')),
  ])
  const amount = netPay(sj as Json)
  const text = subLienReleaseWords({ amountCents: amount, company, owner: job?.customerName ?? '', property: job?.customerAddress ?? '', date: usDate(floridaDay(new Date())), sub: sj.sub.businessName })
  await prisma.subSignRequest.updateMany({ where: { accountId, jobId, subId: sj.subId, kind: 'lien_release', signedAt: null, voidedAt: null }, data: { voidedAt: new Date() } })
  const id = crypto.randomUUID()
  const link = newLink(id)
  await prisma.subSignRequest.create({ data: { id, accountId, subId: sj.subId, jobId, kind: 'lien_release', version: 'FL 713.20(5)', text, linkNonce: link.nonce, tokenHash: link.hash, sentTo: sj.sub.email } })
  const { signLinkUrl } = await import('./subSign.js')
  const url = signLinkUrl({ id, linkNonce: link.nonce })
  await event(sj.id, `Final lien release sent to sign, ${money(amount)}`, by)
  const sent = await tellSub(accountId, sj, `Sign your lien release: ${job?.customerAddress ?? ''}`, `The customer's final payment cleared. Before you are paid ${money(amount)}, sign the final release of lien for ${job?.customerAddress ?? 'the job'}: ${url}`, 'Lien release emailed')
  return { link: url, sent, amountCents: amount }
}

/** Mark the sub paid (one tap: day, amount, method, check number). The amount is the job's actual labor. */
export async function markSubPaid(accountId: string, jobId: string, p: { paidOn: string; amountCents: number; method: string; checkNumber?: string | null }, by: { userId: string | null; name: string }) {
  const sj = await subJobOf(accountId, jobId)
  if (sj.paidAt) throw new SubError(409, `Paid already, ${sj.paidOn}.`)
  if (!sj.confirmedAt || !sj.readyToPayAt) throw new SubError(409, 'Not yet: the install is not confirmed, or the customer\'s final payment has not cleared.')
  const release = await lienReleaseOf(accountId, jobId, sj.subId)
  if (!release?.signedAt) throw new SubError(409, release ? 'Waiting for the sub to sign the final lien release.' : 'Send the sub the final lien release to sign first.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.paidOn) || p.paidOn > floridaDay(new Date())) throw new SubError(400, 'Pick the day you paid (today or before).')
  const net = netPay(sj as Json)
  if (!Number.isInteger(p.amountCents) || p.amountCents < 0 || (p.amountCents === 0 && net !== 0)) throw new SubError(400, 'Enter the amount paid.')
  // What they signed the release for is what they are paid.
  const signedFor = Number(/\$([\d,]+\.\d{2})/.exec(release.text)?.[1]?.replace(/,/g, '')) * 100
  if (Number.isFinite(signedFor) && Math.round(signedFor) !== p.amountCents) throw new SubError(409, `They signed the release for ${money(Math.round(signedFor))}. Pay that, or change their pay and send a new release.`)
  if (!PAY_METHODS.includes(p.method as typeof PAY_METHODS[number])) throw new SubError(400, `Pick how you paid: ${PAY_METHODS.join(', ')}.`)
  if (p.method === 'Check' && !p.checkNumber?.trim()) throw new SubError(400, 'Give the check number.')
  // Once: two taps at the same moment pay once.
  const n = await prisma.subJob.updateMany({ where: { id: sj.id, paidAt: null }, data: { paidOn: p.paidOn, paidCents: p.amountCents, paidMethod: p.method, paidCheckNumber: p.checkNumber?.trim().slice(0, 40) || null, paidBy: by.name, paidAt: new Date() } })
  if (!n.count) throw new SubError(409, 'Paid already.')
  // The job's actual labor: the takeoff's "Sub paid" (made when the job has none yet).
  const { startTakeoff, laborOf } = await import('./jobCosting.js')
  const t = await startTakeoff(accountId, jobId, by.name, crypto.randomUUID())
  const row = await prisma.jobTakeoff.findUniqueOrThrow({ where: { id: t.id } })
  await prisma.jobTakeoff.update({ where: { id: row.id }, data: { labor: { ...laborOf(row), mode: 'sub', subPaidCents: p.amountCents } as Json } })
  await event(sj.id, `Paid ${money(p.amountCents)} on ${p.paidOn} by ${p.method}${p.checkNumber ? ` #${p.checkNumber}` : ''}`, by.name)
  await tellSub(accountId, sj, `Paid: ${money(p.amountCents)}`, `You were paid ${money(p.amountCents)} on ${usDate(p.paidOn)} by ${p.method.toLowerCase()}${p.checkNumber ? ` ${p.checkNumber}` : ''}. Thank you.`, 'Told: paid')
  return { paidCents: p.amountCents }
}
