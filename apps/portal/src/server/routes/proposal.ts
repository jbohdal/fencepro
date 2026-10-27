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
import { Prisma } from '@prisma/client'
import { audit } from '../lib/auditLog.js'
import { requireUser, requireAccount, signedNow } from './saved-quotes.js'
import { onProposalAccepted, ensureJobForAcceptedQuote } from '../lib/proposalAccepted.js'
import { scheduleAfterSigning } from '../lib/contractBilling.js'
import { snapshotAfterSigning } from '../lib/jobCosting.js'
import { syncSalesOrderSafe } from '../lib/salesOrders.js'
import { plainZod } from '../lib/plainZod.js'
import { requireCan } from '../lib/permissions.js'
import rateLimit from 'express-rate-limit'
import { startView, beatView, markSigned, ignoredRequest, proposalOpenedPush } from '../lib/proposalViews.js'
import { contractForQuote, warrantyLines } from '../lib/contractPdf.js'
import { installDateOf } from '../lib/warranties.js'
import { pricingModule, plainStyleName } from '../lib/estimates.js'
import { styleRecords } from '../lib/ownTier.js'
import { overlayAcceptedUpdate } from '../lib/warrantyUpdates.js'
import { depositOf } from '../lib/paymentMath.js'
import { clientIpOf } from '../lib/staffDevices.js'
import { fileSignedContract, plainIp } from '../lib/signedDocuments.js'
import { proposalPhotos, quoteCustomer, belongsToQuote } from '../lib/quoteMedia.js'
import { svgWithNamespace } from '../lib/planSvg.js'
import { currentTerms, companyAddress, termsOn, type Term } from '../lib/contractTerms.js'
import { OFFICE_NOTICE_ROLE } from '../lib/notificationService.js'
import { customerFenceName } from '../lib/customerFenceName.js'

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

/** A phone number to tap: (352) 789 4314. */
function tel(p: string): string {
  const shown = phoneText(p)
  return `<a href="tel:${esc(p.replace(/[^\d+]/g, ''))}" style="white-space:nowrap;display:inline-block;padding:14px 4px;margin:-14px 0">${esc(shown)}</a>`
}

/** A phone number as the customer reads it: (352) 789 4314. */
export function phoneText(p: string): string {
  const d = p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)} ${d.slice(6)}` : p
}

/**
 * What the customer is told when a signing is refused (the answer to Accept, and the page after it
 * reloads): which fence stands and the number to call (review Oct 27 2026: "Please call us" gave neither).
 */
export function refusalText(why: 'signed' | 'accepted', label: string, phone: string): string {
  const call = `please call us${phone ? ` at ${phoneText(phone)}` : ''}.`
  return why === 'accepted'
    ? `This proposal was already accepted${label ? ` for ${label}` : ''}. To make a change, ${call}`
    : `Your fence was already agreed with us${label ? ` for ${label}` : ''}. To change it, ${call}`
}

export const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const money = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US')
const money2 = (n: number) => '$' + (n || 0).toFixed(2)

/** Only our own drawing: an <svg> with no scripts, handlers or links. */
export function safeSvg(svg: unknown): string {
  if (typeof svg !== 'string' || !/^\s*<svg[\s>]/i.test(svg) || svg.length > 400_000) return ''
  // A picture only from inside the drawing itself: the site plan's aerial photo, a JPEG or PNG kept in it.
  if (/<script|<foreignObject|\son\w+\s*=|javascript:|<iframe|<a[\s>]|href\s*=\s*["'](?!#|data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+["'])/i.test(svg)) return ''
  // With the SVG namespace, so it also shows as a picture (the portal's /site-plans/<id>.svg, an <img>), not only inline.
  return svgWithNamespace(svg)
}

/** Monthly payment for a financed price: standard amortized loan. */
export function monthlyPayment(price: number, aprPct: number, months: number): number {
  if (!(price > 0) || !(months > 0)) return 0
  const r = (aprPct || 0) / 100 / 12
  return r > 0 ? (price * r) / (1 - Math.pow(1 + r, -months)) : price / months
}

export interface ProposalOption { label: string; fenceStyle: string; finalPrice: number; perFoot: number; sections: number; photoId?: string | null; adjustmentCents?: number; tier?: { key?: string; label?: string; blurb?: string }; badge?: string; snapshot?: any; warranty?: { id?: string | null; name?: string; text?: string } }
export interface Proposal {
  version: number
  company?: { name?: string; phone?: string; email?: string; address?: string }
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
  /** A fence move or repair: the plain words of the work. */
  kind?: 'move' | 'repair'
  description?: string
  /** Priced to the whole dollar (Oct 21 2026 on): no cents anywhere on the page, the deposit whole dollars too. */
  wholeDollar?: boolean
  /** Show a reduction (the quote's ± dollar adjustment) as the list price, a Discount line and the final. Otherwise the final price only. */
  showDiscount?: boolean
  /** Settings → Contract Templates as the customer reads and signs them (lib/contractTerms.ts), frozen on the proposal. */
  terms?: Term[]
  /** The tier set as it was when the proposal was made (web/src/proposal.ts): how each tier picks its width. */
  tierSet?: { tiers?: Array<{ key: string; width?: string }> }
  /** A best price quote's own option shown as a tier, frozen when saved (lib/ownTier.ts); null: none. */
  ownTier?: { own: number; tier: number } | null
}

/** What the page shows beyond the saved proposal: worked out by proposalPage (never saved). */
export interface ProposalPageView {
  /** The option selected when the page opens (not yet accepted): the one the quote was made with (web/src/proposalOptions.ts). */
  start?: number
  /** Options not shown: the same fence at the same price as one shown before them. */
  hidden?: number[]
  /**
   * Signed in the app (Sold, or its quoted cost saved) but not yet accepted on the link: the option it was
   * signed for (as shown: its twin when it is hidden as the same fence), the only one the customer can sign.
   * -1: signed for a fence that is not on this proposal any more, so nothing can be signed here (call us).
   */
  sold?: number
  /** Sold for a fence not on this proposal (sold -1): that fence in plain words, as the page names it. */
  soldLabel?: string
  /** The order the options show in, by place (a quote's own best price option in its tier's place); every place when not given. */
  order?: number[]
  /** The page reloaded after a signing was refused (?refused=1): it says why, first (refusalText). */
  refused?: boolean
}

/**
 * The option a quote signed in the app was signed for: its style at its price (the same rule acceptQuote
 * takes), shown by its twin when it is hidden as the same fence. -1 when no option is that fence and price.
 */
export function signedOptionOf(options: Array<Pick<ProposalOption, 'fenceStyle' | 'finalPrice'>>, q: { fenceStyle: string; finalPrice: number }, dup: number[]): number {
  const own = options.findIndex(o => o.fenceStyle === q.fenceStyle && Math.round(Number(o.finalPrice) * 100) === Math.round(Number(q.finalPrice) * 100))
  if (own < 0) return -1
  return (dup[own] ?? -1) >= 0 ? dup[own] : own
}

/**
 * The option whose name the fence that stands goes by: the one shown (`at`), unless it is the twin of the
 * quote's own option (its style at its price), a best price fence sold or signed through the tier card it is the
 * same fence as; then the quote's own, the name the signed contract prints (lib/contractPdf.ts).
 */
export function standingOptionOf(options: Array<Pick<ProposalOption, 'fenceStyle' | 'finalPrice'>>, q: { fenceStyle: string; finalPrice: number }, at: number): number {
  if (!options[at] || options[at].fenceStyle === q.fenceStyle) return at
  const own = options.findIndex(o => o.fenceStyle === q.fenceStyle && Math.round(Number(o.finalPrice) * 100) === Math.round(Number(q.finalPrice) * 100))
  return own >= 0 ? own : at
}

/**
 * The proposal as the page shows it: its frozen terms (today's terms from
 * Settings for an unsigned one sent before terms were frozen; none for one
 * signed before), the company's address, the option the quote was made with
 * selected, and any option that is the same fence twice hidden.
 */
export async function proposalPage(q: { accountId: string; acceptedAt: Date | null; chosenOption?: number | null; fenceStyle: string; finalPrice: number; status?: string | null; soldAt?: Date | null; firstViewedAt?: Date | null; viewCount?: number | null }, p: Proposal, signed = false): Promise<{ p: Proposal; view: ProposalPageView }> {
  const m = await pricingModule()
  const frozen = await termsOn(p)
  const terms = frozen ?? (q.acceptedAt ? [] : await currentTerms(q.accountId, { repair: p.kind === 'repair' }))
  const address = p.company?.address || await companyAddress(q.accountId)
  const shown: Proposal = { ...p, terms, company: { ...(p.company ?? {}), ...(address ? { address } : {}) } }
  const dup = m.sameFenceAs(p.options)
  const hidden = dup.map((d, i) => (d >= 0 ? i : -1)).filter(i => i >= 0)
  // A best price quote's own option is the fence of one tier (6 or 8 ft panels per run, where the tier takes one width for
  // the whole yard): shown once, as that tier at the quote's price, in its place (web/src/proposalOptions.ts ownTierFold).
  // Only as frozen on the proposal when saved, or while not yet sent: a sent proposal never reprices (lib/ownTier.ts).
  const fold = m.proposalFold(p, q, await styleRecords())
  let order: number[] | undefined
  if (fold) {
    const t = p.options[fold.tier]
    shown.options = p.options.map((o, i) => i === fold.own ? { ...o, tier: t.tier, badge: t.badge, photoId: t.photoId || o.photoId } : o)
    if (p.recommended === fold.tier) shown.recommended = fold.own
    hidden.push(fold.tier)
    order = p.options.map((_o, i) => i).filter(i => i !== fold.own).map(i => (i === fold.tier ? fold.own : i))
  }
  const start = m.startingOption(p.options, q, p.recommended ?? 0)
  // Sold in the app before the customer signed the link: only the option it was sold for can be signed.
  const sold = signed && !q.acceptedAt ? signedOptionOf(p.options, q, dup) : undefined
  // Sold, or signed, for a fence shown by its twin (a best price fence the same as one tier's): the card says the
  // fence that stands, as the contract prints it (round 6 review, Oct 27 2026: the sold link read "8 ft panels", the
  // signed page "6 or 8 ft panels").
  const standsAt = q.acceptedAt ? (typeof q.chosenOption === 'number' ? q.chosenOption : -1) : sold ?? -1
  const named = standsAt >= 0 ? standingOptionOf(p.options, q, standsAt) : standsAt
  if (standsAt >= 0 && named !== standsAt) shown.options = shown.options.map((o, i) => (i === standsAt ? { ...o, label: p.options[named].label } : o))
  const soldLabel = sold === -1 ? await plainStyleName(q.fenceStyle).catch(() => q.fenceStyle) : undefined
  return { p: shown, view: { start, hidden, ...(order ? { order } : {}), ...(sold === undefined ? {} : { sold }), ...(soldLabel ? { soldLabel } : {}) } }
}

/** An option's price block: the final price; with "Show as discount" and a reduction, the list price and a Discount line above it. */
export function optionPriceHtml(p: Pick<Proposal, 'showDiscount'>, o: Pick<ProposalOption, 'finalPrice' | 'adjustmentCents'>): string {
  const adj = Math.round(Number(o.adjustmentCents) || 0)
  const fmt = money
  if (p.showDiscount !== true || !(adj < 0)) return `<span class="price">${fmt(o.finalPrice)}</span>`
  const list = Math.round(o.finalPrice * 100 - adj) / 100
  return `<span class="list" data-list-price>Price <s>${fmt(list)}</s></span><span class="disc" data-discount>Discount −${fmt(-adj / 100)}</span><span class="price" data-final-price>${fmt(o.finalPrice)}</span>`
}

/** The deposit shown for an option's price (dollars): as the payment schedule makes it (lib/paymentMath.ts depositOf). */
export function depositDollars(p: Pick<Proposal, 'depositPct' | 'wholeDollar'>, price: number): number {
  return p.wholeDollar === true ? depositOf(Math.round(price * 100), Number(p.depositPct), true) / 100 : price * (Number(p.depositPct) / 100)
}

export function logoPath(): string | null {
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
  if (!p || !Array.isArray(p.options) || p.options.length === 0) {
    // An older quote with no proposal (the quote list's "Copy Share Link"): the quote itself, to read, and how to accept it.
    if (q.finalPrice > 0 && q.fenceStyle) { res.type('html').send(await renderQuoteView(q, nonce)); return }
    res.status(404).type('html').send(page('Proposal not found', '<main class="wrap"><h1>This proposal is not ready yet</h1><p>Please call us.</p></main>', nonce)); return
  }
  // Opens are counted by the page's own script once it is on screen (POST <link>/view), so link
  // previews, prefetch and staff opens never count (lib/proposalViews.ts).
  // Every proposal (a new fence, a move or a repair) shows the photos marked Customer on this quote and its site visit (lib/quoteMedia.ts).
  const photos = await proposalPhotos(q)
  // Accepted: the warranty's start, once the job is installed (lib/warranties.ts).
  const installDay = q.acceptedAt ? await acceptedInstallDay(q).catch(() => null) : null
  // Signed on a warranty update link: the accepted option shows the warranty it was signed with (lib/warrantyUpdates.ts).
  const shown = q.acceptedAt ? await overlayAcceptedUpdate(q, p).catch(() => p) : p
  // Its terms, the option the quote was made with selected, and no option twice (proposalPage).
  // Already sold in the app: only the option it was sold for can be signed (audit fix: the customer could pick another).
  const pv = await proposalPage(q, shown, !q.acceptedAt && await signedNow(q))
  // Back from a refused signing (a page opened before it was sold or accepted): it says why, over the fence that stands.
  if (req.query.refused) pv.view.refused = true
  res.type('html').send(renderProposal(q, pv.p, token, nonce, photos, installDay, '', pv.view))
})

/**
 * A quote with no proposal, for the customer: the fence, footage, gates and
 * price (never a cost), and a call to accept or ask for changes. Read only:
 * accepting online needs a proposal (saved from the quote builder).
 */
export async function renderQuoteView(q: any, nonce: string): Promise<string> {
  const b = await prisma.businessState.findUnique({ where: { accountId: q.accountId }, select: { config: true } }).catch(() => null)
  const co = ((b?.config as any)?.company ?? {}) as { name?: string; phone?: string; email?: string }
  const footage = (Array.isArray(q.runs) ? q.runs : []).reduce((t: number, n: unknown) => t + (Number(n) > 0 ? Number(n) : 0), 0)
  const gates = [q.walkGates ? `${q.walkGates} walk gate${q.walkGates === 1 ? '' : 's'}` : '', q.dblGates ? `${q.dblGates} double gate${q.dblGates === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')
  const label = await plainStyleName(q.fenceStyle)
  const status = q.acceptedAt || q.status === 'SOLD' ? '<section class="done"><h2>Accepted</h2><p>Thank you. We will call you to schedule.</p></section>'
    : `<section><h2>Ready to go ahead?</h2><p>Call us${co.phone ? ` at ${tel(co.phone)}` : ''} to accept this quote or to ask for any changes.</p></section>`
  const body = `<header class="top"><img src="logo.png" alt="" class="logo"><div><p class="co">${esc(co.name || 'Getter Done Fence')}</p><p class="small">${[co.phone ? tel(co.phone) : '', co.email ? esc(co.email) : ''].filter(Boolean).join(' · ')}</p></div></header>
  <main class="wrap" data-quote-view>
    <p class="small upper">Fence quote</p>
    <h1>${esc(q.customerName)}</h1>
    <p class="small">${esc(q.customerAddress || '')}</p>
    <section><h2>Your fence</h2><div class="opts"><div class="opt on"><span class="optbody">
      <span class="optlabel">${esc(label)}</span>
      <span class="price" data-quote-view-price>${money(q.finalPrice)}</span>
      <span class="small">${footage ? `${Math.round(footage)} ft of fence` : ''}${gates ? ` · ${esc(gates)}` : ''}</span>
    </span></div></div></section>
    ${status}
    <p class="small foot">Questions? Call ${co.phone ? tel(co.phone) : 'us'}.</p>
  </main>`
  return page(`Fence quote for ${q.customerName}`, body, nonce)
}

/** "October 20, 2026": the install date of the job for an accepted quote, null until installed. */
async function acceptedInstallDay(q: { id: string; accountId: string }): Promise<string | null> {
  const job = await prisma.savedJob.findFirst({ where: { accountId: q.accountId, quoteId: q.id, deletedAt: null, archivedAt: null }, select: { id: true, completedDate: true } })
  const day = job ? await installDateOf(job) : null
  return day ? (await pricingModule()).dayText(day) : null
}

// The signed contract (PDF) for an accepted proposal: the accepted option's warranty, word for word (lib/contractPdf.ts).
publicProposal.get('/:token/contract.pdf', async (req, res) => {
  try {
    const q = await prisma.savedQuote.findUnique({ where: { shareToken: String(req.params.token) } })
    if (!q || q.archivedAt || !q.acceptedAt || linkClosed(q)) { res.status(404).type('text').send('Not available'); return }
    const pdf = await contractForQuote(q)
    if (!pdf) { res.status(404).type('text').send('Not available'); return }
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline; filename="Signed contract.pdf"')
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('X-Robots-Tag', 'noindex')
    res.end(pdf)
  } catch (err) {
    console.error('[proposal] contract pdf:', err)
    res.status(500).type('text').send('Something went wrong. Please call us.')
  }
})

// A photo marked Customer on this proposal's quote or its site visit (marked up when it was).
publicProposal.get('/:token/media/:id', async (req, res) => {
  const q = await prisma.savedQuote.findUnique({ where: { shareToken: String(req.params.token) }, select: { id: true, accountId: true, archivedAt: true, shareDisabledAt: true, shareExpiresAt: true } }).catch(() => null)
  if (!q || q.archivedAt || linkClosed(q)) { res.status(404).end(); return }
  const m = await prisma.mediaItem.findUnique({ where: { id: String(req.params.id) } }).catch(() => null)
  if (!m || m.deletedAt || m.accountId !== q.accountId || m.visibility !== 'customer' || m.kind !== 'photo' || !belongsToQuote(m, q.id, await quoteCustomer(q.accountId, q.id))) { res.status(404).end(); return }
  const file = m.markupPath && fs.existsSync(m.markupPath) ? m.markupPath : m.path
  if (!file || !fs.existsSync(file)) { res.status(404).end(); return }
  res.setHeader('Content-Type', file === m.markupPath ? 'image/jpeg' : m.mime)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  fs.createReadStream(file).pipe(res)
})

// ── Public: opens (the page's own script; lib/proposalViews.ts) ──

const viewLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: false, legacyHeaders: false, message: { success: false } })
// sendBeacon sends text/plain: read either.
const viewBody = express.json({ limit: '4kb', type: ['application/json', 'text/plain'] })
const viewQuoteSelect = { id: true, accountId: true, crmContactId: true, ownerId: true, customerName: true, viewCount: true, firstViewedAt: true, lastViewedAt: true, acceptedAt: true, proposal: true, archivedAt: true, shareDisabledAt: true, shareExpiresAt: true } as const

publicProposal.post('/:token/view', viewLimiter, viewBody, async (req, res) => {
  try {
    if (ignoredRequest(req)) { res.status(204).end(); return }
    const q = await prisma.savedQuote.findUnique({ where: { shareToken: String(req.params.token) }, select: viewQuoteSelect })
    if (!q || q.archivedAt || linkClosed(q) || !Array.isArray((q.proposal as any)?.options)) { res.status(404).json({ success: false }); return }
    const v = await startView(req, q, (req.body as any)?.sp)
    res.json({ success: true, data: { id: v.id, base: v.base } })
    if (v.push) void proposalOpenedPush(v.id).catch(err => console.error('[proposal] opened push:', err))
  } catch (err) {
    console.error('[proposal] view start:', err)
    res.status(500).json({ success: false })
  }
})

publicProposal.post('/:token/view/:id', viewLimiter, viewBody, async (req, res) => {
  try {
    const q = await prisma.savedQuote.findUnique({ where: { shareToken: String(req.params.token) }, select: { id: true, proposal: true, archivedAt: true } })
    if (!q || q.archivedAt) { res.status(404).json({ success: false }); return }
    const ok = await beatView(q, String(req.params.id), (req.body ?? {}) as any)
    res.status(ok ? 204 : 404).end()
  } catch (err) {
    console.error('[proposal] view beat:', err)
    res.status(500).json({ success: false })
  }
})

export const acceptSchema = z.object({
  option: z.number().int().min(0),
  name: z.string().trim().min(1, 'Please type your name').max(200),
  signature: z.string().max(1_000_000).regex(/^data:image\/png;base64,/, 'Please sign').optional(),
  /** The open it was signed in (lib/proposalViews.ts). */
  view: z.string().max(64).nullish(),
})

publicProposal.post('/:token/accept', express.json({ limit: '1.5mb' }), async (req, res) => {
  try {
    const body = acceptSchema.parse(req.body)
    const q = await prisma.savedQuote.findUnique({ where: { shareToken: String(req.params.token) } })
    const out = await acceptQuote(q, body, signerOf(req))
    res.status(out.status).json(out.json)
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[proposal] accept error:', err)
    res.status(500).json({ success: false, error: 'Something went wrong. Please call us.' })
  }
})

/** Where an acceptance came from: the client's IP as Express gives it (trust proxy 1: the address Tailscale Funnel saw) and its browser. */
export interface Signer { ip: string | null; userAgent: string | null }
export const signerOf = (req: express.Request): Signer => ({ ip: plainIp(clientIpOf(req)), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 500) || null })

/**
 * The option shown in place of the signed one: the same fence at the same
 * price (web/src/proposalOptions.ts), so the page showed it instead of the
 * signed one and selected it.
 */
async function twinOfSigned(q: { fenceStyle: string; finalPrice: number }, p: Proposal, option: number): Promise<boolean> {
  const own = p.options.findIndex(o => o.fenceStyle === q.fenceStyle && Math.round(Number(o.finalPrice) * 100) === Math.round(q.finalPrice * 100))
  if (own < 0 || own === option) return false
  const dup = (await pricingModule()).sameFenceAs(p.options)
  return dup[own] === option || dup[option] === own
}

/**
 * A customer tried to sign the proposal link for something other than what stands (another option, or after
 * it was accepted): nothing is changed, and the owner and the office hear it on the bell with what the
 * customer tried, so someone calls them (audit fix Oct 27 2026: the office was never told).
 * The same try again within 10 minutes (a second tap) is one notice.
 */
export async function notifyConflict(q: any, body: { option: number; name: string }, why: 'signed' | 'accepted'): Promise<void> {
  try {
    const p = q.proposal as Proposal | null
    const opts = Array.isArray(p?.options) ? p!.options : []
    const tried = opts[body.option]
    const triedText = tried ? `${tried.label} at ${money(tried.finalPrice)}` : 'an option that is not on the proposal'
    const standing = why === 'accepted' && opts[q.chosenOption ?? -1]
      ? opts[q.chosenOption]
      : opts.find(o => o.fenceStyle === q.fenceStyle && Math.round(Number(o.finalPrice) * 100) === Math.round(Number(q.finalPrice) * 100))
    const standingText = standing ? `${standing.label} at ${money(standing.finalPrice)}` : `${await plainStyleName(q.fenceStyle).catch(() => q.fenceStyle)} at ${money(q.finalPrice)}`
    const customer = q.customerName || body.name
    // The essentials in the title: the bell shows a notice's body on two lines only, on a phone (review Oct 27 2026).
    const standingLabel = standing ? standing.label : await plainStyleName(q.fenceStyle).catch(() => q.fenceStyle)
    const title = `Proposal conflict: ${customer} tried ${tried ? tried.label : 'an option not on the proposal'}; ${standingLabel} stands`
    const already = why === 'accepted' && q.acceptedAt
      ? `it was already accepted${q.acceptedBy ? ` by ${q.acceptedBy}` : ''} on ${new Date(q.acceptedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/New_York' })} for ${standingText}`
      : `it is already signed for ${standingText}`
    const text = `${body.name} tried to accept ${triedText} on the proposal link, but ${already}. Nothing was changed. Call ${customer} to sort it out.`
    const recent = await prisma.notification.findFirst({ where: { title, body: text, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } }, select: { id: true } })
    if (recent) return
    const job = await prisma.savedJob.findFirst({ where: { accountId: q.accountId, quoteId: q.id, deletedAt: null }, select: { id: true } }).catch(() => null)
    await prisma.notification.create({
      data: { recipientRole: OFFICE_NOTICE_ROLE, title, body: text, type: 'warning', link: conflictLink(q), jobId: job?.id ?? null },
    })
    console.log(`[proposal] conflicting acceptance on quote ${q.id}: option ${body.option} by "${body.name}" (${why})`)
  } catch (err) { console.error('[proposal] conflict notice:', err) }
}

/** Where a conflict notice opens: the quote itself, on its customer's Quotes tab (?qv= opens it), else on Quotes. */
export function conflictLink(q: { id: string; crmContactId?: string | null }): string {
  return q.crmContactId ? `/customers/${encodeURIComponent(q.crmContactId)}?tab=quotes&qv=${encodeURIComponent(q.id)}` : `/quotes?qv=${encodeURIComponent(q.id)}`
}

/** Signed now on the link, as it stands: an earlier conflict notice for this quote is settled, so it is marked read. */
async function settleConflicts(q: { id: string; crmContactId?: string | null }): Promise<void> {
  await prisma.notification.updateMany({
    where: { title: { startsWith: 'Proposal conflict: ' }, link: conflictLink(q), read: false },
    data: { read: true, readAt: new Date() },
  }).catch(err => console.error('[proposal] settle conflict notices:', err))
}

/** The signed contract PDF, stored once (lib/signedDocuments.ts); a retry makes it if the first try did not. */
const fileContract = (quoteId: string) => fileSignedContract(quoteId).catch(err => console.error('[proposal] signed contract file:', err))

/**
 * A signing refused: what stands and the number to call (refusalText); `reload`: the page reloads to show
 * the fence that stands, with these words first (a page opened before it was sold or accepted).
 */
async function refused(q: any, why: 'signed' | 'accepted'): Promise<{ status: number; json: any }> {
  const p = q.proposal as Proposal | null
  const opts = Array.isArray(p?.options) ? p!.options : []
  const standing = why === 'accepted'
    ? opts[q.chosenOption ?? -1]
    : opts.find(o => o.fenceStyle === q.fenceStyle && Math.round(Number(o.finalPrice) * 100) === Math.round(Number(q.finalPrice) * 100))
  const label = customerFenceName(standing?.label || await plainStyleName(q.fenceStyle).catch(() => q.fenceStyle))
  return { status: 409, json: { success: false, error: refusalText(why, label, await companyPhone(q.accountId, p)), reload: true } }
}

/**
 * The customer accepts option `body.option` of quote `q` (the proposal link, or
 * a warranty update link: routes/warrantyUpdatePublic.ts). `accepted`: this
 * call is the one that accepted it (not a repeat of an acceptance that stands).
 */
export async function acceptQuote(q: any, body: z.infer<typeof acceptSchema>, signer: Signer = { ip: null, userAgent: null }): Promise<{ status: number; json: any; accepted?: boolean }> {
  if (!q || q.archivedAt) { return { status: 404, json: { success: false, error: 'This proposal is no longer available.' } } }
  // The option already accepted, signed again: the same acceptance sent again (the customer's signal dropped
  // before the answer came back), or someone else of the household signing the same fence. It stands as it was
  // first signed; the page reloads to it (no notice: nothing conflicts, review Oct 27 2026).
  if (q.acceptedAt && q.chosenOption === body.option) { await fileContract(q.id); return { status: 200, json: { success: true, data: { acceptedAt: q.acceptedAt, option: body.option } }, accepted: false } }
  if (q.acceptedAt) {
    await notifyConflict(q, body, 'accepted')
    return refused(q, 'accepted')
  }
  if (linkClosed(q)) { return { status: 410, json: { success: false, error: 'This link is no longer active. Please call us.' } } }
  const p = q.proposal as unknown as Proposal | null
  const opt = p?.options?.[body.option]
  if (!opt) { return { status: 400, json: { success: false, error: 'Please choose an option.' } } }
  // Already signed in the app (Sold, or its quoted cost saved): the price stays as signed (lib/quoteLock.ts).
  // The customer's acceptance is recorded only for the option it was signed at.
  const signed = await signedNow(q)
  if (signed && !(opt.fenceStyle === q.fenceStyle && Math.round(Number(opt.finalPrice) * 100) === Math.round(q.finalPrice * 100)) && !(await twinOfSigned(q, p!, body.option))) {
    await notifyConflict(q, body, 'signed')
    return refused(q, 'signed')
  }
  // The terms the customer just read: frozen on the proposal now if it went out before terms were (lib/contractTerms.ts).
  const termsNow = (await termsOn(p)) ? null : await currentTerms(q.accountId, { repair: p?.kind === 'repair' })
  // The quote becomes the option the customer chose, exactly as it was priced.
  const s = opt.snapshot ?? {}
  const layout = q.layout as any
  // Only while still unaccepted: two taps on Accept at once are one acceptance.
  const claimed = await prisma.savedQuote.updateMany({
    where: { id: q.id, acceptedAt: null },
    data: {
      status: 'SOLD',
      acceptedAt: new Date(),
      acceptedBy: body.name,
      acceptedSignature: body.signature ?? null,
      acceptedIp: signer.ip,
      acceptedUserAgent: signer.userAgent,
      chosenOption: body.option,
      ...(termsNow ? { proposal: { ...(q.proposal as object), terms: termsNow } as any } : {}),
      // Ever sold: set once, never cleared (lib/everSold.ts).
      ...(q.soldAt ? {} : { soldAt: new Date() }),
      ...(signed ? {} : {
        fenceStyle: opt.fenceStyle,
        finalPrice: opt.finalPrice,
        sections: opt.sections,
        ...(typeof s.materialCost === 'number' ? { materialCost: s.materialCost, laborCost: s.laborCost, tearOutCost: s.tearOutCost, totalCOGS: s.totalCOGS, gmPct: s.gmPct } : {}),
        ...(Array.isArray(s.pullSheet) ? { pullSheet: s.pullSheet } : {}),
        ...(Array.isArray(s.runRails) ? { runRails: s.runRails } : {}),
        ...(layout && Array.isArray(s.runSections) ? { layout: { ...layout, runSections: s.runSections } } : {}),
        // A move or repair option carries its work; "New fence instead" carries null (the quote becomes a new fence).
        ...(s && Object.prototype.hasOwnProperty.call(s, 'work') ? { work: s.work === null ? Prisma.JsonNull : s.work } : {}),
        // The cents the chosen option was rounded down by to the whole dollar go with it into the contract (out of profit).
        ...(typeof s.roundingCents === 'number' && (q.proposal as any)?.wholeDollar === true ? { pricing: { ...((q.pricing as any) ?? {}), wholeDollar: true, roundingCents: s.roundingCents } } : {}),
      }),
    },
  })
  const updated = (await prisma.savedQuote.findUnique({ where: { id: q.id } }))!
  if (claimed.count === 0) {
    if (updated.chosenOption === body.option) { await fileContract(q.id); return { status: 200, json: { success: true, data: { acceptedAt: updated.acceptedAt, option: body.option } }, accepted: false } }
    await notifyConflict(updated, body, 'accepted')
    return refused(updated, 'accepted')
  }
  console.log(`[proposal] customer accepted quote ${q.id} option ${body.option} (${opt.fenceStyle}) as "${body.name}"`)
  // A try at another option before this (a conflict notice on the bell) is settled now.
  await settleConflicts(q)
  // Job costing: the quoted cost, as the chosen option was priced, saved once at signing.
  await snapshotAfterSigning(q.accountId, q.id, 'proposal')
  await markSigned(q.id, body.view).catch(err => console.error('[proposal] view signed:', err))
  await onProposalAccepted(q, opt, body.name).catch(err => console.error('[proposal] after accept:', err))
  // Sold online: the job goes to Operations, as when a card is moved to Signed Contract.
  await ensureJobForAcceptedQuote(updated as any).catch(err => console.error('[proposal] job after accept:', err))
  // Its materials to order (Inventory > Sales Orders), the option the customer chose (lib/salesOrders.ts).
  await syncSalesOrderSafe(q.accountId, q.id)
  // Its payment schedule from the contract: deposit due now, final on completion (lib/contractBilling.ts).
  await scheduleAfterSigning(q.accountId, q.id, 'accepted', { userId: null, name: `${body.name} (customer, proposal link)` })
  // The signed contract, stored with the signature, name, IP and time on its last page (after the job, so it is linked to it).
  await fileContract(q.id)
  return { status: 200, json: { success: true, data: { acceptedAt: updated.acceptedAt, option: body.option } }, accepted: true }
}

// ── Staff: style photos ──

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } })
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

stylePhotos.get('/', requireUser, requireAccount, async (req: any, res) => {
  const list = await prisma.stylePhoto.findMany({ where: { accountId: req.user.crmAccountId }, select: { id: true, styleName: true, updatedAt: true } })
  res.json({ success: true, data: list })
})

stylePhotos.post('/', requireUser, requireAccount, requireCan('settings.change'), upload.single('photo'), async (req: any, res) => {
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

stylePhotos.delete('/:id', requireUser, requireAccount, requireCan('settings.change'), async (req: any, res) => {
  const n = await prisma.stylePhoto.deleteMany({ where: { id: String(req.params.id), accountId: req.user.crmAccountId } })
  res.json({ success: true, data: { deleted: n.count } })
})

// ── The page ──

function page(title: string, body: string, nonce: string, script = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="robots" content="noindex"><style>${CSS}</style></head><body>${body}${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`
}

/** The proposal page. `notice`: HTML put first (a warranty update's note, routes/warrantyUpdatePublic.ts). */
// `photos`: ids only. No caption: captions are staff words ("Ready to quote visit"), never shown to the customer (round 2 review, Oct 26 2026).
export function renderProposal(q: any, saved: Proposal, token: string, nonce: string, photos: Array<{ id: string }> = [], installDay: string | null = null, notice = '', shownView: ProposalPageView = {}): string {
  // Each fence by the name the customer reads: "6 ft or 8 ft panels", never the office's "(best price)" tag (lib/customerFenceName.ts).
  const p: Proposal = { ...saved, options: saved.options.map(o => ({ ...o, label: customerFenceName(o.label) })) }
  const view: ProposalPageView = shownView.soldLabel ? { ...shownView, soldLabel: customerFenceName(shownView.soldLabel) } : shownView
  const company = p.company ?? {}
  const rec = Math.min(Math.max(0, p.recommended ?? 0), p.options.length - 1)
  const accepted = !!q.acceptedAt
  const hidden = new Set(view.hidden ?? [])
  // Not yet accepted: the option the quote was made with (proposalPage), else the recommended one.
  const startAt = typeof view.start === 'number' && p.options[view.start] && !hidden.has(view.start) ? view.start : rec
  // Sold in the app, not yet signed here: the sold option is the only one to sign; -1, none can be (proposalPage).
  const sold = !accepted && typeof view.sold === 'number' ? (p.options[view.sold] ? view.sold : -1) : null
  const chosen = accepted ? (q.chosenOption ?? rec) : sold !== null && sold >= 0 ? sold : startAt
  // Accepted, or sold in the app: only the fence that stands is shown, never the others with their prices and
  // "Save $789" (review Oct 27 2026: they read as still on offer). Sold for a fence not on the proposal: none.
  const single = accepted || sold !== null
  const none = !accepted && sold === -1
  const canSign = !accepted && sold !== -1
  const shownCount = none ? 0 : single ? 1 : p.options.length - p.options.filter((_o, i) => hidden.has(i) && i !== chosen).length
  // "Save $X" / "$X more" against the option selected when the page opens (the one the quote was made with).
  const base = p.options[chosen]?.finalPrice ?? p.options[rec]?.finalPrice ?? p.options[0].finalPrice
  const fin = p.financing && (p.financing.months ?? 0) > 0 ? p.financing : null
  // Priced to the whole dollar: the price a foot and the monthly payment show no cents either.
  const whole = p.wholeDollar === true
  const perFootText = (n: number) => whole ? `About ${money(n)}` : money2(n)
  const monthlyText = (n: number) => whole ? money(Math.ceil(n)) : money2(n)

  const order = view.order ?? p.options.map((_o, i) => i)
  const options = order.map(i => {
    const o = p.options[i]
    if (!o) return ''
    // The same fence at the same price as an option shown before it: not shown again (the chosen one always is).
    if (hidden.has(i) && i !== chosen) return ''
    // Accepted or sold: the fence that stands only.
    if (single && (none || i !== chosen)) return ''
    const diff = o.finalPrice - base
    const save = i !== chosen && diff < -0.5 ? `<span class="save">Save ${money(-diff)}</span>` : i !== chosen && diff > 0.5 ? `<span class="more">${money(diff)} more</span>` : ''
    const monthly = fin ? `<p class="monthly">As low as ${monthlyText(monthlyPayment(o.finalPrice, fin.apr ?? 0, fin.months!))}/month for ${fin.months} months${fin.provider ? ` with ${esc(fin.provider)}` : ''}</p>` : ''
    const photo = o.photoId ? `<img class="photo" src="photo/${esc(o.photoId)}" alt="${esc(o.label)}" loading="lazy">` : ''
    return `<label class="opt${i === chosen ? ' on' : ''}" data-option="${i}">
      <input type="radio" name="option" value="${i}"${i === chosen ? ' checked' : ''}${accepted || !canSign ? ' disabled' : ''}>
      ${photo}
      <span class="optbody">
        ${accepted ? '' : sold !== null ? '<span class="badge" data-sold-option>Your fence</span>' : o.badge ? `<span class="badge">${esc(o.badge)}</span>` : i === rec && shownCount > 1 ? '<span class="badge">Recommended</span>' : ''}
        ${o.tier?.label ? `<span class="tier">${esc(o.tier.label)}</span>` : ''}
        <span class="optlabel">${esc(o.label)}</span>
        ${o.tier?.blurb ? `<span class="blurb">${esc(o.tier.blurb)}</span>` : ''}
        ${optionPriceHtml(p, o)}
        ${o.perFoot > 0 ? `<span class="small">${perFootText(o.perFoot)} a foot · ${o.sections} sections</span>` : ''}
        ${o.warranty?.name ? `<span class="wbadge" data-warranty-badge>${esc(o.warranty.name)}</span>` : ''}
        ${save}${monthly}
      </span>
    </label>`
  }).join('')

  const deposit = (p.depositPct ?? 0) > 0 && !none
    ? `<section><h2>Deposit</h2><p id="deposit" data-pct="${Number(p.depositPct)}"${whole ? ' data-whole="1"' : ''}>${esc(p.depositPct)}% to schedule: <b>${money(depositDollars(p, p.options[chosen].finalPrice))}</b></p>${p.depositNote ? `<p class="small">${esc(p.depositNote)}</p>` : ''}</section>`
    : ''
  const included = (p.included?.length || p.includedNote)
    ? `<section><h2>What's included</h2><ul>${(p.included ?? []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>${p.includedNote ? `<p>${esc(p.includedNote).replace(/\n/g, '<br>')}</p>` : ''}</section>`
    : ''
  // Each option's own warranty (frozen when the proposal was saved); the chosen option's words show, and
  // change as the customer picks. An older proposal has one warranty for every option.
  const perOption = p.options.some(o => o.warranty?.text)
  const wOf = (o: ProposalOption | undefined) => perOption ? { name: o?.warranty?.name || '', text: o?.warranty?.text || '' } : { name: '', text: p.warranty || '' }
  const wNow = wOf(p.options[chosen])
  const wStart = accepted ? warrantyLines(null, installDay, p.kind).start : ''
  const warranty = (perOption || p.warranty) && !none ? `<section id="warranty" data-warranty-section><h2>Warranty</h2>${perOption ? `<p class="wname" id="wname">${esc(wNow.name)}</p>` : ''}<p id="wtext">${esc(wNow.text).replace(/\n/g, '<br>')}</p>${wStart ? `<p class="small" data-warranty-start><b>${esc(wStart)}</b></p>` : ''}</section>` : ''
  // Settings → Contract Templates as frozen on the proposal: read before signing, the same words as the signed contract.
  const terms = (p.terms ?? []).filter(t => t && t.text)
  const termsHtml = terms.length ? `<section data-proposal-terms><h2>Terms</h2>${terms.map(t => `<div class="term" data-term="${esc(t.key)}"><h3>${esc(t.title)}</h3><p>${esc(t.text).replace(/\n/g, '<br>')}</p></div>`).join('')}</section>` : ''
  const plan = safeSvg(p.planSvg)
  const callLine = company.phone ? `please call us at ${tel(company.phone)}` : 'please call us'
  const soldOpt = sold !== null && sold >= 0 ? p.options[sold] : null
  // Back from a refused signing: why, and the number to call, first (refusalText; the same words Accept answered with).
  const refusedLabel = accepted ? p.options[chosen]?.label : sold !== null && sold >= 0 ? p.options[sold]?.label : view.soldLabel
  const refusedNote = view.refused && (accepted || sold !== null)
    ? `<section class="refused" data-refused role="alert"><p>${company.phone ? esc(refusalText(accepted ? 'accepted' : 'signed', refusedLabel || '', company.phone)).replace(esc(phoneText(company.phone)), tel(company.phone)) : esc(refusalText(accepted ? 'accepted' : 'signed', refusedLabel || '', ''))}</p></section>`
    : ''
  // Accepted, or nothing to sign here: said near the top, with the signed contract, not under the terms.
  const doneBlock = none
    ? `<section class="done" data-already-signed><h2>Already agreed</h2><p>Your fence was already agreed with us${view.soldLabel ? ` for <b>${esc(view.soldLabel)}</b>` : ''}${Number(q.finalPrice) > 0 ? ` at <b>${money(q.finalPrice)}</b>` : ''}. To make a change, ${callLine}.</p></section>`
    : accepted
    ? `<section class="done" data-accepted><h2>Accepted</h2><p>Accepted by ${esc(q.acceptedBy)} on ${new Date(q.acceptedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}: ${esc(p.options[chosen]?.label)} at ${money(p.options[chosen]?.finalPrice)}.</p><p>Thank you. We will call you to schedule.</p><p><a class="btn linkbtn" href="${esc(token)}/contract.pdf" data-contract-pdf>Your signed contract (PDF)</a></p></section>`
    : ''
  const acceptBlock = !canSign ? '' : `<section id="accept"><h2>Accept this proposal</h2>
        ${soldOpt
          ? `<p class="small" data-sold-note>Your fence was agreed with us for <b>${esc(soldOpt.label)}</b> at <b>${money(soldOpt.finalPrice)}</b>. Type your name and sign with your finger to accept it here.${terms.length ? ' By signing you accept this proposal and its terms above.' : ''} To change to a different option, ${callLine}.</p>`
          : shownCount > 1
          ? `<p class="small">Choose an option above, type your name and sign with your finger.${terms.length ? ' By signing you accept this proposal and its terms above.' : ''}</p>`
          // One option: nothing to choose (round 6 review, Oct 27 2026: a repair with one price said "Choose an option above").
          : `<p class="small" data-one-option>Type your name and sign with your finger to accept it.${terms.length ? ' By signing you accept this proposal and its terms above.' : ''}</p>`}
        <label class="field">Your name<input id="name" autocomplete="name" maxlength="200"></label>
        <div class="sigwrap"><canvas id="sig" width="600" height="200" aria-label="Sign here"></canvas><button type="button" id="clear" class="link">Clear</button></div>
        <p id="err" class="err" role="alert"></p>
        <button type="button" id="go" class="btn">${soldOpt ? 'Accept my fence' : shownCount > 1 ? 'Accept the selected option' : 'Accept this proposal'}</button>
      </section>`

  const body = `<header class="top"><img src="logo.png" alt="" class="logo"><div><p class="co">${esc(company.name || 'Getter Done Fence')}</p><p class="small">${[company.phone ? tel(company.phone) : '', company.email ? esc(company.email) : ''].filter(Boolean).join(' · ')}</p>${company.address ? `<p class="small" data-company-address>${esc(company.address)}</p>` : ''}</div></header>
  <main class="wrap">${notice}
    <p class="small upper">${p.kind === 'move' ? 'Fence move proposal' : p.kind === 'repair' ? 'Fence repair proposal' : 'Fence proposal'}</p>
    <h1>${esc(p.customer?.name || q.customerName)}</h1>
    <p class="small">${esc(p.customer?.address || q.customerAddress || '')}</p>
    ${p.kind ? `<p class="facts" data-work-description>${esc(p.description || '')}</p>` : `<p class="facts">${p.footageFt ? `${Math.round(p.footageFt)} ft of fence` : ''}${p.gatesText ? ` · ${esc(p.gatesText)}` : ''}</p>`}
    ${refusedNote}${doneBlock}
    ${photos.length ? `<section data-proposal-photos><h2>Photos</h2><div class="opts">${photos.map((m, i) => `<figure style="margin:0"><img class="photo" src="${esc(token)}/media/${esc(m.id)}" alt="Photo ${i + 1} of your fence" loading="lazy" style="width:100%;border-radius:10px"></figure>`).join('')}</div></section>` : ''}
    ${plan ? `<section><h2>Site plan</h2><div class="plan">${plan}</div><p class="small">Purple: new fence. Purple squares: corner posts. Dark squares: gate hinge posts. Dots: end and gate latch posts. Dashed arcs: which way each gate swings. Gray dashed: existing fence or no fence, not included.${p.kind === 'move' ? ' Brown dashed: the old fence line.' : p.kind === 'repair' ? ' Red: the sections to repair.' : ''} Not to scale for permitting.</p></section>` : ''}
    ${none ? '' : `<section><h2>${shownCount > 1 ? 'Your options' : p.kind ? 'Your price' : 'Your fence'}</h2><div class="opts${shownCount > 1 && p.options.some(o => o.tier) ? ' tiers' : ''}">${options}</div></section>`}
    ${included}${warranty}${deposit}${termsHtml}${acceptBlock}
    <p class="small foot">Questions? Call ${company.phone ? tel(company.phone) : 'us'}.</p>
  </main>`

  // Signed: the page reloads at its top, where Accepted and the signed contract now are (not scrolled down to the terms).
  // The ?refused=1 a refused signing reloaded with is dropped from the address, so a later reload is the plain page.
  const script = trackScript(token) + (view.refused ? `
  try{history.replaceState(null,'',location.pathname+location.hash)}catch(_){}` : '') + (!canSign ? '' : `
  (function(){
    var opts=[].slice.call(document.querySelectorAll('.opt'));
    var prices=${JSON.stringify(p.options.map(o => o.finalPrice))};
    var dep=document.getElementById('deposit');
    var ws=${JSON.stringify(perOption ? p.options.map(o => wOf(o)) : []).replace(/</g, '\\u003c')},wn=document.getElementById('wname'),wt=document.getElementById('wtext');
    function pick(){opts.forEach(function(o){var r=o.querySelector('input');o.classList.toggle('on',r.checked);if(r.checked&&dep){var b=dep.querySelector('b');var c=Math.round(Math.round(prices[+r.value]*100)*(+dep.dataset.pct)/100);b.textContent='$'+(dep.dataset.whole?Math.floor(c/100):Math.round(c/100)).toLocaleString('en-US');}if(r.checked&&ws.length&&wt){var w=ws[+r.value]||{name:'',text:''};if(wn)wn.textContent=w.name;wt.textContent=w.text}});}
    opts.forEach(function(o){o.querySelector('input').addEventListener('change',pick)});
    var c=document.getElementById('sig'),x=c.getContext('2d'),down=false,inked=false;
    x.lineWidth=3;x.lineCap='round';x.strokeStyle='#1C1030';
    function pos(e){var r=c.getBoundingClientRect();return[(e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height]}
    c.addEventListener('pointerdown',function(e){down=true;inked=true;try{c.setPointerCapture(e.pointerId)}catch(_){}var p=pos(e);x.beginPath();x.moveTo(p[0],p[1]);e.preventDefault()});
    c.addEventListener('pointermove',function(e){if(!down)return;var p=pos(e);x.lineTo(p[0],p[1]);x.stroke();e.preventDefault()});
    c.addEventListener('pointerup',function(){down=false});
    document.getElementById('clear').addEventListener('click',function(){x.clearRect(0,0,c.width,c.height);inked=false});
    var go=document.getElementById('go'),err=document.getElementById('err'),goText=go.textContent;
    go.addEventListener('click',function(){
      var sel=document.querySelector('input[name=option]:checked');var name=document.getElementById('name').value.trim();
      if(!sel){err.textContent='Please choose an option.';return}
      if(!name){err.textContent='Please type your name.';return}
      if(!inked){err.textContent='Please sign in the box.';return}
      go.disabled=true;go.textContent='Sending...';err.textContent='';
      fetch('${esc(token)}/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({option:+sel.value,name:name,signature:c.toDataURL('image/png'),view:window.__proposalView?window.__proposalView():null})})
        .then(function(r){return r.json()}).then(function(j){if(j.success){try{history.scrollRestoration='manual'}catch(_){}location.reload()}else if(j.reload){location.replace(location.pathname+'?refused=1')}else{err.textContent=j.error||'Something went wrong.';go.disabled=false;go.textContent=goText}})
        .catch(function(){err.textContent='No connection. Please try again.';go.disabled=false;go.textContent=goText});
    });
  })();`)
  return page(`Fence proposal for ${p.customer?.name || q.customerName}`, body, nonce, script)
}

/**
 * Opens, on the page itself (lib/proposalViews.ts). Starts once the page is on
 * screen (a prefetch or prerender is not an open), adds up each second which
 * option card is in view (the one across the middle of the screen, else the
 * one with the most of itself showing), notes when the signature box
 * comes into view or is touched, and sends the running totals every 15 s and
 * once more as the page goes away (sendBeacon). Nothing is stored in the
 * browser; the open's id is kept in this page's memory only. Any failure is
 * silent: the proposal works the same without it.
 */
export function trackScript(token: string): string {
  return `
  (function(){try{
    var base=${JSON.stringify(token)}+'/view',id=null,o={},act=0,sig=false,started=false,last=Date.now(),seen={};
    var sp=null;try{var m=/[?&]sp=([^&#]+)/.exec(location.search);if(m){sp=decodeURIComponent(m[1]);history.replaceState(null,'',location.pathname+location.hash)}}catch(_){}
    window.__proposalView=function(){return id};
    var cards=[].slice.call(document.querySelectorAll('.opt[data-option]')),byOpt={};cards.forEach(function(c){byOpt[c.getAttribute('data-option')]=c});
    if('IntersectionObserver' in window){
      var th=[];for(var i=0;i<=20;i++)th.push(i/20);
      var io=new IntersectionObserver(function(es){es.forEach(function(e){seen[e.target.getAttribute('data-option')]=e.isIntersecting?e.intersectionRect.height:0})},{threshold:th});
      cards.forEach(function(c){io.observe(c)});
      var sa=document.getElementById('sig')||document.getElementById('accept')||document.querySelector('section.done');
      if(sa)new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting)sig=true})},{threshold:0.5}).observe(sa);
    }
    var pad=document.getElementById('sig');if(pad)pad.addEventListener('pointerdown',function(){sig=true},{passive:true});
    function step(){var now=Date.now(),d=now-last;last=now;if(!started||document.visibilityState!=='visible'||d<=0||d>5000)return;act+=d;var best=pick();if(best!==null)o[best]=(o[best]||0)+d}
    function pick(){var mid=(window.innerHeight||0)/2,best=null,bh=0;for(var k in seen){if(!(seen[k]>0))continue;var c=byOpt[k];if(!c)continue;var r=c.getBoundingClientRect();if(r.top<=mid&&r.bottom>=mid)return k;if(seen[k]>bh){bh=seen[k];best=k}}return best}
    function body(){return JSON.stringify({o:o,a:act,sig:sig})}
    function beat(){if(!id)return;try{fetch(base+'/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:body(),keepalive:true}).catch(function(){})}catch(_){}}
    function bye(){step();if(!id)return;try{if(navigator.sendBeacon&&navigator.sendBeacon(base+'/'+id,new Blob([body()],{type:'text/plain'})))return}catch(_){}beat()}
    function start(){if(started)return;started=true;last=Date.now();
      try{fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sp:sp})}).then(function(r){return r.ok?r.json():null}).then(function(j){var d=j&&j.data;if(!d||!d.id)return;id=d.id;if(d.base){var b=d.base.o||{};for(var k in b){o[k]=Math.max(o[k]||0,0)+b[k]}act+=d.base.a||0;sig=sig||!!d.base.sig}}).catch(function(){})}catch(_){}}
    setInterval(step,1000);
    setInterval(function(){step();beat()},15000);
    document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')bye();else{last=Date.now();start()}});
    window.addEventListener('pagehide',bye);
    if(document.visibilityState==='visible'&&!document.prerendering)start();
  }catch(_){}})();`
}

export const CSS = `
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
.list{font-size:15px;color:var(--g)}.disc{font-size:16px;font-weight:700;color:#15803d}
.badge{align-self:flex-start;background:var(--p);color:#fff;font-size:12px;font-weight:700;border-radius:999px;padding:2px 10px}
.wbadge{align-self:flex-start;margin-top:6px;border:1px solid #9D7BD0;color:var(--pd);background:#fff;font-size:13px;font-weight:700;border-radius:999px;padding:2px 10px}
.term h3{font-size:15px;margin:12px 0 4px}.term:first-of-type h3{margin-top:0}.term p{margin:0;font-size:14px;color:var(--ink)}
.wname{font-weight:700;margin:0 0 6px}#wtext{white-space:pre-line;margin:0}.linkbtn{display:block;text-align:center;line-height:52px;text-decoration:none}
.save{color:#15803d;font-weight:700}.more{color:var(--g)}.monthly{margin:4px 0 0;font-size:14px;color:var(--pd);font-weight:600}
ul{margin:0;padding-left:20px}.field{display:block;font-size:14px;color:var(--g);margin:8px 0}
.field input{display:block;width:100%;height:48px;font-size:16px;border:1px solid #CBC4D6;border-radius:10px;padding:0 12px;margin-top:4px}
.sigwrap{position:relative;border:1px dashed #9D7BD0;border-radius:10px;background:#fff}#sig{width:100%;height:160px;touch-action:none;display:block}
.link{position:absolute;right:4px;top:4px;background:none;border:0;color:var(--p);font-weight:600;font-size:14px;min-height:48px;min-width:64px}
.btn{width:100%;min-height:52px;margin-top:12px;border:0;border-radius:12px;background:var(--p);color:#fff;font-size:17px;font-weight:700}
section.refused{border-color:#fcd34d;background:#fffbeb;font-weight:600}section.refused p{margin:0}
.btn:disabled{opacity:.6}.err{color:#b91c1c;min-height:1.2em;margin:8px 0 0}.done{border-color:#86efac;background:#f0fdf4}.foot{text-align:center;margin-top:24px}
`
