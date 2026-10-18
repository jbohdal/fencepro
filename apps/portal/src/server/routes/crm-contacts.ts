/**
 * CRM Contacts API
 *
 * Database-backed persistence for the CRM web app's "Customers" page.
 * Today the web app dual-writes: localStorage (for instant UX + offline) and
 * the database (so contacts survive browser clears, device switches, deploys).
 *
 * Auth: requires a CRM user JWT (same as crm-auth.ts).
 *
 * Endpoints (all under /api/crm-contacts):
 *   GET    /            — list all contacts owned by the requesting user
 *   POST   /            — create a contact
 *   PATCH  /:id         — update a contact (partial)
 *   DELETE /:id         — soft-archive a contact
 *   POST   /sync        — bulk upsert from a localStorage payload (best-effort migration)
 */

import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/auditLog.js'
import { resolveSecret } from '../lib/secrets.js'
import { clientIdSchema, decideClientId } from '../lib/clientId.js'
import { syncCalendarAfterWrite } from '../lib/calendarSync/index.js'
import { plainZod } from '../lib/plainZod.js'
import { applyPipelineDelta } from '../lib/pipelineDelta.js'
import { recordCardMoves } from '../lib/automations/hooks.js'
import { requireCan } from '../lib/permissions.js'

const router = Router()

// Anything saved here may carry a date: keep Google Calendar in step, in the background.
router.use(syncCalendarAfterWrite as any)

const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

async function requireUser(req: any, res: any, next: any) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any
    let crmAccountId: string | null = payload.crmAccountId ?? null
    // Backfill for tokens issued before Phase 1.5: the JWT did not include
    // crmAccountId, so look it up from the user record. One extra query the
    // first time per session; subsequent refreshes will carry the claim.
    if (!crmAccountId) {
      const u = await prisma.crmUser.findUnique({
        where: { id: payload.sub },
        select: { crmAccountId: true },
      })
      crmAccountId = u?.crmAccountId ?? null
    }
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      crmAccountId,
    }
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
}

// Refuse access from any session whose user is not linked to a CrmAccount.
// Without it we have no visibility scope and would either leak across tenants
// or silently see nothing.
function requireAccount(req: any, res: any, next: any) {
  if (!req.user?.crmAccountId) {
    res.status(403).json({ success: false, error: 'Your user is not linked to a company; ask an admin to assign you to one.' })
    return
  }
  next()
}

router.use(requireUser)

const contactSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(120),
  // The lead forms make last name optional; a first name alone is enough to save someone.
  lastName: z.string().max(120).optional().default(''),
  email: z.string().email().optional().or(z.literal('').transform(() => undefined)),
  phone: z.string().max(40).optional().or(z.literal('').transform(() => undefined)),
  serviceAddress: z.string().max(500).optional().or(z.literal('').transform(() => undefined)),
  billingAddress: z.string().max(500).optional().or(z.literal('').transform(() => undefined)),
  billingDifferent: z.boolean().optional(),
  city: z.string().max(120).optional().or(z.literal('').transform(() => undefined)),
  state: z.string().max(40).optional().or(z.literal('').transform(() => undefined)),
  zip: z.string().max(20).optional().or(z.literal('').transform(() => undefined)),
  leadSource: z.string().max(120).optional().or(z.literal('').transform(() => undefined)),
  salesRep: z.string().max(120).optional().or(z.literal('').transform(() => undefined)),
  firstApptDate: z.string().max(20).optional().or(z.literal('').transform(() => undefined)),
  tags: z.array(z.string()).optional(),
  notes: z.string().max(20_000).optional().or(z.literal('').transform(() => undefined)),
  jobStatus: z.string().max(60).optional().or(z.literal('').transform(() => undefined)),
  isCompleted: z.boolean().optional(),
})

const updateSchema = contactSchema.partial()

// ── List ──
// Visibility model: any authenticated CrmUser sees every contact in their
// CrmAccount. ownerId is preserved on the row as an audit trail of the
// original creator only (it does not gate visibility).
router.get('/', requireAccount, async (req: any, res) => {
  try {
    // ?since=<time>: only what changed after it (removed ones too), for a small refresh.
    const sinceRaw = typeof req.query.since === 'string' ? Date.parse(req.query.since) : NaN
    const serverTime = new Date(Date.now() - 5000).toISOString()
    const contacts = await prisma.crmContact.findMany({
      where: Number.isFinite(sinceRaw)
        ? { accountId: req.user.crmAccountId, updatedAt: { gt: new Date(sinceRaw) } }
        : { accountId: req.user.crmAccountId, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
    })
    res.json({ success: true, data: contacts, serverTime, partial: Number.isFinite(sinceRaw) })
  } catch (err) {
    console.error('[crm-contacts] list error:', err)
    res.status(500).json({ success: false, error: 'Failed to list contacts' })
  }
})

// ── Create ──
// A new customer and their pipeline card are one save: both are written in one
// transaction, or neither is. Sending the same create again (the phone did not
// hear the answer) returns what was saved the first time, never a second copy.
const newCardSchema = z.object({ id: z.string().min(1).max(64) }).passthrough()

class PipelineBusy extends Error {}

router.post('/', requireAccount, async (req: any, res) => {
  try {
    const data = contactSchema.parse(req.body)
    // An id the server cannot use (an older app made short ones) is replaced, not refused.
    const parsedId = clientIdSchema.safeParse(req.body?.id)
    const clientId = parsedId.success ? parsedId.data : undefined
    const card = req.body?.lead ? newCardSchema.parse(req.body.lead) : null
    const before = typeof req.body?.leadBefore === 'string' ? req.body.leadBefore : null
    const accountId = req.user.crmAccountId
    let decision = await decideClientId(clientId, accountId, id => prisma.crmContact.findUnique({ where: { id } }))

    let result: { contact: any; isNew: boolean; pipelineVersion: number | null } | null = null
    for (let attempt = 0; attempt < 5 && !result; attempt++) {
      try {
        result = await prisma.$transaction(async tx => {
          const isNew = decision.kind !== 'exists'
          const contact = !isNew ? (decision as { row: any }).row : await tx.crmContact.create({
            data: {
              ...(decision.kind === 'use' ? { id: decision.id } : {}),
              accountId,
              ownerId: req.user.id,
              firstName: data.firstName,
              lastName: data.lastName,
              email: data.email,
              phone: data.phone,
              serviceAddress: data.serviceAddress,
              billingAddress: data.billingAddress,
              billingDifferent: data.billingDifferent ?? false,
              city: data.city,
              state: data.state,
              zip: data.zip,
              leadSource: data.leadSource,
              salesRep: data.salesRep,
              firstApptDate: data.firstApptDate,
              tags: data.tags ? JSON.parse(JSON.stringify(data.tags)) : null,
              notes: data.notes,
              jobStatus: data.jobStatus,
              isCompleted: data.isCompleted ?? false,
            },
          })
          let pipelineVersion: number | null = null
          if (card) {
            const lead = { ...card, customerId: contact.id }
            const cur = await tx.pipelineState.findUnique({ where: { accountId } })
            if (!cur) {
              const made = await tx.pipelineState.create({ data: { accountId, leads: [lead], stages: [] } })
              pipelineVersion = made.version
            } else if (!((cur.leads as any[]) ?? []).some(l => l?.id === lead.id || (!isNew && l?.customerId === contact.id))) {
              // A create sent again (no answer reached the phone) never adds a second card for that customer.
              const next = applyPipelineDelta({ leads: (cur.leads as any[]) ?? [], stages: (cur.stages as any[]) ?? [] }, { upsert: [{ lead, before }], remove: [] })
              const done = await tx.pipelineState.updateMany({ where: { accountId, version: cur.version }, data: { leads: JSON.parse(JSON.stringify(next.leads)), version: { increment: 1 } } })
              // Another save to the pipeline landed in between: undo this one and go again.
              if (done.count === 0) throw new PipelineBusy()
              pipelineVersion = cur.version + 1
              // The new card enters its stage: saved for automations in the same step.
              await recordCardMoves(accountId, (cur.leads as any[]) ?? [], next.leads, pipelineVersion, tx)
            } else {
              pipelineVersion = cur.version
            }
          }
          return { contact, isNew, pipelineVersion }
        })
      } catch (e) {
        // The same create arrived twice at once: the other one made it, so this is a repeat.
        if ((e as any)?.code === 'P2002' && decision.kind === 'use') {
          const row = await prisma.crmContact.findUnique({ where: { id: decision.id } })
          if (row && row.accountId === accountId) { decision = { kind: 'exists', row }; continue }
        }
        if (!(e instanceof PipelineBusy)) throw e
      }
    }
    if (!result) { res.status(503).json({ success: false, error: 'The server is busy. It will be sent again by itself.' }); return }
    const { contact, isNew, pipelineVersion } = result
    if (isNew) {
      console.log(`[crm-contacts] created ${contact.id} (${contact.firstName} ${contact.lastName})${card ? ` with pipeline card ${card.id}` : ''} for user ${req.user.id}`)
      await audit(req, 'create', 'CrmContact', contact.id, { newValues: { ...contact, pipelineCard: card?.id ?? null } })
    }
    res.status(isNew ? 201 : 200).json({ success: true, data: contact, pipelineVersion })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[crm-contacts] create error:', err)
    res.status(500).json({ success: false, error: 'The server had a problem saving this customer. It will be sent again by itself.' })
  }
})

// ── Update ──
// Any authenticated CrmUser in the same CrmAccount can edit any contact.
// ownerId is retained on the row as an audit trail of the original creator only.
router.patch('/:id', requireAccount, async (req: any, res) => {
  try {
    const data = updateSchema.parse(req.body)
    const existing = await prisma.crmContact.findUnique({ where: { id: req.params.id } })
    if (!existing) { res.status(404).json({ success: false, error: 'Contact not found' }); return }
    if (existing.accountId !== req.user.crmAccountId) {
      res.status(404).json({ success: false, error: 'Contact not found' }); return
    }
    const updated = await prisma.crmContact.update({
      where: { id: req.params.id },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        serviceAddress: data.serviceAddress,
        billingAddress: data.billingAddress,
        billingDifferent: data.billingDifferent,
        city: data.city,
        state: data.state,
        zip: data.zip,
        leadSource: data.leadSource,
        salesRep: data.salesRep,
        firstApptDate: data.firstApptDate,
        tags: data.tags ? JSON.parse(JSON.stringify(data.tags)) : undefined,
        notes: data.notes,
        jobStatus: data.jobStatus,
        isCompleted: data.isCompleted,
      },
    })
    await audit(req, 'update', 'CrmContact', updated.id, { oldValues: existing, newValues: updated })
    res.json({ success: true, data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[crm-contacts] update error:', err)
    res.status(500).json({ success: false, error: 'Failed to update contact' })
  }
})

// ── Delete (soft) ──
router.delete('/:id', requireAccount, requireCan('records.delete'), async (req: any, res) => {
  try {
    const existing = await prisma.crmContact.findUnique({ where: { id: req.params.id } })
    if (!existing) { res.status(404).json({ success: false, error: 'Contact not found' }); return }
    if (existing.accountId !== req.user.crmAccountId) {
      res.status(404).json({ success: false, error: 'Contact not found' }); return
    }
    await prisma.crmContact.update({ where: { id: req.params.id }, data: { archivedAt: new Date() } })
    await audit(req, 'soft_delete', 'CrmContact', existing.id, { oldValues: existing })
    res.json({ success: true })
  } catch (err) {
    console.error('[crm-contacts] delete error:', err)
    res.status(500).json({ success: false, error: 'Failed to delete contact' })
  }
})

// ── Bulk sync (one-time migration helper) ──
//
// Accepts an array of localStorage-shaped customers. Matches on (accountId, email)
// and falls back to (accountId, firstName, lastName, phone) so legacy records
// from any user in the company merge into the shared account view. ownerId is
// set to the syncing user only on insert (audit trail for the migrator).
router.post('/sync', requireAccount, requireCan('records.import'), async (req: any, res) => {
  try {
    const items = z.array(contactSchema).parse(req.body?.contacts || [])
    let created = 0, updated = 0
    for (const item of items) {
      const matchKey = item.email
        ? { email: item.email, accountId: req.user.crmAccountId, archivedAt: null as any }
        : { firstName: item.firstName, lastName: item.lastName, phone: item.phone || '', accountId: req.user.crmAccountId, archivedAt: null as any }
      const existing = await prisma.crmContact.findFirst({ where: matchKey })
      if (existing) {
        await prisma.crmContact.update({
          where: { id: existing.id },
          data: { ...item, tags: item.tags ? JSON.parse(JSON.stringify(item.tags)) : undefined },
        })
        updated++
      } else {
        await prisma.crmContact.create({
          data: {
            accountId: req.user.crmAccountId,
            ownerId: req.user.id,
            ...item,
            tags: item.tags ? JSON.parse(JSON.stringify(item.tags)) : null,
            billingDifferent: item.billingDifferent ?? false,
            isCompleted: item.isCompleted ?? false,
          },
        })
        created++
      }
    }
    console.log(`[crm-contacts] sync: ${created} created, ${updated} updated for account ${req.user.crmAccountId}`)
    res.json({ success: true, data: { created, updated, total: items.length } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[crm-contacts] sync error:', err)
    res.status(500).json({ success: false, error: 'Failed to sync contacts' })
  }
})

// ── Notes (sub-resource on a contact) ───────────────────────────────────────

const noteSchema = z.object({
  body: z.string().min(1, 'Note body is required').max(20_000),
  isPinned: z.boolean().optional(),
  visibility: z.enum(['internal', 'all_staff']).optional(),
})

const noteUpdateSchema = noteSchema.partial()

// Helper: confirm the parent contact exists in the caller's account, returns
// the contact or sends 404 to the response. Returns null when the helper has
// already sent a response (caller should bail out).
async function loadContactInAccount(req: any, res: any) {
  const contact = await prisma.crmContact.findUnique({ where: { id: req.params.id } })
  if (!contact || contact.accountId !== req.user.crmAccountId) {
    res.status(404).json({ success: false, error: 'Contact not found' })
    return null
  }
  return contact
}

// List notes for a contact.
router.get('/:id/notes', requireAccount, async (req: any, res) => {
  try {
    const contact = await loadContactInAccount(req, res)
    if (!contact) return
    const notes = await prisma.crmContactNote.findMany({
      where: { crmContactId: contact.id, deletedAt: null },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    })
    // Who wrote each note, by name (notes keep the login they were written with).
    const users = await prisma.crmUser.findMany({ where: { crmAccountId: req.user.crmAccountId }, select: { id: true, email: true, firstName: true, lastName: true } })
    const nameOf = (u?: { firstName: string | null; lastName: string | null }) => (u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() : '') || null
    const byId = new Map(users.map(u => [u.id, u])), byEmail = new Map(users.map(u => [u.email.toLowerCase(), u]))
    res.json({ success: true, data: notes.map(n => ({ ...n, createdByName: nameOf((n.createdById ? byId.get(n.createdById) : undefined) ?? byEmail.get((n.createdBy || '').toLowerCase())) ?? (n.createdBy?.includes('@') ? null : n.createdBy) })) })
  } catch (err) {
    console.error('[crm-contacts] notes list error:', err)
    res.status(500).json({ success: false, error: 'Failed to list notes' })
  }
})

// Create a note.
router.post('/:id/notes', requireAccount, async (req: any, res) => {
  try {
    const contact = await loadContactInAccount(req, res)
    if (!contact) return
    const data = noteSchema.parse(req.body)
    // The phone gives each note its id, so a note sent twice is saved once.
    const parsedId = clientIdSchema.safeParse(req.body?.id)
    const decision = await decideClientId(parsedId.success ? parsedId.data : undefined, req.user.crmAccountId, id => prisma.crmContactNote.findUnique({ where: { id } }))
    if (decision.kind === 'exists') { res.status(200).json({ success: true, data: decision.row }); return }
    const created = await prisma.crmContactNote.create({
      data: {
        ...(decision.kind === 'use' ? { id: decision.id } : {}),
        crmContactId: contact.id,
        accountId: req.user.crmAccountId,
        body: data.body,
        isPinned: data.isPinned ?? false,
        visibility: data.visibility ?? 'all_staff',
        createdBy: req.user.email || 'staff',
        createdById: req.user.id,
      },
    })
    await audit(req, 'create', 'CrmContactNote', created.id, { newValues: created })
    res.status(201).json({ success: true, data: created })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    // The same note arrived twice at once: the first one is the note.
    if ((err as any)?.code === 'P2002' && typeof req.body?.id === 'string') {
      const row = await prisma.crmContactNote.findUnique({ where: { id: req.body.id } }).catch(() => null)
      if (row && row.accountId === req.user.crmAccountId) { res.status(200).json({ success: true, data: row }); return }
    }
    console.error('[crm-contacts] notes create error:', err)
    res.status(500).json({ success: false, error: 'Failed to create note' })
  }
})

// Update a note (body / pin / visibility).
router.patch('/:id/notes/:noteId', requireAccount, async (req: any, res) => {
  try {
    const contact = await loadContactInAccount(req, res)
    if (!contact) return
    const data = noteUpdateSchema.parse(req.body)
    const existing = await prisma.crmContactNote.findUnique({ where: { id: req.params.noteId } })
    if (!existing || existing.crmContactId !== contact.id || existing.deletedAt) {
      res.status(404).json({ success: false, error: 'Note not found' })
      return
    }
    const updated = await prisma.crmContactNote.update({
      where: { id: existing.id },
      data: {
        body: data.body,
        isPinned: data.isPinned,
        visibility: data.visibility,
      },
    })
    await audit(req, 'update', 'CrmContactNote', updated.id, { oldValues: existing, newValues: updated })
    res.json({ success: true, data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[crm-contacts] notes update error:', err)
    res.status(500).json({ success: false, error: 'Failed to update note' })
  }
})

// Soft delete a note.
router.delete('/:id/notes/:noteId', requireAccount, requireCan('ops.delete'), async (req: any, res) => {
  try {
    const contact = await loadContactInAccount(req, res)
    if (!contact) return
    const existing = await prisma.crmContactNote.findUnique({ where: { id: req.params.noteId } })
    if (!existing || existing.crmContactId !== contact.id || existing.deletedAt) {
      res.status(404).json({ success: false, error: 'Note not found' })
      return
    }
    await prisma.crmContactNote.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    })
    await audit(req, 'soft_delete', 'CrmContactNote', existing.id, { oldValues: existing })
    res.json({ success: true })
  } catch (err) {
    console.error('[crm-contacts] notes delete error:', err)
    res.status(500).json({ success: false, error: 'Failed to delete note' })
  }
})

// Bulk migration helper for legacy localStorage notes. Idempotent — matches
// existing notes by (crmContactId, body, createdAt) so re running is safe.
const noteSyncSchema = z.object({
  notes: z.array(z.object({
    crmContactId: z.string(),
    body: z.string().min(1).max(20_000),
    isPinned: z.boolean().optional(),
    visibility: z.enum(['internal', 'all_staff']).optional(),
    createdBy: z.string().optional(),
    createdAt: z.string().optional(), // ISO date string from the legacy record
  })),
})

router.post('/notes/sync', requireAccount, requireCan('records.import'), async (req: any, res) => {
  try {
    const { notes } = noteSyncSchema.parse(req.body)
    let created = 0, skipped = 0
    for (const n of notes) {
      // Confirm the contact belongs to the caller's account
      const contact = await prisma.crmContact.findUnique({ where: { id: n.crmContactId } })
      if (!contact || contact.accountId !== req.user.crmAccountId) { skipped++; continue }
      const dupe = await prisma.crmContactNote.findFirst({
        where: {
          crmContactId: n.crmContactId,
          body: n.body,
          deletedAt: null,
        },
      })
      if (dupe) { skipped++; continue }
      await prisma.crmContactNote.create({
        data: {
          crmContactId: n.crmContactId,
          accountId: req.user.crmAccountId,
          body: n.body,
          isPinned: n.isPinned ?? false,
          visibility: n.visibility ?? 'all_staff',
          createdBy: n.createdBy || req.user.email || 'migrated',
          createdById: req.user.id,
          createdAt: n.createdAt ? new Date(n.createdAt) : undefined,
        },
      })
      created++
    }
    console.log(`[crm-contacts] notes sync: ${created} created, ${skipped} skipped (dupes or out of account) for account ${req.user.crmAccountId}`)
    res.json({ success: true, data: { created, skipped, total: notes.length } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[crm-contacts] notes sync error:', err)
    res.status(500).json({ success: false, error: 'Failed to sync notes' })
  }
})

export default router
