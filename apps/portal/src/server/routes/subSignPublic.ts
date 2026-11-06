/**
 * /p/sub-sign/<token>: a sub reads and signs what was sent to them (the
 * Subcontractor Agreement; the final lien release in Phase B), with a typed
 * name and a finger signature (the change order's pad). lib/subSign.ts.
 */

import { Router } from 'express'
import express from 'express'
import crypto from 'crypto'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import fs from 'fs'
import prisma from '../lib/prisma.js'
import { getFilePath } from '../lib/storage/index.js'
import { esc } from './proposal.js'
import { page, headers } from './installPacket.js'
import { SubError } from '../lib/subcontractors.js'
import { signRequestByToken, signRequest } from '../lib/subSign.js'

export const subSignPublic = Router()
subSignPublic.use(rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }))

subSignPublic.get('/:token', async (req, res) => {
  const nonce = crypto.randomBytes(16).toString('base64')
  headers(res, nonce)
  const token = String(req.params.token)
  const r = await signRequestByToken(token)
  if (!r) { res.status(404).type('html').send(page('Sign', '<main class="wrap"><section><h1>This link is not active</h1><p>Ask the office for a new one.</p></section></main>', nonce)); return }
  const title = r.kind === 'agreement' ? 'Subcontractor Agreement' : 'Release of lien'
  const done = r.signedAt
    ? `<section class="done" data-sub-signed><h2>Signed</h2><p>Signed by ${esc(r.signedName ?? '')} on ${esc(r.signedAt.toLocaleDateString('en-US', { timeZone: 'America/New_York', dateStyle: 'long' }))}. The office has a copy.</p><p><a class="btn" href="${esc(token)}/pdf" data-sub-signed-pdf>Download your signed copy (PDF)</a></p></section>`
    : `<section id="accept"><h2>Sign</h2><p class="small">Read it all, type your name and sign with your finger.</p>
      <label class="field">Your name<input id="name" autocomplete="name" maxlength="200" value="${esc(r.sub.contactName || '')}"></label>
      <div class="sigwrap"><canvas id="sig" width="600" height="200" aria-label="Sign here"></canvas><button type="button" id="clear" class="link">Clear</button></div>
      <p id="err" class="err" role="alert"></p><button type="button" id="go" class="btn">Sign</button></section>`
  const body = `<main class="wrap"><p class="small upper">${esc(title)} ${esc(r.version)}</p><h1>${esc(r.sub.businessName)}</h1>
    <section data-sub-sign-text><p style="white-space:pre-wrap">${esc(r.text)}</p></section>${done}</main>`
  const script = r.signedAt ? '' : `
  (function(){
    var c=document.getElementById('sig'),x=c.getContext('2d'),down=false,inked=false;
    x.lineWidth=3;x.lineCap='round';x.strokeStyle='#1C1030';
    function pos(e){var b=c.getBoundingClientRect();return[(e.clientX-b.left)*c.width/b.width,(e.clientY-b.top)*c.height/b.height]}
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
  res.type('html').send(page(`${title}: ${r.sub.businessName}`, body, nonce, script))
})

/** The signer's own copy of what they signed. */
subSignPublic.get('/:token/pdf', async (req, res) => {
  const r = await signRequestByToken(String(req.params.token))
  const doc = r?.documentId ? await prisma.subDocument.findUnique({ where: { id: r.documentId } }) : null
  const p = doc ? getFilePath(doc.path) : ''
  if (!r?.signedAt || !doc || !fs.existsSync(p)) { res.status(404).type('text').send('Not signed yet.'); return }
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${doc.fileName.replace(/[^\w .,-]+/g, '_')}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  fs.createReadStream(p).pipe(res)
})

subSignPublic.post('/:token/sign', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const b = z.object({ name: z.string().max(200), signature: z.string().max(2_800_000) }).parse(req.body)
    await signRequest(String(req.params.token), { name: b.name, signature: b.signature, ip: req.ip ?? null })
    res.json({ success: true })
  } catch (err) {
    if (err instanceof SubError) { res.status(err.status).json({ success: false, error: err.message }); return }
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: 'Please type your name and sign.' }); return }
    console.error('[sub sign]', err)
    res.status(500).json({ success: false, error: 'Something went wrong. Please call the office.' })
  }
})
