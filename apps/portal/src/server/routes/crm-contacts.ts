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

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || 'dev-crm-jwt-secret-change-me'

function requireUser(req: any, res: any, next: any) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any
    req.user = { id: payload.sub, email: payload.email, role: payload.role }
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
}

router.use(requireUser)

const contactSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(120),
  lastName: z.string().min(1, 'Last name is required').max(120),
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
router.get('/', async (req: any, res) => {
  try {
    const contacts = await prisma.crmContact.findMany({
      where: { ownerId: req.user.id, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
    })
    res.json({ success: true, data: contacts })
  } catch (err) {
    console.error('[crm-contacts] list error:', err)
    res.status(500).json({ success: false, error: 'Failed to list contacts' })
  }
})

// ── Create ──
router.post('/', async (req: any, res) => {
  try {
    const data = contactSchema.parse(req.body)
    const created = await prisma.crmContact.create({
      data: {
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
    console.log(`[crm-contacts] created ${created.id} (${created.firstName} ${created.lastName}) for user ${req.user.id}`)
    await audit(req, 'create', 'CrmContact', created.id, { newValues: created })
    res.status(201).json({ success: true, data: created })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[crm-contacts] create error:', err)
    res.status(500).json({ success: false, error: 'Failed to create contact' })
  }
})

// ── Update ──
router.patch('/:id', async (req: any, res) => {
  try {
    const data = updateSchema.parse(req.body)
    const existing = await prisma.crmContact.findUnique({ where: { id: req.params.id } })
    if (!existing) { res.status(404).json({ success: false, error: 'Contact not found' }); return }
    if (existing.ownerId && existing.ownerId !== req.user.id && req.user.role !== 'super_admin' && req.user.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Cannot edit another user\'s contact' }); return
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
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[crm-contacts] update error:', err)
    res.status(500).json({ success: false, error: 'Failed to update contact' })
  }
})

// ── Delete (soft) ──
router.delete('/:id', async (req: any, res) => {
  try {
    const existing = await prisma.crmContact.findUnique({ where: { id: req.params.id } })
    if (!existing) { res.status(404).json({ success: false, error: 'Contact not found' }); return }
    if (existing.ownerId && existing.ownerId !== req.user.id && req.user.role !== 'super_admin' && req.user.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Cannot delete another user\'s contact' }); return
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
// Accepts an array of localStorage-shaped customers. Upserts by client-side id
// stored in `notes` is unreliable — instead we match on (ownerId, email) and
// fall back to (ownerId, firstName, lastName, phone). This is best-effort: it
// is meant to be triggered once when a user with existing localStorage data
// first signs in to the database-backed flow.
router.post('/sync', async (req: any, res) => {
  try {
    const items = z.array(contactSchema).parse(req.body?.contacts || [])
    let created = 0, updated = 0
    for (const item of items) {
      const matchKey = item.email
        ? { email: item.email, ownerId: req.user.id, archivedAt: null as any }
        : { firstName: item.firstName, lastName: item.lastName, phone: item.phone || '', ownerId: req.user.id, archivedAt: null as any }
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
    console.log(`[crm-contacts] sync: ${created} created, ${updated} updated for user ${req.user.id}`)
    res.json({ success: true, data: { created, updated, total: items.length } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[crm-contacts] sync error:', err)
    res.status(500).json({ success: false, error: 'Failed to sync contacts' })
  }
})

export default router
