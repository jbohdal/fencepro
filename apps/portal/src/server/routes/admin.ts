import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { str } from '../lib/helpers.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()

// All admin routes require admin role
router.use(requireAuth, requireRole('admin'))

// ── List all customer accounts with portal status ──
router.get('/accounts', async (_req, res) => {
  try {
    const accounts = await prisma.crmAccount.findMany({
      include: { customers: { select: { id: true, email: true, firstName: true, lastName: true, role: true, portalEnabled: true, lastLoginAt: true } } },
      orderBy: { name: 'asc' },
    })
    res.json({ success: true, data: accounts })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load accounts' })
  }
})

// ── Toggle portal access ──
router.patch('/customers/:id/portal', async (req, res) => {
  try {
    const { enabled } = req.body
    const customer = await prisma.customer.update({
      where: { id: str(req.params.id) },
      data: { portalEnabled: !!enabled },
    })
    res.json({ success: true, data: { id: customer.id, portalEnabled: customer.portalEnabled } })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to update portal access' })
  }
})

// ── View customer's documents ──
router.get('/accounts/:accountId/documents', async (req, res) => {
  try {
    const docs = await prisma.document.findMany({
      where: { accountId: str(req.params.accountId), deletedAt: null },
      include: { customer: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { uploadedAt: 'desc' },
    })
    res.json({ success: true, data: docs })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load documents' })
  }
})

// ── View audit logs ──
router.get('/audit-logs', async (req, res) => {
  try {
    const customerId = req.query.customerId ? String(req.query.customerId) : undefined
    const action = req.query.action ? String(req.query.action) : undefined
    const page = Math.max(1, parseInt(String(req.query.page)) || 1)
    const pageSize = Math.min(100, parseInt(String(req.query.pageSize)) || 50)

    const where = {
      ...(customerId ? { customerId } : {}),
      ...(action ? { action } : {}),
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { customer: { select: { email: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
    ])

    res.json({
      success: true,
      data: {
        items: logs,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load audit logs' })
  }
})

// ── Impersonate customer (read-only) ──
router.get('/impersonate/:customerId', async (req, res) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: str(req.params.customerId) },
      include: { account: true },
    })
    if (!customer) {
      res.status(404).json({ success: false, error: 'Customer not found' })
      return
    }
    // Return the customer's account context — frontend uses this to show their view
    res.json({
      success: true,
      data: {
        customerId: customer.id,
        email: customer.email,
        name: `${customer.firstName} ${customer.lastName}`,
        accountId: customer.accountId,
        accountName: customer.account.name,
      },
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to impersonate' })
  }
})

export default router
