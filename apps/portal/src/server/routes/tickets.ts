import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { str } from '../lib/helpers.js'
import { requireAuth } from '../middleware/auth.js'
import { auditLog } from '../middleware/audit.js'

const router = Router()

const createTicketSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
})

const addCommentSchema = z.object({
  body: z.string().min(1).max(5000),
})

// ── List tickets (account-scoped) ──
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

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.ticket.count({ where }),
    ])

    res.json({
      success: true,
      data: {
        items: tickets.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load tickets' })
  }
})

// ── Get ticket detail (with customer-visible comments only) ──
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: str(req.params.id) },
      include: {
        comments: {
          where: { isInternal: false }, // FILTER: customers never see internal notes
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!ticket || ticket.accountId !== req.user!.accountId) {
      res.status(404).json({ success: false, error: 'Ticket not found' })
      return
    }

    res.json({
      success: true,
      data: {
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
        comments: ((ticket as any).comments || []).map((c: any) => ({
          id: c.id,
          authorName: c.authorName,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
        })),
      },
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load ticket' })
  }
})

// ── Create ticket ──
router.post('/', requireAuth, auditLog('ticket_create'), async (req, res) => {
  try {
    const data = createTicketSchema.parse(req.body)

    const ticket = await prisma.ticket.create({
      data: {
        accountId: req.user!.accountId,
        title: data.title,
        description: data.description,
        priority: data.priority,
      },
    })

    res.status(201).json({
      success: true,
      data: {
        id: ticket.id,
        title: ticket.title,
        status: ticket.status,
        priority: ticket.priority,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    res.status(500).json({ success: false, error: 'Failed to create ticket' })
  }
})

// ── Add comment to ticket ──
router.post('/:id/comments', requireAuth, auditLog('ticket_reply'), async (req, res) => {
  try {
    const { body } = addCommentSchema.parse(req.body)

    const ticket = await prisma.ticket.findUnique({ where: { id: str(req.params.id) } })
    if (!ticket || ticket.accountId !== req.user!.accountId) {
      res.status(404).json({ success: false, error: 'Ticket not found' })
      return
    }

    const customer = await prisma.customer.findUnique({ where: { id: req.user!.sub } })

    const comment = await prisma.ticketComment.create({
      data: {
        ticketId: ticket.id,
        authorName: customer ? `${customer.firstName} ${customer.lastName}` : 'Customer',
        body,
        isInternal: false,
      },
    })

    // Update ticket timestamp
    await prisma.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } })

    res.status(201).json({
      success: true,
      data: {
        id: comment.id,
        authorName: comment.authorName,
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    res.status(500).json({ success: false, error: 'Failed to add comment' })
  }
})

export default router
