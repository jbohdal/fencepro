/**
 * The website quote drawn on the aerial photo (EZ Budget, /p/quote).
 *
 *   nothing  is kept while the customer works until they type a name and a
 *            phone or email; from then the lead so far is kept as a "Didn't
 *            finish instant quote" lead (lib/widgetPartialLead.ts). The old
 *            drafts (WidgetDraft, the drawing with no name) are no longer made;
 *            any left go when their 30 days are up;
 *   prices   the options for what they picked, priced for their drawn yard by
 *            the quote builder's own math (web/src/widgetPricing.ts through the
 *            estimate bundle), prices only;
 *   submit   one customer, one pipeline card and one saved quote, together in
 *            one transaction, keyed by the visit's id: sending again (a retry, or
 *            another option picked) never makes a second one. The quote keeps
 *            the builder's yard (so the salesman opens it drawn on the photo)
 *            and, apart from it, the customer's drawing exactly as drawn
 *            (layout.widgetDrawing), which the builder's saves never replace.
 *
 * Test mode (the page opened with ?test=1) prices and checks everything and
 * writes nothing: no lead, no customer, no quote, no card, no note.
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import prisma from './prisma.js'
import { isUniqueViolation, withLock } from './once.js'
import { findPartialLead, finishPartialLead } from './widgetPartialLead.js'
import { pricingWithData } from './estimates.js'
import { findOrCreateContact, resolveIntakeAccountId } from './intake.js'
import { pushNewLeadSoon, newLeadLink } from './leadAssign.js'
import { loadPipelineStages } from './pipelineStages.js'
import { roleStageId } from './pipelineStageModel.js'
import { applyPipelineDelta } from './pipelineDelta.js'
import { recordCardMoves } from './automations/hooks.js'

type Json = any

export const SOURCE_TEXT = 'Website, drawn by customer'
export const LEAD_SOURCE = 'Website Quote'
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads'

export const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
export const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

// ── Settings ─────────────────────────────────────────────────────────────────

export interface WidgetSettings { showPriceBeforeContact: boolean }

/** The website quote's settings (Settings → Portal & Quotes → Website quote). Default: contact before price. */
export function widgetSettingsOf(config: Json): WidgetSettings {
  return { showPriceBeforeContact: config?.quoteWidget?.showPriceBeforeContact === true }
}

async function tierSetsFor(accountId: string) {
  const rows = await prisma.proposalTierSet.findMany({ where: { accountId }, orderBy: { sortOrder: 'asc' }, select: { category: true, tiers: true, popular: true } })
  return rows.map(r => ({ category: r.category, tiers: Array.isArray(r.tiers) ? r.tiers as Json[] : [], popular: r.popular ?? null }))
}

// ── Pricing a drawing ────────────────────────────────────────────────────────

export interface Pick { material: string; color: string; height: string; kind: string }

export class DrawingProblem extends Error {}

/** The options for a pick, priced for the drawing (prices only), and the builder's yard it was priced as. */
export async function priceDrawing(accountId: string, drawing: Json, pick: Pick) {
  const { m, data } = await pricingWithData()
  const problem = m.drawingProblem(drawing)
  if (problem) throw new DrawingProblem(problem)
  const yard = m.toYardLayout(drawing)
  const priced = m.widgetPricesFor(data, yard, pick, await tierSetsFor(accountId))
  if (!priced.options.length) throw new DrawingProblem('That fence is not offered. Pick another height or color.')
  return { yard, priced, sides: m.drawingRunSides ? (m.drawingJoinRuns(drawing.runs) as Json[]).map((r: Json) => m.drawingRunSides(r)) : [] }
}

/** Only what the page may see of an option: names, prices and price per foot. */
export function optionView(o: Json) {
  return { key: o.key, name: o.name, text: o.text, popular: !!o.popular, fenceStyle: o.fenceStyle, styleLabel: o.styleLabel, price: o.price, perFoot: o.perFoot }
}

// ── The visit ────────────────────────────────────────────────────────────────

/** The id the page makes for one visit and keeps in its memory (never in the browser's storage): the lead's key. */
export const DRAFT_ID = /^[A-Za-z0-9_-]{20,40}$/

// ── The customer's own drawing, kept on the quote ────────────────────────────

/** The aerial snapshot the page made of the drawing (a JPEG), saved beside the other website photos. */
export function saveSnapshot(dataUrl: string | undefined | null): string | null {
  if (!dataUrl) return null
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return null
  const buf = Buffer.from(m[1], 'base64')
  // A real JPEG, and not a big one.
  if (buf.length < 200 || buf.length > 400_000 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  const dir = path.resolve(UPLOAD_DIR, 'intake')
  fs.mkdirSync(dir, { recursive: true })
  const name = `${crypto.randomUUID()}.jpg`
  fs.writeFileSync(path.join(dir, name), buf)
  return `/api/portal/files/intake/${name}`
}

export function widgetDrawingRecord(drawing: Json, sides: Json[][], pick: Pick, options: Json[], chosen: Json, snapshotUrl: string | null, photos: string[] = []) {
  return {
    v: 1,
    source: SOURCE_TEXT,
    drawnAt: new Date().toISOString(),
    address: drawing.address,
    at: drawing.at,
    runs: drawing.runs,
    // Each side as the customer left it: measured from the photo, or typed.
    sides: sides.map((r, ri) => r.map((s: Json, i: number) => ({ run: ri + 1, side: i + 1, measuredFt: s.measuredFt, typedFt: s.typedFt, ft: s.ft, how: s.typed ? 'typed' : 'measured' }))),
    pick,
    shown: options.map(optionView),
    chosen: { fenceStyle: chosen.fenceStyle, name: chosen.name, price: chosen.price },
    snapshotUrl,
    ...(photos.length ? { photos } : {}),
  }
}

/** Only the website's own photo addresses (routes/quote-widget.ts saves them there). */
export const INTAKE_PHOTO = /^\/api\/portal\/files\/intake\/([0-9a-f-]{36})\.(jpg|png|webp|heic)$/

/**
 * The customer's yard photos on their Photos tab (PortalPhoto, from the
 * customer), once each: the photo's own file id is the row's id, so sending
 * again adds none. Returns how many were added.
 */
export async function photosToCustomer(contactId: string, urls: string[]): Promise<number> {
  let added = 0
  for (const url of urls) {
    const m = INTAKE_PHOTO.exec(url)
    if (!m) continue
    const file = path.resolve(UPLOAD_DIR, 'intake', `${m[1]}.${m[2]}`)
    if (!fs.existsSync(file)) continue
    const id = `wq-${m[1]}`
    if (await prisma.portalPhoto.findUnique({ where: { id } })) continue
    const mime = m[2] === 'jpg' ? 'image/jpeg' : `image/${m[2]}`
    await prisma.portalPhoto.create({ data: { id, crmCustomerId: contactId, fileKey: `intake/${m[1]}.${m[2]}`, fileUrl: url, originalFilename: `website-photo.${m[2]}`, fileSizeBytes: fs.statSync(file).size, mimeType: mime, caption: 'Sent with the website quote', source: 'portal_customer', isVisibleToCustomer: true } })
      .then(() => { added++ }, err => { if (!isUniqueViolation(err)) console.error('[widget] photo to customer failed:', err) })
  }
  return added
}

// ── Sending it ───────────────────────────────────────────────────────────────

export interface DrawnSubmission {
  draftId: string
  name: string
  phone: string
  email?: string
  address: string
  drawing: Json
  pick: Pick
  /** The option the customer chose (its style); the most popular (else the first) when not chosen yet. */
  fenceStyle?: string | null
  wantsVisit: boolean
  notes?: string
  snapshot?: string | null
  /** Photos of the yard the customer uploaded (/api/portal/files/intake/…). */
  photos?: string[]
  test?: boolean
}

export interface DrawnResult {
  test: boolean
  duplicate: boolean
  quoteId: string | null
  contactId: string | null
  cardId: string | null
  options: Json[]
  chosen: Json
  /** Test mode only: what the saved quote would hold (no costs). */
  preview?: Json
}

export class PipelineBusy extends Error {}

/** Where the "Website quote" notification goes: the lead's card window, else the customer. */
export function leadLink(cardId: string | null, contactId: string | null): string | null {
  if (cardId) return `/pipeline?card=${encodeURIComponent(cardId)}`
  if (contactId) return `/customers?customer=${encodeURIComponent(contactId)}`
  return null
}

export const materialWord = (m: string) => (m === 'vinyl' ? 'Vinyl' : m === 'chain' ? 'Chain link' : m === 'alum' ? 'Aluminum' : 'Wood')

/**
 * A drawing and a pick priced as the quote builder would: the options, the
 * one chosen (the customer's, else the most popular, else the first), and
 * the saved quote's fields for it.
 */
export async function drawnQuoteFor(accountId: string, drawing: Json, pick: Pick, fenceStyle?: string | null) {
  const { m, data } = await pricingWithData()
  const { yard, priced, sides } = await priceDrawing(accountId, drawing, pick)
  const options: Json[] = priced.options
  const chosen = options.find(o => o.fenceStyle === fenceStyle) ?? options.find(o => o.popular) ?? options[0]
  const q = m.widgetQuoteFor(data, yard, chosen.fenceStyle, chosen.priceAdjust)
  const price: number = q.price
  const runSections: number[] = q.job.calc.perRunSections.filter((_: number, i: number) => q.req.runs[i].ft > 0)
  const layoutBase = { yard, runSections }
  const choice = [materialWord(pick.material), chosen.name, chosen.styleLabel].filter(Boolean).join(', ')
  const quoteFields = {
    fenceStyle: chosen.fenceStyle,
    runs: q.req.runs.map((r: Json) => r.ft), corners: q.req.corners, ends: q.req.ends, walkGates: q.req.walkGates, dblGates: q.req.dblGates,
    priceAdjust: chosen.priceAdjust,
    sections: q.job.calc.sections,
    materialCost: q.job.totals.materialCost, laborCost: q.job.totals.laborCost, tearOutCost: q.job.totals.tearOutCost, totalCOGS: q.job.totals.totalCOGS,
    finalPrice: price, gmPct: q.job.totals.gmPct,
    pullSheet: JSON.parse(JSON.stringify(q.job.pullSheet)),
    pricing: q.job.pricing ? JSON.parse(JSON.stringify(q.job.pricing)) : undefined,
  }
  return { options, chosen, q, price, layoutBase, quoteFields, sides, choice, footageFt: q.footageFt as number }
}
export type DrawnQuote = Awaited<ReturnType<typeof drawnQuoteFor>>

/**
 * The customer's one open card, saved in the same step as the rest: `make`
 * gets the card on the board now (null: none) and returns the card to save.
 * A new card goes on top. Throws PipelineBusy when a browser saved the board
 * in between (the caller tries again).
 */
export async function putCard(tx: Json, accountId: string, contactId: string, make: (existing: Json | null, firstStageId: string) => Json): Promise<Json> {
  const cur = await tx.pipelineState.findUnique({ where: { accountId } })
  const leads = ((cur?.leads as Json[]) ?? [])
  const stages = ((cur?.stages as Json[]) ?? [])
  // A new card lands in the "new cards land here" stage of Settings > Pipeline Stages.
  const firstStageId = roleStageId((await loadPipelineStages(accountId, tx)).stages, 'first') ?? ''
  const existing = leads.find(l => l?.customerId === contactId) ?? null
  const card = make(existing, firstStageId)
  if (!cur) {
    await tx.pipelineState.create({ data: { accountId, leads: [card], stages: [] } })
  } else {
    const next = applyPipelineDelta({ leads, stages }, { upsert: [{ lead: card, before: existing ? undefined : (leads[0]?.id ?? null) }], remove: [] })
    const done = await tx.pipelineState.updateMany({ where: { accountId, version: cur.version }, data: { leads: JSON.parse(JSON.stringify(next.leads)), version: { increment: 1 } } })
    if (done.count === 0) throw new PipelineBusy()
    // A new card is saved for automations (follow ups) in the same step, as for any new lead.
    await recordCardMoves(accountId, leads, next.leads, cur.version + 1, tx)
  }
  return card
}

/** The website quote's summary (its note on the customer and on the website lead). */
export function drawnSummary(d: DrawnQuote, input: { address: string; wantsVisit: boolean; notes?: string }, widgetDrawing: Json, firstLine = `${SOURCE_TEXT} (website quote on the aerial photo)`): string {
  // A side drawn on the photo is just its length (never "(measured)": nobody measured it on site, round 2 Oct 26 2026); a typed one says so.
  const sideLines = (widgetDrawing.sides as Json[][]).flat().map((s: Json) => `Run ${s.run} side ${s.side}: ${s.ft} ft${s.how === 'typed' ? ` (typed by the customer; the photo said ${s.measuredFt} ft)` : ''}`)
  return [
    firstLine,
    `${d.footageFt} ft of ${d.choice}`,
    d.q.req.walkGates || d.q.req.dblGates ? `Gates: ${d.q.req.walkGates} walk, ${d.q.req.dblGates} double` : 'No gates',
    `Estimate shown to the customer: ${money(d.price)}`,
    `Options shown: ${d.options.map((o: Json) => `${o.name} ${money(o.price)}`).join(', ')}`,
    ...sideLines,
    `Asked for an on site estimate: ${input.wantsVisit ? 'yes' : 'no'}`,
    `Address: ${input.address}`,
    widgetDrawing.snapshotUrl ? 'The drawing on the aerial photo is on the quote.' : '',
    input.notes ? `Customer notes: ${input.notes}` : '',
  ].filter(Boolean).join('\n')
}

export const drawnQuoteNotes = (chosen: Json, notes?: string) =>
  `${SOURCE_TEXT}. The customer drew the fence on the aerial photo of the property and saw an estimate of ${money(chosen.price)} (${chosen.name}). Confirm every measurement on site.${notes ? `\nCustomer notes: ${notes}` : ''}`

/**
 * Send the quote. One lock per page visit (the draft id is the visit's id),
 * shared with the lead saved when the customer stopped part way
 * (lib/widgetPartialLead.ts), so the two never make two customers.
 */
export async function submitDrawnQuote(input: DrawnSubmission): Promise<DrawnResult> {
  if (input.test) return submitDrawnQuoteNow(input)
  return withLock(`widget-lead:${input.draftId}`, () => submitDrawnQuoteNow(input))
}

async function submitDrawnQuoteNow(input: DrawnSubmission): Promise<DrawnResult> {
  const accountId = await resolveIntakeAccountId()
  if (!accountId) throw new Error('No company is set up on this server yet')
  const d = await drawnQuoteFor(accountId, input.drawing, input.pick, input.fenceStyle)
  const { options, chosen, q, price, layoutBase, quoteFields, sides, choice } = d

  if (input.test) {
    return {
      test: true, duplicate: false, quoteId: null, contactId: null, cardId: null,
      options: options.map(optionView), chosen: optionView(chosen),
      preview: { fenceStyle: chosen.fenceStyle, finalPrice: price, priceAdjust: chosen.priceAdjust, runs: q.req.runs.map((r: Json) => r.ft), corners: q.req.corners, ends: q.req.ends, walkGates: q.req.walkGates, dblGates: q.req.dblGates, layout: layoutBase },
    }
  }

  // Sent before (a retry, or another option picked): the same quote, never a second one.
  const sentBefore = () => prisma.intakeLead.findUnique({ where: { source_sourceRef: { source: 'ez_quote', sourceRef: input.draftId } } })
  const already = await sentBefore()
  if (already) return changeChoice(accountId, already, chosen, options, quoteFields, layoutBase)

  // Drafts are no longer kept (nothing is saved before the name and phone); old ones go when their 30 days are up.
  await prisma.widgetDraft.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {})

  // They stopped part way before (this visit, or an earlier one with the same name and phone or email):
  // finishing updates that lead, never a second customer, card or push (lib/widgetPartialLead.ts).
  const partial = await findPartialLead(accountId, { sessionId: input.draftId, name: input.name, phone: input.phone, email: input.email })
  if (partial) return finishPartialLead(accountId, partial, input, d)

  const snapshotUrl = saveSnapshot(input.snapshot)
  const photos = (input.photos ?? []).filter(u => INTAKE_PHOTO.test(u))
  const widgetDrawing = widgetDrawingRecord(input.drawing, sides, input.pick, options, chosen, snapshotUrl, photos)
  const today = day()
  const summary = drawnSummary(d, input, widgetDrawing)

  let out: DrawnResult | null = null
  for (let attempt = 0; attempt < 5 && !out; attempt++) {
    try {
      out = await prisma.$transaction(async tx => {
        const contact = await findOrCreateContact(accountId, { name: input.name, phone: input.phone, email: input.email, address: input.address, leadSource: LEAD_SOURCE }, tx)
        const quote = await tx.savedQuote.create({
          data: {
            accountId, crmContactId: contact.id,
            customerName: contact.created ? input.name : (contact.name || input.name),
            customerPhone: input.phone, customerEmail: input.email ?? '', customerAddress: input.address,
            leadSource: LEAD_SOURCE,
            ...quoteFields,
            layout: JSON.parse(JSON.stringify({ ...layoutBase, widgetDrawing })),
            status: 'DRAFT', date: today,
            notes: drawnQuoteNotes(chosen, input.notes),
          },
        })

        // One open card per customer: a second website quote updates it.
        const header = `${SOURCE_TEXT} · ${today} · estimate shown ${money(price)}`
        const [first, ...rest] = (contact.created ? input.name : (contact.name || input.name)).trim().split(/\s+/)
        const card = await putCard(tx, accountId, contact.id, (existing, firstStageId) => existing
          ? { ...existing, notes: [header, existing.notes].filter(Boolean).join('\n'), fenceType: existing.fenceType || choice, quotePrice: existing.quotePrice || price }
          : {
              id: crypto.randomUUID(), customerId: contact.id, firstName: first || 'Unknown', lastName: rest.join(' '),
              phone: input.phone, email: input.email ?? '', address: input.address, leadSource: LEAD_SOURCE, leadTemp: 0,
              fenceType: choice, sections: q.job.calc.sections, quotePrice: price, crew: '', scheduledDate: '', jobValue: 0,
              paymentStatus: '', balanceDue: 0, notes: header, stage: firstStageId,
              createdAt: today, lastMoved: today, assignedRep: '',
            })

        await tx.intakeLead.create({
          data: {
            accountId, source: 'ez_quote', sourceRef: input.draftId, crmContactId: contact.id, status: 'imported', importedAt: new Date(),
            name: input.name.slice(0, 200), phone: input.phone.slice(0, 40), email: (input.email ?? '').slice(0, 200), address: input.address.slice(0, 500),
            fenceType: choice.slice(0, 120), summary: summary.slice(0, 8000), estimate: price,
            payload: JSON.parse(JSON.stringify({ kind: 'drawn', draftId: input.draftId, quoteId: quote.id, cardId: card.id, pick: input.pick, chosen: chosen.fenceStyle, wantsVisit: input.wantsVisit, writtenAt: quote.updatedAt.toISOString() })),
          },
        })
        await tx.crmContactNote.create({ data: { crmContactId: contact.id, accountId, body: summary.slice(0, 19000), isPinned: false, createdBy: 'Website quote (drawn by customer)' } })
        return { test: false, duplicate: false, quoteId: quote.id, contactId: contact.id, cardId: card.id, options: options.map(optionView), chosen: optionView(chosen) }
      })
    } catch (e) {
      // The same draft sent at the same moment by another request: that one stands.
      if (isUniqueViolation(e)) { const won = await sentBefore(); if (won) return changeChoice(accountId, won, chosen, options, quoteFields, layoutBase) }
      if (!(e instanceof PipelineBusy)) throw e
    }
  }
  if (!out) throw new Error('The pipeline was busy; try again')
  if (out.contactId && photos.length) await photosToCustomer(out.contactId, photos).catch(err => console.error('[widget] photos failed:', err))
  await prisma.notification.create({
    // Tapping it opens the Assign screen while nobody has the lead, else its card window on the Sales Pipeline (?card=, SalesPipelineBoard.tsx).
    data: { title: `Website quote: ${input.name}`, body: `${SOURCE_TEXT} · ${choice} · ${q.footageFt} ft · ${money(price)}`.slice(0, 400), type: 'info', link: out.contactId ? await newLeadLink(accountId, out.contactId, leadLink(out.cardId, out.contactId)) : leadLink(out.cardId, out.contactId) },
  }).catch(err => console.error('[widget] notification failed:', err))
  // A new lead, nobody assigned: the owner's push with a one tap Assign (lib/leadAssign.ts).
  if (!out.duplicate && out.contactId) pushNewLeadSoon(accountId, out.contactId, { name: input.name, source: 'ez_quote', address: input.address, fenceType: choice, feet: q.footageFt })
  return out
}

/**
 * The same draft sent again. A different option picked updates the quote,
 * as long as nobody in the office has changed the quote since the website
 * wrote it; otherwise the quote stays and the pick is noted for the salesman.
 */
async function changeChoice(accountId: string, lead: Json, chosen: Json, options: Json[], quoteFields: Json, layoutBase: Json): Promise<DrawnResult> {
  const p = (lead.payload ?? {}) as Json
  const base: DrawnResult = { test: false, duplicate: true, quoteId: p.quoteId ?? null, contactId: lead.crmContactId ?? null, cardId: p.cardId ?? null, options: options.map(optionView), chosen: optionView(chosen) }
  if (!p.quoteId || p.chosen === chosen.fenceStyle) return base
  const quote = await prisma.savedQuote.findFirst({ where: { id: p.quoteId, accountId } })
  if (!quote) return base
  const untouched = quote.status === 'DRAFT' && p.writtenAt && quote.updatedAt.toISOString() === p.writtenAt
  if (!untouched) {
    if (lead.crmContactId) await prisma.crmContactNote.create({ data: { crmContactId: lead.crmContactId, accountId, body: `The customer then picked ${chosen.name} (${money(chosen.price)}) on the website quote. The quote was already being worked on, so it was not changed.`, isPinned: false, createdBy: 'Website quote (drawn by customer)' } })
    return base
  }
  const layout = (quote.layout ?? {}) as Json
  const wd = layout.widgetDrawing ? { ...layout.widgetDrawing, chosen: { fenceStyle: chosen.fenceStyle, name: chosen.name, price: chosen.price } } : undefined
  const updated = await prisma.savedQuote.update({
    where: { id: quote.id },
    data: { ...quoteFields, layout: JSON.parse(JSON.stringify({ ...layoutBase, ...(wd ? { widgetDrawing: wd } : {}) })), notes: `${SOURCE_TEXT}. The customer drew the fence on the aerial photo of the property and saw an estimate of ${money(chosen.price)} (${chosen.name}). Confirm every measurement on site.` },
  })
  await prisma.intakeLead.update({ where: { id: lead.id }, data: { estimate: chosen.price, payload: { ...p, chosen: chosen.fenceStyle, writtenAt: updated.updatedAt.toISOString() } } })
  // The card shows the new price while nobody has worked it.
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await prisma.pipelineState.findUnique({ where: { accountId } })
    const leads = ((cur?.leads as Json[]) ?? [])
    const card = leads.find(l => l?.id === p.cardId)
    if (!cur || !card) break
    const next = applyPipelineDelta({ leads, stages: (cur.stages as Json[]) ?? [] }, { upsert: [{ lead: { ...card, quotePrice: chosen.price } }], remove: [] })
    const done = await prisma.pipelineState.updateMany({ where: { accountId, version: cur.version }, data: { leads: JSON.parse(JSON.stringify(next.leads)), version: { increment: 1 } } })
    if (done.count) break
  }
  return base
}
