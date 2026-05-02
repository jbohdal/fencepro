/**
 * Sync API — receives data from the EZ Biz CRM app
 *
 * These endpoints are called by the CRM frontend when data changes.
 * They upsert into the portal's PostgreSQL database so customers
 * can see their quotes, jobs, invoices, etc.
 *
 * Auth: API key header (X-API-Key) or admin JWT
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'

const router = Router()

// Simple API key auth for sync endpoints
function requireSyncAuth(req: any, res: any, next: any) {
  const apiKey = req.headers['x-api-key']
  const expected = process.env.CRM_SYNC_KEY || 'dev-sync-key'
  if (apiKey === expected) { next(); return }

  // Also allow admin JWT
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) {
    try {
      const { verifyAccessToken } = require('../lib/auth.js')
      const payload = verifyAccessToken(auth.slice(7))
      if (payload.role === 'admin') { next(); return }
    } catch {}
  }

  res.status(401).json({ success: false, error: 'Sync auth required' })
}

router.use(requireSyncAuth)

// ── Sync Account ──
const accountSchema = z.object({
  externalCrmId: z.string(),
  name: z.string(),
  status: z.enum(['active', 'suspended', 'cancelled']).default('active'),
  assignedRepName: z.string().optional(),
  assignedRepEmail: z.string().optional(),
})

router.post('/accounts', async (req, res) => {
  try {
    const data = accountSchema.parse(req.body)
    const account = await prisma.crmAccount.upsert({
      where: { externalCrmId: data.externalCrmId },
      update: {
        name: data.name,
        status: data.status,
        assignedRepName: data.assignedRepName,
        assignedRepEmail: data.assignedRepEmail,
      },
      create: data,
    })
    res.json({ success: true, data: { id: account.id, externalCrmId: account.externalCrmId } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    res.status(500).json({ success: false, error: 'Failed to sync account' })
  }
})

// ── Sync Customer ──
const customerSchema = z.object({
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().optional(),
  accountExternalId: z.string(),
})

router.post('/customers', async (req, res) => {
  try {
    const data = customerSchema.parse(req.body)
    const account = await prisma.crmAccount.findUnique({ where: { externalCrmId: data.accountExternalId } })
    if (!account) {
      res.status(404).json({ success: false, error: 'Account not found. Sync account first.' })
      return
    }

    // Upsert by email
    const existing = await prisma.customer.findUnique({ where: { email: data.email } })
    if (existing) {
      await prisma.customer.update({
        where: { id: existing.id },
        data: { firstName: data.firstName, lastName: data.lastName, phone: data.phone },
      })
      res.json({ success: true, data: { id: existing.id, action: 'updated' } })
    } else {
      // Create without password — they'll need to register or be sent a reset link
      const { hashPassword } = require('../lib/auth.js')
      const tempHash = await hashPassword(Math.random().toString(36).slice(2))
      const customer = await prisma.customer.create({
        data: {
          email: data.email,
          passwordHash: tempHash,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          accountId: account.id,
          portalEnabled: true,
        },
      })
      res.json({ success: true, data: { id: customer.id, action: 'created' } })
    }
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    res.status(500).json({ success: false, error: 'Failed to sync customer' })
  }
})

// ── Sync Quote/Job as Ticket or Contract ──
const quoteSchema = z.object({
  externalId: z.string(),
  accountExternalId: z.string(),
  customerName: z.string(),
  fenceStyle: z.string(),
  sections: z.number(),
  totalPrice: z.number(),
  status: z.string(),
  date: z.string(),
  address: z.string().optional(),
})

router.post('/quotes', async (req, res) => {
  try {
    const data = quoteSchema.parse(req.body)
    const account = await prisma.crmAccount.findUnique({ where: { externalCrmId: data.accountExternalId } })
    if (!account) {
      res.status(404).json({ success: false, error: 'Account not found' })
      return
    }

    // Sync as a contract (the customer sees their fence project as a "contract")
    const contract = await prisma.contract.upsert({
      where: { externalCrmId: data.externalId },
      update: {
        name: `${data.fenceStyle} — ${data.sections} sections`,
        description: `${data.customerName} · ${data.address || ''} · ${data.status}`,
        status: data.status === 'SOLD' ? 'active' : data.status === 'LOST' ? 'cancelled' : 'active',
      },
      create: {
        externalCrmId: data.externalId,
        accountId: account.id,
        name: `${data.fenceStyle} — ${data.sections} sections`,
        description: `${data.customerName} · ${data.address || ''} · ${data.status}`,
        startDate: new Date(data.date),
        status: data.status === 'SOLD' ? 'active' : 'active',
      },
    })

    res.json({ success: true, data: { id: contract.id, action: 'synced' } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    res.status(500).json({ success: false, error: 'Failed to sync quote' })
  }
})

// ── Sync Job status ──
const jobSchema = z.object({
  externalId: z.string(), // quote ID
  accountExternalId: z.string(),
  status: z.string(),
  crewAssigned: z.string().optional(),
  scheduledDate: z.string().optional(),
  completedDate: z.string().optional(),
  contractValue: z.number().optional(),
})

router.post('/jobs', async (req, res) => {
  try {
    const data = jobSchema.parse(req.body)
    const account = await prisma.crmAccount.findUnique({ where: { externalCrmId: data.accountExternalId } })
    if (!account) {
      res.status(404).json({ success: false, error: 'Account not found' })
      return
    }

    // Update the contract that represents this job
    const contract = await prisma.contract.findUnique({ where: { externalCrmId: data.externalId } })
    if (contract) {
      const statusMap: Record<string, string> = {
        staging: 'active', scheduled: 'active', in_progress: 'active',
        completed: 'active', invoiced: 'active', paid: 'completed', on_hold: 'active',
      }
      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          status: statusMap[data.status] || 'active',
          description: [
            data.crewAssigned ? `Crew: ${data.crewAssigned}` : null,
            data.scheduledDate ? `Scheduled: ${data.scheduledDate}` : null,
            `Status: ${data.status}`,
          ].filter(Boolean).join(' · '),
          ...(data.completedDate ? { endDate: new Date(data.completedDate) } : {}),
        },
      })
    }

    res.json({ success: true, data: { action: 'synced' } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    res.status(500).json({ success: false, error: 'Failed to sync job' })
  }
})

// ── Sync Invoice ──
const invoiceSchema = z.object({
  externalId: z.string(),
  accountExternalId: z.string(),
  invoiceNumber: z.string(),
  amountCents: z.number(),
  dueDate: z.string(),
  status: z.enum(['pending', 'paid', 'overdue', 'cancelled', 'refunded']),
  paidAt: z.string().optional(),
})

router.post('/invoices', async (req, res) => {
  try {
    const data = invoiceSchema.parse(req.body)
    const account = await prisma.crmAccount.findUnique({ where: { externalCrmId: data.accountExternalId } })
    if (!account) {
      res.status(404).json({ success: false, error: 'Account not found' })
      return
    }

    const invoice = await prisma.invoice.upsert({
      where: { externalCrmId: data.externalId },
      update: {
        invoiceNumber: data.invoiceNumber,
        amountCents: data.amountCents,
        dueDate: new Date(data.dueDate),
        status: data.status,
        paidAt: data.paidAt ? new Date(data.paidAt) : null,
      },
      create: {
        externalCrmId: data.externalId,
        accountId: account.id,
        invoiceNumber: data.invoiceNumber,
        amountCents: data.amountCents,
        dueDate: new Date(data.dueDate),
        status: data.status,
        paidAt: data.paidAt ? new Date(data.paidAt) : null,
      },
    })

    res.json({ success: true, data: { id: invoice.id, action: 'synced' } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    res.status(500).json({ success: false, error: 'Failed to sync invoice' })
  }
})

// ── Get all portal activity for an account (tickets, documents, comments) ──
router.get('/activity/:accountExternalId', async (req, res) => {
  try {
    const externalId = Array.isArray(req.params.accountExternalId) ? req.params.accountExternalId[0] : req.params.accountExternalId
    const account = await prisma.crmAccount.findUnique({ where: { externalCrmId: externalId } })
    if (!account) {
      res.status(404).json({ success: false, error: 'Account not found' })
      return
    }

    const [tickets, documents, recentAudit, chatConversations] = await Promise.all([
      prisma.ticket.findMany({
        where: { accountId: account.id },
        include: { comments: { orderBy: { createdAt: 'desc' }, take: 5 } },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.document.findMany({
        where: { accountId: account.id, deletedAt: null },
        include: { customer: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { uploadedAt: 'desc' },
      }),
      prisma.auditLog.findMany({
        where: { customer: { accountId: account.id } },
        include: { customer: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.chatConversation.findMany({
        where: { accountId: account.id },
        include: {
          customer: { select: { firstName: true, lastName: true, email: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 3 },
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
    ])

    res.json({
      success: true,
      data: {
        accountId: account.id,
        accountName: account.name,
        tickets: tickets.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          commentCount: t.comments.length,
          latestComment: t.comments[0] || null,
        })),
        documents: documents.map(d => ({
          id: d.id,
          filename: d.originalName,
          mimeType: d.mimeType,
          sizeBytes: d.sizeBytes,
          uploadedBy: d.customer ? `${d.customer.firstName} ${d.customer.lastName}` : 'Unknown',
          uploadedAt: d.uploadedAt,
        })),
        chats: chatConversations.map(c => ({
          id: c.id,
          customerName: `${c.customer.firstName} ${c.customer.lastName}`,
          customerEmail: c.customer.email,
          status: c.status,
          ticketId: c.ticketId,
          messageCount: c.messages.length,
          lastMessages: c.messages.map(m => ({ role: m.role, body: m.body.slice(0, 200), createdAt: m.createdAt })),
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        })),
        recentActivity: recentAudit.map(a => ({
          action: a.action,
          user: a.customer ? `${a.customer.firstName} ${a.customer.lastName}` : 'System',
          timestamp: a.createdAt,
          metadata: a.metadata,
        })),
      },
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load activity' })
  }
})

export default router
