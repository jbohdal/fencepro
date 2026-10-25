/**
 * A warranty or service request's photo link: /p/s/<link> (lib/serviceTickets.ts
 * askForPhotos), on the public door like the proposal and the crew packet. No
 * login, any phone: the customer picks photos or a short video (or takes them
 * there), and each lands on the request as Internal. Open 14 days from the
 * last "Ask for photos"; a closed or removed request's link stops working.
 *
 * Limits (serviceTicketModel.ts): photos (JPEG, PNG, WebP, HEIC) up to 25 MB,
 * videos (MP4, MOV, WebM, 3GP) up to 300 MB, one file per request, 30 files a
 * request in all; 60 requests a minute from one address.
 *
 * Nothing is kept in the browser. The page's script only sends the files.
 */

import { Router } from 'express'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import rateLimit from 'express-rate-limit'
import prisma from '../lib/prisma.js'
import { isUniqueViolation } from '../lib/once.js'
import { esc, CSS } from './proposal.js'
import { mediaDir, processMediaQueue } from '../lib/media.js'
import { linkOpen, customerFileCount, photoArrived, type TicketRow } from '../lib/serviceTickets.js'
import { uploadRefusal, issueLabel, isOpenStage, VIDEO_MAX_BYTES, MAX_CUSTOMER_FILES } from '../lib/serviceTicketModel.js'

export const servicePhotosPublic = Router()
servicePhotosPublic.use(rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many tries. Wait a minute and try again.' } }))

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/

/** The ticket behind a link, and why it does not take photos now (null: it does). */
export async function linkTicket(token: string, now = Date.now()): Promise<{ t: TicketRow | null; closed: 'gone' | 'expired' | 'done' | null }> {
  if (!TOKEN.test(token)) return { t: null, closed: 'gone' }
  const t = await prisma.serviceTicket.findUnique({ where: { uploadToken: token } }).catch(() => null)
  if (!t || t.deletedAt) return { t: null, closed: 'gone' }
  if (!isOpenStage(t.stage)) return { t, closed: 'done' }
  if (!linkOpen(t, now)) return { t, closed: 'expired' }
  return { t, closed: null }
}

async function companyOf(accountId: string) {
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }).catch(() => null)
  const c = (b?.config as any)?.company ?? {}
  return { name: String(c.name || 'Getter Done Fence'), phone: String(c.phone || '') }
}

const shownPhone = (p: string) => { const d = p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)} ${d.slice(6)}` : p }
const callUs = (phone: string) => phone ? `Call us at <a href="tel:${esc(phone.replace(/[^\d+]/g, ''))}"><b>${esc(shownPhone(phone))}</b></a>.` : 'Please call us.'

function headers(res: any, nonce: string) {
  res.setHeader('Content-Security-Policy', `default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`)
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Robots-Tag', 'noindex')
  res.setHeader('Cache-Control', 'no-store')
}

const PAGE_CSS = `.filebtn{display:flex;align-items:center;justify-content:center;font-size:18px}
.media{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:12px}.media figure{margin:0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff}
.media img,.media video{width:100%;height:140px;object-fit:cover;display:block;background:#000}.media figcaption{padding:6px 8px;font-size:13px;color:var(--g)}
.field textarea{display:block;width:100%;min-height:80px;font-size:16px;border:1px solid #CBC4D6;border-radius:10px;margin-top:4px;padding:10px;box-sizing:border-box;font-family:inherit}`
const page = (title: string, body: string, nonce: string, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="robots" content="noindex"><style>${CSS}${PAGE_CSS}</style></head><body>${body}${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`

servicePhotosPublic.get('/:token', async (req, res) => {
  const nonce = crypto.randomBytes(16).toString('base64')
  headers(res, nonce)
  const { t, closed } = await linkTicket(String(req.params.token))
  const company = t ? await companyOf(t.accountId) : { name: 'Getter Done Fence', phone: '' }
  const top = `<header class="top"><img src="../logo.png" alt="" class="logo"><div><p class="co">${esc(company.name)}</p><p class="small">Fence service request</p></div></header>`
  if (!t || closed) {
    const why = closed === 'expired' ? 'This photo link has expired.' : closed === 'done' ? 'This service request is closed.' : 'This link is not available.'
    res.status(t ? 410 : 404).type('html').send(page('Photos for your fence', `${top}<main class="wrap"><section data-service-link-closed="${closed}"><h1>${why}</h1><p>${callUs(company.phone)} We will send a new link if you still need one.</p></section></main>`, nonce))
    return
  }
  const contact = t.crmContactId ? await prisma.crmContact.findUnique({ where: { id: t.crmContactId }, select: { firstName: true } }) : null
  const sent = await customerFileCount(t.id)
  const body = `${top}<main class="wrap" data-service-upload>
    <h1>Hi ${esc(contact?.firstName || 'there')}, show us your fence</h1>
    <p>Sorry to hear about the issue (${esc(issueLabel(t.issue).toLowerCase())}). A few photos help us see what is going on before we come out: the whole fence, then close up of the problem. A short video is fine too.</p>
    <section>
      <label class="btn filebtn">Choose or take photos<input id="files" type="file" accept="image/*,video/*" multiple hidden></label>
      <label class="field">Anything to add? (optional)<textarea id="note" maxlength="500"></textarea></label>
      <p id="msg" class="small" role="status" aria-live="polite">${sent ? `${sent} sent so far. You can add more.` : ''}</p>
      <div id="sent" class="media"></div>
      <p class="small">Photos up to 25 MB each, videos up to 300 MB (about a minute). ${MAX_CUSTOMER_FILES} at most. Link open until ${esc(t.uploadExpiresAt!.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric' }))}.</p>
    </section>
    <p class="small">Questions? ${callUs(company.phone)}</p>
  </main>`
  const script = `
  (function(){
    var tok=${JSON.stringify(String(req.params.token))},files=document.getElementById('files'),msg=document.getElementById('msg'),done=${sent};
    files.addEventListener('change',function(){
      var list=[].slice.call(files.files);if(!list.length)return;var i=0,wait=3000,note=document.getElementById('note').value;
      // Each file keeps one id, so one sent again after the signal dropped is saved once.
      var ids=list.map(function(){return Date.now().toString(36)+Math.random().toString(36).slice(2,12)});
      function next(){
        if(i>=list.length){msg.textContent='Thank you! '+done+' sent. We will take a look and get back to you.';files.value='';return}
        var f=list[i],fd=new FormData();fd.append('cid',ids[i]);fd.append('caption',note);fd.append('file',f);
        var x=new XMLHttpRequest();x.open('POST',tok+'/media');
        x.upload.onprogress=function(e){if(e.lengthComputable)msg.textContent='Sending '+(i+1)+' of '+list.length+': '+Math.round(e.loaded/e.total*100)+'%'};
        x.onload=function(){if(x.status>=200&&x.status<300){shown(f);done++;wait=3000;i++;next()}else if(x.status>=500||x.status===429){retry()}else{var e='';try{e=JSON.parse(x.responseText).error}catch(_){}msg.textContent=(e||'That file could not be sent.');i++;setTimeout(next,1500)}};
        x.onerror=retry;
        x.send(fd);
      }
      function shown(f){var fig=document.createElement('figure'),el=document.createElement(f.type.indexOf('video')===0?'video':'img');el.src=URL.createObjectURL(f);if(el.tagName==='VIDEO'){el.controls=true;el.setAttribute('playsinline','')}else{el.alt=''}var cap=document.createElement('figcaption');cap.textContent='Sent';fig.appendChild(el);fig.appendChild(cap);document.getElementById('sent').appendChild(fig)}
      // No signal: keep the page open and it sends by itself.
      function retry(){msg.textContent='No signal. '+(list.length-i)+' waiting; they will send by themselves. Keep this page open.';setTimeout(next,wait);wait=Math.min(wait*2,30000)}
      next();
    });
  })();`
  res.type('html').send(page('Photos for your fence', body, nonce, script))
})

/** Multer for customer files: to disk, one file, no bigger than the largest video allowed. */
export const customerUpload = multer({
  storage: multer.diskStorage({ destination: (_req, _f, cb) => cb(null, mediaDir('incoming')), filename: (_req, _f, cb) => cb(null, `svc-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.part`) }),
  limits: { fileSize: VIDEO_MAX_BYTES, files: 1, fields: 10 },
})

/** Run multer; a file over the limit is answered in plain words. */
export function takeOneFile(req: any, res: any, next: any) {
  customerUpload.single('file')(req, res, (e: any) => {
    if (!e) { next(); return }
    if (e?.code === 'LIMIT_FILE_SIZE') { res.status(413).json({ success: false, error: 'That file is too large. Photos up to 25 MB, videos up to 300 MB.' }); return }
    res.status(400).json({ success: false, error: 'Send one photo or video at a time.' })
  })
}

const extOf = (mime: string, name: string) => (path.extname(name || '').slice(1).toLowerCase().replace(/[^a-z0-9]/g, '') || ({ 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' } as Record<string, string>)[mime] || (mime.startsWith('video/') ? 'mp4' : 'jpg'))

/**
 * A customer's file onto a ticket: checked against the limits, saved as a
 * MediaItem on the ticket, its job and customer, Internal, category Existing
 * damage. `cid`: the page's own id for the file, so a resend saves once.
 */
export async function receiveCustomerFile(t: TicketRow, file: Express.Multer.File | undefined, opts: { via: 'link' | 'portal'; cid: string | null; caption: string }): Promise<{ status: number; error?: string; id?: string }> {
  const drop = () => { if (file) fs.rm(file.path, { force: true }, () => {}) }
  if (!file) return { status: 400, error: 'Send a photo or video.' }
  const clientId = opts.cid && /^[A-Za-z0-9_-]{6,60}$/.test(opts.cid) ? `svc-${t.id.slice(0, 8)}-${opts.cid}` : null
  if (clientId) {
    const again = await prisma.mediaItem.findUnique({ where: { clientId } })
    if (again) { drop(); return { status: 200, id: again.id } }
  }
  const refusal = uploadRefusal(file.mimetype, file.size, await customerFileCount(t.id))
  if (refusal) { drop(); return { status: 400, error: refusal } }
  const id = crypto.randomUUID()
  const final = path.join(mediaDir(t.accountId), `${id}.${extOf(file.mimetype, file.originalname)}`)
  fs.renameSync(file.path, final)
  try {
    await prisma.mediaItem.create({
      data: {
        id, accountId: t.accountId, clientId: clientId ?? `svc-${id}`, kind: file.mimetype.startsWith('video/') ? 'video' : 'photo', mime: file.mimetype,
        path: final, bytes: file.size, jobId: t.jobId, quoteKey: t.quoteId, customerId: t.crmContactId, serviceTicketId: t.id,
        takenBy: opts.via === 'link' ? 'Customer (photo link)' : 'Customer (portal)', takenAt: new Date(), caption: opts.caption.slice(0, 500),
        category: 'Existing damage', visibility: 'internal', source: 'customer',
      },
    })
  } catch (e) {
    // The same file arrived twice at the same moment: the first one stands.
    fs.rmSync(final, { force: true })
    if (!isUniqueViolation(e)) throw e
    return { status: 200 }
  }
  processMediaQueue().catch(err => console.error('[media] queue:', err))
  const fresh = await prisma.serviceTicket.findUnique({ where: { id: t.id } })
  if (fresh) await photoArrived(fresh, opts.via)
  return { status: 200, id }
}

servicePhotosPublic.post('/:token/media', async (req, res, next) => {
  // The link is checked before any bytes are taken.
  const { closed } = await linkTicket(String(req.params.token))
  if (closed) { res.status(closed === 'gone' ? 404 : 410).json({ success: false, error: closed === 'expired' ? 'This photo link has expired. Please call us for a new one.' : 'This link is not available.' }); return }
  next()
}, takeOneFile, async (req: any, res) => {
  try {
    const { t, closed } = await linkTicket(String(req.params.token))
    if (!t || closed) { if (req.file) fs.rm(req.file.path, { force: true }, () => {}); res.status(410).json({ success: false, error: 'This link is not available.' }); return }
    const out = await receiveCustomerFile(t, req.file, { via: 'link', cid: typeof req.body?.cid === 'string' ? req.body.cid : null, caption: String(req.body?.caption || '') })
    if (out.error) { res.status(out.status).json({ success: false, error: out.error }); return }
    res.json({ success: true })
  } catch (e) {
    console.error('[service] link upload:', e)
    res.status(500).json({ success: false, error: 'Could not save that file. Please try again.' })
  }
})
