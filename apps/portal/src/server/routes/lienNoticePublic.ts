/**
 * The Florida lien notice addendum's customer link: /p/ln/<link> (lib/lienNoticeAddendum.ts; Jonathan, Nov 6 2026).
 * A small server-made page like a change order's (routes/changeOrderPublic.ts): the contract it is added to, the
 * notice word for word in 16 px bold capitals, and "Sign": a typed name and a finger signature, the same pad.
 *
 * Shown only while the owner's attorney review mark is on: taken off, the link says the paper is not available.
 * Once signed: who signed and when, and their signed copy (PDF). A strict Content Security Policy allows only this
 * page's own inline script.
 */

import { Router } from 'express'
import express from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { phoneWords } from '../lib/installDays.js'
import { plainZod } from '../lib/plainZod.js'
import { SubError } from '../lib/subcontractors.js'
import { addendumByToken, addendumReview, signAddendum, contractLine, companyOf, ADDENDUM_TITLE } from '../lib/lienNoticeAddendum.js'
import { storedPdf } from '../lib/signedDocuments.js'
import { CSS, esc } from './proposal.js'
import { signSchema } from './changeOrderPublic.js'

export const lienNoticePublic = Router()

function headers(res: any, nonce: string) {
  res.setHeader('Content-Security-Policy', `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`)
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Robots-Tag', 'noindex')
  res.setHeader('Cache-Control', 'no-store')
}

const page = (title: string, body: string, nonce: string, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="robots" content="noindex"><style>${CSS}</style></head><body>${body}${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`

const day = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })

lienNoticePublic.get('/:token', async (req, res) => {
  const nonce = crypto.randomBytes(16).toString('base64')
  headers(res, nonce)
  const token = String(req.params.token)
  const a = await addendumByToken(token).catch(() => null)
  const company = a ? await companyOf(a.accountId) : { name: 'Getter Done Fence', phone: '' }
  const call = company.phone ? `Call us at <a href="tel:${esc(company.phone.replace(/[^\d+]/g, ''))}"><b>${esc(phoneWords(company.phone))}</b></a>.` : 'Please call us.'
  const top = `<header class="top"><img src="../logo.png" alt="" class="logo"><div><p class="co">${esc(company.name)}</p><p class="small">Addendum to your contract</p></div></header>`
  // Locked (the owner's attorney review mark is off): the customer sees nothing of it, signed or not.
  const reviewed = a ? !!(await addendumReview(a.accountId)) : false
  if (!a || (!reviewed && !a.signedAt)) {
    res.status(404).type('html').send(page('Not available', `${top}<main class="wrap"><section><h1>This paper is not available</h1><p>${call}</p></section></main>`, nonce))
    return
  }
  if (!a.signedAt) await prisma.lienNoticeAddendum.update({ where: { id: a.id }, data: { openCount: { increment: 1 }, lastOpenedAt: new Date() } }).catch(() => null)
  const line = contractLine(company.name, { customerName: a.customerName, address: a.customerAddress, priceCents: a.contractCents, signedOn: a.contractSignedOn, fence: a.contractFence })
  const state = a.signedAt
    ? `<section class="done" data-ln-signed><h2>Signed</h2><p>Signed by ${esc(a.signedBy)} on ${esc(day(a.signedAt))}. Thank you. It is kept with your contract.</p>${a.signedDocumentId ? `<p><a class="btn linkbtn" href="${esc(token)}/signed.pdf" data-ln-pdf>Your signed copy (PDF)</a></p>` : ''}</section>`
    : `<section id="accept"><h2>Sign</h2>
        <p class="small">Type your name and sign with your finger. Your signature signs and dates this notice.</p>
        <label class="field">Your name<input id="name" autocomplete="name" maxlength="200" value="${esc(a.customerName || '')}"></label>
        <div class="sigwrap"><canvas id="sig" width="600" height="200" aria-label="Sign here"></canvas><button type="button" id="clear" class="link">Clear</button></div>
        <p id="err" class="err" role="alert"></p>
        <button type="button" id="go" class="btn">Sign</button>
      </section>`
  const body = `${top}<main class="wrap">
    <p class="small upper">${esc(ADDENDUM_TITLE)}</p>
    <h1>${esc(a.customerName)}</h1>
    <p class="small">${esc(a.customerAddress || '')}</p>
    <p class="facts" data-ln-contract>${esc(line)}</p>
    <section data-lien-notice style="border:2px solid #1C1030"><h2>Notice: Florida construction lien law</h2><p style="font-size:16px;font-weight:700;text-transform:uppercase;line-height:1.45">${esc(a.noticeText)}</p></section>
    ${state}
    <p class="small foot">Questions? ${call}</p>
  </main>`
  // The change order's finger signature pad (routes/changeOrderPublic.ts).
  const script = a.signedAt ? '' : `
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
        .then(function(r){return r.json()}).then(function(j){if(j.success){location.reload()}else{err.textContent=j.error||'Something went wrong.';go.disabled=false;go.textContent='Sign'}})
        .catch(function(){err.textContent='No connection. Please try again.';go.disabled=false;go.textContent='Sign'});
    });
  })();`
  res.type('html').send(page(`${ADDENDUM_TITLE}: ${a.customerName}`, body, nonce, script))
})

lienNoticePublic.post('/:token/sign', express.json({ limit: '1.5mb' }), async (req, res) => {
  try {
    const b = signSchema.parse(req.body)
    const { row, again } = await signAddendum(String(req.params.token), { name: b.name, signature: b.signature, ip: req.ip ?? null, userAgent: String(req.headers['user-agent'] ?? '') || null })
    if (!again) console.log(`[lien-notice] customer signed the lien notice addendum ${row.id} (quote ${row.quoteId}) as "${b.name}"`)
    res.json({ success: true, data: { signedAt: row.signedAt } })
  } catch (e) {
    if (e instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(e) }); return }
    if (e instanceof SubError) { res.status(e.status).json({ success: false, error: e.message }); return }
    console.error('[lien-notice] public sign:', e)
    res.status(500).json({ success: false, error: 'Something went wrong. Please call us.' })
  }
})

/** The customer's signed copy, as stored. */
lienNoticePublic.get('/:token/signed.pdf', async (req, res) => {
  try {
    const a = await addendumByToken(String(req.params.token))
    const out = a?.signedDocumentId ? await storedPdf(a.accountId, a.signedDocumentId) : null
    if (!out) { res.status(404).type('text').send('Not available'); return }
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline; filename="Signed lien notice.pdf"')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Robots-Tag', 'noindex')
    res.end(out.pdf)
  } catch (err) {
    console.error('[lien-notice] pdf:', err)
    res.status(500).type('text').send('Not available')
  }
})
