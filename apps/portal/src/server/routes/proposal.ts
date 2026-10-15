/**
 * Customer proposal: a small server-made page at /p/<link> that opens on any
 * phone. It is the only thing meant for the public door (Tailscale Funnel on
 * /p): the proposal, its style photos, the logo and the Accept button. No
 * sign in page, no app code and no other data are reachable through it.
 *
 * Everything shown comes from the proposal frozen on the quote when it was
 * saved (web/src/proposal.ts), never costs or margin. A strict Content
 * Security Policy allows only this page's own inline script and images.
 *
 * Staff routes for style photos live at /api/style-photos.
 */

import { Router } from 'express'
import express from 'express'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/auditLog.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { onProposalAccepted } from '../lib/proposalAccepted.js'

/** A link that was turned off or has run out. */
export function linkClosed(q: { shareDisabledAt: Date | null; shareExpiresAt: Date | null }): 'off' | 'expired' | null {
  if (q.shareDisabledAt) return 'off'
  if (q.shareExpiresAt && q.shareExpiresAt.getTime() < Date.now()) return 'expired'
  return null
}

async function companyPhone(accountId: string, p?: { company?: { phone?: string } } | null): Promise<string> {
  if (p?.company?.phone) return p.company.phone
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }).catch(() => null)
  return String((b?.config as any)?.company?.phone || '')
}

export const publicProposal = Router()
export const stylePhotos = Router()

// ── Helpers ──

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const money = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US')
const money2 = (n: number) => '$' + (n || 0).toFixed(2)

/** Only our own drawing: an <svg> with no scripts, handlers or links. */
function safeSvg(svg: unknown): string {
  if (typeof svg !== 'string' || !/^\s*<svg[\s>]/i.test(svg) || svg.length > 400_000) return ''
  if (/<script|<foreignObject|\son\w+\s*=|javascript:|<iframe|<a[\s>]|href\s*=\s*["'](?!#)/i.test(svg)) return ''
  return svg
}

/** Monthly payment for a financed price: standard amortized loan. */
export function monthlyPayment(price: number, aprPct: number, months: number): number {
  if (!(price > 0) || !(months > 0)) return 0
  const r = (aprPct || 0) / 100 / 12
  return r > 0 ? (price * r) / (1 - Math.pow(1 + r, -months)) : price / months
}

interface ProposalOption { label: string; fenceStyle: string; finalPrice: number; perFoot: number; sections: number; photoId?: string | null; tier?: { label?: string; blurb?: string }; badge?: string; snapshot?: any }
interface Proposal {
  version: number
  company?: { name?: string; phone?: string; email?: string }
  customer?: { name?: string; address?: string }
  planSvg?: string
  footageFt?: number
  gatesText?: string
  included?: string[]
  includedNote?: string
  warranty?: string
  depositPct?: number
  depositNote?: string
  financing?: { provider?: string; apr?: number; months?: number; link?: string } | null
  recommended?: number
  options: ProposalOption[]
}

function logoPath(): string | null {
  const candidates = [
    process.env.WEB_DIST_DIR && path.join(process.env.WEB_DIST_DIR, 'logo.png'),
    path.resolve(process.cwd(), '../web/dist/logo.png'),
    path.resolve(process.cwd(), '../web/public/logo.png'),
    path.resolve(process.cwd(), 'apps/web/public/logo.png'),
  ].filter(Boolean) as string[]
  return candidates.find(p => fs.existsSync(p)) ?? null
}

// ── Public: logo and style photos ──

publicProposal.get('/logo.png', (_req, res) => {
  const p = logoPath()
  if (!p) { res.status(404).end(); return }
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.type('png').end(fs.readFileSync(p))
})

publicProposal.get('/photo/:id', async (req, res) => {
  const id = String(req.params.id)
  if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(404).end(); return }
  const photo = await prisma.stylePhoto.findUnique({ where: { id } }).catch(() => null)
  if (!photo) { res.status(404).end(); return }
  res.setHeader('Content-Type', photo.mime)
  res.setHeader('Cache-Control', 'public, max-age=3600')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(Buffer.from(photo.data))
})

// ── Public: the proposal page ──

publicProposal.get('/:token', async (req, res) => {
  const token = String(req.params.token)
  const q = await prisma.savedQuote.findUnique({ where: { shareToken: token } }).catch(() => null)
  const nonce = crypto.randomBytes(16).toString('base64')
  res.setHeader('Content-Security-Policy', `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`)
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Robots-Tag', 'noindex')
  res.setHeader('Cache-Control', 'no-store')
  if (!q || q.archivedAt) { res.status(404).type('html').send(page('Proposal not found', '<main class="wrap"><h1>This proposal is not available</h1><p>Please call us and we will send a new link.</p></main>', nonce)); return }
  const p = q.proposal as unknown as Proposal | null
  const closed = linkClosed(q)
  if (closed) {
    const phone = await companyPhone(q.accountId, p)
    const name = esc(p?.company?.name || 'Getter Done Fence')
    res.status(410).type('html').send(page('Proposal link closed', `<header class="top"><img src="logo.png" alt="" class="logo"><div><p class="co">${name}</p></div></header>
      <main class="wrap"><section><h1>This link is no longer active</h1><p>${closed === 'expired' ? 'Proposal links are good for a limited time, and this one has run out.' : 'This proposal link was turned off.'}</p>
      <p>We are happy to help. Call us${phone ? ` at <a href="tel:${esc(phone.replace(/[^\d+]/g, ''))}"><b>${esc(phone)}</b></a>` : ''} and we will send you a current proposal.</p></section></main>`, nonce))
    return
  }
  if (!p || !Array.isArray(p.options) || p.options.length === 0) { res.status(404).type('html').send(page('Proposal not found', '<main class="wrap"><h1>This proposal is not ready yet</h1><p>Please call us.</p></main>', nonce)); return }
  await prisma.savedQuote.update({ where: { id: q.id }, data: { firstViewedAt: q.firstViewedAt || new Date(), viewCount: { increment: 1 } } }).catch(() => {})
  res.type('html').send(renderProposal(q, p, token, nonce))
})

const acceptSchema = z.object({
  option: z.number().int().min(0),
  name: z.string().trim().min(1, 'Please type your name').max(200),
  signature: z.string().max(1_000_000).regex(/^data:image\/png;base64,/, 'Please sign').optional(),
})

publicProposal.post('/:token/accept', express.json({ limit: '1.5mb' }), async (req, res) => {
  try {
    const body = acceptSchema.parse(req.body)
    const q = await prisma.savedQuote.findUnique({ where: { shareToken: String(req.params.token) } })
    if (!q || q.archivedAt) { res.status(404).json({ success: false, error: 'This proposal is no longer available.' }); return }
    if (q.acceptedAt) { res.status(409).json({ success: false, error: 'This proposal was already accepted.' }); return }
    if (linkClosed(q)) { res.status(410).json({ success: false, error: 'This link is no longer active. Please call us.' }); return }
    const p = q.proposal as unknown as Proposal | null
    const opt = p?.options?.[body.option]
    if (!opt) { res.status(400).json({ success: false, error: 'Please choose an option.' }); return }
    // The quote becomes the option the customer chose, exactly as it was priced.
    const s = opt.snapshot ?? {}
    const layout = q.layout as any
    const updated = await prisma.savedQuote.update({
      where: { id: q.id },
      data: {
        status: 'SOLD',
        acceptedAt: new Date(),
        acceptedBy: body.name,
        acceptedSignature: body.signature ?? null,
        chosenOption: body.option,
        fenceStyle: opt.fenceStyle,
        finalPrice: opt.finalPrice,
        sections: opt.sections,
        ...(typeof s.materialCost === 'number' ? { materialCost: s.materialCost, laborCost: s.laborCost, tearOutCost: s.tearOutCost, totalCOGS: s.totalCOGS, gmPct: s.gmPct } : {}),
        ...(Array.isArray(s.pullSheet) ? { pullSheet: s.pullSheet } : {}),
        ...(Array.isArray(s.runRails) ? { runRails: s.runRails } : {}),
        ...(layout && Array.isArray(s.runSections) ? { layout: { ...layout, runSections: s.runSections } } : {}),
      },
    })
    console.log(`[proposal] customer accepted quote ${q.id} option ${body.option} (${opt.fenceStyle}) as "${body.name}"`)
    await onProposalAccepted(q, opt, body.name).catch(err => console.error('[proposal] after accept:', err))
    res.json({ success: true, data: { acceptedAt: updated.acceptedAt, option: body.option } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[proposal] accept error:', err)
    res.status(500).json({ success: false, error: 'Something went wrong. Please call us.' })
  }
})

// ── Staff: style photos ──

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } })
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

stylePhotos.get('/', requireUser, requireAccount, async (req: any, res) => {
  const list = await prisma.stylePhoto.findMany({ where: { accountId: req.user.crmAccountId }, select: { id: true, styleName: true, updatedAt: true } })
  res.json({ success: true, data: list })
})

stylePhotos.post('/', requireUser, requireAccount, upload.single('photo'), async (req: any, res) => {
  const styleName = String(req.body?.styleName || '').trim().slice(0, 200)
  const file = req.file
  if (!styleName || !file) { res.status(400).json({ success: false, error: 'A style and a photo are required' }); return }
  if (!PHOTO_TYPES.includes(file.mimetype)) { res.status(400).json({ success: false, error: 'Use a JPG, PNG or WebP photo' }); return }
  const accountId = req.user.crmAccountId
  const saved = await prisma.stylePhoto.upsert({
    where: { accountId_styleName: { accountId, styleName } },
    create: { accountId, styleName, mime: file.mimetype, data: file.buffer },
    update: { mime: file.mimetype, data: file.buffer },
    select: { id: true, styleName: true, updatedAt: true },
  })
  await audit(req, 'update', 'StylePhoto', saved.id, { newValues: { styleName } }).catch(() => {})
  res.json({ success: true, data: saved })
})

stylePhotos.delete('/:id', requireUser, requireAccount, async (req: any, res) => {
  const n = await prisma.stylePhoto.deleteMany({ where: { id: String(req.params.id), accountId: req.user.crmAccountId } })
  res.json({ success: true, data: { deleted: n.count } })
})

// ── The page ──

function page(title: string, body: string, nonce: string, script = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="robots" content="noindex"><style>${CSS}</style></head><body>${body}${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`
}

function renderProposal(q: any, p: Proposal, token: string, nonce: string): string {
  const company = p.company ?? {}
  const rec = Math.min(Math.max(0, p.recommended ?? 0), p.options.length - 1)
  const accepted = !!q.acceptedAt
  const chosen = accepted ? (q.chosenOption ?? rec) : rec
  const base = p.options[rec]?.finalPrice ?? p.options[0].finalPrice
  const fin = p.financing && (p.financing.months ?? 0) > 0 ? p.financing : null

  const options = p.options.map((o, i) => {
    const diff = o.finalPrice - base
    const save = i !== rec && diff < -0.5 ? `<span class="save">Save ${money(-diff)}</span>` : i !== rec && diff > 0.5 ? `<span class="more">${money(diff)} more</span>` : ''
    const monthly = fin ? `<p class="monthly">As low as ${money2(monthlyPayment(o.finalPrice, fin.apr ?? 0, fin.months!))}/month for ${fin.months} months${fin.provider ? ` with ${esc(fin.provider)}` : ''}</p>` : ''
    const photo = o.photoId ? `<img class="photo" src="photo/${esc(o.photoId)}" alt="${esc(o.label)}" loading="lazy">` : ''
    return `<label class="opt${i === chosen ? ' on' : ''}" data-option="${i}">
      <input type="radio" name="option" value="${i}"${i === chosen ? ' checked' : ''}${accepted ? ' disabled' : ''}>
      ${photo}
      <span class="optbody">
        ${o.badge ? `<span class="badge">${esc(o.badge)}</span>` : i === rec && p.options.length > 1 ? '<span class="badge">Recommended</span>' : ''}
        ${o.tier?.label ? `<span class="tier">${esc(o.tier.label)}</span>` : ''}
        <span class="optlabel">${esc(o.label)}</span>
        ${o.tier?.blurb ? `<span class="blurb">${esc(o.tier.blurb)}</span>` : ''}
        <span class="price">${money(o.finalPrice)}</span>
        <span class="small">${money2(o.perFoot)} a foot · ${o.sections} sections</span>
        ${save}${monthly}
      </span>
    </label>`
  }).join('')

  const deposit = (p.depositPct ?? 0) > 0
    ? `<section><h2>Deposit</h2><p id="deposit" data-pct="${Number(p.depositPct)}">${esc(p.depositPct)}% to schedule: <b>${money(p.options[chosen].finalPrice * (p.depositPct! / 100))}</b></p>${p.depositNote ? `<p class="small">${esc(p.depositNote)}</p>` : ''}</section>`
    : ''
  const included = (p.included?.length || p.includedNote)
    ? `<section><h2>What's included</h2><ul>${(p.included ?? []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>${p.includedNote ? `<p>${esc(p.includedNote).replace(/\n/g, '<br>')}</p>` : ''}</section>`
    : ''
  const warranty = p.warranty ? `<section><h2>Warranty</h2><p>${esc(p.warranty).replace(/\n/g, '<br>')}</p></section>` : ''
  const plan = safeSvg(p.planSvg)
  const acceptBlock = accepted
    ? `<section class="done"><h2>Accepted</h2><p>Accepted by ${esc(q.acceptedBy)} on ${new Date(q.acceptedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}: ${esc(p.options[chosen]?.label)} at ${money(p.options[chosen]?.finalPrice)}.</p><p>Thank you. We will call you to schedule.</p></section>`
    : `<section id="accept"><h2>Accept this proposal</h2>
        <p class="small">Choose an option above, type your name and sign with your finger.</p>
        <label class="field">Your name<input id="name" autocomplete="name" maxlength="200"></label>
        <div class="sigwrap"><canvas id="sig" width="600" height="200" aria-label="Sign here"></canvas><button type="button" id="clear" class="link">Clear</button></div>
        <p id="err" class="err" role="alert"></p>
        <button type="button" id="go" class="btn">Accept the selected option</button>
      </section>`

  const body = `<header class="top"><img src="logo.png" alt="" class="logo"><div><p class="co">${esc(company.name || 'Getter Done Fence')}</p><p class="small">${[company.phone, company.email].filter(Boolean).map(esc).join(' · ')}</p></div></header>
  <main class="wrap">
    <p class="small upper">Fence proposal</p>
    <h1>${esc(p.customer?.name || q.customerName)}</h1>
    <p class="small">${esc(p.customer?.address || q.customerAddress || '')}</p>
    <p class="facts">${p.footageFt ? `${Math.round(p.footageFt)} ft of fence` : ''}${p.gatesText ? ` · ${esc(p.gatesText)}` : ''}</p>
    ${plan ? `<section><h2>Site plan</h2><div class="plan">${plan}</div><p class="small">Purple: new fence. Squares: corner posts. Dots: end and gate posts. Gray dashed: existing fence or no fence, not included. Not to scale for permitting.</p></section>` : ''}
    <section><h2>${p.options.length > 1 ? 'Your options' : 'Your fence'}</h2><div class="opts${p.options.some(o => o.tier) ? ' tiers' : ''}">${options}</div></section>
    ${included}${warranty}${deposit}${acceptBlock}
    <p class="small foot">Questions? Call ${esc(company.phone || 'us')}.</p>
  </main>`

  const script = accepted ? '' : `
  (function(){
    var opts=[].slice.call(document.querySelectorAll('.opt'));
    var prices=${JSON.stringify(p.options.map(o => o.finalPrice))};
    var dep=document.getElementById('deposit');
    function pick(){opts.forEach(function(o){var r=o.querySelector('input');o.classList.toggle('on',r.checked);if(r.checked&&dep){var b=dep.querySelector('b');b.textContent='$'+Math.round(prices[+r.value]*(+dep.dataset.pct)/100).toLocaleString('en-US');}});}
    opts.forEach(function(o){o.querySelector('input').addEventListener('change',pick)});
    var c=document.getElementById('sig'),x=c.getContext('2d'),down=false,inked=false;
    x.lineWidth=3;x.lineCap='round';x.strokeStyle='#1C1030';
    function pos(e){var r=c.getBoundingClientRect();return[(e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height]}
    c.addEventListener('pointerdown',function(e){down=true;inked=true;try{c.setPointerCapture(e.pointerId)}catch(_){}var p=pos(e);x.beginPath();x.moveTo(p[0],p[1]);e.preventDefault()});
    c.addEventListener('pointermove',function(e){if(!down)return;var p=pos(e);x.lineTo(p[0],p[1]);x.stroke();e.preventDefault()});
    c.addEventListener('pointerup',function(){down=false});
    document.getElementById('clear').addEventListener('click',function(){x.clearRect(0,0,c.width,c.height);inked=false});
    var go=document.getElementById('go'),err=document.getElementById('err');
    go.addEventListener('click',function(){
      var sel=document.querySelector('input[name=option]:checked');var name=document.getElementById('name').value.trim();
      if(!sel){err.textContent='Please choose an option.';return}
      if(!name){err.textContent='Please type your name.';return}
      if(!inked){err.textContent='Please sign in the box.';return}
      go.disabled=true;go.textContent='Sending...';err.textContent='';
      fetch('${esc(token)}/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({option:+sel.value,name:name,signature:c.toDataURL('image/png')})})
        .then(function(r){return r.json()}).then(function(j){if(j.success){location.reload()}else{err.textContent=j.error||'Something went wrong.';go.disabled=false;go.textContent='Accept the selected option'}})
        .catch(function(){err.textContent='No connection. Please try again.';go.disabled=false;go.textContent='Accept the selected option'});
    });
  })();`
  return page(`Fence proposal for ${p.customer?.name || q.customerName}`, body, nonce, script)
}

const CSS = `
:root{--p:#5E28A1;--pd:#4E1F88;--ink:#1C1030;--g:#5F5769;--line:#E2DCEC;--bg:#F6F4FA}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
.top{display:flex;gap:12px;align-items:center;padding:14px 16px;background:#fff;border-bottom:1px solid var(--line)}
.logo{width:48px;height:48px;object-fit:contain}.co{margin:0;font-weight:800;font-size:18px;color:var(--p)}
.wrap{max-width:760px;margin:0 auto;padding:16px 16px 48px}
h1{font-size:28px;line-height:1.15;margin:4px 0}h2{font-size:18px;margin:0 0 10px}
section{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px;margin-top:16px}
.small{font-size:14px;color:var(--g);margin:4px 0}.upper{text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:var(--p)}
.facts{font-weight:600}.plan svg{width:100%;height:auto;display:block}
.opts{display:grid;gap:12px}.opts.tiers{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.tier{font-size:22px;font-weight:800;color:var(--p)}.blurb{font-size:14px;color:var(--g)}.opt{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:start;border:2px solid var(--line);border-radius:14px;padding:12px;cursor:pointer}
.opt.on{border-color:var(--p);background:#F7F3FD}.opt input{width:24px;height:24px;margin-top:4px;accent-color:var(--p)}
.photo{grid-column:1/-1;width:100%;max-height:260px;object-fit:cover;border-radius:10px}
.optbody{display:flex;flex-direction:column;gap:2px}.optlabel{font-weight:700}.price{font-size:28px;font-weight:800}
.badge{align-self:flex-start;background:var(--p);color:#fff;font-size:12px;font-weight:700;border-radius:999px;padding:2px 10px}
.save{color:#15803d;font-weight:700}.more{color:var(--g)}.monthly{margin:4px 0 0;font-size:14px;color:var(--pd);font-weight:600}
ul{margin:0;padding-left:20px}.field{display:block;font-size:14px;color:var(--g);margin:8px 0}
.field input{display:block;width:100%;height:48px;font-size:16px;border:1px solid #CBC4D6;border-radius:10px;padding:0 12px;margin-top:4px}
.sigwrap{position:relative;border:1px dashed #9D7BD0;border-radius:10px;background:#fff}#sig{width:100%;height:160px;touch-action:none;display:block}
.link{position:absolute;right:8px;top:6px;background:none;border:0;color:var(--p);font-weight:600;font-size:14px;min-height:44px}
.btn{width:100%;min-height:52px;margin-top:12px;border:0;border-radius:12px;background:var(--p);color:#fff;font-size:17px;font-weight:700}
.btn:disabled{opacity:.6}.err{color:#b91c1c;min-height:1.2em;margin:8px 0 0}.done{border-color:#86efac;background:#f0fdf4}.foot{text-align:center;margin-top:24px}
`
