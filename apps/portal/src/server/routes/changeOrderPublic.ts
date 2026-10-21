/**
 * A change order's customer link: /p/co/<link>, a small server-made page like
 * the proposal (routes/proposal.ts), because that is how a customer gets a
 * proposal today: a link texted or emailed from the office's phone. It shows
 * the change order's lines, amounts and total (never a cost), and "Approve and
 * sign": a typed name and a finger signature, the same pad as the proposal.
 * Signing approves it as the office would (lib/changeOrders.ts signByCustomer).
 *
 * Only a sent change order can be signed; an approved one shows who signed
 * and when; a void one says it was cancelled. A strict Content Security
 * Policy allows only this page's own inline script.
 */

import { Router } from 'express'
import express from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { plainZod } from '../lib/plainZod.js'
import { byLink, linesOf, signByCustomer } from '../lib/changeOrders.js'
import { CSS, esc } from './proposal.js'

export const changeOrderPublic = Router()

const usd = (cents: number) => (cents < 0 ? '−' : '') + '$' + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })

function headers(res: any, nonce: string) {
  res.setHeader('Content-Security-Policy', `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`)
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Robots-Tag', 'noindex')
  res.setHeader('Cache-Control', 'no-store')
}

const CO_CSS = `table.lines{width:100%;border-collapse:collapse}table.lines td{padding:8px 0;border-bottom:1px solid var(--line);vertical-align:top}
table.lines td.amt{text-align:right;white-space:nowrap;font-weight:600;padding-left:12px}table.lines tr.total td{border-bottom:0;font-size:20px;font-weight:800}
.void{border-color:#fca5a5;background:#fef2f2}`

const page = (title: string, body: string, nonce: string, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="robots" content="noindex"><style>${CSS}${CO_CSS}</style></head><body>${body}${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`

async function companyOf(accountId: string) {
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }).catch(() => null)
  const c = (b?.config as any)?.company ?? {}
  return { name: String(c.name || 'Getter Done Fence'), phone: String(c.phone || '') }
}

changeOrderPublic.get('/:token', async (req, res) => {
  const nonce = crypto.randomBytes(16).toString('base64')
  headers(res, nonce)
  const token = String(req.params.token)
  const co = await byLink(token)
  const q = co ? await prisma.savedQuote.findFirst({ where: { id: co.quoteId, accountId: co.accountId }, select: { customerName: true, customerAddress: true, fenceStyle: true, finalPrice: true, archivedAt: true, deletedAt: true } }) : null
  const company = co ? await companyOf(co.accountId) : { name: 'Getter Done Fence', phone: '' }
  const call = company.phone ? `Call us at <a href="tel:${esc(company.phone.replace(/[^\d+]/g, ''))}"><b>${esc(company.phone)}</b></a>.` : 'Please call us.'
  const top = `<header class="top"><img src="../logo.png" alt="" class="logo"><div><p class="co">${esc(company.name)}</p><p class="small">Change order</p></div></header>`
  // Never sent (still a draft) counts as not available: the customer sees only what the office sent.
  if (!co || !q || q.archivedAt || q.deletedAt || co.deletedAt || (co.status === 'draft')) {
    res.status(404).type('html').send(page('Change order', `${top}<main class="wrap"><section><h1>This change order is not available</h1><p>${call}</p></section></main>`, nonce))
    return
  }
  const lines = linesOf(co)
  const signed = co.status === 'approved'
  const state = co.status === 'void'
    ? `<section class="void"><h2>Cancelled</h2><p>This change order was cancelled and is not part of your contract. ${call}</p></section>`
    : signed
      ? `<section class="done" data-co-signed><h2>Approved</h2><p>${co.signedBy ? `Approved and signed by ${esc(co.signedBy)} on ${esc(day(co.signedAt ?? co.approvedAt ?? new Date()))}.` : `Approved on ${esc(day(co.approvedAt ?? new Date()))}.`}</p><p>Thank you. It is added to your contract.</p></section>`
      : `<section id="accept"><h2>Approve and sign</h2>
        <p class="small">If this change looks right, type your name and sign with your finger. It is added to your contract.</p>
        <label class="field">Your name<input id="name" autocomplete="name" maxlength="200" value="${esc(q.customerName || '')}"></label>
        <div class="sigwrap"><canvas id="sig" width="600" height="200" aria-label="Sign here"></canvas><button type="button" id="clear" class="link">Clear</button></div>
        <p id="err" class="err" role="alert"></p>
        <button type="button" id="go" class="btn">Approve and sign</button>
      </section>`
  const body = `${top}<main class="wrap">
    <p class="small upper">Change order #${co.number}</p>
    <h1>${esc(q.customerName)}</h1>
    <p class="small">${esc(q.customerAddress || '')}</p>
    ${co.reason ? `<p class="facts">${esc(co.reason)}</p>` : ''}
    <section><h2>The change</h2><table class="lines"><tbody>
      ${lines.map(l => `<tr><td>${esc(l.description || 'Change')}</td><td class="amt">${usd(l.amountCents)}</td></tr>`).join('')}
      <tr class="total"><td>${co.totalCents < 0 ? 'Total credit' : 'Total'}</td><td class="amt" data-co-total>${usd(co.totalCents)}</td></tr>
    </tbody></table>
    <p class="small">The original price was ${usd(Math.round((q.finalPrice || 0) * 100))}. This change ${co.totalCents < 0 ? 'takes off' : 'adds'} ${usd(Math.abs(co.totalCents))}.</p></section>
    ${state}
    <p class="small foot">Questions? ${call}</p>
  </main>`
  // The proposal's finger signature pad (routes/proposal.ts).
  const script = co.status !== 'sent' ? '' : `
  (function(){
    var c=document.getElementById('sig'),x=c.getContext('2d'),down=false,inked=false;
    x.lineWidth=3;x.lineCap='round';x.strokeStyle='#1C1030';
    function pos(e){var r=c.getBoundingClientRect();return[(e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height]}
    c.addEventListener('pointerdown',function(e){down=true;inked=true;try{c.setPointerCapture(e.pointerId)}catch(_){}var p=pos(e);x.beginPath();x.moveTo(p[0],p[1]);e.preventDefault()});
    c.addEventListener('pointermove',function(e){if(!down)return;var p=pos(e);x.lineTo(p[0],p[1]);x.stroke();e.preventDefault()});
    c.addEventListener('pointerup',function(){down=false});
    document.getElementById('clear').addEventListener('click',function(){x.clearRect(0,0,c.width,c.height);inked=false});
    var go=document.getElementById('go'),err=document.getElementById('err');
    go.addEventListener('click',function(){
      var name=document.getElementById('name').value.trim();
      if(!name){err.textContent='Please type your name.';return}
      if(!inked){err.textContent='Please sign in the box.';return}
      go.disabled=true;go.textContent='Sending...';err.textContent='';
      fetch(${JSON.stringify(token)}+'/sign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,signature:c.toDataURL('image/png')})})
        .then(function(r){return r.json()}).then(function(j){if(j.success){location.reload()}else{err.textContent=j.error||'Something went wrong.';go.disabled=false;go.textContent='Approve and sign'}})
        .catch(function(){err.textContent='No connection. Please try again.';go.disabled=false;go.textContent='Approve and sign'});
    });
  })();`
  res.type('html').send(page(`Change order #${co.number}: ${q.customerName}`, body, nonce, script))
})

export const signSchema = z.object({
  name: z.string().trim().min(1, 'Please type your name').max(200),
  signature: z.string().max(1_000_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'Please sign in the box'),
})

changeOrderPublic.post('/:token/sign', express.json({ limit: '1.5mb' }), async (req, res) => {
  try {
    const b = signSchema.parse(req.body)
    const co = await byLink(String(req.params.token))
    if (!co) { res.status(404).json({ success: false, error: 'This change order is not available.' }); return }
    const { row, again } = await signByCustomer(co.accountId, co.id, { name: b.name, signature: b.signature, ip: req.ip ?? null, userAgent: String(req.headers['user-agent'] ?? '') || null, via: 'link' })
    if (!again) console.log(`[change-orders] customer signed change order ${row.id} (#${row.number}) through the link as "${b.name}"`)
    res.json({ success: true, data: { status: row.status, signedAt: row.signedAt } })
  } catch (e) {
    if (e instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(e) }); return }
    const status = (e as any)?.status
    if (status === 404 || status === 409) { res.status(status).json({ success: false, error: (e as Error).message }); return }
    console.error('[change-orders] public sign:', e)
    res.status(500).json({ success: false, error: 'Something went wrong. Please call us.' })
  }
})
