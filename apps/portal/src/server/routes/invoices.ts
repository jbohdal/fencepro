import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import prisma from '../lib/prisma.js'
import { str } from '../lib/helpers.js'
import { requireAuth } from '../middleware/auth.js'
import { auditLog } from '../middleware/audit.js'

const router = Router()

// ── List invoices (account-scoped) ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const accountId = req.user!.accountId
    const status = String(req.query.status || '') || undefined
    const page = Math.max(1, parseInt(String(req.query.page)) || 1)
    const pageSize = Math.min(50, parseInt(String(req.query.pageSize)) || 20)

    const where = {
      accountId,
      ...(status && status !== 'all' ? { status: status as any } : {}),
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { dueDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.invoice.count({ where }),
    ])

    res.json({
      success: true,
      data: {
        items: invoices.map(inv => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          amountCents: inv.amountCents,
          currency: inv.currency,
          dueDate: inv.dueDate.toISOString(),
          paidAt: inv.paidAt?.toISOString() || null,
          status: inv.status,
          hasPdf: !!inv.pdfPath,
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load invoices' })
  }
})

// ── Download invoice PDF ──
router.get('/:id/pdf', requireAuth, auditLog('invoice_download'), async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: str(req.params.id) } })

    if (!invoice || invoice.accountId !== req.user!.accountId) {
      res.status(404).json({ success: false, error: 'Invoice not found' })
      return
    }

    if (!invoice.pdfPath) {
      res.status(404).json({ success: false, error: 'PDF not available' })
      return
    }

    const fullPath = path.resolve(invoice.pdfPath)
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ success: false, error: 'PDF file not found' })
      return
    }

    res.download(fullPath, `invoice-${invoice.invoiceNumber}.pdf`)
  } catch {
    res.status(500).json({ success: false, error: 'Failed to download invoice' })
  }
})

export default router
