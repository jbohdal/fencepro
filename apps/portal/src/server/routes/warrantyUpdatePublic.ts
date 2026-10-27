/**
 * A warranty update's customer link: /p/wu/<link> (lib/warrantyUpdates.ts), on
 * the public door like the proposal (routes/proposal.ts).
 *
 *   A signed customer (sold, accepted, or signed in person): their fence and
 *   price as signed, the warranty Settings give their option now (name and
 *   full words), "We've updated the warranty on your fence: <name>. Your price
 *   and everything else stay the same.", and Acknowledge (a typed name). Once
 *   acknowledged, the job's warranty and the Warranty Certificate use it.
 *
 *   A sent, unsigned proposal: the same proposal page, prices identical, with
 *   each option's current warranty and the note on top. Accepting here signs
 *   the proposal exactly as the original link would (acceptQuote), with these
 *   warranties. The original link keeps working as it was sent.
 *
 * Opens are counted by the page's own script (trackScript), customer opens
 * only (staff opens from the app carry ?sp=). Nothing is kept in the browser.
 */

import { Router } from 'express'
import express from 'express'
import crypto from 'crypto'
import fs from 'fs'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { plainZod } from '../lib/plainZod.js'
import { CSS, esc, linkClosed, renderProposal, proposalPage, trackScript, acceptQuote, acceptSchema, signerOf, type Proposal } from './proposal.js'
import { signedNow } from './saved-quotes.js'
import { startView, beatView, staffOf, ignoredRequest, proposalOpenedPush } from '../lib/proposalViews.js'
import { contractForQuote } from '../lib/contractPdf.js'
import { installDateOf } from '../lib/warranties.js'
import { pricingModule } from '../lib/estimates.js'
import { remakeCertificateForJob } from '../lib/walkthroughCertificate.js'
import { changedNames, recordAcknowledged, signedIndex, withUpdateWarranties, type UpdateOption } from '../lib/warrantyUpdates.js'
import { REUSE_MS } from '../lib/proposalViewRules.js'
import { proposalPhotos, quoteCustomer, belongsToQuote } from '../lib/quoteMedia.js'
import rateLimit from 'express-rate-limit'

export const warrantyUpdatePublic = Router()

const money = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US')
const dayOf = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' })

function headers(res: any, nonce: string) {
  res.setHeader('Content-Security-Policy', `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`)
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Robots-Tag', 'noindex')
  res.setHeader('Cache-Control', 'no-store')
}

const WU_CSS = `.notice{border-color:#C4B5E3;background:#F7F3FD}.notice p{margin:0}.was{font-size:14px;color:var(--g);margin:8px 0 0}`
const page = (title: string, body: string, nonce: string, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="robots" content="noindex"><style>${CSS}${WU_CSS}</style></head><body>${body}${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`

type Row = NonNullable<Awaited<ReturnType<typeof load>>>

/** The update, its quote (in the same company, not archived or deleted), and whether the customer has signed. */
async function load(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null
  const u = await prisma.warrantyUpdate.findUnique({ where: { token } }).catch(() => null)
  if (!u) return null
  const q = await prisma.savedQuote.findFirst({ where: { id: u.quoteId, accountId: u.accountId } })
  if (!q || q.archivedAt || (q as any).deletedAt) return null
  const signed = await signedNow(q)
  // Acknowledge mode: a signed customer, unless they signed the proposal on this very link.
  const ack = signed && u.acknowledgedHow !== 'accepted'
  return { u, q, signed, ack, options: (Array.isArray(u.options) ? u.options : []) as unknown as UpdateOption[] }
}

async function companyOf(accountId: string, p?: any) {
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }).catch(() => null)
  const c = (b?.config as any)?.company ?? {}
  return { name: String(p?.company?.name || c.name || 'Getter Done Fence'), phone: String(p?.company?.phone || c.phone || '') }
}

const shownPhone = (p: string) => { const d = p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)} ${d.slice(6)}` : p }
const callUs = (phone: string) => phone ? `Call us at <a href="tel:${esc(phone.replace(/[^\d+]/g, ''))}" style="white-space:nowrap"><b>${esc(shownPhone(phone))}</b></a>.` : 'Please call us.'

/** The option this signed customer acknowledges: the signed one, as it is on the update. */
function ackOption(r: Row): UpdateOption | null {
  const idx = signedIndex(r.q)
  return r.options.find(o => (o.index ?? null) === idx) ?? (r.u.kind === 'signed' ? r.options[0] ?? null : null)
}

// The logo and style photos, as the proposal serves them (the proposal page's own relative links).
warrantyUpdatePublic.get('/logo.png', (req, res) => { res.redirect(302, `${req.baseUrl.replace(/\/wu$/, '')}/logo.png`) })
warrantyUpdatePublic.get('/photo/:id', (req, res) => {
  const id = String(req.params.id)
  if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(404).end(); return }
  res.redirect(302, `${req.baseUrl.replace(/\/wu$/, '')}/photo/${id}`)
})

warrantyUpdatePublic.get('/:token', async (req, res) => {
  const nonce = crypto.randomBytes(16).toString('base64')
  headers(res, nonce)
  const token = String(req.params.token)
  const r = await load(token).catch(() => null)
  if (!r) { res.status(404).type('html').send(page('Not available', '<main class="wrap"><section><h1>This link is not available</h1><p>Please call us and we will send a new one.</p></section></main>', nonce)); return }
  const p = r.q.proposal as unknown as Proposal | null
  const company = await companyOf(r.q.accountId, p)
  const top = `<header class="top"><img src="logo.png" alt="" class="logo"><div><p class="co">${esc(company.name)}</p><p class="small">Warranty update</p></div></header>`

  if (r.ack) {
    const o = ackOption(r)
    if (!o?.warranty) { res.status(404).type('html').send(page('Warranty update', `${top}<main class="wrap"><section><h1>This warranty update is not available</h1><p>${callUs(company.phone)}</p></section></main>`, nonce)); return }
    const job = await prisma.savedJob.findFirst({ where: { accountId: r.q.accountId, quoteId: r.q.id, archivedAt: null }, select: { id: true, completedDate: true } })
    const installed = job ? await installDateOf(job) : null
    const m = await pricingModule()
    const start = installed ? `Warranty starts on the install date: ${m.dayText(installed)}` : 'Warranty starts on the install date (set when the fence is installed).'
    const opt = p?.options?.[o.index ?? -1] as any
    const done = r.u.acknowledgedAt
      ? `<section class="done" data-wu-acknowledged><h2>Received</h2><p>Acknowledged by ${esc(r.u.acknowledgedBy)} on ${esc(dayOf(r.u.acknowledgedAt))}. Thank you.</p></section>`
      : `<section id="accept" data-wu-ack-form><h2>Acknowledge</h2>
          <p class="small">Type your name to let us know you received your updated warranty. Nothing else changes.</p>
          <label class="field">Your name<input id="name" autocomplete="name" maxlength="200"></label>
          <p id="err" class="err" role="alert"></p>
          <button type="button" id="go" class="btn">I received my updated warranty</button>
        </section>`
    const body = `${top}<main class="wrap">
      <p class="small upper">Warranty update</p>
      <h1>${esc(p?.customer?.name || r.q.customerName)}</h1>
      <p class="small">${esc(p?.customer?.address || r.q.customerAddress || '')}</p>
      <section class="notice" data-wu-note><p>We've updated the warranty on your fence: <b>${esc(o.warranty.name)}</b>. Your price and everything else stay the same.</p></section>
      <section data-wu-fence><h2>Your fence</h2>
        ${opt?.tier?.label ? `<p class="tier">${esc(opt.tier.label)}</p>` : ''}<p class="optlabel" style="margin:0">${esc(o.label)}</p>
        <p class="price" style="margin:4px 0 0" data-wu-price>${money(o.finalPrice)}</p><p class="small">Your price, unchanged.</p></section>
      <section id="warranty" data-warranty-section><h2>Warranty</h2><p class="wname" id="wname" data-wu-warranty-name>${esc(o.warranty.name)}</p>
        <p id="wtext" data-wu-warranty-text>${esc(o.warranty.text).replace(/\n/g, '<br>')}</p>
        <p class="small"><b>${esc(start)}</b></p>
        ${o.before?.name && o.before.name !== o.warranty.name ? `<p class="was" data-wu-before>Before: ${esc(o.before.name)}</p>` : ''}</section>
      ${done}
      <p class="small foot">Questions? ${callUs(company.phone)}</p>
    </main>`
    const script = trackScript(token) + (r.u.acknowledgedAt ? '' : `
    (function(){
      var go=document.getElementById('go'),err=document.getElementById('err');
      go.addEventListener('click',function(){
        var name=document.getElementById('name').value.trim();
        if(!name){err.textContent='Please type your name.';return}
        go.disabled=true;go.textContent='Sending...';err.textContent='';
        fetch(${JSON.stringify(token)}+'/acknowledge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name})})
          .then(function(r){return r.json()}).then(function(j){if(j.success){location.reload()}else{err.textContent=j.error||'Something went wrong.';go.disabled=false;go.textContent='I received my updated warranty'}})
          .catch(function(){err.textContent='No connection. Please try again.';go.disabled=false;go.textContent='I received my updated warranty'});
      });
    })();`)
    res.type('html').send(page(`Warranty update for ${r.q.customerName}`, body, nonce, script))
    return
  }

  // The proposal again, with each option's current warranty.
  if (!p || !Array.isArray(p.options) || !p.options.length) { res.status(404).type('html').send(page('Not available', `${top}<main class="wrap"><section><h1>This proposal is not available</h1><p>${callUs(company.phone)}</p></section></main>`, nonce)); return }
  if (!r.q.acceptedAt && linkClosed(r.q)) {
    res.status(410).type('html').send(page('Link closed', `${top}<main class="wrap"><section><h1>This link is no longer active</h1><p>We are happy to help. ${callUs(company.phone)} We will send you a current proposal.</p></section></main>`, nonce))
    return
  }
  const shown = withUpdateWarranties(p, r.options)
  const names = changedNames(r.options)
  const notice = `<section class="notice" data-wu-note><p>We've updated the warranty on your fence: <b>${esc(names)}</b>. Your price and everything else stay the same.${p.options.length > 1 ? ' Each option shows its warranty.' : ''}</p></section>`
  let installDay: string | null = null
  if (r.q.acceptedAt) {
    const job = await prisma.savedJob.findFirst({ where: { accountId: r.q.accountId, quoteId: r.q.id, archivedAt: null }, select: { id: true, completedDate: true } })
    const d = job ? await installDateOf(job) : null
    installDay = d ? (await pricingModule()).dayText(d) : null
  }
  // The photos marked Customer on the quote and its site visit, as the proposal shows them (lib/quoteMedia.ts).
  const photos = await proposalPhotos(r.q)
  // Its terms, the option the quote was made with selected, and no option twice, as on the proposal link.
  const pv = await proposalPage(r.q, shown as Proposal)
  res.type('html').send(renderProposal(r.q, pv.p, token, nonce, photos, installDay, notice, pv.view))
})

// ── Opens (the page's own script; lib/proposalViews.ts) ──

const viewLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: false, legacyHeaders: false, message: { success: false } })
const viewBody = express.json({ limit: '4kb', type: ['application/json', 'text/plain'] })

/** A customer open of the link; a reload within REUSE_MS (the proposal's rule) is the same open. */
async function countOpen(id: string, reused = false) {
  const now = new Date()
  const u = await prisma.warrantyUpdate.findUnique({ where: { id }, select: { firstOpenedAt: true, lastOpenedAt: true } })
  const same = reused || (!!u?.lastOpenedAt && now.getTime() - u.lastOpenedAt.getTime() < REUSE_MS)
  await prisma.warrantyUpdate.update({ where: { id }, data: { ...(same ? {} : { openCount: { increment: 1 } }), lastOpenedAt: now, ...(u?.firstOpenedAt ? {} : { firstOpenedAt: now }) } })
}

warrantyUpdatePublic.post('/:token/view', viewLimiter, viewBody, async (req, res) => {
  try {
    if (ignoredRequest(req)) { res.status(204).end(); return }
    const r = await load(String(req.params.token))
    if (!r) { res.status(404).json({ success: false }); return }
    const sp = (req.body as any)?.sp
    if (!r.ack && !r.q.acceptedAt) {
      // An unsigned proposal: an open of the proposal too (time per option, the opened push).
      const v = await startView(req, r.q as any, sp)
      if (!v.staff) await countOpen(r.u.id, !!v.base)
      res.json({ success: true, data: { id: v.id, base: v.base } })
      if (v.push) void proposalOpenedPush(v.id).catch(err => console.error('[warranty update] opened push:', err))
      return
    }
    const who = await staffOf(req, r.q, sp)
    if (!who.staff) await countOpen(r.u.id)
    res.json({ success: true, data: { id: null } })
  } catch (err) {
    console.error('[warranty update] view:', err)
    res.status(500).json({ success: false })
  }
})

warrantyUpdatePublic.post('/:token/view/:id', viewLimiter, viewBody, async (req, res) => {
  try {
    const r = await load(String(req.params.token))
    if (!r || r.ack) { res.status(404).json({ success: false }); return }
    const ok = await beatView(r.q, String(req.params.id), (req.body ?? {}) as any)
    res.status(ok ? 204 : 404).end()
  } catch (err) {
    console.error('[warranty update] view beat:', err)
    res.status(500).json({ success: false })
  }
})

// ── Acknowledge (a signed customer) ──

const ackSchema = z.object({ name: z.string().trim().min(1, 'Please type your name').max(200) })

warrantyUpdatePublic.post('/:token/acknowledge', express.json({ limit: '4kb' }), async (req, res) => {
  try {
    const body = ackSchema.parse(req.body)
    const r = await load(String(req.params.token))
    if (!r) { res.status(404).json({ success: false, error: 'This link is not available. Please call us.' }); return }
    if (!r.ack) { res.status(409).json({ success: false, error: 'Please choose an option and sign the proposal below.' }); return }
    const o = ackOption(r)
    if (!o?.warranty) { res.status(409).json({ success: false, error: 'This warranty update is not available. Please call us.' }); return }
    if (r.u.acknowledgedAt) { res.json({ success: true, data: { acknowledgedAt: r.u.acknowledgedAt } }); return }
    const first = await recordAcknowledged(r.u.id, body.name, 'acknowledged', o.index ?? null)
    if (first) await afterAcknowledged(r, body.name, o.warranty.name)
    const now = await prisma.warrantyUpdate.findUnique({ where: { id: r.u.id }, select: { acknowledgedAt: true } })
    res.json({ success: true, data: { acknowledgedAt: now?.acknowledgedAt } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[warranty update] acknowledge:', err)
    res.status(500).json({ success: false, error: 'Something went wrong. Please call us.' })
  }
})

/** The job follows the update; a certificate already made is made again; the office is told (the bell). */
async function afterAcknowledged(r: Row, name: string, warrantyName: string, accepted = false) {
  const job = await prisma.savedJob.findFirst({ where: { accountId: r.q.accountId, quoteId: r.q.id, archivedAt: null }, select: { id: true } })
  if (job && r.u.jobId !== job.id) await prisma.warrantyUpdate.update({ where: { id: r.u.id }, data: { jobId: job.id } }).catch(() => {})
  if (job) await remakeCertificateForJob(job.id).catch(err => console.error('[warranty update] certificate:', err))
  console.log(`[warranty update] ${r.u.id} ${accepted ? 'accepted with the proposal' : 'acknowledged'} by "${name}" (quote ${r.q.id})`)
  if (accepted) return
  await prisma.notification.create({
    data: {
      title: `Warranty update acknowledged: ${r.q.customerName || name}`,
      body: `${name} acknowledged the ${warrantyName}.`,
      type: 'success',
      link: r.q.crmContactId ? `/?customer=${r.q.crmContactId}` : null,
    },
  }).catch(err => console.error('[warranty update] notification:', err))
}

// ── Accept (an unsigned proposal, on this link) ──

warrantyUpdatePublic.post('/:token/accept', express.json({ limit: '1.5mb' }), async (req, res) => {
  try {
    const body = acceptSchema.parse(req.body)
    const r = await load(String(req.params.token))
    if (!r) { res.status(404).json({ success: false, error: 'This proposal is no longer available.' }); return }
    if (r.ack) { res.status(409).json({ success: false, error: 'This proposal was already accepted.' }); return }
    const out = await acceptQuote(r.q, body, signerOf(req))
    if (out.status === 200) {
      const q = await prisma.savedQuote.findUnique({ where: { id: r.q.id }, select: { chosenOption: true } })
      const o = r.options.find(x => x.index === body.option)
      if (q?.chosenOption === body.option && o?.warranty) {
        const first = await recordAcknowledged(r.u.id, body.name, 'accepted', body.option)
        if (first) await afterAcknowledged(r, body.name, o.warranty.name, true)
      }
    }
    res.status(out.status).json(out.json)
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[warranty update] accept:', err)
    res.status(500).json({ success: false, error: 'Something went wrong. Please call us.' })
  }
})

// The signed contract, once accepted on this link (it carries this link's warranty, lib/contractPdf.ts).
warrantyUpdatePublic.get('/:token/contract.pdf', async (req, res) => {
  try {
    const r = await load(String(req.params.token))
    if (!r || !r.q.acceptedAt || r.u.acknowledgedHow !== 'accepted') { res.status(404).type('text').send('Not available'); return }
    const pdf = await contractForQuote(r.q)
    if (!pdf) { res.status(404).type('text').send('Not available'); return }
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline; filename="Signed contract.pdf"')
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('X-Robots-Tag', 'noindex')
    res.end(pdf)
  } catch (err) {
    console.error('[warranty update] contract pdf:', err)
    res.status(500).type('text').send('Something went wrong. Please call us.')
  }
})

// A photo marked Customer on the quote or its site visit (the proposal shows them).
warrantyUpdatePublic.get('/:token/media/:id', async (req, res) => {
  const r = await load(String(req.params.token)).catch(() => null)
  if (!r) { res.status(404).end(); return }
  const m = await prisma.mediaItem.findUnique({ where: { id: String(req.params.id) } }).catch(() => null)
  if (!m || m.deletedAt || m.accountId !== r.q.accountId || m.visibility !== 'customer' || m.kind !== 'photo' || !belongsToQuote(m, r.q.id, await quoteCustomer(r.q.accountId, r.q.id))) { res.status(404).end(); return }
  const file = m.markupPath && fs.existsSync(m.markupPath) ? m.markupPath : m.path
  if (!file || !fs.existsSync(file)) { res.status(404).end(); return }
  res.setHeader('Content-Type', file === m.markupPath ? 'image/jpeg' : m.mime)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  fs.createReadStream(file).pipe(res)
})
