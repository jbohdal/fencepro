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
 *   POST   /:id/share-token   — issue (or reissue) a public share token
 *   GET    /share/:token      — PUBLIC: fetch a single quote by share token
 *                              (records the firstViewedAt the first time it is hit)
 */

import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/auditLog.js'

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || 'dev-crm-jwt-secret-change-me'

async function requireUser(req: any, res: any, next: any) {
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

function requireAccount(req: any, res: any, next: any) {
  if (!req.user?.crmAccountId) {
    res.status(403).json({ success: false, error: 'Your user is not linked to a company; ask an admin to assign you to one.' })
    return
  }
  next()
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
  leadSource: z.string().default(''),
  salesRep: z.string().default(''),
  fenceStyle: z.string().default(''),
  runs: z.array(z.number()).default([]),
  runRails: z.array(z.enum(['auto', '6ft', '8ft'])).optional().nullable(),
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
})

const quoteUpdateSchema = quoteSchema.partial()

function toJsonValue(value: unknown): any {
  return value === undefined ? undefined : (value === null ? null : JSON.parse(JSON.stringify(value)))
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
    const quotes = await prisma.savedQuote.findMany({
      where: { accountId: req.user.crmAccountId, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
    })
    res.json({ success: true, data: quotes })
  } catch (err) {
    console.error('[saved-quotes] list error:', err)
    res.status(500).json({ success: false, error: 'Failed to list quotes' })
  }
})

// ── Read one ──
router.get('/:id', requireUser, requireAccount, async (req: any, res) => {
  try {
    const q = await prisma.savedQuote.findUnique({ where: { id: req.params.id } })
    if (!q || q.accountId !== req.user.crmAccountId || q.archivedAt) {
      res.status(404).json({ success: false, error: 'Quote not found' })
      return
    }
    res.json({ success: true, data: q })
  } catch (err) {
    console.error('[saved-quotes] read error:', err)
    res.status(500).json({ success: false, error: 'Failed to read quote' })
  }
})

// ── Create ──
router.post('/', requireUser, requireAccount, async (req: any, res) => {
  try {
    const data = quoteSchema.parse(req.body)
    const created = await prisma.savedQuote.create({
      data: {
        accountId: req.user.crmAccountId,
        ownerId: req.user.id,
        crmContactId: data.crmContactId || undefined,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail,
        customerAddress: data.customerAddress,
        leadSource: data.leadSource,
        salesRep: data.salesRep,
        fenceStyle: data.fenceStyle,
        runs: toJsonValue(data.runs),
        runRails: toNullableJson(data.runRails),
        pricing: toNullableJson(data.pricing),
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
      },
    })
    await audit(req, 'create', 'SavedQuote', created.id, { newValues: created })
    res.status(201).json({ success: true, data: created })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[saved-quotes] create error:', err)
    res.status(500).json({ success: false, error: 'Failed to create quote' })
  }
})

// ── Update ──
router.patch('/:id', requireUser, requireAccount, async (req: any, res) => {
  try {
    const data = quoteUpdateSchema.parse(req.body)
    const existing = await prisma.savedQuote.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.accountId !== req.user.crmAccountId || existing.archivedAt) {
      res.status(404).json({ success: false, error: 'Quote not found' })
      return
    }
    const updated = await prisma.savedQuote.update({
      where: { id: existing.id },
      data: {
        crmContactId: data.crmContactId === undefined ? undefined : (data.crmContactId || null),
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail,
        customerAddress: data.customerAddress,
        leadSource: data.leadSource,
        salesRep: data.salesRep,
        fenceStyle: data.fenceStyle,
        runs: toJsonValue(data.runs),
        runRails: toNullableJson(data.runRails),
        pricing: toNullableJson(data.pricing),
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
      },
    })
    await audit(req, 'update', 'SavedQuote', updated.id, { oldValues: existing, newValues: updated })
    res.json({ success: true, data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[saved-quotes] update error:', err)
    res.status(500).json({ success: false, error: 'Failed to update quote' })
  }
})

// ── Delete (soft) ──
router.delete('/:id', requireUser, requireAccount, async (req: any, res) => {
  try {
    const existing = await prisma.savedQuote.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.accountId !== req.user.crmAccountId || existing.archivedAt) {
      res.status(404).json({ success: false, error: 'Quote not found' })
      return
    }
    await prisma.savedQuote.update({ where: { id: existing.id }, data: { archivedAt: new Date() } })
    await audit(req, 'soft_delete', 'SavedQuote', existing.id, { oldValues: existing })
    res.json({ success: true })
  } catch (err) {
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
const syncSchema = z.object({
  quotes: z.array(quoteSchema.extend({ id: z.string().optional() })),
})

router.post('/sync', requireUser, requireAccount, async (req: any, res) => {
  try {
    const { quotes } = syncSchema.parse(req.body)
    let created = 0, updated = 0, skipped = 0
    for (const q of quotes) {
      // If client supplied an id and we already have a row with it under the
      // same account, treat as update.
      if (q.id) {
        const existing = await prisma.savedQuote.findUnique({ where: { id: q.id } })
        if (existing && existing.accountId === req.user.crmAccountId) {
          await prisma.savedQuote.update({
            where: { id: existing.id },
            data: {
              ...quoteSchema.partial().parse(q),
              runs: toJsonValue(q.runs),
              runRails: toNullableJson(q.runRails),
              pricing: toNullableJson(q.pricing),
              pullSheet: toJsonValue(q.pullSheet),
            },
          })
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

      try {
        await prisma.savedQuote.create({
          data: {
            accountId: req.user.crmAccountId,
            ownerId: req.user.id,
            crmContactId: safeContactId,
            customerName: q.customerName,
            customerPhone: q.customerPhone,
            customerEmail: q.customerEmail,
            customerAddress: q.customerAddress,
            leadSource: q.leadSource,
            salesRep: q.salesRep,
            fenceStyle: q.fenceStyle,
            runs: toJsonValue(q.runs),
            runRails: toNullableJson(q.runRails),
            pricing: toNullableJson(q.pricing),
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
            date: q.date,
            notes: q.notes,
            leadTemp: q.leadTemp,
          },
        })
        created++
      } catch {
        skipped++
      }
    }
    console.log(`[saved-quotes] sync: ${created} created, ${updated} updated, ${skipped} skipped for account ${req.user.crmAccountId}`)
    res.json({ success: true, data: { created, updated, skipped, total: quotes.length } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[saved-quotes] sync error:', err)
    res.status(500).json({ success: false, error: 'Failed to sync quotes' })
  }
})

// ── Issue / reissue a public share token ──
router.post('/:id/share-token', requireUser, requireAccount, async (req: any, res) => {
  try {
    const existing = await prisma.savedQuote.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.accountId !== req.user.crmAccountId || existing.archivedAt) {
      res.status(404).json({ success: false, error: 'Quote not found' })
      return
    }
    const token = crypto.randomBytes(24).toString('base64url')
    const updated = await prisma.savedQuote.update({
      where: { id: existing.id },
      data: { shareToken: token, firstViewedAt: null },
    })
    await audit(req, 'update', 'SavedQuote', updated.id, { newValues: { shareToken: token } })
    res.json({ success: true, data: { shareToken: token, quoteId: existing.id } })
  } catch (err) {
    console.error('[saved-quotes] share-token error:', err)
    res.status(500).json({ success: false, error: 'Failed to issue share token' })
  }
})

// ── Public read by share token (no auth) ──
//
// Records `firstViewedAt` the first time a token is hit and increments
// viewCount on every request so the staff side can surface a "viewed" badge
// and view counter, plus fire the quote_first_viewed automation later.
router.get('/share/:token', async (req: any, res) => {
  try {
    const q = await prisma.savedQuote.findUnique({ where: { shareToken: req.params.token } })
    if (!q || q.archivedAt) {
      res.status(404).json({ success: false, error: 'Quote not found or no longer available' })
      return
    }
    await prisma.savedQuote.update({
      where: { id: q.id },
      data: {
        firstViewedAt: q.firstViewedAt || new Date(),
        viewCount: { increment: 1 },
      },
    })
    res.json({ success: true, data: q })
  } catch (err) {
    console.error('[saved-quotes] share read error:', err)
    res.status(500).json({ success: false, error: 'Failed to read quote' })
  }
})

// ── Public accept by share token (no auth) ──
//
// Customer-facing endpoint: the customer signs and clicks Accept on the
// public share page. Flips status to SOLD, stamps acceptedAt + name + (optional)
// signature data URL. Idempotent — accepting a quote that is already SOLD
// returns success but does not double-write.
const acceptSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  signature: z.string().max(1_000_000).optional(),
})
router.post('/share/:token/accept', async (req: any, res) => {
  try {
    const data = acceptSchema.parse(req.body)
    const q = await prisma.savedQuote.findUnique({ where: { shareToken: req.params.token } })
    if (!q || q.archivedAt) {
      res.status(404).json({ success: false, error: 'Quote not found or no longer available' })
      return
    }
    if (q.acceptedAt) {
      res.json({ success: true, data: q })
      return
    }
    const updated = await prisma.savedQuote.update({
      where: { id: q.id },
      data: {
        status: 'SOLD',
        acceptedAt: new Date(),
        acceptedBy: data.name,
        acceptedSignature: data.signature || null,
      },
    })
    console.log(`[saved-quotes] customer accepted quote ${q.id} as "${data.name}"`)
    res.json({ success: true, data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[saved-quotes] accept error:', err)
    res.status(500).json({ success: false, error: 'Failed to accept quote' })
  }
})

export default router
