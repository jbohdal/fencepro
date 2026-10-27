/**
 * A receipt's customer link: /p/r/<token> (a small server-made page, like the
 * change order and proposal links) and /p/r/<token>.pdf (the branded PDF,
 * lib/receiptPdf.ts). No sign in: the token is 24 random bytes. It shows what
 * the receipt says (lib/contractBilling.ts receiptSnapshotIn); a voided one
 * says VOID. A strict Content Security Policy, no script at all.
 */

import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { CSS, esc } from './proposal.js'
import { receiptPdfOf, dayWords, TOKEN_RE } from '../lib/contractBilling.js'
import { moneyText } from '../lib/paymentMath.js'
import { receiptName, LIEN_RELEASE_DRAFT_NOTE, phoneText, type ReceiptSnapshot } from '../lib/receiptPdf.js'

export const receiptPublic = Router()

function headers(res: any) {
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'")
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Robots-Tag', 'noindex')
  res.setHeader('Cache-Control', 'no-store')
}

const R_CSS = `table.lines{width:100%;border-collapse:collapse}table.lines td{padding:8px 0;border-bottom:1px solid var(--line);vertical-align:top}
table.lines td.amt{text-align:right;white-space:nowrap;font-weight:600;padding-left:12px}table.lines tr.total td{font-weight:800}
.big{font-size:40px;font-weight:800;margin:6px 0}.void{border-color:#fca5a5;background:#fef2f2;color:#b42318}.paid{color:#167a3e}`

const byToken = (token: string) => (TOKEN_RE.test(token) ? prisma.receipt.findUnique({ where: { token } }).catch(() => null) : Promise.resolve(null))

receiptPublic.get('/:token.pdf', async (req, res) => {
  headers(res)
  const r = await byToken(String(req.params.token))
  if (!r) { res.status(404).type('text').send('Not available'); return }
  try {
    const pdf = await receiptPdfOf(r)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="receipt-${r.number}.pdf"`)
    res.send(pdf)
  } catch (e) {
    console.error('[receipt] pdf:', e)
    res.status(500).type('text').send('Could not make the receipt. Please call us.')
  }
})

receiptPublic.get('/:token', async (req, res) => {
  headers(res)
  const token = String(req.params.token)
  const r = await byToken(token)
  const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="robots" content="noindex"><style>${CSS}${R_CSS}</style></head><body>${body}</body></html>`
  if (!r) {
    res.status(404).type('html').send(page('Receipt', `<main class="wrap"><section><h1>This receipt is not available</h1><p>Please call us.</p></section></main>`))
    return
  }
  const s = r.snapshot as unknown as ReceiptSnapshot
  // The company's phone to call, as the PDF has it.
  const phone = phoneText(String(s.company?.phone || ''))
  const top = `<header class="top"><img src="../logo.png" alt="" class="logo"><div><p class="co">${esc(s.company.name)}</p><p class="small">Payment receipt${phone ? ` · <a href="tel:${esc(String(s.company.phone).replace(/[^\d+]/g, ''))}" data-receipt-phone>${esc(phone)}</a>` : ''}</p></div></header>`
  const rows: Array<[string, number, boolean?]> = [
    ['Contract as signed', s.signedCents],
    ...(s.changeOrderCents ? [['Change orders', s.changeOrderCents] as [string, number]] : []),
    ...(s.adjustmentCents ? [['Adjustments', s.adjustmentCents] as [string, number]] : []),
    ['Contract total', s.contractCents, true],
    ['Paid to date', s.paidToDateCents],
    [s.balanceCents < 0 ? 'Credit (paid over the total)' : 'Balance remaining', Math.abs(s.balanceCents), true],
  ]
  const body = `${top}<main class="wrap">
    <p class="small upper" data-receipt-number="${r.number}">${esc(receiptName(r.number))} · ${esc(dayWords(s.paidOn))}</p>
    ${r.voidedAt ? `<section class="void" data-receipt-void><h2>VOID</h2><p>This payment was voided. This receipt is no longer valid.</p></section>` : ''}
    <h1>${esc(s.customerName)}</h1>
    <p class="small">${esc(s.address)}</p>
    <section><p class="big ${r.voidedAt ? '' : 'paid'}" data-receipt-amount="${s.amountCents}">${esc(moneyText(s.amountCents))}</p>
      <p>${esc(s.methodText)} · ${esc(s.forText)}</p></section>
    <section><h2>The contract</h2><table class="lines"><tbody>
      ${rows.map(([k, v, b]) => `<tr${b ? ' class="total"' : ''}><td>${esc(k)}</td><td class="amt">${esc(moneyText(v))}</td></tr>`).join('')}
    </tbody></table></section>
    ${s.paidInFull ? `<section class="done" data-receipt-paid-in-full><h2>Paid in full</h2><p>Thank you! Warranty: ${esc(s.warrantyName || 'as written on your contract')}. It starts on the install date.</p></section>` : ''}
    ${s.lienRelease && s.paidInFull ? `<section><h2>Final Release of Lien</h2><p class="small">${esc(LIEN_RELEASE_DRAFT_NOTE)} It is in the PDF.</p></section>` : ''}
    <p><a class="btn" href="${esc(token)}.pdf" data-receipt-pdf>Download the receipt (PDF)</a></p>
  </main>`
  res.type('html').send(page(`${receiptName(r.number)} - ${s.company.name}`, body))
})
