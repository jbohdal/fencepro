/**
 * The sub's link, /p/sub/<token> (no login; lib/subLink.ts). The job as the
 * install packet shows it (routes/installPacket.ts packetPage), the sub's own
 * pay for this job, the 811 ticket (none: a red "Do not dig"), and their three
 * steps: check out at the shop, the job, check in at the shop. Never the
 * customer's price, margin or another job.
 */

import { Router } from 'express'
import express from 'express'
import crypto from 'crypto'
import fs from 'fs'
import multer from 'multer'
import rateLimit from 'express-rate-limit'
import prisma from '../lib/prisma.js'
import { mediaDir } from '../lib/media.js'
import { serveSignedMedia } from './media.js'
import { esc } from './proposal.js'
import { packetPage, page, headers, load as loadPacket, saveCrewMedia } from './installPacket.js'
import { locateOf, locateWords } from '../lib/locates.js'
import { floridaDay } from '../lib/automations/context.js'
import { usDate } from '../lib/installDays.js'
import { jobStyleName } from '../lib/customerStyleName.js'
import { SubError } from '../lib/subcontractors.js'
import { subJobByToken, partsOf, checkOut, saveReport, reportProblem, checkIn, stillToTake } from '../lib/subLink.js'
import { partWithPair } from '../lib/partNames.js'
import { issueLabel } from '../lib/serviceTicketModel.js'

type Json = any
export const subLinkPublic = Router()
subLinkPublic.use(rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }))

const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const UNIT: Record<string, [string, string]> = { ft: ['ft', 'ft'], section: ['section', 'sections'], gate: ['gate', 'gates'], hr: ['hour', 'hours'], job: ['', ''] }
const unitWord = (u: string, n: number) => (UNIT[u] ? UNIT[u][n === 1 ? 0 : 1] : u)

// Photos and video shown on the job sheet, through the public door (the packet's signed links).
subLinkPublic.get('/m/:id/:variant', (req, res) => serveSignedMedia(req, res))

const closedPage = (closed: string) => page('Your job', `<main class="wrap"><section><h1>This link is not active</h1><p>${closed === 'expired'
  ? 'Links close 30 days after the job is complete.' : closed === 'off' ? 'The office turned this link off. Call the office for a new one.' : 'Ask the office for the link to this job.'}</p></section></main>`, crypto.randomBytes(16).toString('base64'))

subLinkPublic.get('/:token', async (req, res) => {
  const nonce = crypto.randomBytes(16).toString('base64')
  headers(res, nonce)
  const { sj, job, closed } = await subJobByToken(String(req.params.token))
  if (!sj || !job || closed) { res.status(sj ? 410 : 404).type('html').send(closedPage(closed ?? 'gone')); return }
  await prisma.subJob.update({ where: { id: sj.id }, data: { lastOpenedAt: new Date() } }).catch(() => {})
  const today = floridaDay(new Date())
  const loc = locateOf(job)
  const out = (sj.checkout ?? null) as Json
  const out_ = out
  const parts = await partsOf(sj.accountId, sj.jobId)
  // What is still to leave the shop: all of it, or what a change order added after check out.
  const toTake = out_?.at ? stillToTake(parts, out_) : parts
  const lines = (sj.payLines as Json[]) ?? []
  const r = (sj.report ?? {}) as Json
  const back = (sj.checkin ?? null) as Json

  // Installed (a callback on a finished job): no dig warning; the 811 ticket is the install's.
  const locate = sj.confirmedAt || sj.submittedAt ? '' : loc.ticket
    ? `<section data-sub-811-ok><h2>811 locate</h2><p class="facts">Ticket ${esc(loc.ticket)}${loc.expDate ? `, good until ${esc(usDate(loc.expDate))}` : ''}${loc.goodDate && loc.goodDate > today ? `. Do not dig before ${esc(usDate(loc.goodDate))}.` : '.'}</p></section>`
    : `<section data-sub-811-none style="background:#fef2f2;border-color:#fca5a5"><h2 style="color:#991b1b">Do not dig, 811 ticket not in yet</h2><p>We call in 811. You get an email as soon as the ticket is in.</p></section>`
  const pay = `<section data-sub-pay><h2>Your pay for this job</h2><p class="price">${money(sj.payCents)}</p>
    ${sj.payEdited ? '<p class="small">Set by the office.</p>' : lines.length ? `<table><tbody>${lines.map(l => `<tr><td>${esc(l.label)}</td><td>${l.unit === 'job' ? '' : `${l.qty} ${unitWord(l.unit, l.qty)} × ${money(l.rateCents)}`}</td><td style="text-align:right">${money(l.cents)}</td></tr>`).join('')}</tbody></table>` : ''}
    <p class="small">Paid after the customer's final payment has cleared, with your signed lien release.</p></section>`
  const steps = `<section data-sub-steps><h2>Your steps</h2><ol>
    <li>${out?.at ? '✓ ' : ''}Check out the material at the shop</li><li>${sj.submittedAt ? '✓ ' : ''}Install and sign off</li><li>${back?.at ? '✓ ' : ''}Bring back what is left and check it in</li></ol></section>`
  // The final lien release waiting for their signature (sent once the customer's final payment cleared).
  const release = await prisma.subSignRequest.findFirst({ where: { subId: sj.subId, jobId: sj.jobId, kind: 'lien_release', voidedAt: null, signedAt: null }, orderBy: { sentAt: 'desc' } })
  const { signLinkUrl } = await import('../lib/subSign.js')
  const sign = release ? `<section data-sub-lien-release style="border-color:#8b5cf6"><h2>Sign your lien release</h2><p>The customer's final payment cleared. Sign the final release of lien to be paid.</p><p><a class="btn" href="${esc(signLinkUrl(release))}">Read and sign</a></p></section>` : ''
  // Callbacks on their workmanship (the office marked them so): fixed at no charge, from here.
  const callbacks = await prisma.serviceTicket.findMany({ where: { jobId: sj.jobId, subcontractorId: sj.subId, subWorkmanship: true, stage: { notIn: ['fixed', 'closed'] } }, orderBy: { createdAt: 'asc' } })
  const callbackBox = callbacks.length ? `<section data-sub-callbacks style="border-color:#f59e0b"><h2>Callback: please fix at no charge</h2>${callbacks.map(c => `<div data-sub-callback="${esc(c.id)}"><p><b>${esc(issueLabel(c.issue))}</b>${c.notes ? `: ${esc(c.notes)}` : ''}</p><label class="field">What you did (optional)<input id="cbNote-${esc(c.id)}" maxlength="500"></label><button type="button" class="btn cbFixed" data-ticket="${esc(c.id)}">Fixed</button><p class="small" id="cbMsg-${esc(c.id)}" aria-live="polite"></p></div>`).join('')}</section>` : ''
  const top = callbackBox + sign + locate + steps + pay

  const photoBox = (id: string, label: string, purpose: string) => `<label class="btn filebtn">${esc(label)}<input type="file" accept="image/*" capture="environment" multiple hidden data-up="${id}" data-purpose="${purpose}"></label><div class="media" id="${id}-shown"></div><p class="small" id="${id}-msg"></p>`
  const checkedOut = out?.at ? `<section data-sub-checkout-done><h2>Checked out</h2><p class="small">At the shop ${esc(new Date(out.lastAt ?? out.at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}.</p></section>` : ''
  const checkoutForm = back?.at || (out?.at && !toTake.length)
    ? checkedOut
    : `${checkedOut}<section data-sub-checkout><h2>${out?.at ? 'More material to pick up (a change order)' : '1. Check out at the shop'}</h2><p class="small">Tick each line when it is on the trailer. Change the count if it is not all there.</p>
      ${toTake.length ? `<table><thead><tr><th></th><th>Material</th><th>Pull</th><th>Taken</th></tr></thead><tbody>${toTake.map((p, i) => `<tr data-item="${esc(p.item)}"><td><input type="checkbox" class="co-tick" data-i="${i}" style="width:28px;height:28px" aria-label="On the trailer"></td><td>${esc(partWithPair(p.item))}</td><td>${p.qty}</td><td><input class="co-qty" data-i="${i}" type="number" inputmode="numeric" min="0" value="${p.qty}" style="width:84px;font-size:16px;min-height:44px" aria-label="Taken"></td></tr>`).join('')}</tbody></table>` : '<p>No pull sheet yet. Call the office.</p>'}
      ${photoBox('trailer', 'Photo of the loaded trailer', 'Material check out')}
      <button type="button" class="btn" id="coSend">Checked out</button><p class="small" id="coMsg" aria-live="polite"></p></section>`
  const reportForm = sj.submittedAt
    ? `<section data-sub-report-done><h2>Signed off</h2><p>${esc(r.footage)} ft, ${esc(r.gates)} gate${r.gates === 1 ? '' : 's'}, ${esc(r.startedOn ? usDate(r.startedOn) : '')} to ${esc(r.finishedOn ? usDate(r.finishedOn) : '')}. Signed by ${esc(r.signName)}.</p><p class="small">${sj.confirmedAt ? 'The office confirmed the install.' : 'Waiting for the office to confirm.'}</p></section>`
    : `<section data-sub-report><h2>2. On the job</h2>
      <div class="row"><label class="field">Started<input id="startedOn" type="date" value="${esc(r.startedOn ?? '')}"></label><label class="field">Finished<input id="finishedOn" type="date" value="${esc(r.finishedOn ?? '')}"></label></div>
      <div class="row"><label class="field">Feet installed<input id="footage" type="number" inputmode="decimal" min="0" value="${esc(r.footage ?? '')}"></label><label class="field">Gates hung<input id="gates" type="number" inputmode="numeric" min="0" value="${esc(r.gates ?? '')}"></label></div>
      <label class="field">Problems found (optional)<textarea id="problemsFound" rows="3" maxlength="2000">${esc(r.problemsFound ?? '')}</textarea></label>
      <h3>Before photos</h3>${photoBox('before', 'Add before photos', 'Before')}
      <h3>After photos</h3>${photoBox('after', 'Add after photos', 'After')}
      <div class="row"><label class="field">Your name<input id="signName" maxlength="120" value="${esc(r.signName ?? '')}" autocomplete="name"></label><label class="field">Date<input id="signedOn" type="date" value="${esc(r.signedOn ?? today)}"></label></div>
      <button type="button" class="btn" id="rpSave">Save</button> <button type="button" class="btn" id="rpSend">Sign off: installed</button><p class="small" id="rpMsg" aria-live="polite"></p></section>`
  const problemForm = `<section data-sub-problem><h2>Report a problem</h2>
      <label class="field">What<select id="pbKind"><option value="site">Site issue</option><option value="damage">Property damage</option></select></label>
      <label class="field">What happened<textarea id="pbText" rows="3" maxlength="2000"></textarea></label>
      ${photoBox('problem', 'Add photos', 'Problem')}
      <button type="button" class="btn" id="pbSend">Send to the office</button><p class="small" id="pbMsg" aria-live="polite"></p>
      ${(r.problems ?? []).length ? `<ul>${(r.problems as Json[]).map(p => `<li>${esc(p.kind === 'damage' ? 'Property damage' : 'Site issue')}: ${esc(p.text)}</li>`).join('')}</ul>` : ''}</section>`
  const checkinForm = back?.at
    ? `<section data-sub-checkin-done><h2>Checked in</h2><p class="small">Thank you.</p></section>`
    : out?.at
      ? `<section data-sub-checkin><h2>3. Check in at the shop</h2><p class="small">Count what you brought back.</p>
        <table><thead><tr><th>Material</th><th>Out</th><th>Back</th></tr></thead><tbody>${(out.lines as Json[]).map((l, i) => `<tr data-item="${esc(l.item)}"><td>${esc(partWithPair(l.item))}</td><td>${l.taken}</td><td><input class="ci-qty" data-i="${i}" type="number" inputmode="numeric" min="0" value="0" style="width:84px;font-size:16px;min-height:44px"></td></tr>`).join('')}</tbody></table>
        ${photoBox('leftover', 'Photo of what you brought back', 'Material check in')}
        <button type="button" class="btn" id="ciSend">Checked in</button><p class="small" id="ciMsg" aria-live="polite"></p></section>`
      : ''
  const after = checkoutForm + reportForm + problemForm + checkinForm

  // The job as the install packet shows it, when the office has made one; else the basics.
  const p = await prisma.installPacket.findUnique({ where: { jobId: sj.jobId } })
  let body: string, script = '', title = `Your job: ${job.customerName}`
  if (p && !p.disabledAt) {
    const f = await loadPacket(p.token)
    // The sub's own token in the page (the crew packet's link, which has the customer's phone, never reaches it).
    const page_ = await packetPage(f!, { token: String(req.params.token), visit: false, sub: { top, after, notes: sj.subNotes } })
    body = page_.body; script = page_.script; title = `Your job: ${job.customerName}`
  } else {
    const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.customerAddress)}`
    body = `<header class="top"><img src="../logo.png" alt="" class="logo"><div><p class="co">Getter Done Fence</p><p class="small">Your job</p></div></header><main class="wrap">
      <h1>${esc(job.customerName)}</h1><p><a href="${esc(map)}" class="maplink">${esc(job.customerAddress)}</a></p>
      <p class="facts">Install: ${esc(job.scheduledDate ? usDate(job.scheduledDate) : 'not booked yet')} · ${esc(await jobStyleName(job))}</p>
      ${top}${sj.subNotes ? `<section class="notes"><h2>Gate codes and notes</h2><p>${esc(sj.subNotes).replace(/\n/g, '<br>')}</p></section>` : ''}
      ${parts.length ? `<section><h2>Pull sheet</h2><table><tbody>${parts.map(x => `<tr><td>${esc(x.item)}</td><td>${x.qty}</td></tr>`).join('')}</tbody></table></section>` : ''}
      <p class="small">The office has not sent the full job sheet yet (plan and runs).</p>${after}</main>`
  }
  res.type('html').send(page(title, body, nonce, script + subScript(String(req.params.token), toTake.length, out?.lines?.length ?? 0)))
})

/** The sub's forms: photos go up one at a time (each keeps an id, so a resend after a dropped signal is kept once). */
function subScript(token: string, partCount: number, outCount: number): string {
  return `
  (function(){
    var tok=${JSON.stringify(token)},up={};
    function $(id){return document.getElementById(id)}
    [].forEach.call(document.querySelectorAll('input[data-up]'),function(inp){
      var key=inp.getAttribute('data-up');up[key]=[];
      inp.addEventListener('change',function(){
        var list=[].slice.call(inp.files),i=0,msg=$(key+'-msg');
        function next(){if(i>=list.length){msg.textContent=up[key].length+' photo'+(up[key].length===1?'':'s')+' added.';inp.value='';return}
          var f=list[i],fd=new FormData();fd.append('purpose',inp.getAttribute('data-purpose'));fd.append('cid',Date.now().toString(36)+Math.random().toString(36).slice(2,10));fd.append('file',f);
          msg.textContent='Uploading '+(i+1)+' of '+list.length+'...';
          fetch(tok+'/media',{method:'POST',body:fd}).then(function(r){return r.json()}).then(function(j){
            if(j.success&&j.id){up[key].push(j.id);var im=document.createElement('img');im.src=URL.createObjectURL(f);var fig=document.createElement('figure');fig.appendChild(im);$(key+'-shown').appendChild(fig);i++;next()}
            else msg.textContent=j.error||'Could not upload.'}).catch(function(){msg.textContent='No signal. Try again.'})}
        next()})});
    function post(path,body,msgId,done,ok,after){var m=$(msgId);m.textContent=ok?'Saving...':'Sending...';
      fetch(tok+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json()}).then(function(j){
        if(j.success){m.textContent=ok||'Sent.';if(after)after();if(done)setTimeout(function(){location.reload()},600)}else m.textContent=j.error||'Could not send.'}).catch(function(){m.textContent='No signal. Try again.'})}
    var co=$('coSend');if(co)co.addEventListener('click',function(){var lines=[];
      for(var i=0;i<${partCount};i++){var t=document.querySelector('.co-tick[data-i="'+i+'"]'),q=document.querySelector('.co-qty[data-i="'+i+'"]'),row=t.closest('tr');lines.push({item:row.getAttribute('data-item'),ticked:t.checked,taken:Number(q.value)})}
      post('/checkout',{lines:lines,photos:up.trailer||[]},'coMsg',true)});
    function report(submit){return{startedOn:$('startedOn').value,finishedOn:$('finishedOn').value,footage:$('footage').value===''?null:Number($('footage').value),gates:$('gates').value===''?null:Number($('gates').value),
      problemsFound:$('problemsFound').value,before:up.before&&up.before.length?up.before:undefined,after:up.after&&up.after.length?up.after:undefined,signName:$('signName').value,signedOn:$('signedOn').value,submit:submit}}
    var rs=$('rpSave');if(rs)rs.addEventListener('click',function(){post('/report',report(false),'rpMsg',false,'Saved.')});
    var rd=$('rpSend');if(rd)rd.addEventListener('click',function(){post('/report',report(true),'rpMsg',true)});
    var pb=$('pbSend');if(pb)pb.addEventListener('click',function(){post('/problem',{kind:$('pbKind').value,text:$('pbText').value,photos:up.problem||[]},'pbMsg',false,'Sent to the office.',function(){$('pbText').value='';up.problem=[];$('problem-shown').innerHTML='';$('problem-msg').textContent=''})});
    [].forEach.call(document.querySelectorAll('.cbFixed'),function(b){b.addEventListener('click',function(){var id=b.getAttribute('data-ticket');post('/callback/'+id,{note:$('cbNote-'+id).value},'cbMsg-'+id,true)})});
    var ci=$('ciSend');if(ci)ci.addEventListener('click',function(){var lines=[];
      for(var i=0;i<${outCount};i++){var q=document.querySelector('.ci-qty[data-i="'+i+'"]'),row=q.closest('tr');lines.push({item:row.getAttribute('data-item'),back:Number(q.value)})}
      post('/checkin',{lines:lines,photos:up.leftover||[]},'ciMsg',true)});
  })();`
}

async function liveSub(req: any, res: any) {
  const { sj, job, closed } = await subJobByToken(String(req.params.token))
  if (!sj || !job || closed) { res.status(410).json({ success: false, error: 'This link is not active. Call the office.' }); return null }
  return { sj, job }
}
function fail(res: any, err: unknown, what: string) {
  if (err instanceof SubError) { res.status(err.status).json({ success: false, error: err.message }); return }
  console.error(`[sub link] ${what}:`, err)
  res.status(500).json({ success: false, error: `Could not ${what}. Try again or call the office.` })
}

const upload = multer({
  storage: multer.diskStorage({ destination: (_r, _f, cb) => cb(null, mediaDir('incoming')), filename: (_r, _f, cb) => cb(null, `sub-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.part`) }),
  limits: { fileSize: 40 * 1024 * 1024, files: 1 },
})
const PURPOSES = ['Material check out', 'Before', 'After', 'Problem', 'Material check in']

subLinkPublic.post('/:token/media', upload.single('file'), async (req: any, res) => {
  const file = req.file
  const drop = () => { if (file) fs.rm(file.path, { force: true }, () => {}) }
  try {
    const at = await liveSub(req, res)
    if (!at) { drop(); return }
    if (!file || !/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) { drop(); res.status(400).json({ success: false, error: 'Send a photo.' }); return }
    const purpose = PURPOSES.includes(req.body?.purpose) ? req.body.purpose : 'Progress'
    const cid = typeof req.body?.cid === 'string' && /^[a-z0-9]{6,40}$/.test(req.body.cid) ? `sub-${req.body.cid}` : null
    const id = await saveCrewMedia({ accountId: at.sj.accountId, job: at.job }, file, { cid, category: purpose, caption: `${at.sj.sub.businessName}: ${purpose}`, takenBy: `Sub: ${at.sj.sub.businessName}` })
    const kept = id ?? (cid ? (await prisma.mediaItem.findUnique({ where: { clientId: cid }, select: { id: true } }))?.id : null)
    res.json({ success: true, id: kept })
  } catch (err) { drop(); fail(res, err, 'save the photo') }
})

const json = express.json({ limit: '64kb' })
subLinkPublic.post('/:token/checkout', json, async (req, res) => {
  try { const at = await liveSub(req, res); if (!at) return; await checkOut(at.sj, req.body); res.json({ success: true }) } catch (err) { fail(res, err, 'check out') }
})
subLinkPublic.post('/:token/report', json, async (req, res) => {
  try { const at = await liveSub(req, res); if (!at) return; await saveReport(at.sj, req.body); res.json({ success: true }) } catch (err) { fail(res, err, 'save') }
})
subLinkPublic.post('/:token/problem', json, async (req, res) => {
  try { const at = await liveSub(req, res); if (!at) return; await reportProblem(at.sj, req.body); res.json({ success: true }) } catch (err) { fail(res, err, 'send the problem') }
})
subLinkPublic.post('/:token/checkin', json, async (req, res) => {
  try { const at = await liveSub(req, res); if (!at) return; await checkIn(at.sj, req.body); res.json({ success: true }) } catch (err) { fail(res, err, 'check in') }
})

/** A workmanship callback fixed by the sub at no charge; the owner gets a push. */
subLinkPublic.post('/:token/callback/:ticketId', json, async (req, res) => {
  try {
    const at = await liveSub(req, res); if (!at) return
    const { ticketOf, markFixedBySub } = await import('../lib/serviceTickets.js')
    const t = await ticketOf(at.sj.accountId, String(req.params.ticketId))
    if (!t || t.jobId !== at.sj.jobId || (t as any).subcontractorId !== at.sj.subId || !(t as any).subWorkmanship) throw new SubError(404, 'That callback is not yours to fix.')
    await markFixedBySub(t, at.sj.sub.businessName, String(req.body?.note ?? ''))
    const { sendPush } = await import('../lib/automations/push.js')
    await sendPush(at.sj.accountId, { title: `Callback fixed: ${at.job.customerName}`, body: `${at.sj.sub.businessName} fixed the callback at no charge.`, url: `/operations?job=${at.sj.jobId}`, tag: `sub-callback-${t.id}` }).catch(() => null)
    res.json({ success: true })
  } catch (err) { fail(res, err, 'mark it fixed') }
})
