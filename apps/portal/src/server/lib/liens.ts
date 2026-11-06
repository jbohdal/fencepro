/**
 * Liens (Jonathan, Nov 6 2026; the owner only). When a customer does not pay,
 * the lien process is ready to go.
 *
 *   The clock: day 0 is the job's final furnishing date (set when the install
 *   is confirmed). The Claim of Lien must be recorded by day 90 (s. 713.08(5)).
 *   While the final payment has not cleared, the owner is pushed at day 30, 60,
 *   75 and 85, and the dashboard shows the days.
 *
 *   One tap actions, each kept on the job with its day and how it was sent:
 *   a payment reminder letter; a notice of intent to lien (a PDF for certified
 *   mail); the Claim of Lien (a PDF filled in: owner, property, parcel ID, the
 *   legal description the owner types, amount owed, first and last day of work,
 *   what was furnished), then its checklist (notarized; recorded with the clerk:
 *   day and instrument number; served on the owner within 15 days: day, method,
 *   tracking, with a countdown); the Contractor's Final Payment Affidavit (to the
 *   owner at least 5 days before any suit, s. 713.06(3)(d)); a year to sue after
 *   recording, or 60 days from a Notice of Contest (s. 713.22); the Release of
 *   Lien once paid, with a task to record it.
 *
 * Every paper is locked "Attorney review required" until the owner marks it
 * reviewed (lib/subcontractors.ts TEMPLATES, sub settings reviews). These are
 * forms for the owner to sign, notarize and record; nothing is filed for him.
 */

import crypto from 'crypto'
import prisma from './prisma.js'
import { floridaDay } from './automations/context.js'
import { plusDays, usDate, isYmd, type Ymd } from './installDays.js'
import { clearedCover } from './paymentClearing.js'
import { subSettingsOf, SubError, TEMPLATES, type TemplateKey } from './subcontractors.js'
import { pdfDocument, pdfSafeText } from './pdfText.js'
import { storeFile } from './storage/index.js'
import { noticeGiven } from './lienNoticeAddendum.js'

type Json = any
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const daysBetween = (a: Ymd, b: Ymd) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export const LIEN_DEADLINE_DAYS = 90
export const LIEN_PUSH_DAYS = [30, 60, 75, 85]
export type LienKind = 'reminder' | 'notice_of_intent' | 'claim_of_lien' | 'final_affidavit' | 'release'
const TEMPLATE_OF: Record<LienKind, TemplateKey> = {
  reminder: 'payment_reminder', notice_of_intent: 'notice_of_intent', claim_of_lien: 'claim_of_lien', final_affidavit: 'final_affidavit', release: 'owner_release',
}
export const LIEN_KIND_LABEL: Record<LienKind, string> = {
  reminder: 'Payment reminder', notice_of_intent: 'Notice of intent to lien', claim_of_lien: 'Claim of Lien',
  final_affidavit: "Contractor's Final Payment Affidavit", release: 'Release of Lien',
}

export interface LienClock {
  finalFurnishingDate: Ymd | null
  day: number | null
  deadline: Ymd | null
  daysLeft: number | null
  owedCents: number
  contractCents: number
  clearedCents: number
  open: boolean
  /** Recorded: serve the owner within 15 days of recording. */
  serveBy: Ymd | null
  /** A year from recording to sue, or 60 days from a Notice of Contest. */
  suitBy: Ymd | null
}

/** The job's lien clock (pure): from the final furnishing date, what is still owed (cleared payments only), the case. */
export function clockOf(ffd: string | null | undefined, cover: { contractCents: number; clearedCents: number } | null, c: { recordedOn?: string | null; contestOn?: string | null; servedOn?: string | null; releasedOn?: string | null } | null, today: Ymd): LienClock {
  const f = isYmd(ffd) ? ffd : null
  const owed = cover ? Math.max(0, cover.contractCents - cover.clearedCents) : 0
  const deadline = f ? plusDays(f, LIEN_DEADLINE_DAYS) : null
  const suitBy = c?.contestOn && isYmd(c.contestOn) ? plusDays(c.contestOn, 60) : c?.recordedOn && isYmd(c.recordedOn) ? plusDays(c.recordedOn, 365) : null
  return {
    finalFurnishingDate: f, day: f ? daysBetween(f, today) : null, deadline, daysLeft: deadline ? daysBetween(today, deadline) : null,
    owedCents: owed, contractCents: cover?.contractCents ?? 0, clearedCents: cover?.clearedCents ?? 0,
    open: !!f && owed > 0 && !c?.releasedOn,
    serveBy: c?.recordedOn && isYmd(c.recordedOn) && !c.servedOn ? plusDays(c.recordedOn, 15) : null,
    suitBy,
  }
}

/** The job's final furnishing date: set on the job (a sub's confirm, or typed by the owner), else its completed day. */
export const ffdOf = (job: { finalFurnishingDate?: string | null; completedDate?: string | null }): string | null =>
  isYmd(job.finalFurnishingDate) ? job.finalFurnishingDate : isYmd(job.completedDate) ? job.completedDate : null

export async function lienCaseOf(accountId: string, jobId: string) {
  return prisma.lienCase.findUnique({ where: { jobId } }).then(c => (c && c.accountId === accountId ? c : null))
}

export async function lienView(accountId: string, jobId: string) {
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null } })
  if (!job) throw new SubError(404, 'That job is not there any more.')
  const [c, cover, settings] = await Promise.all([lienCaseOf(accountId, jobId), clearedCover(accountId, jobId), subSettingsOf(accountId)])
  const parcelId = c?.parcelId || await parcelOf(accountId, jobId)
  return {
    // Day 0: the final furnishing date (a sub's job, confirmed), else the day our own crew completed the job.
    clock: clockOf(ffdOf(job), cover, c, floridaDay(new Date())),
    case: c ? { ...c, parcelId } : { parcelId, legalDescription: '', furnished: '', actions: [] as Json[] },
    reviewed: Object.fromEntries((Object.keys(TEMPLATE_OF) as LienKind[]).map(k => [k, !!settings.reviews[TEMPLATE_OF[k]]])),
    job: { id: job.id, customerName: job.customerName, address: job.customerAddress, startedOn: job.scheduledDate, finalFurnishingDate: ffdOf(job), ffdSet: !!job.finalFurnishingDate },
    // Florida's 713.015 notice: on the contract, or given by the signed addendum (lib/lienNoticeAddendum.ts).
    notice: await noticeGiven(accountId, job.quoteId),
  }
}

/** The parcel ID from the job's site plan, when the plan found the lot (lib/parcels.ts). */
async function parcelOf(accountId: string, jobId: string): Promise<string> {
  const plan = await prisma.sitePlan.findUnique({ where: { jobId }, select: { data: true, accountId: true } }).catch(() => null)
  if (!plan || plan.accountId !== accountId) return ''
  const p = (plan.data as Json)?.parcel
  return String(p?.id ?? p?.parcelId ?? p?.number ?? '').slice(0, 60)
}

/** The case's typed facts and checklist (legal description, notarized, recorded, served, contest, suit, released). */
export async function saveLienFacts(accountId: string, jobId: string, b: Partial<{ legalDescription: string; parcelId: string; furnished: string; notarizedOn: string | null; recordedOn: string | null; instrumentNumber: string; servedOn: string | null; serveMethod: string; serveTracking: string; contestOn: string | null; suitFiledOn: string | null }>) {
  const today = floridaDay(new Date())
  for (const k of ['notarizedOn', 'recordedOn', 'servedOn', 'contestOn', 'suitFiledOn'] as const) {
    const v = b[k]
    if (v != null && v !== '' && (!isYmd(v) || v > today)) throw new SubError(400, 'Dates are the day it happened (today or before).')
    if (v === '') b[k] = null
  }
  const was = await lienCaseOf(accountId, jobId)
  const recorded = b.recordedOn !== undefined ? b.recordedOn : was?.recordedOn
  const instrument = b.instrumentNumber !== undefined ? b.instrumentNumber : was?.instrumentNumber
  if (recorded && !String(instrument ?? '').trim()) throw new SubError(400, 'Give the instrument number the clerk recorded it under.')
  const data = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 4000) : v]))
  return prisma.lienCase.upsert({ where: { jobId }, create: { accountId, jobId, ...data }, update: data })
}

// ── The papers ───────────────────────────────────────────────────────────────

/** The lienor as the papers name it: the company's legal name (Settings → Company), its address and phone. */
async function companyOf(accountId: string) {
  const c = ((await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }))?.config as Json)?.company ?? {}
  const street = String(c.address ?? '').trim()
  const address = street ? [street, c.city, c.state, c.zip].filter(x => String(x ?? '').trim()).join(', ') : ''
  const digits = String(c.phone || '').replace(/\D/g, '').slice(-10)
  const phone = digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)} ${digits.slice(6)}` : String(c.phone || '')
  return { name: String(c.legalName || c.name || 'Getter Done Fence').trim(), phone, address }
}

/** The words of a paper for this job, filled in (what the attorney reviews; the PDF prints exactly these). */
export async function paperWords(accountId: string, jobId: string, kind: LienKind): Promise<{ title: string; text: string }> {
  const v = await lienView(accountId, jobId)
  return wordsFrom(accountId, jobId, kind, v as Json, await companyOf(accountId))
}

/** The words with blanks where the job's facts go, for the attorney to read before the owner marks it reviewed. */
export async function sampleWords(accountId: string, kind: LienKind): Promise<{ title: string; text: string }> {
  const co = await companyOf(accountId)
  const v = {
    job: { customerName: '(OWNER NAME)', address: '(PROPERTY ADDRESS)', startedOn: null },
    case: { legalDescription: '(LEGAL DESCRIPTION)', parcelId: '(PARCEL ID)', furnished: '', recordedOn: null, instrumentNumber: '(INSTRUMENT NUMBER)' },
    clock: { finalFurnishingDate: null, deadline: null, owedCents: 0, contractCents: 0 },
  }
  const words = await wordsFrom(accountId, null, kind, v, { ...co, address: co.address || '(COMPANY ADDRESS)' })
  return { title: words.title, text: words.text.replace(/\$0\.00/g, '$(AMOUNT)') }
}

async function wordsFrom(accountId: string, jobId: string | null, kind: LienKind, v: Json, co: { name: string; phone: string; address: string }): Promise<{ title: string; text: string }> {
  const j = v.job, c = v.case as Json, k = v.clock
  const county = /ocala|marion/i.test(j.address) ? 'Marion' : '____________'
  const first = j.startedOn && isYmd(j.startedOn) ? usDate(j.startedOn) : '____________'
  const last = k.finalFurnishingDate ? usDate(k.finalFurnishingDate) : '____________'
  const legal = c.legalDescription?.trim() || '(legal description of the real property)'
  const furnished = c.furnished?.trim() || 'fence installation: labor, services and materials'
  const today = usDate(floridaDay(new Date()))
  const sub = jobId ? await prisma.subJob.findFirst({ where: { accountId, jobId }, include: { sub: { select: { businessName: true } } } }) : null
  if (kind === 'reminder') return { title: 'Payment reminder', text: `${today}

${j.customerName}
${j.address}

Dear ${j.customerName},

Our records show a balance of ${money(k.owedCents)} on your fence at ${j.address}, installed and completed on ${last}. Please pay the balance at your earliest convenience. If you have already sent it, thank you, and please disregard this letter.

Questions: ${co.phone || 'call our office'}.

${co.name}` }
  if (kind === 'notice_of_intent') return { title: 'NOTICE OF INTENT TO FILE A CLAIM OF LIEN', text: `${today}

To: ${j.customerName}
${j.address}

Property: ${j.address}${c.parcelId ? `, parcel ID ${c.parcelId}` : ''}

${co.name} furnished ${furnished} to the property above, from ${first} through ${last}, under its contract with you. A balance of ${money(k.owedCents)} remains unpaid.

Unless the balance is paid in full within 10 days of this notice, ${co.name} intends to record a Claim of Lien against the property under Florida's Construction Lien Law (Chapter 713, Florida Statutes). The Claim of Lien must be recorded within 90 days of the last day of work (${k.deadline ? usDate(k.deadline) : '____'}).

To pay or to talk about the balance: ${co.phone || 'call our office'}.

${co.name}
${co.address}

Sent by certified mail, return receipt requested.` }
  if (kind === 'claim_of_lien') return { title: 'CLAIM OF LIEN', text: `WARNING! THIS LEGAL DOCUMENT REFLECTS THAT A CONSTRUCTION LIEN HAS BEEN PLACED ON THE REAL PROPERTY LISTED HEREIN. UNLESS THE OWNER OF SUCH PROPERTY TAKES ACTION TO SHORTEN THE TIME PERIOD, THIS LIEN MAY REMAIN VALID FOR ONE YEAR FROM THE DATE OF RECORDING, AND SHALL EXPIRE AND BECOME NULL AND VOID THEREAFTER UNLESS LEGAL PROCEEDINGS HAVE BEEN COMMENCED TO FORECLOSE OR TO DISCHARGE THIS LIEN.

CLAIM OF LIEN

State of Florida
County of ${county}

Before me, the undersigned notary public, personally appeared ____________________, who was duly sworn and says that he or she is the agent of the lienor herein, ${co.name}, whose address is ${co.address || '____________________'}; and that in accordance with a contract with ${j.customerName}, lienor furnished labor, services, or materials consisting of ${furnished} on the following described real property in ${county} County, Florida:

${legal}
Street address: ${j.address}${c.parcelId ? `\nParcel ID: ${c.parcelId}` : ''}

owned by ${j.customerName} of a total value of ${money(k.contractCents)}, of which there remains unpaid ${money(k.owedCents)}, and furnished the first of the items on ${first}, and the last of the items on ${last}.

_______________________________________
(Signature of lienor's agent)

Sworn to (or affirmed) and subscribed before me by means of [ ] physical presence or [ ] online notarization, this ____ day of ______________, ______, by ____________________.

_______________________________________
(Signature of Notary Public, State of Florida)
(Print, type, or stamp commissioned name of Notary Public)

Personally known ____ OR Produced identification ____ Type of identification produced ____________` }
  if (kind === 'final_affidavit') return { title: "CONTRACTOR'S FINAL PAYMENT AFFIDAVIT", text: `State of Florida
County of ${county}

Before me, the undersigned authority, personally appeared ____________________ who, after being first duly sworn, deposes and says of his or her personal knowledge the following:

1. He or she is the ____________________ of ${co.name}, which does business in the State of Florida, hereinafter referred to as the "Contractor."

2. Contractor, pursuant to a contract with ${j.customerName}, hereinafter referred to as the "Owner," has furnished or caused to be furnished labor, materials, and services for the improvement of the real property as follows: ${j.address}${c.parcelId ? ` (parcel ID ${c.parcelId})` : ''}; ${legal}.

3. This affidavit is executed by the Contractor in accordance with section 713.06 of the Florida Statutes for the purposes of obtaining final payment from the Owner in the amount of ${money(k.owedCents)}.

4. All work to be performed under the contract has been fully completed, and all lienors under the direct contract have been paid in full, except the following listed lienors:

NAME OF LIENOR                          AMOUNT DUE
${sub && !sub.paidAt ? `${sub.sub.businessName.padEnd(40)}${money(sub.payCents)}` : '(none)'}

Signed, sealed, and delivered this ____ day of ______________, ______.

${co.name}
By: _______________________________________

Sworn to (or affirmed) and subscribed before me this ____ day of ______________, ______, by ____________________.

_______________________________________
(Signature of Notary Public, State of Florida)

To the Owner at least 5 days before any suit to enforce the lien.` }
  return { title: 'RELEASE OF LIEN', text: `State of Florida
County of ${county}

KNOW ALL MEN BY THESE PRESENTS, that ${co.name}, the lienor, for and in consideration of payment in full, hereby releases and discharges the Claim of Lien recorded on ${c.recordedOn ? usDate(c.recordedOn) : '____________'}${c.instrumentNumber ? `, instrument number ${c.instrumentNumber},` : ''} in the Official Records of ${county} County, Florida, against the following described real property:

${legal}
Street address: ${j.address}${c.parcelId ? `\nParcel ID: ${c.parcelId}` : ''}

owned by ${j.customerName}, and consents that the same be cancelled of record.

Dated ${today}.

${co.name}
By: _______________________________________

Sworn to (or affirmed) and subscribed before me this ____ day of ______________, ______, by ____________________.

_______________________________________
(Signature of Notary Public, State of Florida)` }
}

/**
 * Make one of the papers (refused while it still needs the attorney's review) and keep the action on the job with
 * its day and how it was sent (mail, certified mail, email, handed, recorded...). Returns the PDF.
 */
export async function makePaper(accountId: string, jobId: string, kind: LienKind, how: string, by: string, note = ''): Promise<{ pdf: Buffer; action: Json }> {
  const settings = await subSettingsOf(accountId)
  if (!settings.reviews[TEMPLATE_OF[kind]]) throw new SubError(409, `Attorney review required: the ${TEMPLATES[TEMPLATE_OF[kind]]} is locked until the owner marks it reviewed (Subcontractors → Settings).`)
  const v = await lienView(accountId, jobId)
  if (!v.clock.finalFurnishingDate) throw new SubError(409, 'This job has no final furnishing date yet (confirm the install first).')
  if (kind === 'release' && v.clock.owedCents > 0) throw new SubError(409, `Not paid yet: ${money(v.clock.owedCents)} has not cleared.`)
  if (kind !== 'release' && kind !== 'final_affidavit' && v.clock.owedCents <= 0) throw new SubError(409, 'Nothing is owed: the payments cover the contract.')
  if (kind === 'claim_of_lien' && !(v.case as Json).legalDescription?.trim()) throw new SubError(400, 'Type the legal description of the property first (from the deed or the Property Appraiser).')
  if (!(await companyOf(accountId)).address) throw new SubError(409, 'The company address is blank: fill it in under Settings → Company first (the papers name the lienor and its address).')
  const words = await paperWords(accountId, jobId, kind)
  const pdf = await paperPdf(words.title, words.text)
  const stored = storeFile(pdf, `${kind}-${jobId}.pdf`, accountId)
  const action = { id: crypto.randomUUID(), kind, at: new Date().toISOString(), day: floridaDay(new Date()), how: how.trim().slice(0, 120) || 'printed', by, note: note.slice(0, 500), documentPath: stored.storagePath, owedCents: v.clock.owedCents }
  const c = await prisma.lienCase.upsert({ where: { jobId }, create: { accountId, jobId, actions: [action] as Json }, update: {} })
  if (c.actions && (c.actions as Json[]).every(a => a.id !== action.id)) await prisma.lienCase.update({ where: { id: c.id }, data: { actions: [...(c.actions as Json[]), action] as Json } })
  // Paid: the Release of Lien, and a task to record it with the clerk.
  if (kind === 'release') {
    await prisma.lienCase.update({ where: { id: c.id }, data: { releasedOn: floridaDay(new Date()) } })
    const job = await prisma.savedJob.findUnique({ where: { id: jobId }, select: { customerName: true } })
    await prisma.task.create({ data: { title: `Record the Release of Lien: ${job?.customerName ?? ''}`.slice(0, 200), description: 'Have it notarized and record it with the Clerk of Court where the Claim of Lien was recorded.', jobId, jobName: job?.customerName ?? '', dueDate: new Date(Date.now() + 7 * 86_400_000), priority: 'high', createdBy: 'liens', assignedRole: 'owner' } })
  }
  return { pdf, action }
}

function paperPdf(title: string, text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = pdfDocument({ size: 'LETTER', margin: 60, info: { Title: title } })
    const chunks: Buffer[] = []
    doc.on('data', b => chunks.push(b))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.font('Helvetica-Bold').fontSize(14).text(pdfSafeText(title), { align: 'center' })
    doc.moveDown(1)
    doc.font(/^WARNING!/.test(text) ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).text(pdfSafeText(text), { lineGap: 2 })
    doc.end()
  })
}

/** The owner's pushes at day 30, 60, 75 and 85 while the final payment has not cleared (each once). */
export async function lienSweep(now = new Date()): Promise<number> {
  const today = floridaDay(now)
  // Day 30 to 90 back: jobs whose final furnishing date (or completed day) is in that window.
  const from = plusDays(today, -LIEN_DEADLINE_DAYS), to = plusDays(today, -LIEN_PUSH_DAYS[0])
  const jobs = (await prisma.savedJob.findMany({ where: { deletedAt: null, archivedAt: null, OR: [{ finalFurnishingDate: { gte: from, lte: to } }, { finalFurnishingDate: null, completedDate: { gte: from, lte: to } }] }, select: { id: true, accountId: true, customerName: true, finalFurnishingDate: true, completedDate: true } }))
    .map(j => ({ ...j, finalFurnishingDate: ffdOf(j) })).filter(j => j.finalFurnishingDate)
  let n = 0
  for (const j of jobs) {
    const day = daysBetween(j.finalFurnishingDate!, today)
    const due = LIEN_PUSH_DAYS.filter(d => day >= d && day <= LIEN_DEADLINE_DAYS)
    if (!due.length) continue
    const c = await lienCaseOf(j.accountId, j.id)
    if (c?.releasedOn || c?.recordedOn) continue
    const pushed: number[] = Array.isArray(c?.pushedDays) ? (c!.pushedDays as number[]) : []
    const mark = due.filter(d => !pushed.includes(d)).pop()
    if (mark === undefined) continue
    const cover = await clearedCover(j.accountId, j.id)
    const k = clockOf(j.finalFurnishingDate, cover, c, today)
    if (!k.open) continue
    const { sendPush } = await import('./automations/push.js')
    await sendPush(j.accountId, { title: `Lien clock day ${day}: ${j.customerName}`, body: `${money(k.owedCents)} not cleared. The Claim of Lien must be recorded by ${usDate(k.deadline!)} (${k.daysLeft} days).`, url: `/operations?job=${j.id}`, tag: `lien-${j.id}` }, { userIds: await ownerIds(j.accountId) }).catch(() => null)
    await prisma.lienCase.upsert({ where: { jobId: j.id }, create: { accountId: j.accountId, jobId: j.id, pushedDays: [...pushed, ...due] }, update: { pushedDays: [...new Set([...pushed, ...due])] } })
    n++
  }
  return n
}

async function ownerIds(accountId: string): Promise<string[]> {
  return (await prisma.crmUser.findMany({ where: { crmAccountId: accountId, role: 'super_admin' }, select: { id: true } })).map(u => u.id)
}
