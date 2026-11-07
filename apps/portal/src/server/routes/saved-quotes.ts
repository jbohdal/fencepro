/**
 * Saved Quotes API
 *
 * CRUD for the user's saved quotes (the SavedQuote model). Distinct from
 * /api/quotes/* which is the stateless calculator/chatbot endpoint.
 *
 * Auth: requires a CRM user JWT and a tenant CrmAccount, same pattern as
 * /api/crm-contacts. Public share read endpoint at /share/:token is the
 * one exception — no auth so customers can view their quote without a login.
 *
 * Endpoints (all under /api/saved-quotes):
 *   GET    /                  — list active quotes for the caller's account
 *   GET    /:id               — fetch a single quote
 *   POST   /                  — create a quote (returns server id)
 *   PATCH  /:id               — update a quote (any field)
 *   DELETE /:id               — soft archive a quote
 *   POST   /sync              — bulk push from a localStorage payload
 *   POST   /:id/salesman      — the owner changes this quote's Salesman (and its job's), { to, confirm? }
 *   GET    /:id/commission    — the owner reads who gets a signed quote's commission
 *   POST   /:id/commission    — the owner edits it by hand, { to?, commissionCents? } (lib/soldBy.ts)
 *   POST   /:id/share-token   — issue (or reissue) a public share token
 *   GET    /share/:token      — PUBLIC: fetch a single quote by share token
 *                              (records the firstViewedAt the first time it is hit)
 */

import { canonicalWord } from '../lib/optionLists.js'
import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { placeRecord, dropMovedQuoteProperty } from '../lib/properties.js'
import { DeleteError, deleteRecord } from '../lib/deletion.js'
import { audit } from '../lib/auditLog.js'
import { clientIdSchema, decideClientId } from '../lib/clientId.js'
import { resolveSecret } from '../lib/secrets.js'
import { plainZod } from '../lib/plainZod.js'
import { repForSave, repName } from '../lib/salesRep.js'
import { samePerson } from '../lib/quotesFollowCustomer.js'
import { salesmanMoveRoute } from '../lib/salesmanMove.js'
import { commissionEdit, commissionRead, keepSaleRecord, withSoldBy, withoutSaleRecord } from '../lib/soldBy.js'
import { can, requireCan, roleOf } from '../lib/permissions.js'
import { hidesCosts, hideFor } from '../lib/costRedact.js'
import { withServerCosts, keepSavedCosts } from '../lib/quotePricing.js'
import { commissionSettings, hasCommissionFigures, ruleLogins, saveTakesCommissionOff, withCommission, withoutCommission } from '../lib/commissionRule.js'
import { snapshotAfterSigning } from '../lib/jobCosting.js'
import { isSignedQuote, lockedChanges, lockMessage, LOCKED_CODE, keepPrices } from '../lib/quoteLock.js'
import { markEverSold } from '../lib/everSold.js'
import { scheduleAfterSigning, termsDepositOf } from '../lib/contractBilling.js'
import { customerDollarsFrom, noDepositCancellationFrom } from '../lib/customerDollars.js'
import { heldPriceRefusal, refuseHeldPrice } from '../lib/heldStylePrice.js'
import { makePreviewToken } from '../lib/proposalViews.js'
import { stampQuoteWarranties } from '../lib/warranties.js'
import { stampQuoteTerms, isWalkedNoPlan } from '../lib/contractTerms.js'
import { workKindOf } from '../lib/installDays.js'
import { stampOwnTier, proposalSent, styleRecords } from '../lib/ownTier.js'
import { pricingModule } from '../lib/estimates.js'
import { clientIpOf } from '../lib/staffDevices.js'
import { fileSignedContract, plainIp } from '../lib/signedDocuments.js'
import { slimQuote, withHeavyParts } from '../lib/quoteSlim.js'
import { optionSeen } from '../lib/optionSeen.js'
import { customerProposal } from '../lib/customerProposal.js'
import { checkQuotePrices, refusePrices, priceCheckAudit, quoteChangedSince, overOptionLimit } from '../lib/quotePriceCheck.js'
import { checkDiscountMinimum, minimumOverrideAudit } from '../lib/discountMinimum.js'

const router = Router()

const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

export async function requireUser(req: any, res: any, next: any) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any
    let crmAccountId: string | null = payload.crmAccountId ?? null
    if (!crmAccountId) {
      const u = await prisma.crmUser.findUnique({
        where: { id: payload.sub },
        select: { crmAccountId: true },
      })
      crmAccountId = u?.crmAccountId ?? null
    }
    req.user = { id: payload.sub, email: payload.email, role: payload.role, crmAccountId }
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
}

export function requireAccount(req: any, res: any, next: any) {
  if (!req.user?.crmAccountId) {
    res.status(403).json({ success: false, error: 'Your user is not linked to a company; ask an admin to assign you to one.' })
    return
  }
  next()
}


/** Photos taken while the quote was written follow it to its customer. */
async function linkQuoteMedia(q: { id: string; accountId: string; crmContactId: string | null }) {
  if (!q.crmContactId) return
  await prisma.mediaItem.updateMany({ where: { accountId: q.accountId, quoteKey: q.id, customerId: null }, data: { customerId: q.crmContactId } }).catch(() => {})
}

// ── Schemas ──

const lineItemSchema = z.object({
  item: z.string(),
  qty: z.number(),
  unitCost: z.number(),
  total: z.number(),
}).passthrough() // pull-sheet line items can carry extra fields per style

const quoteSchema = z.object({
  crmContactId: z.string().optional().nullable(),
  customerName: z.string().default(''),
  customerPhone: z.string().default(''),
  customerEmail: z.string().default(''),
  customerAddress: z.string().default(''),
  /** The customer's property it is for (CustomerProperty); its address becomes customerAddress. */
  propertyId: z.string().max(64).optional().nullable(),
  leadSource: z.string().default(''),
  salesRep: z.string().default(''),
  fenceStyle: z.string().default(''),
  runs: z.array(z.number()).default([]),
  runRails: z.array(z.enum(['auto', '6ft', '8ft'])).optional().nullable(),
  // Proposal options and words, frozen at save (see web/src/proposal.ts).
  proposal: z.object({ version: z.number(), options: z.array(z.object({}).passthrough()).max(12) }).passthrough().optional().nullable(),
  // Yard layout as drawn plus each run's sections (see web/src/yardLayout.ts).
  layout: z.object({
    yard: z.object({ shape: z.string(), closed: z.boolean(), sides: z.array(z.object({}).passthrough()).max(60) }).passthrough().nullable(),
    runSections: z.array(z.number()).max(200),
    // Kept (Nov 5 2026: they were dropped on every save): vinyl tees priced as line posts, a typed run list's gate widths.
    teeLinePosts: z.number().int().min(0).max(100).optional(),
    gateWidths: z.object({ walk: z.array(z.number()).max(40), dbl: z.array(z.number()).max(40) }).optional().nullable(),
    // The walk list as measured on site (web walkList.ts), and whether the office has drawn the plan from it.
    walk: z.object({
      v: z.literal(1),
      lines: z.array(z.object({
        id: z.string().max(64), fromTee: z.string().max(64).optional().nullable(), branchTurn: z.enum(['left', 'right']).optional(),
        steps: z.array(z.object({
          id: z.string().max(64), feetIn: z.number().min(0).max(1_000_000), what: z.enum(['corner', 'gate', 'tee', 'end', 'start']),
          turn: z.enum(['left', 'right']).optional().nullable(),
          gate: z.object({ widthIn: z.number().min(0).max(1200), type: z.enum(['walk', 'double']) }).optional().nullable(),
        })).max(200),
      })).max(40),
      // The finger sketch it was measured on (web sketch.ts, Nov 6 2026): shape and rough angles only, never the price.
      sketch: z.object({
        v: z.literal(1),
        lines: z.array(z.object({
          id: z.string().max(64),
          pts: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).max(200),
          closed: z.boolean(),
          feetIn: z.array(z.number().min(0).max(1_000_000).nullable()).max(200),
          gates: z.array(z.object({ id: z.string().max(64), side: z.number().int().min(0).max(200), atIn: z.number().min(0).max(1_000_000).nullable(), widthIn: z.number().min(0).max(1200), type: z.enum(['walk', 'double']) })).max(100),
          tee: z.object({ lineId: z.string().max(64), side: z.number().int().min(0).max(200), atIn: z.number().min(0).max(1_000_000).nullable() }).optional().nullable(),
        })).max(40),
        house: z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().finite(), h: z.number().finite() }).optional().nullable(),
      }).optional().nullable(),
    }).optional().nullable(),
    planDone: z.boolean().optional(),
  }).optional().nullable(),
  corners: z.number().int().default(0),
  ends: z.number().int().default(0),
  walkGates: z.number().int().default(0),
  dblGates: z.number().int().default(0),
  tearOutSections: z.number().int().default(0),
  tearOutGates: z.number().int().default(0),
  adjLaborHrs: z.number().default(0),
  hasSalesman: z.boolean().default(false),
  priceAdjust: z.number().default(0),
  sections: z.number().int().default(0),
  materialCost: z.number().default(0),
  laborCost: z.number().default(0),
  tearOutCost: z.number().default(0),
  totalCOGS: z.number().default(0),
  finalPrice: z.number().default(0),
  gmPct: z.number().default(0),
  pullSheet: z.array(lineItemSchema).default([]),
  status: z.enum(['DRAFT', 'SENT', 'SOLD', 'LOST']).default('DRAFT'),
  date: z.string().default(''),
  notes: z.string().default(''),
  leadTemp: z.number().int().default(0),
  // Per quote pricing choices (labor mode, subcontractor rate, price method,
  // manual price). Stored as is; the web pricing engine owns the shape.
  pricing: z.record(z.any()).optional().nullable(),
  // A fence move or repair: job type, inputs and the cost lines it was priced
  // with (web/src/moveRepair.ts). Null for a new fence.
  work: z.object({ type: z.enum(['move', 'repair']) }).passthrough().optional().nullable(),
  // A sent quote saved again at today's prices: it has to be sent again.
  needsResend: z.boolean().optional(),
})

const quoteUpdateSchema = quoteSchema.partial()

/** Is this saved quote signed (Sold, accepted, or a quoted cost saved at signing)? Signed quotes are locked (lib/quoteLock.ts). */
export async function signedNow(q: { id: string; accountId: string; status: string; acceptedAt: Date | null; soldAt?: Date | null }): Promise<boolean> {
  if (isSignedQuote(q)) return true
  return !!(await prisma.jobQuotedCost.findUnique({ where: { accountId_quoteId: { accountId: q.accountId, quoteId: q.id } }, select: { id: true } }))
}

/** 409 for a write that would change a signed quote's price; nothing is saved. `data` is the saved copy. */
function refuseLocked(res: any, fields: string[], saved: unknown) {
  res.status(409).json({ success: false, code: LOCKED_CODE, error: lockMessage(fields), fields, data: saved })
}

function toJsonValue(value: unknown): any {
  return value === undefined ? undefined : (value === null ? null : JSON.parse(JSON.stringify(value)))
}

/**
 * A quote may only link to a contact that exists in the same company. An id
 * that does not resolve is saved as "no link" instead of failing the whole
 * save: the quote still carries the customer's name, phone and address, and
 * losing the quote is far worse than losing the link.
 */
async function ownContactId(contactId: string | null | undefined, accountId: string): Promise<string | null> {
  if (!contactId) return null
  const c = await prisma.crmContact.findUnique({ where: { id: contactId }, select: { id: true, accountId: true, deletedAt: true } })
  if (c && c.accountId === accountId && !c.deletedAt) return c.id
  console.warn(`[saved-quotes] contact ${contactId} not found for this company; saving the quote without the link`)
  return null
}

/** For nullable Json columns (runRails, pricing). Prisma rejects a bare JS
 *  null on a Json? column, so null has to be sent as Prisma.JsonNull. */
function toNullableJson(value: unknown): any {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return JSON.parse(JSON.stringify(value))
}

// ── List ──
router.get('/', requireUser, requireAccount, async (req: any, res) => {
  try {
    // ?since=<time>: only what changed after it (removed ones too, with archivedAt), so the
    // phone's refresh is small. A few seconds of overlap covers saves in flight.
    const sinceRaw = typeof req.query.since === 'string' ? Date.parse(req.query.since) : NaN
    const serverTime = new Date(Date.now() - 5000).toISOString()
    const quotes = await prisma.savedQuote.findMany({
      where: Number.isFinite(sinceRaw)
        ? { accountId: req.user.crmAccountId, updatedAt: { gt: new Date(sinceRaw) } }
        : req.query.archived === '1' ? { accountId: req.user.crmAccountId, deletedAt: null, archivedAt: { not: null } }
        : { accountId: req.user.crmAccountId, deletedAt: null, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
    })
    // ?archived=1 above: the archived ones (search, reports, Unarchive). A small refresh marks a deleted
    // one with archivedAt too, so an older screen drops it (a new screen checks deletedAt first).
    const marked = Number.isFinite(sinceRaw) ? quotes.map(x => (x.deletedAt && !x.archivedAt ? { ...x, archivedAt: x.deletedAt } : x)) : quotes
    // Whole proposals, as before Oct 28. The phone load cut (lib/quoteSlim.ts, ?slim=1) is held back from the
    // app: several screens read a sent option's copies straight from the list (sentReprice.ts, change orders),
    // and sent and signed proposals must open exactly as before (Jonathan, Oct 28 2026).
    const sold = await withSoldBy(marked)
    const data = req.query.slim === '1' ? sold.map(slimQuote) : sold
    res.json({ success: true, data, serverTime, partial: Number.isFinite(sinceRaw) })
  } catch (err) {
    console.error('[saved-quotes] list error:', err)
    res.status(500).json({ success: false, error: 'Failed to list quotes' })
  }
})

// ── Read one ──
router.get('/:id', requireUser, requireAccount, async (req: any, res) => {
  try {
    const q = await prisma.savedQuote.findUnique({ where: { id: req.params.id } })
    if (!q || q.accountId !== req.user.crmAccountId || q.deletedAt) {
      res.status(404).json({ success: false, error: 'Quote not found' })
      return
    }
    res.json({ success: true, data: (await withSoldBy([q]))[0] })
  } catch (err) {
    console.error('[saved-quotes] read error:', err)
    res.status(500).json({ success: false, error: 'Failed to read quote' })
  }
})

// ── The deposit its Payment Terms say (the quote window's Preview reads as the customer's link) ──
router.get('/:id/deposit-terms', requireUser, requireAccount, async (req: any, res) => {
  try {
    const q = await prisma.savedQuote.findUnique({ where: { id: req.params.id }, select: { accountId: true, deletedAt: true, proposal: true, acceptedAt: true, soldAt: true, status: true } })
    if (!q || q.accountId !== req.user.crmAccountId || q.deletedAt) {
      res.status(404).json({ success: false, error: 'Quote not found' })
      return
    }
    res.json({ success: true, data: termsDepositOf(q, await customerDollarsFrom(q.accountId), await noDepositCancellationFrom(q.accountId)) })
  } catch (err) {
    console.error('[saved-quotes] deposit terms error:', err)
    res.status(500).json({ success: false, error: 'Failed to read the deposit' })
  }
})

/**
 * What is about to be saved, held to the commission rule (lib/commissionRule.ts). `existing`: the saved quote, as a
 * save may send only some fields: the figures are the two together. The switch sent alone, with no margin, moves the margin with it.
 */
async function holdCommissionRule(accountId: string, data: any, rep: string | null | undefined, ownerId: string | null | undefined, existing: any | null): Promise<void> {
  await commissionForSave(accountId, data, rep, ownerId, existing)
  // Switch off: no commission figure stays in any copy (a move's or repair's saved work, a proposal option's copy).
  const after = { ...(existing ?? {}), ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) }
  if (!after.hasSalesman && hasCommissionFigures(after)) { const gmPct = data.gmPct; Object.assign(data, withoutCommission(after)); if (gmPct !== undefined) data.gmPct = gmPct }
  // A move took it off: said on the quote until a Salesman has it back (lib/commissionRule.ts). A save does not lose that; the switch turned on does.
  if (existing?.pricing?.commissionMovedOff === true && data.pricing && typeof data.pricing === 'object') {
    if (after.hasSalesman) { const { commissionMovedOff: _off, ...rest } = data.pricing; data.pricing = rest } else data.pricing = { ...data.pricing, commissionMovedOff: true }
  }
}

async function commissionForSave(accountId: string, data: any, rep: string | null | undefined, ownerId: string | null | undefined, existing: any | null): Promise<void> {
  if (typeof data.hasSalesman !== 'boolean') return
  const whole = { ...(existing ?? {}), ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) }
  const settings = await commissionSettings(accountId)
  if (data.hasSalesman && saveTakesCommissionOff({ salesRep: rep, ownerId, pricing: whole.pricing }, await ruleLogins(accountId), settings.mode)) {
    Object.assign(data, withoutCommission(whole))
    return
  }
  if (!existing || data.gmPct !== undefined || data.hasSalesman === !!existing.hasSalesman) return
  const added = (whole.pricing?.commissionMode ?? settings.mode) === 'added'
  if (added) { delete data.hasSalesman; return }
  Object.assign(data, data.hasSalesman ? withCommission(whole, settings.pct) : withoutCommission(whole))
}

/**
 * Would a save take this quote's commission off? What the quote builder asks before it saves, so the switch it shows
 * is what a save does. POST { quoteId?, rep? }: the rep on the quote stays, else the one given; a new quote is made by this login.
 */
router.post('/commission-rule', requireUser, requireAccount, requireCan('quotes.change'), async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const q = typeof req.body?.quoteId === 'string' ? await prisma.savedQuote.findFirst({ where: { id: req.body.quoteId, accountId, deletedAt: null }, select: { salesRep: true, ownerId: true, pricing: true } }) : null
    const rep = q?.salesRep?.trim() || (typeof req.body?.rep === 'string' ? req.body.rep : '')
    const off = saveTakesCommissionOff({ salesRep: rep, ownerId: q ? q.ownerId : req.user.id, pricing: q?.pricing }, await ruleLogins(accountId), (await commissionSettings(accountId)).mode)
    res.json({ success: true, data: { off, rep: rep.trim() } })
  } catch (err) {
    console.error('[saved-quotes] commission rule error:', err)
    res.status(500).json({ success: false, error: 'Could not check the commission.' })
  }
})

// ── Create ──
/**
 * A Salesman's or Installer's save: the costs and margin are worked out here from the quote builder's request, or
 * kept as saved. The Installer sees prices only; the Salesman sees costs but never margin, so her phone is priced by
 * the server too and sends no margin (Nov 2 2026).
 */
async function costsForLimited(req: any, existing: any | null): Promise<any> {
  if (!hidesCosts(roleOf(req)) && roleOf(req) !== 'sales_rep') return req.body
  return req.body?.priceRequest ? withServerCosts(req.user.crmAccountId, req.body, existing) : keepSavedCosts(req.body, existing, hideFor(roleOf(req)))
}

router.post('/', requireUser, requireAccount, requireCan('quotes.change'), async (req: any, res) => {
  try {
    const sameId = typeof req.body?.id === 'string' ? await prisma.savedQuote.findFirst({ where: { id: req.body.id, accountId: req.user.crmAccountId } }) : null
    const data = quoteSchema.parse(await costsForLimited(req, sameId))
    // Who sold a signed quote is that quote's: a copy of it starts with no seller (lib/soldBy.ts).
    data.pricing = withoutSaleRecord(data.pricing)
    // A proposal sent back slim (the list's copy): its saved drawing and option copies go back on (lib/quoteSlim.ts).
    if (data.proposal) data.proposal = withHeavyParts(data.proposal, sameId?.proposal ?? null)
    // Lead source and tags by Settings > Lead Sources and Customer Tags: an id or linked word kept, a name in any capital letters becomes its id, anything else as typed.
    if (typeof data.leadSource === 'string') data.leadSource = (await canonicalWord(req.user.crmAccountId, 'leadSources', data.leadSource)) ?? ''
    // Each proposal option's warranty, from Settings → Warranties now (lib/warranties.ts).
    if (data.proposal) data.proposal = await stampQuoteWarranties(req.user.crmAccountId, data.proposal, null, false) as any
    // The terms the customer reads and signs (Settings → Contract Templates) and the company's address, frozen on the proposal (lib/contractTerms.ts).
    if (data.proposal) data.proposal = await stampQuoteTerms(req.user.crmAccountId, data.proposal, null, false, { repair: workKindOf(data.work) === 'repair', walked: isWalkedNoPlan(data.layout) }) as any
    // A best price quote's own option shown as its tier, frozen now: a new proposal has not been sent (lib/ownTier.ts).
    if (data.proposal) data.proposal = await stampOwnTier(data.proposal, data.fenceStyle, null, false) as any
    // A style held now for missing costs (8 ft tall with no piece costs): no price on it is saved (lib/heldStylePrice.ts).
    // A retried create of a quote already here passes through to its existing row.
    const heldNew = sameId ? null : await heldPriceRefusal(req.user.crmAccountId, data, null)
    if (heldNew) { refuseHeldPrice(res, heldNew); return }
    const clientId = clientIdSchema.parse(req.body?.id)
    const decision = await decideClientId(clientId, req.user.crmAccountId, id => prisma.savedQuote.findUnique({ where: { id } }))
    if (decision.kind === 'exists') {
      // A retried create: the quote is already here.
      res.status(200).json({ success: true, data: decision.row })
      return
    }
    // Priced at prices the server no longer has, or a fence not available for quoting now: refused, the phone
    // reprices and asks first (broken list #58, lib/quotePriceCheck.ts). An older app's save is taken and recorded.
    const priceCheck = await checkQuotePrices(req.user.crmAccountId, req.body, data, null)
    if (priceCheck.kind === 'refuse') { refusePrices(res, priceCheck); return }
    const over = await overOptionLimit(data, null)
    if (over) { refusePrices(res, over); return }
    // A discount or typed price under the minimum job price: refused; the owner's override goes through and is recorded (lib/discountMinimum.ts).
    const minimum = await checkDiscountMinimum(req.user.crmAccountId, roleOf(req), req.body, data, null)
    if (minimum.kind === 'refuse') { refusePrices(res, minimum); return }
    const repNow = (await repForSave(req, data.salesRep)) ?? ''
    await holdCommissionRule(req.user.crmAccountId, data, repNow, req.user.id, null)
    const contactId = await ownContactId(data.crmContactId, req.user.crmAccountId)
    // The property it is for (lib/properties.ts): the one picked, or the customer's with this address.
    const place = await placeRecord(prisma, req.user.crmAccountId, contactId, { propertyId: data.propertyId, address: data.customerAddress })
    const created = await prisma.savedQuote.create({
      data: {
        ...(decision.kind === 'use' ? { id: decision.id } : {}),
        accountId: req.user.crmAccountId,
        ownerId: req.user.id,
        crmContactId: contactId,
        propertyId: place.propertyId,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail,
        customerAddress: place.address ?? data.customerAddress,
        leadSource: data.leadSource,
        // A Salesman's own quote is hers when no rep is given (lib/salesRep.ts).
        salesRep: repNow,
        fenceStyle: data.fenceStyle,
        runs: toJsonValue(data.runs),
        runRails: toNullableJson(data.runRails),
        layout: toNullableJson(data.layout),
        proposal: toNullableJson(data.proposal),
        pricing: toNullableJson(data.pricing),
        work: toNullableJson(data.work),
        corners: data.corners,
        ends: data.ends,
        walkGates: data.walkGates,
        dblGates: data.dblGates,
        tearOutSections: data.tearOutSections,
        tearOutGates: data.tearOutGates,
        adjLaborHrs: data.adjLaborHrs,
        hasSalesman: data.hasSalesman,
        priceAdjust: data.priceAdjust,
        sections: data.sections,
        materialCost: data.materialCost,
        laborCost: data.laborCost,
        tearOutCost: data.tearOutCost,
        totalCOGS: data.totalCOGS,
        finalPrice: data.finalPrice,
        gmPct: data.gmPct,
        pullSheet: toJsonValue(data.pullSheet),
        status: data.status,
        date: data.date,
        notes: data.notes,
        leadTemp: data.leadTemp,
        needsResend: data.needsResend ?? false,
      },
    })
    await audit(req, 'create', 'SavedQuote', created.id, { newValues: created })
    if (priceCheck.kind === 'unstamped') await priceCheckAudit((a, e, id, o) => audit(req, a, e, id, o), created)
    if (minimum.kind === 'override') await minimumOverrideAudit((a, e, id, o) => audit(req, a, e, id, o), created.id, minimum)
    await linkQuoteMedia(created)
    // Job costing: a quote saved as Sold is signed now; its quoted cost is saved once.
    if (created.status === 'SOLD') { await markEverSold(created.accountId, created.id); await snapshotAfterSigning(created.accountId, created.id, 'app'); await scheduleAfterSigning(created.accountId, created.id, 'sold', { userId: req.user.id ?? null, name: req.user.email ?? '' }) }
    res.status(201).json({ success: true, data: created })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    // The same quote arrived twice at once: the first one is the quote.
    if ((err as any)?.code === 'P2002' && typeof req.body?.id === 'string') {
      const row = await prisma.savedQuote.findUnique({ where: { id: req.body.id } }).catch(() => null)
      if (row && row.accountId === req.user.crmAccountId) { res.status(200).json({ success: true, data: row }); return }
    }
    console.error('[saved-quotes] create error:', err)
    res.status(500).json({ success: false, error: 'Failed to create quote' })
  }
})

// ── Update ──
router.patch('/:id', requireUser, requireAccount, requireCan('quotes.change'), async (req: any, res) => {
  try {
    const existing = await prisma.savedQuote.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.accountId !== req.user.crmAccountId || existing.deletedAt) {
      res.status(404).json({ success: false, error: 'Quote not found' })
      return
    }
    const data = quoteUpdateSchema.parse(await costsForLimited(req, existing))
    // A proposal sent back slim (the list's copy): its saved drawing and option copies go back on before
    // anything compares or saves it, so a sent quote never reprices or loses its plan (lib/quoteSlim.ts).
    if (data.proposal) data.proposal = withHeavyParts(data.proposal, existing.proposal)
    // Lead source and tags by Settings > Lead Sources and Customer Tags: an id or linked word kept, a name in any capital letters becomes its id, anything else as typed.
    if (typeof data.leadSource === 'string') data.leadSource = (await canonicalWord(req.user.crmAccountId, 'leadSources', data.leadSource)) ?? ''
    // A signed quote keeps its price: a change to it goes on a change order (lib/quoteLock.ts).
    if (await signedNow(existing)) {
      // Who sold it and the owner's hand edit stay as saved, whatever copy this save read (lib/soldBy.ts).
      keepSaleRecord(existing, data)
      const fields = lockedChanges(existing, data)
      if (fields.length) { refuseLocked(res, fields, existing); return }
    } else data.pricing = withoutSaleRecord(data.pricing)
    // A sent (or lost) quote goes back to Draft only when Draft was picked on it (backToDraft): a save from a copy
    // read before it was sent (the quote builder opened on the phone's older copy) keeps it as it is (#58 review).
    if (data.status === 'DRAFT' && (existing.status === 'SENT' || existing.status === 'LOST') && req.body?.backToDraft !== true) delete data.status
    // An unsent quote repriced at prices the server no longer has, or put on a fence not available for quoting
    // now: refused, the phone reprices and asks first (broken list #58). Sent and signed quotes are not checked.
    const priceCheck = await checkQuotePrices(req.user.crmAccountId, req.body, data, existing)
    if (priceCheck.kind === 'refuse') { refusePrices(res, priceCheck); return }
    // Never adds options past the limit; a proposal that already has more keeps them or comes down (lib/quotePriceCheck.ts).
    const over = (await signedNow(existing)) ? null : await overOptionLimit(data, existing)
    if (over) { refusePrices(res, over); return }
    // Two people on one quote: a save built on options another save has since changed is refused, nothing lost (lib/quotePriceCheck.ts).
    const stale = await quoteChangedSince(req.body, data, existing)
    if (stale) { refusePrices(res, stale); return }
    // Each proposal option's warranty: a sent or signed proposal keeps the words it went out with (lib/warranties.ts).
    if (data.proposal) data.proposal = await stampQuoteWarranties(existing.accountId, data.proposal, existing, existing.status !== 'DRAFT' || await signedNow(existing)) as any
    // Its terms and the company's address: a sent or signed proposal keeps the ones it went out with (lib/contractTerms.ts).
    if (data.proposal) data.proposal = await stampQuoteTerms(existing.accountId, data.proposal, existing, existing.status !== 'DRAFT' || await signedNow(existing), { repair: workKindOf(data.work === undefined ? existing.work : data.work) === 'repair', walked: isWalkedNoPlan(data.layout === undefined ? existing.layout : data.layout) }) as any
    // A best price quote's own option shown as its tier: a sent proposal keeps the cards and prices it went out with;
    // a draft saved before folding was frozen is frozen as it showed when it is sent now (lib/ownTier.ts).
    const sentBefore = proposalSent(existing) || await signedNow(existing)
    if (data.proposal) data.proposal = await stampOwnTier(data.proposal, data.fenceStyle ?? existing.fenceStyle, existing.proposal, sentBefore) as any
    else if (!sentBefore && data.status && data.status !== 'DRAFT' && existing.proposal && (existing.proposal as any).ownTier === undefined) data.proposal = await stampOwnTier(existing.proposal, existing.fenceStyle, null, false) as any
    // A sent or shared proposal never reprices unless the office chose it ("Save new version (send it again)",
    // which sends needsResend). Any other save that would change a price or fence the customer reads (an old
    // browser, a queued save) keeps the sent prices: the quote as saved, with only its words and details changed.
    let keptSentPrices: Array<{ name: string; wasCents: number | null; nowCents: number | null }> = []
    if (data.proposal && existing.proposal && data.needsResend !== true && (sentBefore || !!existing.shareToken) && !(await signedNow(existing))) {
      const m = await pricingModule()
      const changes = m.proposalPriceChanges(existing.proposal, existing, data.proposal, { ...existing, ...data }, await styleRecords())
      if (changes.length) {
        const kept = keepPrices(existing as any, data as any) as any
        for (const k of Object.keys(data)) if (k !== 'crmContactId' && k !== 'leadSource' && k !== 'salesRep') (data as any)[k] = kept[k]
        keptSentPrices = changes
      }
    }
    // A discount or typed price under the minimum job price, on the prices this save really writes: refused; the owner's
    // override goes through and is recorded. A signed quote's prices stand (lib/discountMinimum.ts).
    const minimum = (await signedNow(existing)) ? { kind: 'ok' as const } : await checkDiscountMinimum(existing.accountId, roleOf(req), req.body, data, existing)
    if (minimum.kind === 'refuse') { refusePrices(res, minimum); return }
    // A link is out and this save would put a hand picked style on it that the customer would read wrong: not saved (optionBlocks; share-token stops a new link).
    if (data.proposal && existing.shareToken && !(await signedNow(existing))) {
      const blocks = (await pricingModule()).optionBlocks(data.proposal as any) as string[]
      if (blocks.length) { res.status(409).json({ success: false, code: 'OPTION_NOT_READY', error: `This proposal is on the customer's link, so this cannot be saved yet. ${blocks.join(' ')}`, blocks }); return }
    }
    // A style held now for missing costs: a save that would change the price is refused, drafts too; the saved
    // price with only words changed goes through (lib/heldStylePrice.ts; review Oct 29 2026, $5,050 → $698).
    const held = await heldPriceRefusal(existing.accountId, data, existing)
    if (held) { refuseHeldPrice(res, held); return }
    // A quote's Salesman, once on it, changes only by the owner (Jonathan, Oct 29 2026: the quote's Salesman control,
    // lib/salesmanMove.ts, and the customer's Salesman, which brings the open quotes along: lib/quotesFollowCustomer.ts).
    // No screen's save changes it: a save sending another name is a copy read before the change (or the quote
    // builder sending its customer's Salesman), so the rest is saved and the Salesman on the quote stays, whoever
    // saves. An unsold quote given to another customer takes that customer's Salesman (D3), read here, not sent.
    if (data.salesRep?.trim() && existing.salesRep?.trim() && !samePerson(data.salesRep, existing.salesRep)) {
      const toOther = !!data.crmContactId && data.crmContactId !== existing.crmContactId
      const customer = toOther && !(await signedNow(existing)) && !(await prisma.savedJob.findFirst({ where: { accountId: existing.accountId, quoteId: existing.id }, select: { id: true } }))
        ? await prisma.crmContact.findFirst({ where: { id: data.crmContactId!, accountId: existing.accountId, deletedAt: null }, select: { salesRep: true } })
        : null
      data.salesRep = customer?.salesRep?.trim() || existing.salesRep
    }
    // A signed quote keeps its switch (only a logged fix changes it).
    const repNow = data.salesRep?.trim() ? data.salesRep : existing.salesRep?.trim() ? existing.salesRep : await repForSave(req, data.salesRep, existing.ownerId ?? null)
    if (!(await signedNow(existing))) await holdCommissionRule(existing.accountId, data, repNow, existing.ownerId, existing)
    const contactNow = data.crmContactId === undefined ? undefined : await ownContactId(data.crmContactId, req.user.crmAccountId)
    // Its property (lib/properties.ts): a signed quote keeps the one it was signed for.
    const place = (await signedNow(existing)) || (data.propertyId === undefined && data.customerAddress === undefined && contactNow === undefined)
      ? null
      : await placeRecord(prisma, existing.accountId, contactNow === undefined ? existing.crmContactId : contactNow, { propertyId: data.propertyId === undefined ? (contactNow === undefined || contactNow === existing.crmContactId ? existing.propertyId : null) : data.propertyId, address: data.customerAddress ?? existing.customerAddress })
    const updated = await prisma.savedQuote.update({
      // Signed on the link since this save read the quote: it stands (routes/proposal.ts acceptQuote locks the row).
      where: { id: existing.id, ...(existing.acceptedAt ? {} : { acceptedAt: null }) },
      data: {
        crmContactId: contactNow,
        ...(place ? { propertyId: place.propertyId } : {}),
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail,
        customerAddress: place?.address ?? data.customerAddress,
        leadSource: data.leadSource,
        // A rep already on the quote stays when a blank one is sent (a phone's older copy); a Salesman's own quote with none is hers (lib/salesRep.ts).
        salesRep: data.salesRep?.trim() ? data.salesRep : existing.salesRep?.trim() ? undefined : repNow,
        fenceStyle: data.fenceStyle,
        runs: toJsonValue(data.runs),
        runRails: toNullableJson(data.runRails),
        layout: toNullableJson(keepWidgetDrawing(data.layout, existing.layout)),
        proposal: toNullableJson(data.proposal),
        pricing: toNullableJson(data.pricing),
        work: toNullableJson(data.work),
        corners: data.corners,
        ends: data.ends,
        walkGates: data.walkGates,
        dblGates: data.dblGates,
        tearOutSections: data.tearOutSections,
        tearOutGates: data.tearOutGates,
        adjLaborHrs: data.adjLaborHrs,
        hasSalesman: data.hasSalesman,
        priceAdjust: data.priceAdjust,
        sections: data.sections,
        materialCost: data.materialCost,
        laborCost: data.laborCost,
        tearOutCost: data.tearOutCost,
        totalCOGS: data.totalCOGS,
        finalPrice: data.finalPrice,
        gmPct: data.gmPct,
        pullSheet: toJsonValue(data.pullSheet),
        status: data.status,
        date: data.date,
        notes: data.notes,
        leadTemp: data.leadTemp,
        needsResend: data.needsResend,
      },
    })
    await audit(req, 'update', 'SavedQuote', updated.id, { oldValues: existing, newValues: updated })
    if (priceCheck.kind === 'unstamped') await priceCheckAudit((a, e, id, o) => audit(req, a, e, id, o), updated)
    if (minimum.kind === 'override') await minimumOverrideAudit((a, e, id, o) => audit(req, a, e, id, o), updated.id, minimum)
    await linkQuoteMedia(updated)
    // Moved to another customer: the first one keeps the property only when it was already theirs (lib/properties.ts).
    if (existing.crmContactId && updated.crmContactId !== existing.crmContactId && existing.propertyId && updated.propertyId !== existing.propertyId) {
      if (await dropMovedQuoteProperty(prisma, existing.accountId, existing.propertyId, existing)) console.log(`[saved-quotes] quote ${existing.id} moved customers: took off the property its saves made for the first customer`)
    }
    // Job costing: marked Sold (signed in person) now; its quoted cost is saved once. A quote already Sold keeps the one from its signing.
    if (updated.status === 'SOLD' && !updated.soldAt) await markEverSold(updated.accountId, updated.id)
    if (existing.status !== 'SOLD' && updated.status === 'SOLD') await snapshotAfterSigning(updated.accountId, updated.id, 'app')
    // Sold with no rep: the person who sold it is credited, whatever their role (Oct 25 2026: an owner's sale read "Sales Rep —").
    if (existing.status !== 'SOLD' && updated.status === 'SOLD' && !updated.salesRep?.trim()) {
      const u = await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } }).catch(() => null)
      const rep = u ? repName(u) : ''
      if (rep) {
        await prisma.savedQuote.update({ where: { id: updated.id }, data: { salesRep: rep } })
        await prisma.savedJob.updateMany({ where: { accountId: updated.accountId, quoteId: updated.id, salesRep: '' }, data: { salesRep: rep } })
        ;(updated as any).salesRep = rep
      }
    }
    // Its job's payment schedule, when the job is there already (lib/contractBilling.ts; otherwise made with the job).
    if (updated.status === 'SOLD') await scheduleAfterSigning(updated.accountId, updated.id, 'sold', { userId: req.user.id ?? null, name: req.user.email ?? '' })
    res.json({ success: true, data: updated.status === 'SOLD' && !updated.soldAt ? await prisma.savedQuote.findUnique({ where: { id: updated.id } }) : updated, ...(keptSentPrices.length ? { keptSentPrices } : {}) })
  } catch (err) {
    // Signed on the customer's link while this save was on its way: the signature stands.
    if ((err as any)?.code === 'P2025') { res.status(409).json({ success: false, code: LOCKED_CODE, error: lockMessage(['proposal']) }); return }
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[saved-quotes] update error:', err)
    res.status(500).json({ success: false, error: 'Failed to update quote' })
  }
})

// ── The quote's Salesman: the owner only, a signed one after asking (lib/salesmanMove.ts) ──
router.post('/:id/salesman', requireUser, requireAccount, salesmanMoveRoute('quote'))

// ── Who gets a signed job's commission and how much: the owner only, by hand (lib/soldBy.ts) ──
router.get('/:id/commission', requireUser, requireAccount, commissionRead)
router.post('/:id/commission', requireUser, requireAccount, commissionEdit)

// ── Delete (soft, owner and admin) ──
// With everything that hangs off it, in one transaction, logged in Settings >
// Deleted Records with a snapshot to restore from (lib/deletion.ts).
const actorOf = (req: any) => ({ accountId: req.user.crmAccountId as string, userId: (req.user.id ?? null) as string | null })
router.delete('/:id', requireUser, requireAccount, requireCan('records.delete'), async (req: any, res) => {
  try {
    const r = await deleteRecord(actorOf(req), 'quote', String(req.params.id), typeof req.body?.reason === 'string' ? req.body.reason : null)
    await audit(req, 'soft_delete', 'SavedQuote', String(req.params.id), { newValues: r })
    res.json({ success: true, data: r })
  } catch (err) {
    if (err instanceof DeleteError) { res.status(err.status).json({ success: false, error: err.status === 404 ? 'Quote not found' : err.message }); return }
    console.error('[saved-quotes] delete error:', err)
    res.status(500).json({ success: false, error: 'Failed to delete quote' })
  }
})

// ── Bulk sync (one-time migration helper) ──
//
// Accepts an array of localStorage-shaped quotes. Matches by client id when
// present (so reruns are idempotent for the same browser); otherwise creates
// a new server row. crmContactId is preserved if it points at a contact in
// the caller's account; cleared otherwise so legacy uid customers don't link
// to nothing.
/**
 * A quote from the website quote keeps the customer's own drawing
 * (layout.widgetDrawing) as they drew it: the quote builder's saves carry only
 * its yard and run sections, so the drawing is put back from the saved quote.
 */
function keepWidgetDrawing(next: unknown, saved: unknown): unknown {
  const kept = saved && typeof saved === 'object' ? (saved as { widgetDrawing?: unknown }).widgetDrawing : undefined
  if (kept === undefined || next === undefined) return next
  // Switched to the run list (no yard): the customer's drawing still stays.
  if (next === null || typeof next !== 'object') return { yard: null, runSections: [], widgetDrawing: kept }
  return { ...(next as object), widgetDrawing: kept }
}

const syncSchema = z.object({
  quotes: z.array(quoteSchema.extend({ id: z.string().optional() })),
})

router.post('/sync', requireUser, requireAccount, requireCan('records.import'), async (req: any, res) => {
  try {
    const { quotes } = syncSchema.parse(req.body)
    let created = 0, updated = 0, skipped = 0, locked = 0, underMinimum = 0
    // The owner's import takes what it is given; any other login's is held to the minimum job price (lib/discountMinimum.ts).
    const minimumBody = { minimumOverride: can(roleOf(req), 'quotes.underMinimum') }
    for (const q of quotes) {
      // If client supplied an id and we already have a row with it under the
      // same account, treat as update.
      if (q.id) {
        const existing = await prisma.savedQuote.findUnique({ where: { id: q.id } })
        if (existing && existing.accountId === req.user.crmAccountId) {
          // A signed quote is not rewritten from an old browser copy.
          if (await signedNow(existing) && lockedChanges(existing, q).length) { locked++; continue }
          const minimum = (await signedNow(existing)) ? { kind: 'ok' as const } : await checkDiscountMinimum(req.user.crmAccountId, roleOf(req), minimumBody, q, existing)
          if (minimum.kind === 'refuse') { underMinimum++; continue }
          await prisma.savedQuote.update({
            where: { id: existing.id },
            data: {
              ...quoteSchema.partial().parse(q),
              // The Salesman on the quote stays: only the owner changes it (lib/salesmanMove.ts), never an old browser copy.
              ...(existing.salesRep?.trim() ? { salesRep: existing.salesRep } : {}),
              runs: toJsonValue(q.runs),
              runRails: toNullableJson(q.runRails),
              layout: toNullableJson(keepWidgetDrawing(q.layout, existing.layout)),
              proposal: toNullableJson(q.proposal),
              pricing: toNullableJson(q.pricing),
              work: toNullableJson(q.work),
              pullSheet: toJsonValue(q.pullSheet),
            },
          })
          if (minimum.kind === 'override') await minimumOverrideAudit((a, e, id, o) => audit(req, a, e, id, o), existing.id, minimum)
          await markEverSold(existing.accountId, existing.id)
          updated++
          continue
        }
      }

      // Validate the contact link is in our account; otherwise null it out.
      let safeContactId: string | null = null
      if (q.crmContactId) {
        const c = await prisma.crmContact.findUnique({ where: { id: q.crmContactId } })
        if (c && c.accountId === req.user.crmAccountId) safeContactId = c.id
      }

      const minimum = await checkDiscountMinimum(req.user.crmAccountId, roleOf(req), minimumBody, q, null)
      if (minimum.kind === 'refuse') { underMinimum++; continue }
      q.pricing = withoutSaleRecord(q.pricing)
      await holdCommissionRule(req.user.crmAccountId, q, q.salesRep, req.user.id, null)
      try {
        const made = await prisma.savedQuote.create({
          data: {
            accountId: req.user.crmAccountId,
            ownerId: req.user.id,
            crmContactId: safeContactId,
            propertyId: (await placeRecord(prisma, req.user.crmAccountId, safeContactId, { address: q.customerAddress })).propertyId,
            customerName: q.customerName,
            customerPhone: q.customerPhone,
            customerEmail: q.customerEmail,
            customerAddress: q.customerAddress,
            leadSource: q.leadSource,
            salesRep: q.salesRep,
            fenceStyle: q.fenceStyle,
            runs: toJsonValue(q.runs),
            runRails: toNullableJson(q.runRails),
              layout: toNullableJson(q.layout),
              proposal: toNullableJson(q.proposal),
            pricing: toNullableJson(q.pricing),
            work: toNullableJson(q.work),
            corners: q.corners,
            ends: q.ends,
            walkGates: q.walkGates,
            dblGates: q.dblGates,
            tearOutSections: q.tearOutSections,
            tearOutGates: q.tearOutGates,
            adjLaborHrs: q.adjLaborHrs,
            hasSalesman: q.hasSalesman,
            priceAdjust: q.priceAdjust,
            sections: q.sections,
            materialCost: q.materialCost,
            laborCost: q.laborCost,
            tearOutCost: q.tearOutCost,
            totalCOGS: q.totalCOGS,
            finalPrice: q.finalPrice,
            gmPct: q.gmPct,
            pullSheet: toJsonValue(q.pullSheet),
            status: q.status,
            ...(q.status === 'SOLD' ? { soldAt: new Date() } : {}),
            date: q.date,
            notes: q.notes,
            leadTemp: q.leadTemp,
          },
        })
        if (minimum.kind === 'override') await minimumOverrideAudit((a, e, id, o) => audit(req, a, e, id, o), made.id, minimum)
        created++
      } catch {
        skipped++
      }
    }
    console.log(`[saved-quotes] sync: ${created} created, ${updated} updated, ${skipped} skipped, ${locked} signed (kept), ${underMinimum} under the minimum for account ${req.user.crmAccountId}`)
    res.json({ success: true, data: { created, updated, skipped, locked, underMinimum, total: quotes.length } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[saved-quotes] sync error:', err)
    res.status(500).json({ success: false, error: 'Failed to sync quotes' })
  }
})

// ── Issue / reissue a public share token ──
router.post('/:id/share-token', requireUser, requireAccount, requireCan('quotes.change'), async (req: any, res) => {
  try {
    const existing = await prisma.savedQuote.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.accountId !== req.user.crmAccountId || existing.deletedAt) {
      res.status(404).json({ success: false, error: 'Quote not found' })
      return
    }
    // A style picked by hand that the customer would read wrong (no warranty, parts left out) is not sent (web/src/proposal.ts optionBlocks).
    const blocks = (await pricingModule()).optionBlocks(existing.proposal as any) as string[]
    if (blocks.length) { res.status(409).json({ success: false, code: 'OPTION_NOT_READY', error: `This proposal cannot be sent yet. ${blocks.join(' ')}`, blocks }); return }
    // A link already sent keeps working until it runs out or is turned off;
    // after that (or with ?new=1) a new link is made.
    const open = existing.shareToken && !existing.shareDisabledAt && !(existing.shareExpiresAt && existing.shareExpiresAt.getTime() < Date.now())
    // preview: a short-lived signed mark the app adds when staff open the link themselves, so the open is a
    // "Staff view" and never counted (lib/proposalViews.ts).
    if (open && req.query.new !== '1') { res.json({ success: true, data: { shareToken: existing.shareToken, quoteId: existing.id, expiresAt: existing.shareExpiresAt, preview: makePreviewToken(req.user.id, existing.id) } }); return }
    const b = await prisma.businessState.findUnique({ where: { accountId: existing.accountId }, select: { config: true } }).catch(() => null)
    const days = Number((b?.config as any)?.proposal?.linkDays) > 0 ? Number((b?.config as any).proposal.linkDays) : 30
    const expiresAt = new Date(Date.now() + days * 86_400_000)
    const token = crypto.randomBytes(24).toString('base64url')
    const updated = await prisma.savedQuote.update({
      where: { id: existing.id },
      data: { shareToken: token, firstViewedAt: null, shareExpiresAt: expiresAt, shareDisabledAt: null },
    })
    await audit(req, 'update', 'SavedQuote', updated.id, { newValues: { shareToken: token } })
    res.json({ success: true, data: { shareToken: token, quoteId: existing.id, expiresAt, preview: makePreviewToken(req.user.id, existing.id) } })
  } catch (err) {
    console.error('[saved-quotes] share-token error:', err)
    res.status(500).json({ success: false, error: 'Failed to issue share token' })
  }
})

// ── Turn a customer link off ──
router.post('/:id/share-off', requireUser, requireAccount, requireCan('quotes.change'), async (req: any, res) => {
  const existing = await prisma.savedQuote.findUnique({ where: { id: req.params.id } })
  if (!existing || existing.accountId !== req.user.crmAccountId) { res.status(404).json({ success: false, error: 'Quote not found' }); return }
  const updated = await prisma.savedQuote.update({ where: { id: existing.id }, data: { shareDisabledAt: new Date() } })
  await audit(req, 'update', 'SavedQuote', updated.id, { newValues: { shareDisabledAt: updated.shareDisabledAt } })
  res.json({ success: true, data: { shareDisabledAt: updated.shareDisabledAt } })
})

// ── Public read by share token (no auth) ──
//
// Records `firstViewedAt` the first time a token is hit and increments
// viewCount on every request so the staff side can surface a "viewed" badge
// and view counter, plus fire the quote_first_viewed automation later.
router.get('/share/:token', async (req: any, res) => {
  try {
    const q = await prisma.savedQuote.findUnique({ where: { shareToken: req.params.token } })
    if (!q || q.archivedAt || q.deletedAt) {
      res.status(404).json({ success: false, error: 'Quote not found or no longer available' })
      return
    }
    if (q.shareDisabledAt || (q.shareExpiresAt && q.shareExpiresAt.getTime() < Date.now())) {
      res.status(410).json({ success: false, error: 'This link is no longer active. Please call us for a current quote.' })
      return
    }
    await prisma.savedQuote.update({
      where: { id: q.id },
      data: {
        firstViewedAt: q.firstViewedAt || new Date(),
        viewCount: { increment: 1 },
      },
    })
    res.json({ success: true, data: await shownToCustomer(q) })
  } catch (err) {
    console.error('[saved-quotes] share read error:', err)
    res.status(500).json({ success: false, error: 'Failed to read quote' })
  }
})

/** What a customer's browser gets: the quote without costs, margin, the
 *  pull sheet or the internal pricing choices. */
function forCustomer<T extends Record<string, any>>(q: T) {
  const { materialCost, laborCost, tearOutCost, totalCOGS, gmPct, pullSheet, pricing, ownerId, adjLaborHrs, work, acceptedIp, acceptedUserAgent, ...rest } = q
  void materialCost; void laborCost; void tearOutCost; void totalCOGS; void gmPct; void pullSheet; void pricing; void ownerId; void adjLaborHrs; void acceptedIp; void acceptedUserAgent
  const proposal = customerProposal(rest.proposal)
  // A move or repair: only what kind of job it is (its cost lines stay inside).
  const jobType = work && typeof work === 'object' && typeof (work as any).type === 'string' ? (work as any).type : null
  return { ...rest, proposal, materialCost: 0, laborCost: 0, tearOutCost: 0, totalCOGS: 0, gmPct: 0, pullSheet: [], pricing: null, adjLaborHrs: 0, work: jobType ? { type: jobType } : null }
}

/** The customer's copy and the deposit its Payment Terms say (lib/contractBilling.ts termsDepositOf), as the proposal link says it. */
async function shownToCustomer<T extends Record<string, any> & { accountId: string; proposal: unknown }>(q: T) {
  return { ...forCustomer(q), depositTerms: termsDepositOf(q, await customerDollarsFrom(q.accountId), await noDepositCancellationFrom(q.accountId)) }
}

// ── Public accept by share token (no auth) ──
//
// Customer-facing endpoint: the customer signs and clicks Accept on the
// public share page. Flips status to SOLD, stamps acceptedAt + name + (optional)
// signature data URL. Idempotent — accepting a quote that is already SOLD
// returns success but does not double-write.
const acceptSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  signature: z.string().max(1_000_000).optional(),
  /** The fence and price the page showed (lib/optionSeen.ts). */
  seen: z.string().max(400).optional(),
})
router.post('/share/:token/accept', async (req: any, res) => {
  try {
    const data = acceptSchema.parse(req.body)
    const q = await prisma.savedQuote.findUnique({ where: { shareToken: req.params.token } })
    if (!q || q.archivedAt || q.deletedAt) {
      res.status(404).json({ success: false, error: 'Quote not found or no longer available' })
      return
    }
    if (q.acceptedAt) {
      res.json({ success: true, data: await shownToCustomer(q) })
      return
    }
    // The quote changed while the page was open: nothing is signed, the page reloads (as the proposal link).
    const seenNow = optionSeen(q)
    if ((data.seen !== undefined || Array.isArray((q.proposal as any)?.options)) && data.seen !== seenNow) {
      res.status(409).json({ success: false, changed: true, error: 'This quote was updated while the page was open, so nothing was signed. Please look it over and accept again.' })
      return
    }
    // Only while still unaccepted: two taps at once are one acceptance (the first name and signature stand).
    await prisma.savedQuote.updateMany({
      where: { id: q.id, acceptedAt: null, fenceStyle: q.fenceStyle, finalPrice: q.finalPrice },
      data: {
        status: 'SOLD',
        acceptedAt: new Date(),
        acceptedBy: data.name,
        acceptedSignature: data.signature || null,
        // Where it was signed from (lib/signedDocuments.ts): the client's IP (trust proxy 1) and browser.
        acceptedIp: plainIp(clientIpOf(req)),
        acceptedUserAgent: String(req.headers['user-agent'] ?? '').slice(0, 500) || null,
      },
    })
    await markEverSold(q.accountId, q.id)
    const updated = (await prisma.savedQuote.findUnique({ where: { id: q.id } }))!
    console.log(`[saved-quotes] customer accepted quote ${q.id} as "${data.name}"`)
    // Job costing: the quoted cost, saved once at signing.
    await snapshotAfterSigning(updated.accountId, updated.id, 'share')
    await scheduleAfterSigning(updated.accountId, updated.id, 'accepted', { userId: null, name: `${data.name} (customer, quote link)` })
    // The signed contract, stored once (when the quote has a proposal to build it from).
    await fileSignedContract(updated.id).catch(err => console.error('[saved-quotes] signed contract file:', err))
    res.json({ success: true, data: await shownToCustomer(updated) })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[saved-quotes] accept error:', err)
    res.status(500).json({ success: false, error: 'Failed to accept quote' })
  }
})

export default router
