/**
 * Install packet for the crew: a private link per sold job at /p/i/<link>
 * that opens well on any phone and prints to PDF. No login. It can be
 * turned off, and it stops working 30 days after the job is marked complete.
 *
 * Shows the customer and address (with a map link), install date, gate codes
 * and notes, the site plan with photo pins, every run with its post to post
 * spacing, section and post counts, gates, the pull sheet quantities, all
 * Crew and Customer photos and video with captions (marked up first), and a
 * field for the 811 locate ticket. Never prices, margins or sub pay.
 *
 * The crew can add Progress and Completed photos from the link; they land on
 * the job as Internal until the office marks them Customer.
 *
 * Under /p, so the same public door as proposals serves it.
 */

import { Router } from 'express'
import express from 'express'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { esc, safeSvg, CSS } from './proposal.js'
import { mediaDir, serializeMedia, processMediaQueue } from '../lib/media.js'
import { serveSignedMedia } from './media.js'

/** 3527894314 → (352) 789-4314; anything else as typed. */
function phone(p: string): string {
  const d = p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p
}

export const packetPublic = Router()
export const packetStaff = Router()

const DAYS_AFTER_COMPLETE = 30
const CREW_CATEGORIES = ['Progress', 'Completed'] as const

/** Why a packet link no longer works, or null. */
export function packetClosed(p: { disabledAt: Date | null }, job: { completedDate: string | null; archivedAt?: Date | null } | null, now = Date.now()): 'off' | 'expired' | 'gone' | null {
  if (p.disabledAt) return 'off'
  if (!job || job.archivedAt) return 'gone'
  if (job.completedDate) {
    const done = new Date(job.completedDate.length <= 10 ? `${job.completedDate}T23:59:59` : job.completedDate).getTime()
    if (Number.isFinite(done) && now > done + DAYS_AFTER_COMPLETE * 86_400_000) return 'expired'
  }
  return null
}

interface Snapshot {
  planSvg?: string
  style?: string
  footageFt?: number
  sections?: number
  posts?: { corners: number; ends: number; gatePosts: number }
  runs?: Array<{ label: string; length: string; sections: number; spacing: string }>
  gates?: string[]
  skips?: string[]
  pullSheet?: Array<{ item: string; qty: number }>
  crewNotes?: string[]
  notes?: string
  companyName?: string
  companyPhone?: string
}

// ── Staff ─────────────────────────────────────────────────────────────────────

const snapSchema = z.object({
  planSvg: z.string().max(400_000).optional(),
  style: z.string().max(200).optional(),
  footageFt: z.number().optional(),
  sections: z.number().optional(),
  posts: z.object({ corners: z.number(), ends: z.number(), gatePosts: z.number() }).optional(),
  runs: z.array(z.object({ label: z.string().max(200), length: z.string().max(40), sections: z.number(), spacing: z.string().max(40) })).max(200).optional(),
  gates: z.array(z.string().max(300)).max(60).optional(),
  skips: z.array(z.string().max(300)).max(60).optional(),
  // Quantities only: a cost sent here is dropped.
  pullSheet: z.array(z.object({ item: z.string().max(300), qty: z.number() }).strip()).max(400).optional(),
  crewNotes: z.array(z.string().max(2000)).max(100).optional(),
  notes: z.string().max(10_000).optional(),
  companyName: z.string().max(200).optional(),
  companyPhone: z.string().max(60).optional(),
}).strip()

packetStaff.use(requireUser, requireAccount)

packetStaff.get('/', async (req: any, res) => {
  const p = await prisma.installPacket.findFirst({ where: { accountId: req.user.crmAccountId, jobId: String(req.query.jobId || '') } })
  res.json({ success: true, data: p ? { id: p.id, token: p.token, disabledAt: p.disabledAt, locateTicket: p.locateTicket, locateDate: p.locateDate, sentAt: p.sentAt } : null })
})

// Send (or refresh) a job's packet. A packet that was turned off gets a new link.
packetStaff.post('/', express.json({ limit: '1mb' }), async (req: any, res) => {
  try {
    const body = z.object({ jobId: z.string().min(1).max(100), snapshot: snapSchema }).parse(req.body)
    const accountId = req.user.crmAccountId
    const job = await prisma.savedJob.findFirst({ where: { id: body.jobId, accountId } })
    if (!job) { res.status(404).json({ success: false, error: 'Job not found' }); return }
    const existing = await prisma.installPacket.findUnique({ where: { jobId: job.id } })
    const token = !existing || existing.disabledAt ? crypto.randomBytes(24).toString('base64url') : existing.token
    const p = existing
      ? await prisma.installPacket.update({ where: { id: existing.id }, data: { token, snapshot: body.snapshot as any, disabledAt: null, sentAt: new Date() } })
      : await prisma.installPacket.create({ data: { accountId, jobId: job.id, token, snapshot: body.snapshot as any } })
    res.json({ success: true, data: { id: p.id, token: p.token, disabledAt: p.disabledAt, locateTicket: p.locateTicket, locateDate: p.locateDate, sentAt: p.sentAt } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[packet] send:', err); res.status(500).json({ success: false, error: 'Could not make the packet' })
  }
})

packetStaff.post('/:id/off', async (req: any, res) => {
  const n = await prisma.installPacket.updateMany({ where: { id: String(req.params.id), accountId: req.user.crmAccountId }, data: { disabledAt: new Date() } })
  res.json({ success: true, data: { updated: n.count } })
})

// ── Public: the packet ────────────────────────────────────────────────────────

async function load(token: string) {
  const p = await prisma.installPacket.findUnique({ where: { token } }).catch(() => null)
  if (!p) return null
  const job = await prisma.savedJob.findUnique({ where: { id: p.jobId } }).catch(() => null)
  return { p, job }
}

function headers(res: any, nonce: string) {
  res.setHeader('Content-Security-Policy', `default-src 'none'; img-src 'self' data: blob:; media-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`)
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Robots-Tag', 'noindex')
  res.setHeader('Cache-Control', 'no-store')
}

const page = (title: string, body: string, nonce: string, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="robots" content="noindex"><style>${CSS}${PACKET_CSS}</style></head><body>${body}${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`

// Photos and video on a packet, through the public door (same signed links as the app).
packetPublic.get('/m/:id/:variant', (req, res) => serveSignedMedia(req, res))

packetPublic.get('/:token', async (req, res) => {
  const nonce = crypto.randomBytes(16).toString('base64')
  headers(res, nonce)
  const found = await load(String(req.params.token))
  const closed = found ? packetClosed(found.p, found.job) : 'gone'
  if (!found || closed) {
    const snap = (found?.p.snapshot ?? {}) as Snapshot
    res.status(found ? 410 : 404).type('html').send(page('Install packet', `<header class="top"><img src="../logo.png" alt="" class="logo"><div><p class="co">${esc(snap.companyName || 'Getter Done Fence')}</p></div></header>
      <main class="wrap"><section><h1>This install packet is not active</h1><p>${closed === 'expired' ? 'Packets close 30 days after the job is complete.' : closed === 'off' ? 'This link was turned off. Ask the office for a new one.' : 'Ask the office for a current link.'}</p>${snap.companyPhone ? `<p>Office: <a href="tel:${esc(snap.companyPhone.replace(/[^\d+]/g, ''))}"><b>${esc(phone(snap.companyPhone))}</b></a></p>` : ''}</section></main>`, nonce))
    return
  }
  const { p, job } = found
  const s = p.snapshot as Snapshot
  // Crew and Customer photos and video, plus what the crew added from here.
  const ttl = 3 * 86_400_000
  const media = await prisma.mediaItem.findMany({
    where: { accountId: p.accountId, deletedAt: null, AND: [{ OR: [{ jobId: job!.id }, ...(job!.quoteId ? [{ quoteKey: job!.quoteId }] : [])] }, { OR: [{ visibility: { in: ['crew', 'customer'] } }, { source: 'crew' }] }] },
    orderBy: { takenAt: 'asc' },
  })
  const items = media.map(m => serializeMedia(m, ttl))
  // Walkthrough video first, then marked up photos, then the rest.
  items.sort((a, b) => rank(a) - rank(b))
  // /api/media/f/<id>/<v>?… → m/<id>/<v>?… (under /p/i, the public door)
  const fix = (u: string | null) => (u ? u.replace(/^\/api\/media\/f\//, 'm/') : null)

  const job_ = job!
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job_.customerAddress)}`
  const crewNotes = (s.crewNotes ?? []).filter(Boolean)
  const body = `<header class="top"><img src="../logo.png" alt="" class="logo"><div><p class="co">${esc(s.companyName || 'Getter Done Fence')}</p><p class="small">Install packet${s.companyPhone ? ` · Office <a href="tel:${esc(s.companyPhone.replace(/[^\d+]/g, ''))}">${esc(phone(s.companyPhone))}</a>` : ''}</p></div>
    <button type="button" id="print" class="printbtn noprint">Print / PDF</button></header>
  <main class="wrap">
    <h1>${esc(job_.customerName)}</h1>
    <p><a href="${esc(map)}" class="maplink">${esc(job_.customerAddress)}</a>${job_.customerPhone ? ` · <a href="tel:${esc(job_.customerPhone.replace(/[^\d+]/g, ''))}">${esc(phone(job_.customerPhone))}</a>` : ''}</p>
    <p class="facts">Install: ${esc(job_.scheduledDate || 'not scheduled yet')}${job_.crewAssigned ? ` · Crew: ${esc(job_.crewAssigned)}` : ''}</p>
    ${s.notes ? `<section class="notes"><h2>Gate codes and notes</h2><p>${esc(s.notes).replace(/\n/g, '<br>')}</p></section>` : ''}
    ${crewNotes.length ? `<section class="notes"><h2>Crew notes</h2><ul>${crewNotes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></section>` : ''}
    <section><h2>811 locate</h2>
      <div class="row"><label class="field">Ticket number<input id="ticket" value="${esc(p.locateTicket ?? '')}" maxlength="60" inputmode="numeric"></label>
      <label class="field">Date<input id="ldate" type="date" value="${esc(p.locateDate ?? '')}"></label></div>
      <button type="button" id="saveLocate" class="btn noprint">Save locate</button><p id="locMsg" class="small"></p>
    </section>
    <section><h2>The fence</h2>
      <p class="facts">${esc(s.style ?? job_.fenceStyle)}${s.footageFt ? ` · ${Math.round(s.footageFt)} ft` : ''}${s.sections ? ` · ${s.sections} sections` : ''}</p>
      ${s.posts ? `<p>${s.posts.corners} corner posts · ${s.posts.ends - s.posts.gatePosts} end posts · ${s.posts.gatePosts} gate posts</p>` : ''}
      ${safeSvg(s.planSvg) ? `<div class="plan">${safeSvg(s.planSvg)}</div><p class="small">Purple: new fence. Squares: corner posts. Dots: end and gate posts. Open dots: line posts. Dark arrows: where photos were taken. Not to scale for permitting.</p>` : ''}
      ${s.runs?.length ? `<table><thead><tr><th>Run</th><th>Length</th><th>Sections</th><th>Posts apart</th></tr></thead><tbody>${s.runs.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(r.length)}</td><td>${r.sections}</td><td>${esc(r.spacing)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${s.gates?.length ? `<h3>Gates</h3><ul>${s.gates.map(g => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
      ${s.skips?.length ? `<h3>Skips (not included)</h3><ul>${s.skips.map(g => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
    </section>
    ${s.pullSheet?.length ? `<section><h2>Pull sheet</h2><table><thead><tr><th>Material</th><th>Qty</th></tr></thead><tbody>${s.pullSheet.map(i => `<tr><td>${esc(i.item)}</td><td>${esc(i.qty)}</td></tr>`).join('')}</tbody></table></section>` : ''}
    <section><h2>Photos and video</h2>
      ${items.length ? `<div class="media">${items.map(m => {
        const src = fix(m.markupUrl ?? m.url)
        const media = m.kind === 'video'
          ? `<video src="${esc(fix(m.previewUrl ?? m.url))}" ${m.thumbUrl ? `poster="${esc(fix(m.thumbUrl))}"` : ''} controls playsinline preload="none"></video>`
          : `<a href="${esc(src)}"><img src="${esc(src)}" alt="${esc(m.caption || m.category)}" loading="lazy"></a>`
        return `<figure>${media}<figcaption><b>${esc(m.category)}</b>${m.source === 'crew' ? ' · from the crew' : ''}<br>${esc(m.caption)}</figcaption></figure>`
      }).join('')}</div>` : '<p class="small">No photos shared with the crew yet.</p>'}
    </section>
    <section class="noprint"><h2>Add progress photos</h2>
      <p class="small">Photos and video you add here go to the office.</p>
      <label class="field">What they show<select id="cat">${CREW_CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select></label>
      <label class="field">Note (optional)<input id="note" maxlength="500"></label>
      <label class="btn filebtn">Choose photos or video<input id="files" type="file" accept="image/*,video/*" multiple hidden></label>
      <p id="upMsg" class="small"></p>
    </section>
  </main>`
  const script = `
  (function(){
    document.getElementById('print').addEventListener('click',function(){window.print()});
    var tok=${JSON.stringify(String(req.params.token))};
    document.getElementById('saveLocate').addEventListener('click',function(){
      var m=document.getElementById('locMsg');m.textContent='Saving...';
      fetch(tok+'/locate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:document.getElementById('ticket').value,date:document.getElementById('ldate').value})})
        .then(function(r){return r.json()}).then(function(j){m.textContent=j.success?'Saved.':(j.error||'Could not save.')}).catch(function(){m.textContent='No connection. Try again.'});
    });
    var files=document.getElementById('files'),msg=document.getElementById('upMsg');
    files.addEventListener('change',function(){
      var list=[].slice.call(files.files);if(!list.length)return;var i=0;
      function next(){
        if(i>=list.length){msg.textContent=list.length+' uploaded. Thank you.';files.value='';return}
        var f=list[i],fd=new FormData();fd.append('category',document.getElementById('cat').value);fd.append('caption',document.getElementById('note').value);fd.append('file',f);
        var x=new XMLHttpRequest();x.open('POST',tok+'/media');
        x.upload.onprogress=function(e){if(e.lengthComputable)msg.textContent='Uploading '+(i+1)+' of '+list.length+': '+Math.round(e.loaded/e.total*100)+'%'};
        x.onload=function(){if(x.status>=200&&x.status<300){i++;next()}else{msg.textContent='Upload failed ('+x.status+'). Try again.'}};
        x.onerror=function(){msg.textContent='No connection. Try again when you have signal.'};
        x.send(fd);
      }
      next();
    });
  })();`
  res.type('html').send(page(`Install packet: ${job_.customerName}`, body, nonce, script))
})

function rank(m: { kind: string; category: string; markupUrl: string | null }): number {
  if (m.kind === 'video' && m.category === 'Site walk') return 0
  if (m.markupUrl) return 1
  return m.kind === 'video' ? 3 : 2
}

packetPublic.post('/:token/locate', express.json({ limit: '8kb' }), async (req, res) => {
  const found = await load(String(req.params.token))
  if (!found || packetClosed(found.p, found.job)) { res.status(410).json({ success: false, error: 'This packet is not active.' }); return }
  const b = z.object({ ticket: z.string().max(60), date: z.string().max(20) }).safeParse(req.body)
  if (!b.success) { res.status(400).json({ success: false, error: 'Check the ticket and date.' }); return }
  await prisma.installPacket.update({ where: { id: found.p.id }, data: { locateTicket: b.data.ticket.trim() || null, locateDate: b.data.date.trim() || null } })
  res.json({ success: true })
})

const crewUpload = multer({
  storage: multer.diskStorage({ destination: (_req, _f, cb) => cb(null, mediaDir('incoming')), filename: (_req, _f, cb) => cb(null, `crew-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.part`) }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 },
})
const OK_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|video\/(mp4|quicktime|webm|3gpp))$/

packetPublic.post('/:token/media', crewUpload.single('file'), async (req: any, res) => {
  const file = req.file
  const drop = () => { if (file) fs.rm(file.path, { force: true }, () => {}) }
  const found = await load(String(req.params.token))
  if (!found || packetClosed(found.p, found.job)) { drop(); res.status(410).json({ success: false, error: 'This packet is not active.' }); return }
  if (!file || !OK_TYPES.test(file.mimetype)) { drop(); res.status(400).json({ success: false, error: 'Send a photo or video.' }); return }
  const category = CREW_CATEGORIES.includes(req.body?.category) ? req.body.category : 'Progress'
  const id = crypto.randomUUID()
  const ext = path.extname(file.originalname || '').slice(1).toLowerCase().replace(/[^a-z0-9]/g, '') || (file.mimetype.startsWith('video/') ? 'mp4' : 'jpg')
  const final = path.join(mediaDir(found.p.accountId), `${id}.${ext}`)
  fs.renameSync(file.path, final)
  await prisma.mediaItem.create({
    data: {
      id, accountId: found.p.accountId, clientId: `crew-${id}`, kind: file.mimetype.startsWith('video/') ? 'video' : 'photo', mime: file.mimetype,
      path: final, bytes: file.size, jobId: found.job!.id, quoteKey: found.job!.quoteId ?? null, customerId: found.job!.crmContactId ?? null,
      takenBy: 'Crew (install packet)', takenAt: new Date(), caption: String(req.body?.caption || '').slice(0, 500), category,
      // Internal until the office marks it Customer.
      visibility: 'internal', source: 'crew',
    },
  })
  processMediaQueue().catch(err => console.error('[media] queue:', err))
  res.json({ success: true })
})

const PACKET_CSS = `
a[href^="tel:"]{white-space:nowrap}
.printbtn{margin-left:auto;min-height:44px;border:1px solid var(--line);background:#fff;border-radius:10px;padding:0 12px;font-weight:700;color:var(--p)}
.maplink{color:var(--p);font-weight:700}.notes{border-color:#FACC15;background:#FFFBEB}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:6px 4px;border-bottom:1px solid var(--line)}th{color:var(--g);font-weight:600}
h3{font-size:15px;margin:14px 0 6px}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.field select{display:block;width:100%;height:48px;font-size:16px;border:1px solid #CBC4D6;border-radius:10px;margin-top:4px;padding:0 10px;background:#fff}
.media{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}.media figure{margin:0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff}
.media img,.media video{width:100%;max-height:320px;object-fit:cover;display:block;background:#000}.media figcaption{padding:8px;font-size:13px;color:var(--g)}
.filebtn{display:flex;align-items:center;justify-content:center}
@media print{.noprint{display:none!important}body{background:#fff}section{break-inside:avoid;border:0;padding:8px 0}.media{grid-template-columns:repeat(2,1fr)}.media video{display:none}}
`
