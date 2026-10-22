/**
 * Signed documents (Jonathan, Oct 22 2026): "every signed contract shows on
 * the customer page under a Documents section with the signed date, signer
 * name, and a link to the signed PDF, and also on the quote and on the job it
 * became."
 *
 * The moment a customer accepts a proposal (routes/proposal.ts acceptQuote)
 * or signs a change order (lib/changeOrders.ts signByCustomer), its PDF is
 * made once and stored: the contract (lib/contractPdf.ts) or the change order
 * (lib/changeOrderPdf.ts), built only from what was signed (the proposal and
 * option frozen on the quote, the change order's lines) and the stored
 * signature, with the signed record on the last page: the typed name, the
 * date and time (America/New_York, with the zone), the IP and what was
 * accepted.
 *
 * Stored in the upload folder under signed/<company>/ (backed up with the
 * other uploads by deploy/mac/backup.sh), with:
 *
 *   SignedDocument   the signed record: kind, quote, change order, job, the
 *                    file, its SHA-256, when, by whom, the IP and browser.
 *                    `sourceKey` is unique, so a repeat accept, a retry or two
 *                    at once never make two.
 *   PortalFile       the customer's copy (kind contract, visible to the
 *                    customer), so it is in their files and their portal.
 *                    Made as soon as the quote has a customer.
 *
 * Nothing is sent to anyone. The on the fly contract (/p/<link>/contract.pdf,
 * /api/warranties/quote/<id>/contract.pdf) stays for the install date wording;
 * Documents opens the stored signed copy.
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import prisma from './prisma.js'
import { isUniqueViolation } from './once.js'
import { contractForQuote, acceptedOptionText, CONTRACT_SELECT } from './contractPdf.js'
import { changeOrderPdf, changeOrderAcceptedText } from './changeOrderPdf.js'
import { linesOf } from './changeOrders.js'
import { plainStyleName } from './estimates.js'
import { signedFileUrl } from './portalFiles.js'

const UPLOAD_DIR = () => process.env.UPLOAD_DIR || './uploads'
const TZ = 'America/New_York'

export type SignedKind = 'contract' | 'change_order'
export const contractKey = (quoteId: string) => `contract:${quoteId}`
export const changeOrderKey = (changeOrderId: string) => `change-order:${changeOrderId}`

type Doc = NonNullable<Awaited<ReturnType<typeof prisma.signedDocument.findUnique>>>
export type MadeBy = 'signing' | 'backfill'

/** A plain IP: "::ffff:1.2.3.4" as "1.2.3.4"; nothing usable is null. */
export function plainIp(ip: string | null | undefined): string | null {
  const v = String(ip ?? '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '').slice(0, 100)
  return v || null
}

const pngOf = (dataUrl: string | null | undefined): Buffer | null => {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '')
  return m ? Buffer.from(m[1], 'base64') : null
}

const dayWords = (d: Date) => d.toLocaleDateString('en-US', { timeZone: TZ, month: 'long', day: 'numeric', year: 'numeric' })

/** The job a quote became (open or closed, not deleted). */
async function jobOfQuote(accountId: string, quoteId: string): Promise<string | null> {
  const j = await prisma.savedJob.findFirst({ where: { accountId, quoteId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true } })
  return j?.id ?? null
}

interface StoreInput {
  accountId: string; sourceKey: string; kind: SignedKind; quoteId: string; changeOrderId: string | null; jobId: string | null
  contactId: string | null; pdf: Buffer; signedAt: Date; signedBy: string; ip: string | null; userAgent: string | null; madeBy: MadeBy
  fileName: string; label: string
}

/**
 * Write the PDF and its records, once. The file gets a name of its own per
 * attempt: when two attempts race, the one that lost removes its file and the
 * record that won is given back.
 */
async function store(s: StoreInput): Promise<{ doc: Doc; made: boolean }> {
  const slug = s.sourceKey.replace(/[^A-Za-z0-9-]+/g, '-')
  const fileKey = path.join('signed', s.accountId, `${slug}-${crypto.randomBytes(6).toString('hex')}.pdf`)
  const full = path.resolve(UPLOAD_DIR(), fileKey)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, s.pdf)
  try {
    const doc = await prisma.$transaction(async tx => {
      const file = s.contactId ? await tx.portalFile.create({
        data: {
          crmCustomerId: s.contactId, uploadedByUser: 'EZ Biz', fileKey, fileUrl: `/api/portal/files/${encodeURIComponent(fileKey)}`,
          originalFilename: s.fileName, fileSizeBytes: s.pdf.length, mimeType: 'application/pdf', fileKind: 'contract', source: 'system_generated',
          label: s.label, isVisibleToCustomer: true,
        },
      }) : null
      return tx.signedDocument.create({
        data: {
          accountId: s.accountId, sourceKey: s.sourceKey, kind: s.kind, quoteId: s.quoteId, changeOrderId: s.changeOrderId, jobId: s.jobId,
          portalFileId: file?.id ?? null, fileKey, fileSizeBytes: s.pdf.length, sha256: crypto.createHash('sha256').update(s.pdf).digest('hex'),
          signedAt: s.signedAt, signedBy: s.signedBy.slice(0, 200), signedIp: s.ip, signedUserAgent: s.userAgent?.slice(0, 500) ?? null, madeBy: s.madeBy,
        },
      })
    })
    return { doc, made: true }
  } catch (e) {
    fs.rmSync(full, { force: true })
    if (isUniqueViolation(e)) {
      const won = await prisma.signedDocument.findUnique({ where: { sourceKey: s.sourceKey } })
      if (won) return { doc: won, made: false }
    }
    throw e
  }
}

/**
 * An existing signed document: the customer's copy once the quote has a
 * customer, and the job once there is one. Never a new PDF.
 */
async function complete(doc: Doc, contactId: string | null, label: string, fileName: string): Promise<Doc> {
  let cur = doc
  if (!cur.jobId) {
    const jobId = await jobOfQuote(cur.accountId, cur.quoteId)
    if (jobId) cur = await prisma.signedDocument.update({ where: { id: cur.id }, data: { jobId } })
  }
  if (!cur.portalFileId && contactId) {
    const file = await prisma.portalFile.create({
      data: {
        crmCustomerId: contactId, uploadedByUser: 'EZ Biz', fileKey: cur.fileKey, fileUrl: `/api/portal/files/${encodeURIComponent(cur.fileKey)}`,
        originalFilename: fileName, fileSizeBytes: cur.fileSizeBytes, mimeType: 'application/pdf', fileKind: 'contract', source: 'system_generated', label, isVisibleToCustomer: true,
      },
    })
    const n = await prisma.signedDocument.updateMany({ where: { id: cur.id, portalFileId: null }, data: { portalFileId: file.id } })
    if (n.count === 0) await prisma.portalFile.delete({ where: { id: file.id } }).catch(() => {})
    cur = (await prisma.signedDocument.findUnique({ where: { id: cur.id } }))!
  }
  return cur
}

const safeName = (s: string) => s.replace(/[^\w .,'-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Customer'

/**
 * The signed contract of an accepted quote (acceptedAt set), stored once.
 * Null when the quote is not accepted or has no proposal to build it from.
 */
export async function fileSignedContract(quoteId: string, madeBy: MadeBy = 'signing'): Promise<{ doc: Doc; made: boolean } | null> {
  const q = await prisma.savedQuote.findUnique({ where: { id: quoteId }, select: { ...CONTRACT_SELECT, crmContactId: true, acceptedIp: true, acceptedUserAgent: true } })
  if (!q || !q.acceptedAt) return null
  const label = `Signed contract: ${await plainStyleName(q.fenceStyle)}`
  const fileName = `Signed contract - ${safeName(q.customerName)}.pdf`
  const have = await prisma.signedDocument.findUnique({ where: { sourceKey: contractKey(q.id) } })
  if (have) return { doc: await complete(have, q.crmContactId, label, fileName), made: false }
  const pdf = await contractForQuote(q, { at: q.acceptedAt, ip: plainIp(q.acceptedIp), accepted: acceptedOptionText(q) })
  if (!pdf) return null
  const out = await store({
    accountId: q.accountId, sourceKey: contractKey(q.id), kind: 'contract', quoteId: q.id, changeOrderId: null, jobId: await jobOfQuote(q.accountId, q.id),
    contactId: q.crmContactId, pdf, signedAt: q.acceptedAt, signedBy: q.acceptedBy || q.customerName, ip: plainIp(q.acceptedIp), userAgent: q.acceptedUserAgent, madeBy, fileName, label,
  })
  if (out.made) console.log(`[signed-documents] stored the signed contract of quote ${q.id} (${madeBy})`)
  return out
}

/** The signed change order (signed by the customer: a signature and a time), stored once. */
export async function fileSignedChangeOrder(changeOrderId: string, madeBy: MadeBy = 'signing'): Promise<{ doc: Doc; made: boolean } | null> {
  const co = await prisma.changeOrder.findUnique({ where: { id: changeOrderId } })
  if (!co || !co.signedAt || !co.signedBy || !co.signature || co.status === 'draft') return null
  const q = await prisma.savedQuote.findFirst({ where: { id: co.quoteId, accountId: co.accountId }, select: { id: true, customerName: true, customerAddress: true, finalPrice: true, crmContactId: true, proposal: true } })
  if (!q) return null
  const label = `Signed change order #${co.number}`
  const fileName = `Signed change order ${co.number} - ${safeName(q.customerName)}.pdf`
  const have = await prisma.signedDocument.findUnique({ where: { sourceKey: changeOrderKey(co.id) } })
  if (have) return { doc: await complete(have, q.crmContactId, label, fileName), made: false }
  const b = await prisma.businessState.findUnique({ where: { accountId: co.accountId }, select: { config: true } })
  const cfg = (b?.config as any)?.company ?? {}
  const p = (q.proposal as any)?.company ?? {}
  const ip = plainIp(co.signedIp)
  const pdf = await changeOrderPdf({
    company: { name: String(p.name || cfg.name || 'Getter Done Fence'), phone: String(p.phone || cfg.phone || ''), email: String(p.email || cfg.email || '') },
    number: co.number, customerName: q.customerName, address: q.customerAddress || '', reason: co.reason, lines: linesOf(co), totalCents: co.totalCents,
    originalCents: Math.round((q.finalPrice || 0) * 100), signedBy: co.signedBy, signedVia: co.signedVia, signature: pngOf(co.signature),
    record: { at: co.signedAt, ip, accepted: changeOrderAcceptedText(co.number, co.totalCents) },
  })
  const out = await store({
    accountId: co.accountId, sourceKey: changeOrderKey(co.id), kind: 'change_order', quoteId: q.id, changeOrderId: co.id, jobId: await jobOfQuote(co.accountId, q.id),
    contactId: q.crmContactId, pdf, signedAt: co.signedAt, signedBy: co.signedBy, ip, userAgent: co.signedUserAgent, madeBy, fileName, label,
  })
  if (out.made) console.log(`[signed-documents] stored the signed change order ${co.id} (#${co.number}) (${madeBy})`)
  return out
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface SignedDocumentView {
  id: string
  kind: SignedKind
  /** "Contract" or "Change order #2". */
  title: string
  /** What was signed: "Better: White vinyl privacy at $10,000.00", "Change order #2: total $450.00". */
  detail: string
  signedAt: string
  /** "October 22, 2026" (Florida time). */
  signedOn: string
  signedBy: string
  quoteId: string
  jobId: string | null
  changeOrderId: string | null
  /** Shown to the customer in their portal. */
  inPortal: boolean
  portalFileId: string | null
  /** The stored PDF, for staff: GET with the staff sign in. */
  pdf: string
}

/**
 * As shown. A document of a quote that was deleted (Settings > Deleted
 * Records) is not shown, like the quote; it is kept, and shows again when the
 * quote is restored.
 */
async function views(all: Doc[]): Promise<SignedDocumentView[]> {
  if (!all.length) return []
  const quotes = await prisma.savedQuote.findMany({ where: { id: { in: [...new Set(all.map(r => r.quoteId))] }, deletedAt: null }, select: { id: true, proposal: true, chosenOption: true, fenceStyle: true, finalPrice: true, acceptedAt: true } })
  const rows = all.filter(r => quotes.some(q => q.id === r.quoteId))
  // all rows: by the ids of these documents; a change order voided or deleted later still shows its number on what was signed.
  const cos = await prisma.changeOrder.findMany({ where: { id: { in: rows.map(r => r.changeOrderId).filter((x): x is string => !!x) } }, select: { id: true, number: true, totalCents: true } })
  const files = await prisma.portalFile.findMany({ where: { id: { in: rows.map(r => r.portalFileId).filter((x): x is string => !!x) } }, select: { id: true, deletedAt: true, isVisibleToCustomer: true } })
  return rows.map(r => {
    const q = quotes.find(x => x.id === r.quoteId)
    const co = r.changeOrderId ? cos.find(x => x.id === r.changeOrderId) : null
    const f = r.portalFileId ? files.find(x => x.id === r.portalFileId) : null
    return {
      id: r.id, kind: r.kind as SignedKind,
      title: r.kind === 'contract' ? 'Contract' : `Change order #${co?.number ?? ''}`.trim(),
      detail: r.kind === 'contract' ? (q ? acceptedOptionText(q) : '') : co ? changeOrderAcceptedText(co.number, co.totalCents) : '',
      signedAt: r.signedAt.toISOString(), signedOn: dayWords(r.signedAt), signedBy: r.signedBy,
      quoteId: r.quoteId, jobId: r.jobId, changeOrderId: r.changeOrderId,
      inPortal: !!f && !f.deletedAt && f.isVisibleToCustomer, portalFileId: r.portalFileId,
      pdf: `/api/signed-documents/${r.id}/pdf`,
    }
  })
}

const ORDER = [{ signedAt: 'desc' as const }, { createdAt: 'desc' as const }]

/** A customer's signed documents: on their quotes, or filed to them. */
export async function signedForCustomer(accountId: string, customerId: string): Promise<SignedDocumentView[]> {
  const quotes = (await prisma.savedQuote.findMany({ where: { accountId, crmContactId: customerId, deletedAt: null }, select: { id: true } })).map(q => q.id)
  const files = (await prisma.portalFile.findMany({ where: { crmCustomerId: customerId, fileKind: 'contract', source: 'system_generated' }, select: { id: true } })).map(f => f.id)
  if (!quotes.length && !files.length) return []
  return views(await prisma.signedDocument.findMany({ where: { accountId, OR: [{ quoteId: { in: quotes } }, { portalFileId: { in: files } }] }, orderBy: ORDER }))
}

export async function signedForQuote(accountId: string, quoteId: string): Promise<SignedDocumentView[]> {
  return views(await prisma.signedDocument.findMany({ where: { accountId, quoteId }, orderBy: ORDER }))
}

/** A job's signed documents: filed to it, or on the quote it is for. */
export async function signedForJob(accountId: string, jobId: string): Promise<SignedDocumentView[]> {
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId }, select: { quoteId: true } })
  if (!job) return []
  return views(await prisma.signedDocument.findMany({ where: { accountId, OR: [{ jobId }, ...(job.quoteId ? [{ quoteId: job.quoteId }] : [])] }, orderBy: ORDER }))
}

/** The stored PDF of a signed document of this company, or null. */
export async function storedPdf(accountId: string, id: string): Promise<{ doc: Doc; pdf: Buffer } | null> {
  const doc = await prisma.signedDocument.findFirst({ where: { id, accountId } })
  if (!doc) return null
  const root = path.resolve(UPLOAD_DIR())
  const full = path.resolve(root, doc.fileKey)
  if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) return null
  return { doc, pdf: fs.readFileSync(full) }
}

/**
 * For the customer portal (lib/portalCustomer.ts papersOf): the customer's
 * stored signed PDFs, from an explicit list of fields, each with its signed
 * file link. Only the copies filed to this customer and visible to them.
 */
export async function signedForPortal(customerId: string): Promise<Array<{ id: string; kind: SignedKind; title: string; detail: string; signedOn: string; signedBy: string; quoteId: string; url: string }>> {
  const files = await prisma.portalFile.findMany({ where: { crmCustomerId: customerId, deletedAt: null, isVisibleToCustomer: true, fileKind: 'contract', source: 'system_generated' }, select: { id: true, fileKey: true } })
  if (!files.length) return []
  const rows = await prisma.signedDocument.findMany({ where: { portalFileId: { in: files.map(f => f.id) } }, orderBy: ORDER })
  return (await views(rows)).map(v => ({
    id: v.id, kind: v.kind, title: v.title, detail: v.detail, signedOn: v.signedOn, signedBy: v.signedBy, quoteId: v.quoteId,
    url: signedFileUrl(files.find(f => f.id === v.portalFileId)!.fileKey),
  }))
}
