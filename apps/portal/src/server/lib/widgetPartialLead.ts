/**
 * People who start the website instant quote and do not finish (Jonathan,
 * Oct 29 2026):
 *   "Nothing is saved before they type contact info. As soon as they've typed
 *    a name plus a phone or email, save them as a lead marked 'Didn't finish
 *    instant quote', with whatever else they entered (address, fence choice,
 *    drawing, price shown). I get the new lead push, same as other website
 *    leads, so we can call them. If they come back and finish, it updates that
 *    same lead, not a second one. No text or email goes to the customer just
 *    for starting."
 *
 * The page (widget/WidgetApp.tsx) keeps a visit id in memory only and sends
 * what the customer has entered once the name and a phone or email pass
 * lib/widgetContact.ts, then again as they change things, when they leave a
 * box, and when the page is hidden or closed. Here:
 *
 *   - The first save makes the lead the way a sent website quote does
 *     (lib/widgetDrawQuote.ts): the customer (a new one, with a Possible match
 *     when the phone or email is already on file; lib/intake.ts), a website
 *     lead row (IntakeLead, source "ez_quote_partial": the waiting list, the
 *     Assign screen and the pushes say "Didn't finish instant quote"), one
 *     card in the first stage marked unfinishedQuote, the tag "Didn't finish
 *     instant quote" on the customer, one note (the customer's History), and,
 *     once there is a drawing and a fence, a draft quote drawn on the photo.
 *   - Later saves from the same visit, or from a later visit with the same
 *     name and the same phone or email within 30 days, update that lead, its
 *     note, card and draft quote. Never a second customer, card or push.
 *   - The owner's push: the same new lead push as any website lead
 *     (lib/leadAssign.ts pushNewLead, one tap Assign), sent by the automation
 *     worker once the customer has stopped for 3 minutes (15 at most after the
 *     lead was saved), or at once when the page is closed. Waiting a moment
 *     keeps the owner from getting "Didn't finish" for someone who sends the
 *     quote a few seconds after typing the phone. Each lead's push is written
 *     down (AutomationEffect, key widget-partial-push:<lead>) before it goes,
 *     so it is sent once. Then D8's repeat pushes apply (lib/leadRepush.ts).
 *   - Finishing (Show my prices / Send me this estimate) updates the same lead
 *     (lib/widgetDrawQuote.ts calls finishPartialLead): the quote, the card
 *     and the note become the sent quote's, "Didn't finish" is cleared (card
 *     mark, tag, lead source), and no second push goes out: the finished
 *     lead's usual push only when the "Didn't finish" one has not gone yet.
 *   - Nothing here texts or emails the customer.
 */

import crypto from 'crypto'
import prisma from './prisma.js'
import { withLock } from './once.js'
import { pricingWithData } from './estimates.js'
import { findOrCreateContact, resolveIntakeAccountId, splitName } from './intake.js'
import { pushNewLead, pushNewLeadSoon, newLeadLink, type LeadPushDeps } from './leadAssign.js'
import { sameName } from './customerImport.js'
import { applyPipelineDelta } from './pipelineDelta.js'
import { callableContact, phoneDigits } from './widgetContact.js'
import {
  drawnQuoteFor, drawnSummary, drawnQuoteNotes, putCard, leadLink, materialWord, widgetDrawingRecord, saveSnapshot, photosToCustomer,
  optionView, PipelineBusy, INTAKE_PHOTO, SOURCE_TEXT, LEAD_SOURCE, money, day,
  type DrawnQuote, type DrawnSubmission, type DrawnResult, type Pick,
} from './widgetDrawQuote.js'

type Json = any

export const PARTIAL_SOURCE = 'ez_quote_partial'
/** The words on the lead, its card, its customer (a tag) and the owner's push. */
export const UNFINISHED = "Didn't finish instant quote"
/** A later visit with the same name and phone or email updates the lead within this many days. */
export const PARTIAL_MATCH_DAYS = 30
/** The push waits until the customer has stopped this long... */
export const PARTIAL_PUSH_QUIET_MS = 3 * 60_000
/** ...or this long after the lead was saved, whichever comes first. */
export const PARTIAL_PUSH_LATEST_MS = 15 * 60_000
export const PARTIAL_PUSH_RUN_ID = 'widget-partial-push'
export const partialPushKey = (intakeId: string) => `${PARTIAL_PUSH_RUN_ID}:${intakeId}`

const STEP_WORDS = ['1. Address', '2. Draw', '3. Fence', '4. Price']

export class PartialRefused extends Error {}

export interface PartialInput {
  sessionId: string
  name: string
  phone?: string
  email?: string
  address?: string
  drawing?: Json | null
  pick?: Pick | null
  fenceStyle?: string | null
  /** The step the page was on (0 Address … 3 Price). */
  step: number
  /** The prices were on the screen (Settings: prices before contact). */
  priceShown?: boolean
  photos?: string[]
  notes?: string
  wantsVisit?: boolean
  /** The page was being hidden or closed: the owner's push goes now. */
  leaving?: boolean
}

export interface PartialResult {
  saved: boolean
  created: boolean
  /** This visit already sent its quote: nothing to save. */
  finished?: boolean
  intakeId?: string
  contactId?: string | null
  cardId?: string | null
  quoteId?: string | null
}

// ── Finding the lead again ──────────────────────────────────────────────────

const nameParts = (full: string) => { const { firstName, lastName } = splitName(full); return { first: firstName, last: lastName } }

/**
 * The unfinished lead this is: the same visit (its id), else a later visit by
 * the same person (the same name, and the same phone or email) within
 * PARTIAL_MATCH_DAYS. Only leads still unfinished, on a customer still on file.
 */
export async function findPartialLead(accountId: string, who: { sessionId: string; name: string; phone?: string | null; email?: string | null }) {
  const live = async (row: Json) => {
    if (!row?.crmContactId) return null
    const c = await prisma.crmContact.findFirst({ where: { id: row.crmContactId, accountId, deletedAt: null }, select: { id: true } })
    return c ? row : null
  }
  const same = await prisma.intakeLead.findFirst({
    where: { accountId, source: PARTIAL_SOURCE, deletedAt: null, OR: [{ sourceRef: who.sessionId }, { payload: { path: ['sessions'], array_contains: [who.sessionId] } }] },
  })
  if (same) return live(same)
  const p10 = phoneDigits(who.phone)
  const email = String(who.email || '').trim().toLowerCase()
  if (p10.length !== 10 && !email) return null
  const since = new Date(Date.now() - PARTIAL_MATCH_DAYS * 86_400_000)
  const rows = await prisma.intakeLead.findMany({ where: { accountId, source: PARTIAL_SOURCE, deletedAt: null, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 300 })
  for (const r of rows) {
    const byPhone = p10.length === 10 && phoneDigits(r.phone) === p10
    const byEmail = !!email && r.email.trim().toLowerCase() === email
    if ((byPhone || byEmail) && sameName(nameParts(r.name), nameParts(who.name)) && (await live(r))) return r
  }
  return null
}

// ── What they entered, in words ─────────────────────────────────────────────

function pickWords(pick: Pick | null | undefined): string {
  if (!pick) return ''
  const color = pick.color ? pick.color.replace(/-/g, ' ') : ''
  return [materialWord(pick.material), color, pick.height ? `${pick.height} ft${pick.kind ? ` ${pick.kind}` : ''}` : pick.kind].filter(Boolean).join(', ')
}

const at = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d)

interface Entered {
  contact: { name: string; phone: string; email: string }
  address: string
  drawnFt: number
  d: DrawnQuote | null
  pick: Pick | null
  priceShown: boolean
}

function partialSummary(e: Entered, input: PartialInput, startedAt: Date): string {
  const step = STEP_WORDS[Math.max(0, Math.min(3, input.step | 0))]
  const photos = (input.photos ?? []).filter(u => INTAKE_PHOTO.test(u)).length
  const priced = e.d
  return [
    `${UNFINISHED} (website, ${at(startedAt)})`,
    `Got as far as: ${step}. They typed their name and ${e.contact.phone && e.contact.email ? 'phone and email' : e.contact.phone ? 'phone' : 'email'}, then stopped before sending.`,
    e.contact.phone ? `Phone: ${e.contact.phone}` : '',
    e.contact.email ? `Email: ${e.contact.email}` : '',
    e.address ? `Address: ${e.address}` : 'Address: not entered',
    e.drawnFt > 0 ? `Drawn on the photo: ${Math.round(e.drawnFt)} ft${priced && (priced.q.req.walkGates || priced.q.req.dblGates) ? ` (gates: ${priced.q.req.walkGates} walk, ${priced.q.req.dblGates} double)` : ''}` : 'Drawing: none yet',
    e.pick ? `Fence: ${priced ? priced.choice : pickWords(e.pick)}` : 'Fence: not picked yet',
    priced && e.priceShown ? `Prices shown to the customer: ${priced.options.map((o: Json) => `${o.name} ${money(o.price)}`).join(', ')}` : '',
    priced && !e.priceShown ? `Estimate for what they drew (not shown to the customer: prices come after the name and phone): ${priced.chosen.name} ${money(priced.price)}; ${priced.options.map((o: Json) => `${o.name} ${money(o.price)}`).join(', ')}` : '',
    priced ? 'The drawing is on the draft quote.' : '',
    typeof input.wantsVisit === 'boolean' && input.step >= 3 ? `Free visit box: ${input.wantsVisit ? 'checked' : 'unchecked'}` : '',
    photos ? `Photos of the yard: ${photos}` : '',
    input.notes?.trim() ? `Customer notes: ${input.notes.trim()}` : '',
  ].filter(Boolean).join('\n')
}

const cardHeader = (e: Entered) => [UNFINISHED, day(), e.d ? `estimate ${money(e.d.price)}` : ''].filter(Boolean).join(' · ')
/** The card's notes with its first "Didn't finish" line replaced (or added on top). */
function withHeader(notes: string, header: string): string {
  const lines = String(notes || '').split('\n').filter(l => !l.startsWith(UNFINISHED))
  return [header, ...lines].filter(Boolean).join('\n')
}

const partialQuoteNotes = (d: DrawnQuote, shown: boolean) =>
  `${UNFINISHED}. The customer drew the fence on the aerial photo of the property and stopped before sending it. ${shown ? `They saw an estimate of ${money(d.price)} (${d.chosen.name}).` : `They were not shown a price yet; this is ${d.chosen.name} at ${money(d.price)}.`} Confirm every measurement on site.`

// ── Saving it ───────────────────────────────────────────────────────────────

export async function savePartialLead(input: PartialInput): Promise<PartialResult> {
  return withLock(`widget-lead:${input.sessionId}`, () => savePartialNow(input))
}

async function savePartialNow(input: PartialInput): Promise<PartialResult> {
  const accountId = await resolveIntakeAccountId()
  if (!accountId) throw new Error('No company is set up on this server yet')
  // This visit already sent its quote: the quote is the lead now.
  const sent = await prisma.intakeLead.findUnique({ where: { source_sourceRef: { source: 'ez_quote', sourceRef: input.sessionId } } })
  if (sent) return { saved: false, created: false, finished: true, intakeId: sent.id, contactId: sent.crmContactId }

  const contact = callableContact(input)
  if (!contact) throw new PartialRefused('Add a name and a phone number or email.')
  const address = String(input.address || input.drawing?.address || '').trim().slice(0, 300)
  const { m } = await pricingWithData()
  const drawn = input.drawing && Array.isArray(input.drawing.runs) ? { ...input.drawing, runs: input.drawing.runs.filter((r: Json) => Array.isArray(r?.pts) && r.pts.length >= 2) } : null
  const drawnFt = drawn && drawn.runs.length ? (() => { try { return Number(m.drawingTotalFt(drawn)) || 0 } catch { return 0 } })() : 0
  // Priced as the sent quote would be, when there is a drawing and a fence (a drawing that cannot be priced is kept as drawn).
  const d = drawn && drawn.runs.length && input.pick ? await drawnQuoteFor(accountId, drawn, input.pick, input.fenceStyle).catch(() => null) : null
  const priceShown = !!input.priceShown && !!d
  const e: Entered = { contact, address, drawnFt, d, pick: input.pick ?? null, priceShown }
  const photos = (input.photos ?? []).filter(u => INTAKE_PHOTO.test(u))
  const fenceType = (d ? d.choice : pickWords(input.pick)).slice(0, 120)

  const existing = await findPartialLead(accountId, { sessionId: input.sessionId, name: contact.name, phone: contact.phone, email: contact.email })
  const out = existing
    ? await updatePartial(accountId, existing, input, e, fenceType, photos, drawn)
    : await createPartial(accountId, input, e, fenceType, photos, drawn)
  if (out.contactId && photos.length) await photosToCustomer(out.contactId, photos).catch(err => console.error('[widget] partial photos failed:', err))
  // They closed the page: the owner hears now (once; lib comment above).
  if (input.leaving && out.intakeId) await sendPartialPush(out.intakeId).catch(err => console.error('[widget] partial push failed:', err))
  return out
}

function partialPayload(prev: Json, input: PartialInput, e: Entered, drawn: Json, photos: string[], extra: Json) {
  const sessions = [...new Set([...(Array.isArray(prev?.sessions) ? prev.sessions : []), input.sessionId])].slice(-10)
  return JSON.parse(JSON.stringify({
    ...prev, ...extra, kind: 'partial', sessions, step: input.step, address: e.address, drawing: drawn ?? prev?.drawing ?? null, pick: input.pick ?? prev?.pick ?? null,
    fenceStyle: e.d?.chosen.fenceStyle ?? input.fenceStyle ?? null, priceShown: e.priceShown,
    options: e.d ? e.d.options.map(optionView) : null, estimate: e.d?.price ?? null, photos, notes: input.notes?.trim() || undefined,
    wantsVisit: input.wantsVisit, savedAt: new Date().toISOString(),
  }))
}

function quoteData(accountId: string, contactId: string, e: Entered, drawn: Json, input: PartialInput) {
  const d = e.d!
  const widgetDrawing = widgetDrawingRecord(drawn, d.sides, input.pick!, d.options, d.chosen, null, [])
  return {
    accountId, crmContactId: contactId,
    customerName: e.contact.name, customerPhone: e.contact.phone, customerEmail: e.contact.email, customerAddress: e.address,
    leadSource: LEAD_SOURCE,
    ...d.quoteFields,
    layout: JSON.parse(JSON.stringify({ ...d.layoutBase, widgetDrawing: { ...widgetDrawing, unfinished: true } })),
    status: 'DRAFT' as const, date: day(),
    notes: partialQuoteNotes(d, e.priceShown),
  }
}

async function createPartial(accountId: string, input: PartialInput, e: Entered, fenceType: string, photos: string[], drawn: Json): Promise<PartialResult> {
  const startedAt = new Date()
  const summary = partialSummary(e, input, startedAt)
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const contact = await findOrCreateContact(accountId, { name: e.contact.name, phone: e.contact.phone || undefined, email: e.contact.email || undefined, address: e.address || undefined, leadSource: LEAD_SOURCE, tags: [UNFINISHED] }, tx)
        const quote = e.d ? await tx.savedQuote.create({ data: quoteData(accountId, contact.id, e, drawn, input) }) : null
        const today = day()
        const { firstName, lastName } = splitName(e.contact.name)
        const card = await putCard(tx, accountId, contact.id, (existing, firstStageId) => existing
          ? { ...existing, unfinishedQuote: true, notes: withHeader(existing.notes, cardHeader(e)), fenceType: existing.fenceType || fenceType, quotePrice: existing.quotePrice || (e.d?.price ?? 0) }
          : {
              id: crypto.randomUUID(), customerId: contact.id, firstName: firstName || 'Unknown', lastName,
              phone: e.contact.phone, email: e.contact.email, address: e.address, leadSource: LEAD_SOURCE, leadTemp: 0,
              fenceType, sections: e.d?.q.job.calc.sections ?? 0, quotePrice: e.d?.price ?? 0, crew: '', scheduledDate: '', jobValue: 0,
              paymentStatus: '', balanceDue: 0, notes: cardHeader(e), stage: firstStageId,
              createdAt: today, lastMoved: today, assignedRep: '', unfinishedQuote: true,
            })
        const note = await tx.crmContactNote.create({ data: { crmContactId: contact.id, accountId, body: summary.slice(0, 19000), isPinned: false, createdBy: 'Website quote (not finished)' } })
        const row = await tx.intakeLead.create({
          data: {
            accountId, source: PARTIAL_SOURCE, sourceRef: input.sessionId, crmContactId: contact.id, status: 'imported', importedAt: new Date(),
            name: e.contact.name.slice(0, 200), phone: e.contact.phone.slice(0, 40), email: e.contact.email.slice(0, 200), address: e.address.slice(0, 500),
            fenceType, summary: summary.slice(0, 8000), estimate: e.d?.price ?? null,
            payload: partialPayload({}, input, e, drawn, photos, { madeContact: true, cardId: card.id, noteId: note.id, quoteId: quote?.id ?? null, writtenAt: quote?.updatedAt.toISOString() ?? null }),
          },
        })
        return { saved: true, created: true, intakeId: row.id, contactId: contact.id, cardId: card.id, quoteId: quote?.id ?? null }
      })
    } catch (err) {
      if (!(err instanceof PipelineBusy)) throw err
    }
  }
  throw new Error('The pipeline was busy; try again')
}

async function updatePartial(accountId: string, row: Json, input: PartialInput, e: Entered, fenceType: string, photos: string[], drawn: Json): Promise<PartialResult> {
  const p = (row.payload ?? {}) as Json
  const contactId: string = row.crmContactId
  const summary = partialSummary(e, input, row.createdAt)
  // The draft quote follows the drawing while nobody in the office has touched it.
  let quoteId: string | null = p.quoteId ?? null
  let writtenAt: string | null = p.writtenAt ?? null
  if (e.d) {
    const quote = quoteId ? await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId } }) : null
    if (!quote) {
      const made = await prisma.savedQuote.create({ data: quoteData(accountId, contactId, e, drawn, input) })
      quoteId = made.id; writtenAt = made.updatedAt.toISOString()
    } else if (quote.status === 'DRAFT' && writtenAt && quote.updatedAt.toISOString() === writtenAt) {
      const { accountId: _a, crmContactId: _c, ...data } = quoteData(accountId, contactId, e, drawn, input)
      const upd = await prisma.savedQuote.update({ where: { id: quote.id }, data })
      writtenAt = upd.updatedAt.toISOString()
    }
  }
  await prisma.intakeLead.update({
    where: { id: row.id },
    data: {
      ...(row.sourceRef !== input.sessionId ? { sourceRef: input.sessionId } : {}),
      name: e.contact.name.slice(0, 200), phone: (e.contact.phone || row.phone).slice(0, 40), email: (e.contact.email || row.email).slice(0, 200),
      address: (e.address || row.address).slice(0, 500), fenceType: fenceType || row.fenceType, summary: summary.slice(0, 8000), estimate: e.d?.price ?? row.estimate,
      payload: partialPayload(p, input, e, drawn, photos, { quoteId, writtenAt }),
    },
  })
  if (p.noteId) await prisma.crmContactNote.updateMany({ where: { id: p.noteId, crmContactId: contactId }, data: { body: summary.slice(0, 19000) } })
  // A typo fixed while still on the page: the customer this lead made follows (one made earlier stays as the office has it).
  if (p.madeContact) {
    const { firstName, lastName } = splitName(e.contact.name)
    await prisma.crmContact.updateMany({
      where: { id: contactId, accountId },
      data: { firstName, lastName, ...(e.contact.phone ? { phone: e.contact.phone } : {}), ...(e.contact.email ? { email: e.contact.email } : {}), ...(e.address ? { serviceAddress: e.address } : {}) },
    })
  }
  const cardId = await patchCard(accountId, p.cardId, contactId, card => ({
    ...card, unfinishedQuote: true, notes: withHeader(card.notes, cardHeader(e)), fenceType: fenceType || card.fenceType,
    ...(e.d ? { quotePrice: e.d.price, sections: e.d.q.job.calc.sections } : {}),
    ...(e.address && !card.address ? { address: e.address } : {}),
    ...(p.madeContact ? { ...splitFirstLast(e.contact.name), ...(e.contact.phone ? { phone: e.contact.phone } : {}), ...(e.contact.email ? { email: e.contact.email } : {}), ...(e.address ? { address: e.address } : {}) } : {}),
  }))
  return { saved: true, created: false, intakeId: row.id, contactId, cardId, quoteId }
}

const splitFirstLast = (name: string) => { const { firstName, lastName } = splitName(name); return { firstName, lastName } }

/** Change one card on the board (a versioned save, tried again when a browser saved in between). Its id, or null when gone. */
async function patchCard(accountId: string, cardId: string | null | undefined, contactId: string, change: (card: Json) => Json): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await prisma.pipelineState.findUnique({ where: { accountId } })
    const leads = ((cur?.leads as Json[]) ?? [])
    const card = (cardId ? leads.find(l => l?.id === cardId) : null) ?? leads.find(l => l?.customerId === contactId)
    if (!cur || !card) return null
    const next = applyPipelineDelta({ leads, stages: (cur.stages as Json[]) ?? [] }, { upsert: [{ lead: change(card) }], remove: [] })
    const done = await prisma.pipelineState.updateMany({ where: { accountId, version: cur.version }, data: { leads: JSON.parse(JSON.stringify(next.leads)), version: { increment: 1 } } })
    if (done.count) return card.id
  }
  return null
}

// ── Finishing ───────────────────────────────────────────────────────────────

/**
 * The customer sent the quote after stopping part way: the same customer,
 * card, lead and draft quote become the sent quote's. Called by
 * submitDrawnQuote (lib/widgetDrawQuote.ts), inside the visit's lock.
 */
export async function finishPartialLead(accountId: string, row: Json, input: DrawnSubmission, d: DrawnQuote): Promise<DrawnResult> {
  const p = (row.payload ?? {}) as Json
  const contactId: string = row.crmContactId
  const { options, chosen, price, layoutBase, quoteFields, sides, choice, q } = d
  const snapshotUrl = saveSnapshot(input.snapshot)
  const photos = (input.photos ?? []).filter(u => INTAKE_PHOTO.test(u))
  const widgetDrawing = widgetDrawingRecord(input.drawing, sides, input.pick, options, chosen, snapshotUrl, photos)
  const today = day()
  const summary = [drawnSummary(d, input, widgetDrawing), `Started ${at(row.createdAt)} and stopped before sending (the lead was saved then); finished ${at(new Date())}.`].join('\n')
  const header = `${SOURCE_TEXT} · ${today} · estimate shown ${money(price)}`
  const customer = { customerName: input.name, customerPhone: input.phone, customerEmail: input.email ?? '', customerAddress: input.address }

  let out: DrawnResult | null = null
  for (let attempt = 0; attempt < 5 && !out; attempt++) {
    try {
      out = await prisma.$transaction(async tx => {
        // The draft quote becomes the sent one while the office has not touched it; else it stays, with a note.
        const old = p.quoteId ? await tx.savedQuote.findFirst({ where: { id: p.quoteId, accountId } }) : null
        const untouched = !!old && old.status === 'DRAFT' && !!p.writtenAt && old.updatedAt.toISOString() === p.writtenAt
        const data = { ...customer, leadSource: LEAD_SOURCE, ...quoteFields, layout: JSON.parse(JSON.stringify({ ...layoutBase, widgetDrawing })), status: 'DRAFT' as const, date: today, notes: drawnQuoteNotes(chosen, input.notes) }
        const quote = untouched
          ? await tx.savedQuote.update({ where: { id: old!.id }, data })
          : old ? old : await tx.savedQuote.create({ data: { accountId, crmContactId: contactId, ...data } })
        if (old && !untouched) {
          await tx.crmContactNote.create({ data: { crmContactId: contactId, accountId, body: `The customer then finished the website quote: ${choice}, ${money(price)}. The quote was already being worked on, so it was not changed.`, isPinned: false, createdBy: 'Website quote (drawn by customer)' } })
        }
        const card = await putCard(tx, accountId, contactId, (existing, firstStageId) => {
          if (existing) {
            const { unfinishedQuote: _u, ...rest } = existing
            return { ...rest, notes: [header, ...String(existing.notes || '').split('\n').filter((l: string) => l && !l.startsWith(UNFINISHED))].join('\n'), fenceType: choice, quotePrice: price, sections: q.job.calc.sections }
          }
          const { firstName, lastName } = splitName(input.name)
          return {
            id: crypto.randomUUID(), customerId: contactId, firstName: firstName || 'Unknown', lastName,
            phone: input.phone, email: input.email ?? '', address: input.address, leadSource: LEAD_SOURCE, leadTemp: 0,
            fenceType: choice, sections: q.job.calc.sections, quotePrice: price, crew: '', scheduledDate: '', jobValue: 0,
            paymentStatus: '', balanceDue: 0, notes: header, stage: firstStageId, createdAt: today, lastMoved: today, assignedRep: '',
          }
        })
        await tx.intakeLead.update({
          where: { id: row.id },
          data: {
            source: 'ez_quote', sourceRef: input.draftId, status: 'imported',
            name: input.name.slice(0, 200), phone: input.phone.slice(0, 40), email: (input.email ?? '').slice(0, 200), address: input.address.slice(0, 500),
            fenceType: choice.slice(0, 120), summary: summary.slice(0, 8000), estimate: price,
            payload: JSON.parse(JSON.stringify({ kind: 'drawn', draftId: input.draftId, quoteId: quote.id, cardId: card.id, pick: input.pick, chosen: chosen.fenceStyle, wantsVisit: input.wantsVisit, writtenAt: quote.updatedAt.toISOString(), unfinishedFrom: { at: row.createdAt.toISOString(), sessions: p.sessions ?? [row.sourceRef] } })),
          },
        })
        // One note on the History: the "Didn't finish" one becomes the sent quote's.
        const noted = p.noteId ? await tx.crmContactNote.updateMany({ where: { id: p.noteId, crmContactId: contactId }, data: { body: summary.slice(0, 19000), createdBy: 'Website quote (drawn by customer)' } }) : { count: 0 }
        if (!noted.count) await tx.crmContactNote.create({ data: { crmContactId: contactId, accountId, body: summary.slice(0, 19000), isPinned: false, createdBy: 'Website quote (drawn by customer)' } })
        // "Didn't finish" comes off the customer; a customer this lead made takes the name and phone as sent.
        const c = await tx.crmContact.findUnique({ where: { id: contactId }, select: { tags: true } })
        const tags = (Array.isArray(c?.tags) ? (c!.tags as string[]) : []).filter(t => t !== UNFINISHED)
        const { firstName, lastName } = splitName(input.name)
        await tx.crmContact.update({
          where: { id: contactId },
          data: { tags, ...(p.madeContact ? { firstName, lastName, phone: input.phone, ...(input.email ? { email: input.email } : {}), serviceAddress: input.address } : {}) },
        })
        return { test: false, duplicate: false, quoteId: quote.id, contactId, cardId: card.id, options: options.map(optionView), chosen: optionView(chosen) }
      })
    } catch (err) {
      if (!(err instanceof PipelineBusy)) throw err
    }
  }
  if (!out) throw new Error('The pipeline was busy; try again')
  if (photos.length) await photosToCustomer(contactId, photos).catch(err => console.error('[widget] photos failed:', err))
  // One push per lead: the sent quote's, only when the "Didn't finish" one has not gone out yet.
  const first = await claimPush(row.id, 'finished', { at: new Date().toISOString(), why: 'finished before the unfinished push' })
  await prisma.notification.create({
    data: {
      title: first ? `Website quote: ${input.name}` : `Website quote: ${input.name} finished the instant quote`,
      body: `${SOURCE_TEXT} · ${choice} · ${q.footageFt} ft · ${money(price)}`.slice(0, 400), type: 'info',
      link: await newLeadLink(accountId, contactId, leadLink(out.cardId, contactId)),
    },
  }).catch(err => console.error('[widget] notification failed:', err))
  if (first) pushNewLeadSoon(accountId, contactId, { name: input.name, source: 'ez_quote', address: input.address, fenceType: choice, feet: q.footageFt })
  return out
}

// ── The owner's push ────────────────────────────────────────────────────────

/** Write the lead's one push down; false when it already was (sent, being sent, or the lead was finished first). */
async function claimPush(intakeId: string, status: 'sending' | 'finished', result: Json): Promise<boolean> {
  const r = await prisma.automationEffect.createMany({ data: [{ key: partialPushKey(intakeId), runId: PARTIAL_PUSH_RUN_ID, status, result }], skipDuplicates: true })
  return r.count === 1
}

/** The "Didn't finish" push and bell entry for one lead, once. Null when it already went (or the lead was finished or deleted). */
export async function sendPartialPush(intakeId: string, deps: LeadPushDeps = {}) {
  const row = await prisma.intakeLead.findUnique({ where: { id: intakeId } })
  if (!row || row.source !== PARTIAL_SOURCE || row.deletedAt || !row.crmContactId) return null
  if (!(await claimPush(row.id, 'sending', { at: new Date().toISOString() }))) return null
  const p = (row.payload ?? {}) as Json
  const what = [row.fenceType, p.estimate ? money(p.estimate) : ''].filter(Boolean).join(' · ')
  await prisma.notification.create({
    data: {
      title: `${UNFINISHED}: ${row.name || row.phone || row.email}`,
      body: [row.address, what, row.phone || row.email].filter(Boolean).join(' · ').slice(0, 400), type: 'info',
      link: await newLeadLink(row.accountId, row.crmContactId, leadLink(p.cardId ?? null, row.crmContactId)),
    },
  }).catch(err => console.error('[widget] notification failed:', err))
  const feet = Array.isArray(p.drawing?.runs) ? await pricingWithData().then(({ m }) => Number(m.drawingTotalFt(p.drawing)) || null).catch(() => null) : null
  const r = await pushNewLead(row.accountId, row.crmContactId, { name: row.name || row.phone || row.email, source: PARTIAL_SOURCE, address: row.address, fenceType: row.fenceType, feet }, deps)
  await prisma.automationEffect.update({ where: { key: partialPushKey(row.id) }, data: { status: 'done', result: { at: new Date().toISOString(), pushed: r.pushed, held: !!r.held, why: r.why ?? null } } })
  return r
}

/**
 * Run by the automation worker every 30 seconds (lib/automations/queue.ts):
 * the "Didn't finish" push for each unfinished lead whose customer has
 * stopped for PARTIAL_PUSH_QUIET_MS, or was saved PARTIAL_PUSH_LATEST_MS ago.
 */
export async function partialLeadPushSweep(now = new Date(), deps: LeadPushDeps & { accountIds?: string[] } = {}): Promise<string[]> {
  const rows = await prisma.intakeLead.findMany({
    where: { source: PARTIAL_SOURCE, deletedAt: null, crmContactId: { not: null }, createdAt: { gte: new Date(now.getTime() - 2 * 86_400_000) }, ...(deps.accountIds ? { accountId: { in: deps.accountIds } } : {}) },
    select: { id: true, createdAt: true, payload: true },
  })
  if (!rows.length) return []
  const done = new Set((await prisma.automationEffect.findMany({ where: { key: { in: rows.map(r => partialPushKey(r.id)) } }, select: { key: true } })).map(e => e.key))
  const sent: string[] = []
  for (const r of rows) {
    if (done.has(partialPushKey(r.id))) continue
    const last = Date.parse((r.payload as Json)?.savedAt ?? '') || r.createdAt.getTime()
    if (now.getTime() - last < PARTIAL_PUSH_QUIET_MS && now.getTime() - r.createdAt.getTime() < PARTIAL_PUSH_LATEST_MS) continue
    try { if (await sendPartialPush(r.id, deps)) sent.push(r.id) } catch (err) { console.error('[widget] partial push:', String((err as Error)?.message || err).slice(0, 200)) }
  }
  return sent
}

