/**
 * What a sub signs on a link (no login): the Subcontractor Agreement (Phase A,
 * Jonathan Nov 6 2026), and the final lien release (Phase B). The words are
 * kept exactly as sent; the signed PDF (words, typed name, finger signature,
 * date, time and IP) is filed on the sub as a paper.
 *
 * The agreement goes out only once the owner has marked it reviewed by an
 * attorney ("Attorney review required" until then) and set the callback months.
 */

import crypto from 'crypto'
import prisma from './prisma.js'
import { pdfDocument, pdfSafeText } from './pdfText.js'
import { storeFile } from './storage/index.js'
import { linkToken, newLink, hashToken, subSettingsOf, agreementWords, SubError } from './subcontractors.js'
import { getFrontendBase } from './urls.js'

type Json = any

/** "12 Oak St, $949.00": which job and amount a signed release is for (several pile up on a sub's page). */
async function releaseLabel(r: { jobId: string | null; text: string }): Promise<string> {
  const job = r.jobId ? await prisma.savedJob.findUnique({ where: { id: r.jobId }, select: { customerAddress: true } }) : null
  const amount = /\$([\d,]+\.\d{2})/.exec(r.text)?.[0] ?? ''
  return [job?.customerAddress, amount].filter(Boolean).join(', ').slice(0, 120)
}

export const signLinkUrl = (r: { id: string; linkNonce: string }) => `${getFrontendBase()}/p/sub-sign/${linkToken(r.id, r.linkNonce)}`

async function companyOf(accountId: string): Promise<{ name: string; phone: string }> {
  const c = ((await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }))?.config as Json)?.company ?? {}
  return { name: String(c.name || 'Getter Done Fence'), phone: String(c.phone || '') }
}

/** Send the agreement to a sub (refused while it still needs the attorney's review, or with no callback months). */
export async function sendAgreement(accountId: string, subId: string, by: string) {
  const [settings, sub, company] = await Promise.all([subSettingsOf(accountId), prisma.subcontractor.findFirst({ where: { id: subId, accountId, deletedAt: null } }), companyOf(accountId)])
  if (!sub) throw new SubError(404, 'That sub is not there any more.')
  const a = settings.agreement
  if (!a.reviewedAt) throw new SubError(409, 'Attorney review required: the agreement is locked until the owner marks it reviewed (Settings → Subcontractors).')
  if (!a.callbackMonths) throw new SubError(409, 'Set how many months the sub fixes their own workmanship callbacks (Settings → Subcontractors).')
  if (!sub.email.trim()) throw new SubError(400, `${sub.businessName} has no email. Add one first.`)
  // One open request at a time: the one before stops.
  await prisma.subSignRequest.updateMany({ where: { accountId, subId, kind: 'agreement', signedAt: null, voidedAt: null }, data: { voidedAt: new Date() } })
  const id = crypto.randomUUID()
  const link = newLink(id)
  const row = await prisma.subSignRequest.create({ data: {
    id, accountId, subId, kind: 'agreement', version: `v${a.version}`, text: agreementWords(a, company.name, sub.businessName),
    linkNonce: link.nonce, tokenHash: link.hash, sentTo: sub.email.trim(),
  } })
  const { sendEmail } = await import('./emailService.js')
  const url = signLinkUrl(row)
  const r = await sendEmail({
    to: sub.email.trim(), subject: `${company.name}: Subcontractor Agreement to sign`,
    body: `<p>Please read and sign the Subcontractor Agreement.</p><p><a href="${url}">Read and sign</a></p><p>${company.name}</p>`,
    text: `Please read and sign the Subcontractor Agreement: ${url}\n\n${company.name}`,
  }).catch(e => ({ success: false, error: String(e) }) as Json)
  return { id: row.id, link: url, sent: !!r.success, how: r.success ? 'email' : r.held ? 'email (dev outbox, not sent)' : r.notConfigured ? 'not sent: email not set up' : `not sent: ${r.error ?? 'email failed'}`, by }
}

export async function signRequestByToken(token: string) {
  if (!token || token.length < 20 || token.length > 100) return null
  const r = await prisma.subSignRequest.findUnique({ where: { tokenHash: hashToken(token) }, include: { sub: true } })
  if (!r || r.voidedAt || r.sub.deletedAt) return null
  return r
}

const decode = (dataUrl: string): Buffer | null => {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return null
  const b = Buffer.from(m[1], 'base64')
  return b.length > 100 && b.length < 2_000_000 ? b : null
}

/** Signed on the link: the PDF is filed on the sub (an agreement as their "Subcontractor Agreement (signed)" paper). */
export async function signRequest(token: string, input: { name: string; signature: string; ip: string | null }) {
  const r = await signRequestByToken(token)
  if (!r) throw new SubError(410, 'This link is not active. Ask the office for a new one.')
  if (r.signedAt) return { again: true, row: r }
  // A final lien release is signed only while the sub is ready to be paid (a bounce withdraws it).
  if (r.kind === 'lien_release' && r.jobId) {
    const sj = await prisma.subJob.findFirst({ where: { accountId: r.accountId, jobId: r.jobId, subId: r.subId } })
    if (!sj?.readyToPayAt || sj.paidAt) throw new SubError(409, 'This release is not ready to sign any more. Call the office.')
  }
  const name = String(input.name ?? '').trim().slice(0, 200)
  if (!name) throw new SubError(400, 'Please type your name.')
  const sig = decode(String(input.signature ?? ''))
  if (!sig) throw new SubError(400, 'Please sign in the box.')
  const at = new Date()
  const company = await companyOf(r.accountId)
  const pdf = await signedPdf({ title: r.kind === 'agreement' ? 'Subcontractor Agreement' : 'Release of lien', company: company.name, text: r.text, name, signature: sig, at, ip: input.ip, version: r.version })
  const stored = storeFile(pdf, `${r.kind}-${r.sub.businessName}.pdf`, r.accountId)
  const signedOn = at.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const doc = await prisma.subDocument.create({ data: {
    accountId: r.accountId, subId: r.subId, kind: r.kind === 'agreement' ? 'agreement' : 'other:lien_release',
    label: r.kind === 'agreement' ? 'Subcontractor Agreement (signed)' : `Final release of lien (signed): ${await releaseLabel(r)}`, fileName: `${r.kind === 'agreement' ? 'Subcontractor Agreement' : 'Release of lien'} - ${r.sub.businessName}.pdf`.slice(0, 200),
    mime: 'application/pdf', bytes: pdf.length, path: stored.storagePath, sha256: (await import('crypto')).createHash('sha256').update(pdf).digest('hex'),
    version: r.version, signedOn, uploadedBy: `${name} (signed on the link)`,
  } })
  const row = await prisma.subSignRequest.update({ where: { id: r.id }, data: { signedAt: at, signedName: name, signature: `data:image/png;base64,${sig.toString('base64')}`, signedIp: input.ip, documentId: doc.id }, include: { sub: true } })
  // Their own copy, by email (and on the link: Download the signed copy).
  if (r.sub.email.trim()) {
    const { sendEmail } = await import('./emailService.js')
    await sendEmail({
      to: r.sub.email.trim(), subject: `${company.name}: your signed ${r.kind === 'agreement' ? 'Subcontractor Agreement' : 'release of lien'}`,
      body: `<p>Your signed copy is attached. Thank you.</p><p>${company.name}</p>`, text: `Your signed copy is attached. Thank you.\n\n${company.name}`,
      attachments: [{ filename: doc.fileName, content: pdf, contentType: 'application/pdf' }],
    }).catch(e => console.error('[sub sign] copy email:', e))
  }
  const { sendPush } = await import('./automations/push.js')
  await sendPush(r.accountId, { title: `${r.sub.businessName} signed`, body: `${r.kind === 'agreement' ? 'The Subcontractor Agreement' : 'The final lien release'} is signed and filed on their page.`, url: `/subcontractors?subcontractor=${r.subId}`, tag: `sub-signed-${r.id}` }).catch(() => null)
  return { again: false, row }
}

function signedPdf(c: { title: string; company: string; text: string; name: string; signature: Buffer; at: Date; ip: string | null; version: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = pdfDocument({ size: 'LETTER', margin: 54, info: { Title: `${c.title} - ${c.name}`, Author: c.company } })
    const chunks: Buffer[] = []
    doc.on('data', b => chunks.push(b))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.font('Helvetica-Bold').fontSize(16).text(pdfSafeText(c.company))
    doc.font('Helvetica').fontSize(9).fillColor('#555').text(`${c.title} ${c.version}`).fillColor('#000').moveDown(1)
    doc.font('Helvetica').fontSize(10.5).text(pdfSafeText(c.text), { lineGap: 2 })
    doc.moveDown(2)
    if (doc.y > doc.page.height - 200) doc.addPage()
    doc.font('Helvetica-Bold').fontSize(11).text('Signed')
    const y = doc.y + 4
    try { doc.image(c.signature, 54, y, { fit: [240, 70] }) } catch { /* unreadable ink */ }
    doc.y = y + 76
    const when = c.at.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short' })
    doc.font('Helvetica').fontSize(10).text(pdfSafeText(`${c.name}, ${when} Eastern${c.ip ? `, from ${c.ip}` : ''}. Signed on the link sent to them.`))
    doc.end()
  })
}
