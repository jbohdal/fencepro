/**
 * Florida's construction lien notice (s. 713.015) as an addendum to a contract
 * signed before new contracts carried it (Jonathan, Nov 6 2026): "Yes, prepare
 * the signed notice addendum for the 11 contracts not installed yet, locked
 * until I mark it attorney reviewed; don't send until then. Leave the
 * installed ones alone."
 *
 *   Who gets one   a signed contract (Sold, or accepted on the link) over
 *                  $2,500, the same rule as new contracts (lib/contractTerms.ts),
 *                  whose proposal did not carry the notice, and whose job is
 *                  not installed yet: not Complete, Invoiced or Paid, no
 *                  completed day, no final furnishing date (a sub's install
 *                  confirmed), and the install has not happened by the crew's
 *                  records (lib/jobTruth.ts installHappened: the crew finished,
 *                  or its last crew day is past). Installed jobs and contracts
 *                  that have the notice get nothing.
 *   The paper      one page: the notice word for word (LIEN_NOTICE_713015, the
 *                  new contracts' page), naming the original contract (the
 *                  customer, the address, the day it was signed, the fence and
 *                  the price), the customer's name, finger signature and date.
 *   Locked         until the owner marks it reviewed by an attorney: the same
 *                  lock as the sub agreement and the lien papers, with its own
 *                  mark in its own record (AccountKeyValue
 *                  "lien-notice-addendum:review"), so no other paper's mark
 *                  opens it. Until then nothing sends it and its link shows
 *                  the customer nothing.
 *   Sending        the office (billing.change): Email it (the server's email,
 *                  through the outbound gate), Text it or Copy link (the
 *                  office's own phone). Never by itself.
 *   Signed         the signed PDF is stored once with the contract's signed
 *                  documents (lib/signedDocuments.ts fileSignedLienNotice):
 *                  the job's and the customer's Documents and their portal. The
 *                  owner's lien clock counts it as the notice given (lib/liens.ts).
 */

import crypto from 'crypto'
import prisma from './prisma.js'
import { LIEN_NOTICE_713015, LIEN_NOTICE_OVER_CENTS } from './contractTerms.js'
import { SubError } from './subcontractors.js'
import { pdfDocument, pdfSafeText } from './pdfText.js'
import { plainStyleName } from './estimates.js'
import { customerFenceName, soldRailsOf } from './customerFenceName.js'
import { publicDoorUrl } from './urls.js'
import { formatPhonesIn } from './customerText.js'
import { isDonePhase } from './opsStageModel.js'

type Json = any
type Row = NonNullable<Awaited<ReturnType<typeof prisma.lienNoticeAddendum.findUnique>>>

/** The owner's attorney review mark on the addendum, its own record (Subcontractors → Settings, or on the job). */
export const ADDENDUM_REVIEW_KEY = 'lien-notice-addendum:review'
/** What every send button says while it is locked (Jonathan, Nov 6 2026). */
export const ADDENDUM_LOCKED = 'Locked until Jonathan marks it attorney reviewed.'
export const ADDENDUM_TITLE = 'Addendum: Notice of Florida Construction Lien Law'

const TZ = 'America/New_York'
const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const ymdOf = (d: Date | null | undefined) => (d ? d.toLocaleDateString('en-CA', { timeZone: TZ }) : null)
export const dayWords = (ymd: string | null | undefined) => (ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '')
export const addendumUrl = (token: string) => publicDoorUrl(`/p/ln/${token}`)

const QUOTE_SELECT = {
  id: true, accountId: true, crmContactId: true, customerName: true, customerAddress: true, customerPhone: true, customerEmail: true, finalPrice: true,
  fenceStyle: true, runRails: true, proposal: true, status: true, acceptedAt: true, soldAt: true, deletedAt: true, archivedAt: true,
} as const
type Quote = { id: string; accountId: string; crmContactId: string | null; customerName: string; customerAddress: string; customerPhone: string; customerEmail: string; finalPrice: number; fenceStyle: string; runRails: unknown; proposal: unknown; status: string; acceptedAt: Date | null; soldAt: Date | null; deletedAt: Date | null; archivedAt: Date | null }
type Job = { id: string; quoteId: string | null; status: string; completedDate: string | null; finalFurnishingDate: string | null; scheduledDate: string; scheduledEndDate: string | null; deletedAt: Date | null; archivedAt: Date | null }
const JOB_SELECT = { id: true, quoteId: true, status: true, completedDate: true, finalFurnishingDate: true, scheduledDate: true, scheduledEndDate: true, deletedAt: true, archivedAt: true } as const

const priceCents = (q: { finalPrice: number }) => Math.round((q.finalPrice || 0) * 100)
/** Signed: Sold, or accepted on the link; never a contract since marked Lost (cancelled; review Nov 6 2026). */
const isSigned = (q: { status: string; acceptedAt: Date | null; soldAt: Date | null }) => q.status !== 'LOST' && (q.status === 'SOLD' || !!q.acceptedAt)
const hasNotice = (q: { proposal: unknown }) => { const n = (q.proposal as Json)?.lienNotice; return typeof n === 'string' && !!n.trim() }

/** A contract signed without the notice and over $2,500 (whatever its job). */
export function contractMissesNotice(q: Pick<Quote, 'status' | 'acceptedAt' | 'soldAt' | 'finalPrice' | 'proposal' | 'deletedAt'>): boolean {
  return !q.deletedAt && isSigned(q) && priceCents(q) > LIEN_NOTICE_OVER_CENTS && !hasNotice(q)
}

/** Installed by the app's records: done phase, a completed day, a final furnishing date, or the install happened. */
export async function jobInstalled(accountId: string, j: Job): Promise<boolean> {
  if (isDonePhase(j.status) || j.completedDate || j.finalFurnishingDate) return true
  const { installHappened } = await import('./jobTruth.js')
  return installHappened(accountId, j)
}

export interface Candidate { quoteId: string; jobId: string; customerName: string; address: string; priceCents: number; signedOn: string | null; jobStatus: string }

/**
 * Every contract that gets the addendum now: signed over $2,500 without the notice, with a job not installed yet.
 * Also `older`: how many such contracts are already installed (left alone).
 */
export async function addendumCandidates(accountId: string): Promise<{ list: Candidate[]; older: number }> {
  const quotes = (await prisma.savedQuote.findMany({ where: { accountId, deletedAt: null, OR: [{ status: 'SOLD' }, { acceptedAt: { not: null } }] }, select: QUOTE_SELECT }) as Quote[]).filter(contractMissesNotice)
  if (!quotes.length) return { list: [], older: 0 }
  const jobs = await prisma.savedJob.findMany({ where: { accountId, deletedAt: null, archivedAt: null, quoteId: { in: quotes.map(q => q.id) } }, select: JOB_SELECT, orderBy: { createdAt: 'asc' } }) as Job[]
  const list: Candidate[] = []
  for (const q of quotes) {
    for (const j of jobs.filter(x => x.quoteId === q.id)) {
      if (await jobInstalled(accountId, j)) continue
      list.push({ quoteId: q.id, jobId: j.id, customerName: q.customerName, address: q.customerAddress, priceCents: priceCents(q), signedOn: ymdOf(q.acceptedAt ?? q.soldAt), jobStatus: j.status })
      break
    }
  }
  list.sort((a, b) => a.customerName.localeCompare(b.customerName))
  return { list, older: quotes.length - list.length }
}

/**
 * Was Florida's 713.015 notice given on this contract? On the signed contract itself (its proposal carried it), or
 * by the signed addendum (counts the same for the owner's lien clock); `needed: false` at $2,500 or less.
 */
export async function noticeGiven(accountId: string, quoteId: string | null | undefined): Promise<{ needed: boolean; given: boolean; how: 'contract' | 'addendum' | null; signedOn: string | null }> {
  const q = quoteId ? await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId }, select: { finalPrice: true, proposal: true } }) : null
  if (!q) return { needed: false, given: false, how: null, signedOn: null }
  if (hasNotice(q)) return { needed: true, given: true, how: 'contract', signedOn: null }
  const a = await prisma.lienNoticeAddendum.findUnique({ where: { quoteId: quoteId! }, select: { signedAt: true, accountId: true } })
  if (a?.signedAt && a.accountId === accountId) return { needed: true, given: true, how: 'addendum', signedOn: ymdOf(a.signedAt) }
  return { needed: priceCents(q) > LIEN_NOTICE_OVER_CENTS, given: false, how: null, signedOn: null }
}

/** The owner's attorney review mark on the addendum, or null (locked). */
export async function addendumReview(accountId: string): Promise<{ at: string; by: string } | null> {
  const v = (await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: ADDENDUM_REVIEW_KEY } } }))?.value as Json
  return v && typeof v.at === 'string' && v.at ? { at: v.at, by: String(v.by ?? '') } : null
}

/** The owner marks it reviewed by an attorney (or takes the mark off). The caller checks it is the owner. */
export async function setAddendumReview(accountId: string, reviewed: boolean, by: { userId: string; name: string }): Promise<{ at: string; by: string } | null> {
  const value = reviewed ? { at: new Date().toISOString(), by: by.name } : {}
  await prisma.accountKeyValue.upsert({
    where: { accountId_key: { accountId, key: ADDENDUM_REVIEW_KEY } },
    create: { accountId, key: ADDENDUM_REVIEW_KEY, value, updatedBy: by.userId },
    update: { value, updatedBy: by.userId, version: { increment: 1 } },
  })
  return addendumReview(accountId)
}

export type AddendumState = 'locked' | 'ready' | 'sent' | 'signed'
export const stateOf = (row: Pick<Row, 'signedAt' | 'sentAt'> | null, reviewed: boolean): AddendumState =>
  row?.signedAt ? 'signed' : !reviewed ? 'locked' : row?.sentAt ? 'sent' : 'ready'

export interface ContractFacts { customerName: string; address: string; priceCents: number; signedOn: string | null; fence: string }

async function factsOf(q: Quote): Promise<ContractFacts> {
  return {
    customerName: q.customerName, address: q.customerAddress, priceCents: priceCents(q), signedOn: ymdOf(q.acceptedAt ?? q.soldAt),
    // The fence as the customer reads it (sections used, never "(best price)"; Jonathan, Nov 6 2026).
    fence: customerFenceName(await plainStyleName(q.fenceStyle), soldRailsOf(q as Json)),
  }
}

/** The line above the notice naming the contract it is added to. Plain facts only: the notice's words are the statute's. */
export function contractLine(company: string, f: ContractFacts): string {
  const parts = [`This addendum is part of the contract between ${company} and ${f.customerName || 'the owner'}`]
  if (f.address) parts.push(`for ${f.address}`)
  if (f.signedOn) parts.push(`signed ${dayWords(f.signedOn)}`)
  return `${parts.join(', ')}${f.fence ? ` (${f.fence}, ${usd(f.priceCents)})` : ` (${usd(f.priceCents)})`}.`
}

export async function companyOf(accountId: string): Promise<{ name: string; phone: string }> {
  const c = ((await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }))?.config as Json)?.company ?? {}
  return { name: String(c.name || 'Getter Done Fence'), phone: String(c.phone || '') }
}

export const summaryOf = (r: Row) => ({
  id: r.id, token: r.token, link: addendumUrl(r.token), createdAt: r.createdAt.toISOString(), createdBy: r.createdBy,
  sentAt: r.sentAt?.toISOString() ?? null, sentChannel: r.sentChannel, sentBy: r.sentBy, sentTo: r.sentTo,
  openCount: r.openCount, lastOpenedAt: r.lastOpenedAt?.toISOString() ?? null,
  signedAt: r.signedAt?.toISOString() ?? null, signedBy: r.signedBy, signedDocumentId: r.signedDocumentId,
})

/**
 * The addendum on a job: whether it applies (a candidate now, or one already made), its state, the review mark,
 * the contract it names and the words. `applies: false` for an installed job or a contract that has the notice.
 */
export async function addendumForJob(accountId: string, jobId: string) {
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null }, select: JOB_SELECT }) as Job | null
  if (!job) throw new SubError(404, 'That job is not there any more.')
  const q = job.quoteId ? await prisma.savedQuote.findFirst({ where: { id: job.quoteId, accountId }, select: QUOTE_SELECT }) as Quote | null : null
  const row = q ? await prisma.lienNoticeAddendum.findUnique({ where: { quoteId: q.id } }) : null
  const review = await addendumReview(accountId)
  // A signed addendum stays with its contract. One not signed yet applies only while the contract still needs it:
  // not deleted or Lost, still without the notice (review Nov 6 2026: a cancelled contract could still be signed).
  const applies = !!q && (row?.signedAt ? true : row ? contractMissesNotice(q) : (contractMissesNotice(q) && !job.archivedAt && !(await jobInstalled(accountId, job))))
  if (!q || !applies) return { applies: false as const }
  const company = await companyOf(accountId)
  const facts: ContractFacts = row
    ? { customerName: row.customerName, address: row.customerAddress, priceCents: row.contractCents, signedOn: row.contractSignedOn, fence: row.contractFence }
    : await factsOf(q)
  const state = stateOf(row, !!review)
  const first = (q.customerName || '').trim().split(/\s+/)[0] || 'there'
  return {
    applies: true as const, jobId, quoteId: q.id, state, reviewed: review, lockedWhy: review ? null : ADDENDUM_LOCKED,
    title: ADDENDUM_TITLE, contract: facts, contractLine: contractLine(company.name, facts), notice: row?.noticeText ?? LIEN_NOTICE_713015,
    customer: { name: q.customerName, firstName: first, phone: q.customerPhone || '', email: q.customerEmail || '' },
    addendum: row ? summaryOf(row) : null,
  }
}

/** The text the office sends (email body and the text message). */
export const messageOf = (firstName: string, company: string, url: string) =>
  `Hi ${firstName}, here is Florida's construction lien notice for your fence contract with ${company}. Please read and sign it here: ${url}`

/**
 * The office sends it (billing.change): refused while locked, once signed, or when the job does not get one. Makes
 * the addendum the first time (the contract's facts and the notice kept as sent). Email goes through the server's
 * email (the outbound gate holds it anywhere but the live install); text and copy are the office's own phone.
 */
export async function sendAddendum(accountId: string, jobId: string, channel: 'email' | 'text' | 'copy', by: string) {
  const v = await addendumForJob(accountId, jobId)
  if (!v.applies) throw new SubError(409, 'This contract does not need the addendum: it has the notice, is $2,500 or less, was cancelled or deleted, or the job is installed.')
  if (!v.reviewed) throw new SubError(409, ADDENDUM_LOCKED)
  if (v.state === 'signed') throw new SubError(409, `Already signed by ${v.addendum?.signedBy} on ${dayWords(ymdOf(new Date(v.addendum!.signedAt!)))}.`)
  if (channel === 'email' && !v.customer.email.trim()) throw new SubError(400, 'Email it: add an email to the customer first.')
  if (channel === 'text' && !v.customer.phone.trim()) throw new SubError(400, 'Text it: add a phone number to the customer first.')
  const q = await prisma.savedQuote.findFirst({ where: { id: v.quoteId, accountId }, select: QUOTE_SELECT }) as Quote
  let row = await prisma.lienNoticeAddendum.findUnique({ where: { quoteId: q.id } })
  if (!row) {
    const f = v.contract
    row = await prisma.lienNoticeAddendum.upsert({
      where: { quoteId: q.id }, update: {},
      create: {
        accountId, quoteId: q.id, jobId, crmContactId: q.crmContactId, token: crypto.randomBytes(24).toString('base64url'), noticeText: LIEN_NOTICE_713015,
        customerName: f.customerName, customerAddress: f.address, contractCents: f.priceCents, contractSignedOn: f.signedOn, contractFence: f.fence, createdBy: by,
      },
    })
  }
  const company = await companyOf(accountId)
  const link = addendumUrl(row.token)
  const message = messageOf(v.customer.firstName, company.name, link)
  let how = channel === 'text' ? 'text from your phone' : 'link copied'
  // Text: sent from the office's phone on the tap. Copy link: nothing reached the customer yet, so not marked sent.
  let sent = channel === 'text'
  if (channel === 'email') {
    const { sendEmail } = await import('./emailService.js')
    const r: Json = await sendEmail({
      to: v.customer.email.trim(), subject: `${company.name}: Florida construction lien notice for your fence contract`,
      body: `<p>${message.replace(link, `<a href="${link}">${link}</a>`)}</p><p>${company.name}${company.phone ? `<br>${formatPhonesIn(company.phone)}` : ''}</p>`,
      text: `${message}\n\n${company.name}${company.phone ? `\n${formatPhonesIn(company.phone)}` : ''}`,
    }).catch(e => ({ success: false, error: String(e) }))
    sent = !!r.success
    how = r.success ? 'email' : r.held ? 'email held in the dev outbox, not sent' : r.notConfigured ? 'not sent: email is not set up' : `not sent: ${r.error ?? 'email failed'}`
  }
  if (sent) {
    row = await prisma.lienNoticeAddendum.update({ where: { id: row.id }, data: { sentAt: new Date(), sentChannel: channel, sentBy: by, sentTo: channel === 'email' ? v.customer.email.trim() : channel === 'text' ? v.customer.phone : null } })
  }
  return { sent, how, link, message, addendum: summaryOf(row) }
}

/** The addendum on a customer link (null: no such link, or its quote was deleted). */
export async function addendumByToken(token: string): Promise<Row | null> {
  if (!token || token.length < 20 || token.length > 100) return null
  const row = await prisma.lienNoticeAddendum.findUnique({ where: { token } })
  if (!row) return null
  // A signed one stays readable (the customer's copy); one not signed yet only while its contract still needs it.
  const q = await prisma.savedQuote.findFirst({ where: { id: row.quoteId, accountId: row.accountId }, select: QUOTE_SELECT }) as Quote | null
  if (!q || q.deletedAt) return null
  if (row.signedAt) return row
  const job = row.jobId ? await prisma.savedJob.findFirst({ where: { id: row.jobId, accountId: row.accountId }, select: { deletedAt: true } }) : null
  return contractMissesNotice(q) && !job?.deletedAt ? row : null
}

const pngOf = (dataUrl: string): Buffer | null => {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return null
  const b = Buffer.from(m[1], 'base64')
  return b.length > 60 && b.length < 2_000_000 ? b : null
}

/**
 * The customer signs on the link: refused while locked (the review mark taken off), once only; the signed PDF is
 * stored with the contract's signed documents and the owner is told.
 */
export async function signAddendum(token: string, input: { name: string; signature: string; ip: string | null; userAgent: string | null }): Promise<{ again: boolean; row: Row }> {
  const row = await addendumByToken(token)
  if (!row) throw new SubError(404, 'This paper is not available. Please call us.')
  if (row.signedAt) return { again: true, row }
  if (!(await addendumReview(row.accountId))) throw new SubError(409, 'This paper is not available. Please call us.')
  const name = String(input.name ?? '').trim().slice(0, 200)
  if (!name) throw new SubError(400, 'Please type your name.')
  if (!pngOf(String(input.signature ?? ''))) throw new SubError(400, 'Please sign in the box.')
  const n = await prisma.lienNoticeAddendum.updateMany({ where: { id: row.id, signedAt: null }, data: { signedAt: new Date(), signedBy: name, signature: input.signature, signedIp: input.ip, signedUserAgent: input.userAgent?.slice(0, 500) ?? null } })
  if (!n.count) return { again: true, row: (await prisma.lienNoticeAddendum.findUnique({ where: { id: row.id } }))! }
  const { fileSignedLienNotice } = await import('./signedDocuments.js')
  const filed = await fileSignedLienNotice(row.id)
  const done = (await prisma.lienNoticeAddendum.update({ where: { id: row.id }, data: { signedDocumentId: filed?.doc.id ?? null } }))
  const { sendPush } = await import('./automations/push.js')
  const owners = (await prisma.crmUser.findMany({ where: { crmAccountId: row.accountId, role: 'super_admin' }, select: { id: true } })).map(u => u.id)
  await sendPush(row.accountId, { title: `${row.customerName} signed the lien notice`, body: "Florida's construction lien notice (addendum) is signed and filed with the contract.", url: row.jobId ? `/operations?job=${row.jobId}` : '/operations', tag: `lien-notice-${row.id}` }, { userIds: owners }).catch(() => null)
  return { again: false, row: done }
}

/** The signed addendum: one page, the contract named, the notice in 12 point bold capitals, signed and dated. */
export function addendumPdf(c: { company: string; line: string; notice: string; name: string; signature: Buffer | null; at: Date; ip: string | null }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = pdfDocument({ size: 'LETTER', margin: 54, info: { Title: `${ADDENDUM_TITLE} - ${c.name}`, Author: c.company } })
    const chunks: Buffer[] = []
    doc.on('data', b => chunks.push(b))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    const L = 54, W = doc.page.width - 108
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000').text(pdfSafeText(c.company), L, 48, { width: W })
    doc.font('Helvetica').fontSize(9.5).fillColor('#333').text(pdfSafeText(`Addendum to your contract. ${c.line}`), L, doc.y + 2, { width: W })
    doc.moveDown(0.8)
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#000').text('NOTICE: FLORIDA CONSTRUCTION LIEN LAW', L, doc.y, { width: W, align: 'center' })
    doc.moveDown(0.6)
    doc.font('Helvetica-Bold').fontSize(12).text(pdfSafeText(c.notice.toUpperCase()), L, doc.y, { width: W, lineGap: 1.5 })
    doc.moveDown(1.2)
    const y = doc.y
    if (c.signature) { try { doc.image(c.signature, L, y, { fit: [220, 64] }) } catch { /* unreadable ink */ } }
    doc.moveTo(L, y + 68).lineTo(L + 260, y + 68).strokeColor('#000').stroke()
    const day = c.at.toLocaleDateString('en-US', { timeZone: TZ, month: 'long', day: 'numeric', year: 'numeric' })
    doc.font('Helvetica-Bold').fontSize(11).text(pdfSafeText(`Owner: ${c.name}`), L, y + 74, { width: W })
    doc.font('Helvetica').fontSize(10).text(`Date: ${day}`, L, doc.y + 2, { width: W })
    const when = c.at.toLocaleString('en-US', { timeZone: TZ, dateStyle: 'long', timeStyle: 'short' })
    doc.font('Helvetica').fontSize(8.5).fillColor('#444').text(pdfSafeText(`Signed by ${c.name} on ${when} Eastern${c.ip ? `, from ${c.ip}` : ''}, on the link sent to them.`), L, doc.y + 6, { width: W })
    doc.end()
  })
}
