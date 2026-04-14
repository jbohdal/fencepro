import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import type { DashboardSummary } from '../../types/index.js'

const router = Router()

router.get('/', requireAuth, async (req, res) => {
  try {
    const accountId = req.user!.accountId

    const [openTickets, pendingInvoices, overdueInvoices, activeContracts, invoiceTotals, recentTickets, recentInvoices] = await Promise.all([
      prisma.ticket.count({ where: { accountId, status: { in: ['open', 'in_progress', 'waiting_customer'] } } }),
      prisma.invoice.count({ where: { accountId, status: 'pending' } }),
      prisma.invoice.count({ where: { accountId, status: 'overdue' } }),
      prisma.contract.count({ where: { accountId, status: 'active' } }),
      prisma.invoice.aggregate({ where: { accountId, status: { in: ['pending', 'overdue'] } }, _sum: { amountCents: true } }),
      prisma.ticket.findMany({ where: { accountId }, orderBy: { updatedAt: 'desc' }, take: 5 }),
      prisma.invoice.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 5 }),
    ])

    const activity = [
      ...recentTickets.map(t => ({
        id: t.id,
        type: 'ticket_update' as const,
        title: t.title,
        description: `Ticket ${t.status}`,
        timestamp: t.updatedAt.toISOString(),
      })),
      ...recentInvoices.map(inv => ({
        id: inv.id,
        type: 'invoice_created' as const,
        title: `Invoice #${inv.invoiceNumber}`,
        description: `$${(inv.amountCents / 100).toFixed(2)} — ${inv.status}`,
        timestamp: inv.createdAt.toISOString(),
      })),
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 10)

    const summary: DashboardSummary = {
      openTickets,
      pendingInvoices,
      overdueInvoices,
      activeContracts,
      totalOwed: invoiceTotals._sum.amountCents || 0,
      recentActivity: activity,
    }

    res.json({ success: true, data: summary })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load dashboard' })
  }
})

export default router
