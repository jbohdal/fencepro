/**
 * The warranty certificate (it is also the Certificate of Completion): a
 * branded PDF (pdfkit, free) with the warranty up top (which warranty, the
 * day it starts, how long it covers, the property), the checklist, the punch
 * list and how each was fixed, the required photos, both signatures (name,
 * role, date, time, where) and the warranty's coverage word for word.
 *
 * The warranty is the one the job was signed with (the accepted proposal
 * option's, lib/warranties.ts); it starts on the install date (the job's
 * completed date, else the day the walkthrough is finished).
 *
 * Saved to the job (Walkthrough.certificatePath) and, when the job has a
 * customer, to the customer portal as a document (PortalFile), where the
 * customer and the office's customer Files tab see it.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import PDFDocument from 'pdfkit'
import prisma from './prisma.js'
import { plainStyleName, pricingModule } from './estimates.js'
import { logoPath } from '../routes/proposal.js'
import { CATEGORY_LABEL, locationText, type WalkItem, type PhotoSlot, type Signature, type WalkCategory } from './walkthroughRules.js'
import { effectiveQuoteWarranty, nyDay } from './warranties.js'

const PURPLE = '#5E28A1', INK = '#1C1030', GRAY = '#5F5769', LINE = '#E2DCEC'
const TZ = 'America/New_York'

/** The warranty in Contract Templates (shown on proposals), else the one typed beside the walkthrough templates. */
export const DEFAULT_WARRANTY = `Materials are covered by the manufacturer's warranty. Workmanship is warranted for 1 year from installation date against defects in workmanship. Warranty does not cover damage from impact, severe weather, or misuse.`

export function warrantyFrom(b: { contractSections?: unknown; config?: unknown } | null | undefined): string {
  const sections = Array.isArray(b?.contractSections) ? b!.contractSections as any[] : []
  // Contract Templates never saved: its default warranty is what proposals show.
  const w = sections.find(s => s?.key === 'warranty')
  if (!w) return DEFAULT_WARRANTY
  if (w.visible !== false && String(w.body || '').trim()) return plain(String(w.body))
  return String((b?.config as any)?.walkthroughWarranty || '').trim()
}

/** Contract text may be HTML: keep the words and line breaks. */
function plain(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').trim()
}

export const when = (iso: string | Date) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
/** 3527894314 → (352) 789 4314; anything else as typed. */
const phoneText = (p: string) => { const d = p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)} ${d.slice(6)}` : p }
const day = (iso: string | Date) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'long', day: 'numeric', year: 'numeric' })

/** A file pdfkit can draw (JPEG or PNG), checked by its first bytes. */
function drawable(file: string | null | undefined): string | null {
  if (!file || !fs.existsSync(file)) return null
  try {
    const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(8); fs.readSync(fd, b, 0, 8, 0); fs.closeSync(fd)
    if (b[0] === 0xff && b[1] === 0xd8) return file
    if (b.readUInt32BE(0) === 0x89504e47) return file
  } catch { /* not readable */ }
  return null
}

function sigImage(s: Signature | null): Buffer | null {
  const m = /^data:image\/png;base64,(.+)$/.exec(s?.image || '')
  return m ? Buffer.from(m[1], 'base64') : null
}

export interface CertificateInput {
  company: { name: string; phone: string; email: string }
  customerName: string
  address: string
  fenceStyle: string
  category: WalkCategory
  completedAt: Date
  items: WalkItem[]
  punch: Array<{ label: string; note: string; fixNote: string; fixedAt: Date | null; fixedBy: string | null }>
  photos: Array<{ label: string; file: string | null }>
  homeowner: Signature | null
  rep: Signature | null
  warranty: string
  /** The job's warranty by name, its start (plain words) and how long it covers; missing: the older certificate. */
  warrantyName?: string
  warrantyStart?: string
  warrantyEnd?: string
  /** "October 21, 2026": the customer acknowledged a warranty update that day (lib/warrantyUpdates.ts). */
  warrantyUpdated?: string
}

/** The PDF itself. */
export function certificatePdf(c: CertificateInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: `${c.warrantyName ? 'Warranty Certificate' : 'Certificate of Completion'} - ${c.customerName}`, Author: c.company.name } })
    const chunks: Buffer[] = []
    doc.on('data', b => chunks.push(b))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    const W = doc.page.width - 96, L = 48
    const need = (h: number) => { if (doc.y + h > doc.page.height - 60) doc.addPage() }
    const heading = (t: string, keepWith = 0) => { need(40 + keepWith); doc.moveDown(0.8); doc.font('Helvetica-Bold').fontSize(13).fillColor(PURPLE).text(t, L); doc.moveTo(L, doc.y + 2).lineTo(L + W, doc.y + 2).strokeColor(LINE).stroke(); doc.moveDown(0.5) }

    // Header
    const logo = logoPath()
    if (logo) { try { doc.image(logo, L, 40, { fit: [56, 56] }) } catch { /* not a drawable logo */ } }
    doc.font('Helvetica-Bold').fontSize(18).fillColor(PURPLE).text(c.company.name, L + 68, 46)
    doc.font('Helvetica').fontSize(10).fillColor(GRAY).text([phoneText(c.company.phone), c.company.email].filter(Boolean).join('  ·  '), L + 68, 68)
    doc.moveTo(L, 108).lineTo(L + W, 108).lineWidth(2).strokeColor(PURPLE).stroke().lineWidth(1)
    doc.font('Helvetica-Bold').fontSize(26).fillColor(INK).text(c.warrantyName ? 'Warranty Certificate' : 'Certificate of Completion', L, 124, { width: W, align: 'center' })
    if (c.warrantyName) doc.font('Helvetica-Bold').fontSize(12).fillColor(PURPLE).text('Certificate of Completion', L, doc.y + 2, { width: W, align: 'center' })
    doc.font('Helvetica').fontSize(11).fillColor(GRAY).text(`This certifies that the fence at the property below was installed, walked through with the homeowner and accepted on ${day(c.completedAt)}.`, L, doc.y + 6, { width: W, align: 'center' })
    doc.moveDown(1)
    const facts: Array<[string, string]> = [
      ['Homeowner', c.customerName], ['Property', c.address || 'Not given'], ['Fence', `${c.fenceStyle || CATEGORY_LABEL[c.category]} (${CATEGORY_LABEL[c.category]})`], ['Completed', when(c.completedAt)],
      ...(c.warrantyName ? [['Warranty', c.warrantyName], ['Starts', c.warrantyStart || day(c.completedAt)], ['Covers', c.warrantyEnd || '']] as Array<[string, string]> : []),
      ...(c.warrantyName && c.warrantyUpdated ? [['Updated', `Warranty updated on ${c.warrantyUpdated}`]] as Array<[string, string]> : []),
    ]
    for (const [k, v] of facts) {
      const y = doc.y
      doc.font('Helvetica-Bold').fontSize(10).fillColor(GRAY).text(k, L, y, { width: 90 })
      doc.font('Helvetica').fontSize(11).fillColor(INK).text(v, L + 95, y, { width: W - 95 })
      doc.moveDown(0.2)
    }

    // Checklist
    heading('Final walkthrough checklist')
    for (const i of c.items) {
      need(30)
      const y = doc.y
      const pass = i.result === 'pass'
      doc.font('Helvetica-Bold').fontSize(10).fillColor(pass ? '#15803d' : '#b45309').text(pass ? 'PASS' : 'FIXED', L, y, { width: 50 })
      doc.font('Helvetica').fontSize(11).fillColor(INK).text(i.label, L + 55, y, { width: W - 55 })
      if (i.note) doc.font('Helvetica-Oblique').fontSize(9).fillColor(GRAY).text(i.note, L + 55, doc.y, { width: W - 55 })
      doc.moveDown(0.25)
    }

    if (c.punch.length) {
      heading('Punch list (fixed before sign off)')
      for (const p of c.punch) {
        need(36)
        doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(p.label, L)
        const lines = [p.note && `Found: ${p.note}`, p.fixNote && `Fixed: ${p.fixNote}`, p.fixedAt && `Fixed ${when(p.fixedAt)}${p.fixedBy ? ` by ${p.fixedBy}` : ''}`].filter(Boolean) as string[]
        doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(lines.join('  ·  '), L, doc.y, { width: W })
        doc.moveDown(0.3)
      }
    }

    // Photos, two to a row
    if (c.photos.length) {
      const cw = (W - 16) / 2, ph = 170
      heading('Photos', ph + 30)
      for (let i = 0; i < c.photos.length; i += 2) {
        need(ph + 30)
        const y = doc.y
        for (let k = 0; k < 2 && i + k < c.photos.length; k++) {
          const p = c.photos[i + k], x = L + k * (cw + 16)
          const f = drawable(p.file)
          if (f) { try { doc.image(f, x, y, { fit: [cw, ph], align: 'center', valign: 'center' }) } catch { doc.rect(x, y, cw, ph).strokeColor(LINE).stroke() } }
          else { doc.rect(x, y, cw, ph).strokeColor(LINE).stroke(); doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Photo on file with the job', x, y + ph / 2 - 5, { width: cw, align: 'center' }) }
          doc.font('Helvetica').fontSize(9).fillColor(INK).text(p.label, x, y + ph + 4, { width: cw, align: 'center' })
        }
        doc.y = y + ph + 22
        doc.x = L
      }
    }

    // Signatures
    heading('Signatures', 160)
    const sy = doc.y, sw = (W - 16) / 2
    const sigBox = (s: Signature | null, title: string, x: number) => {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(GRAY).text(title, x, sy, { width: sw })
      const img = sigImage(s)
      if (img) { try { doc.image(img, x, sy + 16, { fit: [sw, 60] }) } catch { /* unreadable ink */ } }
      doc.moveTo(x, sy + 80).lineTo(x + sw, sy + 80).strokeColor(INK).stroke()
      if (s) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(s.name, x, sy + 86, { width: sw })
        doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(`${s.role}\n${when(s.signedAt)}\nLocation: ${locationText(s)}${s.via === 'link' ? '\nSigned on their own phone' : ''}`, x, doc.y, { width: sw })
      }
    }
    sigBox(c.homeowner, 'Homeowner', L)
    sigBox(c.rep, `For ${c.company.name}`, L + sw + 16)
    doc.y = sy + 160; doc.x = L

    if (c.warranty) {
      heading(c.warrantyName ? `Warranty coverage: ${c.warrantyName}` : 'Warranty')
      doc.font('Helvetica').fontSize(10).fillColor(INK).text(c.warranty, L, doc.y, { width: W })
      if (c.warrantyUpdated) { doc.moveDown(0.4); doc.font('Helvetica-Oblique').fontSize(9).fillColor(GRAY).text(`Warranty updated on ${c.warrantyUpdated}. The price and the rest of the signed contract are unchanged.`, L, doc.y, { width: W }) }
    }
    doc.moveDown(1.5)
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(`Thank you for choosing ${c.company.name}.${c.company.phone ? ` Questions or warranty service: ${phoneText(c.company.phone)}.` : ''}`, L, doc.y, { width: W, align: 'center' })
    doc.end()
  })
}

/**
 * The job's warranty for the certificate: the signed option's (lib/warranties.ts),
 * starting on the job's completed date, else today (the walkthrough is finished now).
 * No style and no proposal: the older single warranty (warrantyFrom).
 */
async function jobWarrantyLines(job: { quoteId: string | null; fenceStyle: string; completedDate: string | null; accountId: string } | null, completedAt: Date, b: { config?: unknown; contractSections?: unknown } | null) {
  const q = job?.quoteId ? await prisma.savedQuote.findFirst({ where: { id: job.quoteId, accountId: job.accountId }, select: { id: true, accountId: true, proposal: true, chosenOption: true, fenceStyle: true, status: true, acceptedAt: true, soldAt: true, work: true } }) : null
  const { warranty, update } = job ? await effectiveQuoteWarranty(q, job.fenceStyle, b?.config ?? null) : { warranty: null, update: null }
  if (!warranty) return { warranty: warrantyFrom(b) }
  const m = await pricingModule()
  const start = job?.completedDate && /^\d{4}-\d{2}-\d{2}$/.test(job.completedDate) ? job.completedDate : nyDay(completedAt)
  const period = m.warrantyPeriod(warranty, start)
  return { warranty: warranty.text, warrantyName: warranty.name, warrantyStart: m.dayText(start), warrantyEnd: period.endText, ...(update ? { warrantyUpdated: m.dayText(nyDay(update.at)) } : {}) }
}

/** Where certificates and portal files live: the same folder the customer portal serves. */
export const uploadRoot = () => path.resolve(process.env.UPLOAD_DIR || './uploads')

/** Make the certificate for a finished walkthrough and save it to the job and the customer portal. */
export async function makeCertificate(
  w: { id: string; accountId: string; jobId: string; category: string; items: unknown; photos: unknown; homeownerSig: unknown; repSig: unknown },
  punch: Array<{ label: string; note: string; fixNote: string; fixedAt: Date | null; fixedBy: string | null; fixPhotoClientId: string | null }>,
  remake?: { completedAt: Date; path: string },
): Promise<{ path: string; portalFileId: string | null }> {
  const job = await prisma.savedJob.findUnique({ where: { id: w.jobId } })
  const b = await prisma.businessState.findUnique({ where: { accountId: w.accountId }, select: { config: true, contractSections: true } }).catch(() => null)
  const co = (b?.config as any)?.company ?? {}
  const slots = (Array.isArray(w.photos) ? w.photos : []) as PhotoSlot[]
  const ids = [...slots.map(s => s.clientId), ...punch.map(p => p.fixPhotoClientId)].filter((x): x is string => !!x)
  const media = ids.length ? await prisma.mediaItem.findMany({ where: { clientId: { in: ids }, deletedAt: null } }) : []
  const fileOf = (cid: string | null) => {
    const m = media.find(x => x.clientId === cid)
    return m ? (drawable(m.markupPath) ?? drawable(m.thumbPath) ?? drawable(m.path)) : null
  }
  const completedAt = remake?.completedAt ?? new Date()
  const pdf = await certificatePdf({
    company: { name: String(co.name || 'Getter Done Fence'), phone: String(co.phone || ''), email: String(co.email || '') },
    customerName: job?.customerName || 'Homeowner',
    address: job?.customerAddress || '',
    fenceStyle: await plainStyleName(job?.fenceStyle || ''),
    category: (['vinyl', 'chain_link', 'aluminum'].includes(w.category) ? w.category : 'vinyl') as WalkCategory,
    completedAt,
    items: (Array.isArray(w.items) ? w.items : []) as WalkItem[],
    punch,
    photos: [
      ...slots.map(s => ({ label: s.label, file: fileOf(s.clientId) })),
      ...punch.filter(p => p.fixPhotoClientId).map(p => ({ label: `Fixed: ${p.label}`, file: fileOf(p.fixPhotoClientId) })),
    ],
    homeowner: (w.homeownerSig ?? null) as Signature | null,
    rep: (w.repSig ?? null) as Signature | null,
    ...(await jobWarrantyLines(job, completedAt, b)),
  })
  // Made again (a warranty update acknowledged): the same file, so the job, the portal and the walkthrough link all show the new one.
  if (remake) {
    fs.mkdirSync(path.dirname(remake.path), { recursive: true })
    fs.writeFileSync(remake.path, pdf)
    return { path: remake.path, portalFileId: null }
  }
  const customerId = job?.crmContactId ?? null
  // Under the portal's folder for the customer (so the portal serves it), else under the job.
  const rel = customerId ? path.join('portal', customerId, `${crypto.randomUUID()}.pdf`) : path.join('walkthroughs', w.accountId, `${w.id}.pdf`)
  const abs = path.resolve(uploadRoot(), rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, pdf)
  let portalFileId: string | null = null
  if (customerId) {
    const f = await prisma.portalFile.create({
      data: {
        crmCustomerId: customerId, uploadedByUser: 'EZ Biz', fileKey: rel, fileUrl: `/api/portal/files/${encodeURIComponent(rel)}`,
        originalFilename: `Certificate of Completion - ${job?.customerName || 'Fence'}.pdf`, fileSizeBytes: pdf.length, mimeType: 'application/pdf',
        fileKind: 'document', source: 'system_generated', label: 'Certificate of Completion', isVisibleToCustomer: true,
      },
    })
    portalFileId = f.id
  }
  return { path: abs, portalFileId }
}

/**
 * A finished walkthrough's certificate made again, in place (the warranty
 * changed: a warranty update was acknowledged). Same completion time, same
 * file; the portal file's size follows. Nothing when the job has no finished
 * walkthrough.
 */
export async function remakeCertificateForJob(jobId: string): Promise<boolean> {
  const w = await prisma.walkthrough.findUnique({ where: { jobId } })
  if (!w || w.status !== 'completed' || !w.certificatePath || !w.completedAt) return false
  const punch = await prisma.walkthroughPunchItem.findMany({ where: { walkthroughId: w.id }, orderBy: { createdAt: 'asc' } })
  await makeCertificate(w, punch, { completedAt: w.completedAt, path: w.certificatePath })
  if (w.certificateFileId) {
    const size = fs.statSync(w.certificatePath).size
    await prisma.portalFile.updateMany({ where: { id: w.certificateFileId }, data: { fileSizeBytes: size } }).catch(() => {})
  }
  return true
}
