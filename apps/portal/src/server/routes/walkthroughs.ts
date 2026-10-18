/**
 * Final walkthrough: staff routes at /api/walkthroughs, and the homeowner's
 * page at /p/w/<link> (the public door, like proposals).
 *
 * Every change comes from the phone's save queue and may arrive more than
 * once: the walkthrough and each punch item carry the id the phone chose (a
 * repeat is the same record), and each change sets values (sending it twice
 * is the same as once). Changes to one walkthrough are made under a row lock.
 *
 * Once everything is in (lib/walkthrough.ts tryFinish), the Certificate of
 * Completion is made and the walkthrough is finished; after that it is read
 * only.
 */

import { Router } from 'express'
import express from 'express'
import fs from 'fs'
import crypto from 'crypto'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { esc, CSS } from './proposal.js'
import { serveSignedMedia } from './media.js'
import { serializeMedia } from '../lib/media.js'
import { clientIdSchema } from '../lib/clientId.js'
import { plainZod } from '../lib/plainZod.js'
import { audit } from '../lib/auditLog.js'
import {
  startWalkthrough, mutate, items, slots, sig, afterSignature, afterPunchFixed, tryFinish, issueLink, linkState, viewOf, missingFor,
  type WalkthroughRow,
} from '../lib/walkthrough.js'
import { ROLES, locationText, CATEGORY_LABEL, type Signature, type WalkCategory } from '../lib/walkthroughRules.js'
import { when } from '../lib/walkthroughCertificate.js'

export const walkthroughStaff = Router()
export const walkthroughPublic = Router()

const idSchema = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Invalid id')
const cid = z.string().min(8).max(100).nullable().optional()
const itemSchema = z.object({ id: z.string().min(1).max(64), label: z.string().min(1).max(300), result: z.enum(['pass', 'fix']).nullable(), note: z.string().max(2000).default(''), photoClientId: cid, punchId: idSchema.nullable().optional() })
const slotSchema = z.object({ key: z.string().min(1).max(100), label: z.string().min(1).max(300), kind: z.enum(['side', 'gate', 'wide']), clientId: cid })
const sigImage = z.string().max(1_000_000).regex(/^data:image\/png;base64,/, 'Please sign in the box')
const coord = { lat: z.number().min(-90).max(90).nullable().optional(), lng: z.number().min(-180).max(180).nullable().optional(), accuracyM: z.number().min(0).max(1e6).nullable().optional() }

async function who(req: any): Promise<string> {
  const u = await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } }).catch(() => null)
  return u ? `${u.firstName} ${u.lastName}`.trim() : req.user.email
}

const fail = (res: any, err: unknown, what: string) => {
  if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
  const status = (err as any)?.status
  if (status === 404 || status === 409) { res.status(status).json({ success: false, error: (err as Error).message }); return }
  console.error(`[walkthrough] ${what}:`, err)
  res.status(500).json({ success: false, error: `Could not ${what}` })
}

/**
 * The walkthrough a change is for. Two phones that started the same job with
 * no signal each chose an id; the server kept the first. A change sent with
 * the other id (and its job, ?jobId=) goes to the one walkthrough.
 */
async function wid(req: any): Promise<string> {
  const id = String(req.params.id)
  const jobId = typeof req.query.jobId === 'string' ? req.query.jobId : ''
  if (!jobId) return id
  if (await prisma.walkthrough.findUnique({ where: { id }, select: { id: true } })) return id
  const w = await prisma.walkthrough.findUnique({ where: { jobId }, select: { id: true, accountId: true } })
  return w && w.accountId === req.user.crmAccountId ? w.id : id
}

const finished = () => Object.assign(new Error('This walkthrough is finished; it can no longer be changed.'), { status: 409 })

/** After a change: finish by itself once everything is in (the certificate is made then). */
async function settle(req: any, id: string) {
  await tryFinish(req.user.crmAccountId, id, await who(req)).catch(err => console.error('[walkthrough] finish after change:', err))
  const w = (await prisma.walkthrough.findUnique({ where: { id } }))!
  return viewOf(w)
}

// ── Staff ─────────────────────────────────────────────────────────────────────

walkthroughStaff.use(requireUser, requireAccount)

walkthroughStaff.get('/', async (req: any, res) => {
  const jobId = String(req.query.jobId || '')
  if (!jobId) { res.status(400).json({ success: false, error: 'jobId is required' }); return }
  const w = await prisma.walkthrough.findUnique({ where: { jobId } })
  res.json({ success: true, data: w && w.accountId === req.user.crmAccountId ? await viewOf(w) : null })
})

walkthroughStaff.get('/:id', async (req: any, res) => {
  const w = await prisma.walkthrough.findUnique({ where: { id: await wid(req) } })
  if (!w || w.accountId !== req.user.crmAccountId) { res.status(404).json({ success: false, error: 'Walkthrough not found' }); return }
  res.json({ success: true, data: await viewOf(w) })
})

// Start: the phone's id; the same start sent again (or on a second phone) gives the one walkthrough.
walkthroughStaff.post('/', async (req: any, res) => {
  try {
    const b = z.object({
      id: clientIdSchema, jobId: z.string().min(1).max(100), category: z.enum(['vinyl', 'chain_link', 'aluminum']).optional(),
      items: z.array(itemSchema).max(100).optional(), photos: z.array(slotSchema).max(80).optional(),
    }).parse(req.body)
    const r = await startWalkthrough(req.user.crmAccountId, b.jobId, await who(req), { id: b.id, category: b.category, items: b.items as any, photos: b.photos as any })
    if (r.created) await audit(req, 'create', 'Walkthrough', r.id, { newValues: { jobId: b.jobId } }).catch(() => {})
    const w = (await prisma.walkthrough.findUnique({ where: { id: r.id } }))!
    res.status(r.created ? 201 : 200).json({ success: true, data: await viewOf(w) })
  } catch (err) { fail(res, err, 'start the walkthrough') }
})

// One checklist item: Pass or Needs fixing, note, photo. Needs fixing puts it on the punch list.
walkthroughStaff.put('/:id/items/:itemId', async (req: any, res) => {
  try {
    const b = itemSchema.omit({ id: true, label: true }).parse(req.body)
    const itemId = String(req.params.itemId)
    await mutate(req.user.crmAccountId, await wid(req), async (w, tx) => {
      const list = items(w)
      const at = list.findIndex(i => i.id === itemId)
      if (at < 0) throw Object.assign(new Error('That checklist item is not on this walkthrough'), { status: 404 })
      const cur = list[at]
      const next = { ...cur, result: b.result, note: b.note, photoClientId: b.photoClientId ?? null, punchId: b.result === 'fix' ? (b.punchId ?? cur.punchId ?? null) : null }
      if (w.status !== 'open') {
        if (cur.result === next.result && cur.note === next.note && cur.photoClientId === next.photoClientId) return
        throw finished()
      }
      if (b.result === 'fix') {
        const open = await tx.walkthroughPunchItem.findFirst({ where: { walkthroughId: w.id, itemId, status: 'open' } })
        if (open) {
          await tx.walkthroughPunchItem.update({ where: { id: open.id }, data: { note: b.note, photoClientId: b.photoClientId ?? null, label: cur.label } })
          next.punchId = open.id
        } else {
          const pid = b.punchId ?? crypto.randomUUID()
          const same = await tx.walkthroughPunchItem.findUnique({ where: { id: pid } })
          if (!same) await tx.walkthroughPunchItem.create({ data: { id: pid, accountId: w.accountId, walkthroughId: w.id, jobId: w.jobId, itemId, label: cur.label, note: b.note, photoClientId: b.photoClientId ?? null } })
          else if (same.walkthroughId !== w.id) throw Object.assign(new Error('Invalid id'), { status: 409 })
          next.punchId = pid
        }
      } else {
        // Marked wrong at first: the punch item it made goes (one already fixed stays on record).
        await tx.walkthroughPunchItem.deleteMany({ where: { walkthroughId: w.id, itemId, status: 'open' } })
      }
      list[at] = next
      await tx.walkthrough.update({ where: { id: w.id }, data: { items: list as any } })
    })
    res.json({ success: true, data: await settle(req, await wid(req)) })
  } catch (err) { fail(res, err, 'save the checklist item') }
})

// The required photo list (when the crew sets how many sides and gates). Photos already taken stay with their slot.
walkthroughStaff.put('/:id/photos', async (req: any, res) => {
  try {
    const b = z.object({ slots: z.array(slotSchema).min(1).max(80) }).parse(req.body)
    await mutate(req.user.crmAccountId, await wid(req), async (w, tx) => {
      if (w.status !== 'open') throw finished()
      const had = new Map(slots(w).map(s => [s.key, s.clientId]))
      const next = b.slots.map(s => ({ ...s, clientId: s.clientId ?? had.get(s.key) ?? null }))
      await tx.walkthrough.update({ where: { id: w.id }, data: { photos: next as any } })
    })
    res.json({ success: true, data: await settle(req, await wid(req)) })
  } catch (err) { fail(res, err, 'save the photo list') }
})

// One required photo taken (the phone's id for it; the photo itself uploads through /api/media).
walkthroughStaff.put('/:id/photos/:key', async (req: any, res) => {
  try {
    const b = z.object({ clientId: cid, label: z.string().max(300).optional(), kind: z.enum(['side', 'gate', 'wide']).optional() }).parse(req.body)
    const key = String(req.params.key)
    await mutate(req.user.crmAccountId, await wid(req), async (w, tx) => {
      const list = slots(w)
      const at = list.findIndex(s => s.key === key)
      if (w.status !== 'open') { if (at >= 0 && list[at].clientId === (b.clientId ?? null)) return; throw finished() }
      if (at >= 0) list[at] = { ...list[at], clientId: b.clientId ?? null }
      else if (b.label && b.kind) list.splice(Math.max(0, list.length - 1), 0, { key, label: b.label, kind: b.kind, clientId: b.clientId ?? null })
      else throw Object.assign(new Error('That photo is not on this walkthrough'), { status: 404 })
      await tx.walkthrough.update({ where: { id: w.id }, data: { photos: list as any } })
    })
    res.json({ success: true, data: await settle(req, await wid(req)) })
  } catch (err) { fail(res, err, 'save the photo') }
})

// A punch item fixed: needs its new photo.
walkthroughStaff.put('/:id/punch/:punchId', async (req: any, res) => {
  try {
    const b = z.object({ fixPhotoClientId: z.string().min(8).max(100, 'Take a photo of the fix'), fixNote: z.string().max(2000).default('') }).parse(req.body)
    const by = await who(req)
    const pid = String(req.params.punchId)
    let fixedNow = null as WalkthroughRow | null
    await mutate(req.user.crmAccountId, await wid(req), async (w, tx) => {
      const p = await tx.walkthroughPunchItem.findUnique({ where: { id: pid } })
      if (!p || p.walkthroughId !== w.id) throw Object.assign(new Error('Punch item not found'), { status: 404 })
      if (w.status !== 'open') { if (p.status === 'fixed' && p.fixPhotoClientId === b.fixPhotoClientId) return; throw finished() }
      await tx.walkthroughPunchItem.update({ where: { id: p.id }, data: { status: 'fixed', fixPhotoClientId: b.fixPhotoClientId, fixNote: b.fixNote, fixedAt: p.fixedAt ?? new Date(), fixedBy: p.fixedBy ?? by } })
      fixedNow = w
    })
    if (fixedNow) await afterPunchFixed(fixedNow, pid)
    res.json({ success: true, data: await settle(req, await wid(req)) })
  } catch (err) { fail(res, err, 'save the fix') }
})

// A signature on the crew's phone: the homeowner, or our representative (with a role).
walkthroughStaff.put('/:id/signatures/:who', async (req: any, res) => {
  try {
    const whoSig = String(req.params.who)
    if (whoSig !== 'homeowner' && whoSig !== 'rep') { res.status(404).json({ success: false, error: 'Not found' }); return }
    const b = z.object({
      name: z.string().trim().min(1, 'Type the name').max(200), role: z.string().max(100).optional(), signedAt: z.string().datetime().optional(),
      image: sigImage, ...coord,
    }).parse(req.body)
    if (whoSig === 'rep' && !(ROLES as readonly string[]).includes(b.role || '')) { res.status(400).json({ success: false, error: 'Choose the representative\'s role' }); return }
    const s: Signature = {
      name: b.name, role: whoSig === 'rep' ? b.role! : 'Homeowner', signedAt: b.signedAt ?? new Date().toISOString(),
      lat: b.lat ?? null, lng: b.lng ?? null, accuracyM: b.accuracyM ?? null, image: b.image, via: 'device',
    }
    const field = whoSig === 'rep' ? 'repSig' : 'homeownerSig'
    const w = await mutate(req.user.crmAccountId, await wid(req), async (w, tx) => {
      const cur = sig(w[field])
      if (w.status !== 'open') { if (cur && cur.name === s.name && cur.signedAt === s.signedAt) return w; throw finished() }
      // The same signature sent again: the first one stands.
      if (cur && cur.name === s.name && cur.signedAt === s.signedAt) return w
      return tx.walkthrough.update({ where: { id: w.id }, data: { [field]: s as any } })
    })
    await afterSignature(w)
    res.json({ success: true, data: await settle(req, w.id) })
  } catch (err) { fail(res, err, 'save the signature') }
})

// Finish: refused (409, with what is missing) until everything is in.
walkthroughStaff.post('/:id/finish', async (req: any, res) => {
  try {
    const r = await tryFinish(req.user.crmAccountId, await wid(req), await who(req))
    if (!r.done) { res.status(409).json({ success: false, error: `Not ready to finish: ${r.missing.join('; ')}`, data: { missing: r.missing } }); return }
    res.json({ success: true, data: await viewOf(r.walkthrough) })
  } catch (err) { fail(res, err, 'finish the walkthrough') }
})

// The homeowner's link: made (or the open one returned); ?new=1 makes a new one.
walkthroughStaff.post('/:id/link', async (req: any, res) => {
  try {
    const l = await issueLink(req.user.crmAccountId, await wid(req), req.query.new === '1')
    res.json({ success: true, data: l })
  } catch (err) { fail(res, err, 'make the link') }
})

walkthroughStaff.post('/:id/link-off', async (req: any, res) => {
  const n = await prisma.walkthrough.updateMany({ where: { id: await wid(req), accountId: req.user.crmAccountId }, data: { shareDisabledAt: new Date() } })
  if (!n.count) { res.status(404).json({ success: false, error: 'Walkthrough not found' }); return }
  res.json({ success: true, data: { disabledAt: new Date() } })
})

walkthroughStaff.get('/:id/certificate.pdf', async (req: any, res) => {
  const w = await prisma.walkthrough.findUnique({ where: { id: await wid(req) } })
  if (!w || w.accountId !== req.user.crmAccountId || !w.certificatePath || !fs.existsSync(w.certificatePath)) { res.status(404).json({ success: false, error: 'No certificate yet' }); return }
  sendPdf(res, w.certificatePath)
})

function sendPdf(res: any, file: string) {
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', 'inline; filename="Certificate of Completion.pdf"')
  res.setHeader('Cache-Control', 'private, no-store')
  fs.createReadStream(file).pipe(res)
}

// ── Public: the homeowner's page (/p/w/<link>) ───────────────────────────────

function headers(res: any, nonce: string) {
  res.setHeader('Content-Security-Policy', `default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`)
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Robots-Tag', 'noindex')
  res.setHeader('Cache-Control', 'no-store')
  // Location for the signature, only when the homeowner allows it.
  res.setHeader('Permissions-Policy', 'geolocation=(self)')
}

const page = (title: string, body: string, nonce: string, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="robots" content="noindex"><style>${CSS}${WALK_CSS}</style></head><body>${body}${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`

walkthroughPublic.get('/m/:id/:variant', (req, res) => serveSignedMedia(req, res))

async function byToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null
  return prisma.walkthrough.findUnique({ where: { shareToken: token } }).catch(() => null)
}

async function companyOf(accountId: string) {
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }).catch(() => null)
  const c = (b?.config as any)?.company ?? {}
  return { name: String(c.name || 'Getter Done Fence'), phone: String(c.phone || '') }
}

walkthroughPublic.get('/:token', async (req, res) => {
  const nonce = crypto.randomBytes(16).toString('base64')
  headers(res, nonce)
  const token = String(req.params.token)
  const w = await byToken(token)
  const co = w ? await companyOf(w.accountId) : { name: 'Getter Done Fence', phone: '' }
  const top = `<header class="top"><img src="../logo.png" alt="" class="logo"><div><p class="co">${esc(co.name)}</p><p class="small">Final walkthrough</p></div></header>`
  const call = co.phone ? `<p>Call us at <a href="tel:${esc(co.phone.replace(/[^\d+]/g, ''))}"><b>${esc(co.phone)}</b></a>.</p>` : ''
  const closed = w ? linkState(w) : null
  if (!w || closed) {
    res.status(w ? 410 : 404).type('html').send(page('Final walkthrough', `${top}<main class="wrap"><section><h1>This link is no longer active</h1><p>${closed === 'expired' ? 'Walkthrough links are good for a limited time, and this one has run out.' : closed === 'off' ? 'This link was turned off.' : 'This walkthrough is not available.'}</p>${call}</section></main>`, nonce))
    return
  }
  const job = await prisma.savedJob.findUnique({ where: { id: w.jobId } })
  const punch = await prisma.walkthroughPunchItem.findMany({ where: { walkthroughId: w.id }, orderBy: { createdAt: 'asc' } })
  const list = items(w), photoSlots = slots(w)
  const ids = [...photoSlots.map(s => s.clientId), ...list.map(i => i.photoClientId), ...punch.map(p => p.fixPhotoClientId)].filter((x): x is string => !!x)
  const media = ids.length ? await prisma.mediaItem.findMany({ where: { clientId: { in: ids }, deletedAt: null } }) : []
  // /api/media/f/<id>/<v>?… → m/<id>/<v>?… (under /p/w, the public door)
  const src = (clientId: string | null) => {
    const m = media.find(x => x.clientId === clientId)
    if (!m) return null
    const s = serializeMedia(m, 3 * 86_400_000)
    return String(s.markupUrl ?? s.thumbUrl ?? s.url).replace(/^\/api\/media\/f\//, 'm/')
  }
  const fig = (clientId: string | null, label: string) => { const u = src(clientId); return u ? `<figure><a href="${esc(u)}"><img src="${esc(u)}" alt="${esc(label)}" loading="lazy"></a><figcaption>${esc(label)}</figcaption></figure>` : '' }
  const home = sig(w.homeownerSig), rep = sig(w.repSig)
  const sigLine = (s: Signature, title: string) => `<p><b>${esc(title)}:</b> ${esc(s.name)}${s.role && s.role !== 'Homeowner' ? `, ${esc(s.role)}` : ''} · ${esc(when(s.signedAt))} · ${esc(locationText(s))}</p>`
  const openPunch = punch.filter(p => p.status !== 'fixed')
  const body = `${top}<main class="wrap">
    <p class="small upper">Final walkthrough</p>
    <h1>${esc(job?.customerName || '')}</h1>
    <p class="small">${esc(job?.customerAddress || '')}</p>
    <p class="facts">${esc(job?.fenceStyle || CATEGORY_LABEL[w.category as WalkCategory] || '')}</p>
    ${w.status === 'completed' ? `<section class="done"><h2>Complete</h2><p>Finished ${esc(when(w.completedAt!))}. Thank you!</p>${w.certificatePath ? `<p><a class="btn linkbtn" href="${esc(token)}/certificate.pdf">Certificate of Completion (PDF)</a></p>` : ''}</section>` : ''}
    <section><h2>Checklist</h2><ul class="check">${list.map(i => `<li class="${i.result === 'pass' ? 'pass' : i.result === 'fix' ? 'fix' : ''}"><span class="mark">${i.result === 'pass' ? 'Pass' : i.result === 'fix' ? 'Needs fixing' : 'Not checked'}</span><span>${esc(i.label)}${i.note ? `<br><span class="small">${esc(i.note)}</span>` : ''}</span></li>`).join('')}</ul></section>
    ${punch.length ? `<section><h2>Punch list</h2><ul class="check">${punch.map(p => `<li class="${p.status === 'fixed' ? 'pass' : 'fix'}"><span class="mark">${p.status === 'fixed' ? 'Fixed' : 'To fix'}</span><span>${esc(p.label)}${p.note ? `<br><span class="small">${esc(p.note)}</span>` : ''}${p.fixNote ? `<br><span class="small">Fixed: ${esc(p.fixNote)}</span>` : ''}</span></li>`).join('')}</ul>${openPunch.length ? '<p class="small">We will fix these and send you photos before the job is finished.</p>' : ''}</section>` : ''}
    <section><h2>Photos</h2><div class="media">${photoSlots.map(s => fig(s.clientId, s.label)).join('')}${punch.map(p => fig(p.fixPhotoClientId, `Fixed: ${p.label}`)).join('')}${list.map(i => fig(i.photoClientId, i.label)).join('')}</div></section>
    <section><h2>Signatures</h2>${rep ? sigLine(rep, `For ${co.name}`) : '<p class="small">Our representative has not signed yet.</p>'}${home ? sigLine(home, 'Homeowner') : ''}</section>
    ${home ? `<section class="done"><h2>Signed</h2><p>Signed by ${esc(home.name)} on ${esc(when(home.signedAt))}. This page is now read only.</p></section>` : w.status === 'completed' ? '' : `<section id="sign"><h2>Sign off</h2>
      <p class="small">If everything looks right, type your name and sign with your finger. Your location is added if your phone allows it.</p>
      <label class="field">Your name<input id="name" autocomplete="name" maxlength="200" value="${esc(job?.customerName || '')}"></label>
      <div class="sigwrap"><canvas id="sig" width="600" height="200" aria-label="Sign here"></canvas><button type="button" id="clear" class="link">Clear</button></div>
      <p id="err" class="err" role="alert"></p>
      <button type="button" id="go" class="btn">Sign the walkthrough</button></section>`}
    <p class="small foot">Questions? ${co.phone ? `Call <a href="tel:${esc(co.phone.replace(/[^\d+]/g, ''))}">${esc(co.phone)}</a>.` : 'Call us.'}</p>
  </main>`
  // The same finger signature pad as the proposal page.
  const script = home || w.status === 'completed' ? '' : `
  (function(){
    var c=document.getElementById('sig'),x=c.getContext('2d'),down=false,inked=false;
    x.lineWidth=3;x.lineCap='round';x.strokeStyle='#1C1030';
    function pos(e){var r=c.getBoundingClientRect();return[(e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height]}
    c.addEventListener('pointerdown',function(e){down=true;inked=true;try{c.setPointerCapture(e.pointerId)}catch(_){}var p=pos(e);x.beginPath();x.moveTo(p[0],p[1]);e.preventDefault()});
    c.addEventListener('pointermove',function(e){if(!down)return;var p=pos(e);x.lineTo(p[0],p[1]);x.stroke();e.preventDefault()});
    c.addEventListener('pointerup',function(){down=false});
    document.getElementById('clear').addEventListener('click',function(){x.clearRect(0,0,c.width,c.height);inked=false});
    var go=document.getElementById('go'),err=document.getElementById('err');
    function send(loc){
      fetch(${JSON.stringify(token)}+'/sign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('name').value.trim(),signature:c.toDataURL('image/png'),lat:loc?loc.lat:null,lng:loc?loc.lng:null,accuracyM:loc?loc.acc:null})})
        .then(function(r){return r.json()}).then(function(j){if(j.success){location.reload()}else{err.textContent=j.error||'Something went wrong.';go.disabled=false;go.textContent='Sign the walkthrough'}})
        .catch(function(){err.textContent='No connection. Please try again.';go.disabled=false;go.textContent='Sign the walkthrough'});
    }
    go.addEventListener('click',function(){
      if(!document.getElementById('name').value.trim()){err.textContent='Please type your name.';return}
      if(!inked){err.textContent='Please sign in the box.';return}
      go.disabled=true;go.textContent='Sending...';err.textContent='';
      var sent=false;function once(l){if(!sent){sent=true;send(l)}}
      if(navigator.geolocation){navigator.geolocation.getCurrentPosition(function(p){once({lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy})},function(){once(null)},{timeout:8000,maximumAge:60000});setTimeout(function(){once(null)},9000)}else{once(null)}
    });
  })();`
  res.type('html').send(page(`Final walkthrough: ${job?.customerName || ''}`, body, nonce, script))
})

const publicSign = z.object({ name: z.string().trim().min(1, 'Please type your name').max(200), signature: sigImage, ...coord })

walkthroughPublic.post('/:token/sign', express.json({ limit: '1.5mb' }), async (req, res) => {
  try {
    const b = publicSign.parse(req.body)
    const w0 = await byToken(String(req.params.token))
    if (!w0) { res.status(404).json({ success: false, error: 'This walkthrough is no longer available.' }); return }
    const cur0 = sig(w0.homeownerSig)
    // Sent again (the signal dropped before the answer came back): it stands.
    if (cur0 && cur0.name === b.name && cur0.via === 'link') { res.json({ success: true, data: { signedAt: cur0.signedAt } }); return }
    if (cur0) { res.status(409).json({ success: false, error: 'This walkthrough was already signed.' }); return }
    if (linkState(w0)) { res.status(410).json({ success: false, error: 'This link is no longer active. Please call us.' }); return }
    if (w0.status !== 'open') { res.status(409).json({ success: false, error: 'This walkthrough is already finished.' }); return }
    const s: Signature = { name: b.name, role: 'Homeowner', signedAt: new Date().toISOString(), lat: b.lat ?? null, lng: b.lng ?? null, accuracyM: b.accuracyM ?? null, image: b.signature, via: 'link' }
    const w = await mutate(w0.accountId, w0.id, async (w, tx) => {
      if (sig(w.homeownerSig)) return w // signed a moment ago (two taps): the first stands
      return tx.walkthrough.update({ where: { id: w.id }, data: { homeownerSig: s as any } })
    })
    console.log(`[walkthrough] homeowner signed ${w.id} through the link as "${b.name}"`)
    await afterSignature(w)
    // Everything else already in: finished now, and the certificate is made.
    if (!(await missingFor(w)).length) await tryFinish(w.accountId, w.id, 'Homeowner (link)').catch(err => console.error('[walkthrough] finish after link sign:', err))
    res.json({ success: true, data: { signedAt: sig(w.homeownerSig)?.signedAt ?? s.signedAt } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[walkthrough] public sign:', err)
    res.status(500).json({ success: false, error: 'Something went wrong. Please call us.' })
  }
})

walkthroughPublic.get('/:token/certificate.pdf', async (req, res) => {
  const w = await byToken(String(req.params.token))
  if (!w || linkState(w) || !w.certificatePath || !fs.existsSync(w.certificatePath)) { res.status(404).type('text').send('Not available'); return }
  sendPdf(res, w.certificatePath)
})

const WALK_CSS = `
.check{list-style:none;padding:0;margin:0}.check li{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)}.check li:last-child{border-bottom:0}
.mark{display:inline-block;min-width:96px;font-size:12px;font-weight:700;border-radius:999px;padding:2px 10px;flex-shrink:0;margin-top:2px;background:#eee;color:var(--g);text-align:center}
.pass .mark{background:#dcfce7;color:#166534}.fix .mark{background:#fef3c7;color:#92400e}
.media{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.media figure{margin:0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff}
.media img{width:100%;height:150px;object-fit:cover;display:block;background:#000}.media figcaption{padding:6px 8px;font-size:13px;color:var(--g)}
.linkbtn{display:flex;align-items:center;justify-content:center;text-decoration:none}
a[href^="tel:"]{white-space:nowrap;display:inline-block;padding:14px 0;margin:-14px 0}
`
