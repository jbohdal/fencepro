import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { auditLog } from '../middleware/audit.js'

const router = Router()

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const AI_MODEL = process.env.AI_CHAT_MODEL || 'claude-sonnet-4-20250514'

// ── Build context about the customer for the AI ──
async function buildCustomerContext(accountId: string, customerId: string): Promise<string> {
  const [account, tickets, invoices, contracts] = await Promise.all([
    prisma.crmAccount.findUnique({ where: { id: accountId } }),
    prisma.ticket.findMany({ where: { accountId }, orderBy: { updatedAt: 'desc' }, take: 5 }),
    prisma.invoice.findMany({ where: { accountId }, orderBy: { dueDate: 'desc' }, take: 5 }),
    prisma.contract.findMany({ where: { accountId }, orderBy: { startDate: 'desc' }, take: 5 }),
  ])

  const customer = await prisma.customer.findUnique({ where: { id: customerId } })

  let ctx = `Customer: ${customer?.firstName} ${customer?.lastName} (${customer?.email})\n`
  ctx += `Account: ${account?.name || 'Unknown'}\n`
  ctx += `Assigned Rep: ${account?.assignedRepName || 'Not assigned'} (${account?.assignedRepEmail || ''})\n\n`

  if (tickets.length > 0) {
    ctx += 'Recent Tickets:\n'
    tickets.forEach(t => { ctx += `- "${t.title}" — Status: ${t.status}, Priority: ${t.priority}, Updated: ${t.updatedAt.toLocaleDateString()}\n` })
    ctx += '\n'
  }

  if (invoices.length > 0) {
    ctx += 'Recent Invoices:\n'
    invoices.forEach(inv => {
      ctx += `- #${inv.invoiceNumber}: $${(inv.amountCents / 100).toFixed(2)} — ${inv.status}, Due: ${inv.dueDate.toLocaleDateString()}\n`
    })
    ctx += '\n'
  }

  if (contracts.length > 0) {
    ctx += 'Active Contracts:\n'
    contracts.forEach(c => { ctx += `- "${c.name}" — Status: ${c.status}, Started: ${c.startDate.toLocaleDateString()}\n` })
  }

  return ctx
}

const SYSTEM_PROMPT = `You are the customer support assistant for a professional fence installation company. You are friendly, professional, and helpful.

You can help customers with:
- Checking the status of their fence installation project
- Questions about invoices and payments
- Scheduling and timeline questions
- Warranty information
- General fence maintenance advice
- Creating support tickets for issues you can't resolve

Important rules:
- Never share internal pricing, cost data, or margin information
- Never share other customers' information
- If you can't answer something, suggest the customer create a support ticket or contact their assigned representative
- Be concise but thorough
- If the customer seems frustrated, acknowledge their concern and offer to escalate

When the customer wants to escalate or you can't resolve their issue, respond with exactly: [ESCALATE] followed by a brief summary of the issue.`

// ── AI response generation ──
async function getAIResponse(messages: { role: string; body: string }[], customerContext: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    console.log('[Chat] No API key configured, using fallback')
    return getFallbackResponse(messages[messages.length - 1]?.body || '')
  }
  console.log('[Chat] Calling Claude API with', messages.length, 'messages')

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 1024,
        system: `${SYSTEM_PROMPT}\n\nHere is the customer's account information:\n${customerContext}`,
        messages: messages.map(m => ({
          role: m.role === 'customer' ? 'user' : 'assistant',
          content: m.body,
        })),
      }),
    })

    if (!res.ok) {
      console.error('AI API error:', res.status, await res.text())
      return getFallbackResponse(messages[messages.length - 1]?.body || '')
    }

    const data = await res.json() as { content: { text: string }[] }
    return data.content[0]?.text || 'I apologize, I had trouble processing that. Could you try rephrasing?'
  } catch (err) {
    console.error('AI error:', err)
    return getFallbackResponse(messages[messages.length - 1]?.body || '')
  }
}

// ── Fallback when no AI key is configured ──
function getFallbackResponse(message: string): string {
  const lower = message.toLowerCase()

  if (lower.includes('status') || lower.includes('project') || lower.includes('install'))
    return 'You can check your project status in the Contracts tab. If you need more details, I can create a support ticket for you — just say "create a ticket".'

  if (lower.includes('invoice') || lower.includes('payment') || lower.includes('bill') || lower.includes('pay'))
    return 'Your invoices are available in the Invoices tab with payment details and due dates. If you have a billing question, I can connect you with your representative.'

  if (lower.includes('ticket') || lower.includes('create') || lower.includes('issue') || lower.includes('problem'))
    return '[ESCALATE] Customer wants to create a support ticket.'

  if (lower.includes('warranty'))
    return 'Our fence installations typically include a manufacturer warranty on materials and a workmanship warranty on labor. For specific warranty details about your installation, I recommend checking your contract or creating a support ticket.'

  if (lower.includes('schedule') || lower.includes('when') || lower.includes('date'))
    return 'Your scheduled dates are shown in your contract details. If you need to reschedule, please create a support ticket and your project coordinator will reach out.'

  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey'))
    return 'Hello! How can I help you today? I can answer questions about your project, invoices, scheduling, or help you create a support ticket.'

  return 'I can help you with project status, invoices, scheduling, and general questions. If you need specific assistance, I can create a support ticket for your team. What would you like help with?'
}

// ── Routes ──

// Get or create active conversation
router.get('/conversation', requireAuth, async (req, res) => {
  try {
    let conversation = await prisma.chatConversation.findFirst({
      where: { customerId: req.user!.sub, status: 'active' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })

    if (!conversation) {
      conversation = await prisma.chatConversation.create({
        data: { customerId: req.user!.sub, accountId: req.user!.accountId },
        include: { messages: true },
      })
      // Welcome message
      await prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          body: 'Hi there! I\'m your support assistant. I can help with project status, invoices, scheduling, and more. What can I help you with?',
        },
      })
      conversation = await prisma.chatConversation.findUnique({
        where: { id: conversation.id },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      })
    }

    res.json({
      success: true,
      data: {
        id: conversation!.id,
        status: conversation!.status,
        messages: conversation!.messages.map(m => ({
          id: m.id,
          role: m.role,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
        })),
      },
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load chat' })
  }
})

// Send a message
const messageSchema = z.object({ body: z.string().min(1).max(2000) })

router.post('/message', requireAuth, auditLog('chat_message'), async (req, res) => {
  try {
    const { body } = messageSchema.parse(req.body)

    // Get or create conversation
    let conversation = await prisma.chatConversation.findFirst({
      where: { customerId: req.user!.sub, status: 'active' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })

    if (!conversation) {
      conversation = await prisma.chatConversation.create({
        data: { customerId: req.user!.sub, accountId: req.user!.accountId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      })
    }

    // Save customer message
    const customerMsg = await prisma.chatMessage.create({
      data: { conversationId: conversation.id, role: 'customer', body },
    })

    // Build context and get AI response
    const context = await buildCustomerContext(req.user!.accountId, req.user!.sub)
    const allMessages = [...conversation.messages, { role: 'customer', body }]
    const aiResponse = await getAIResponse(
      allMessages.map(m => ({ role: m.role, body: m.body })),
      context,
    )

    // Check for escalation
    if (aiResponse.includes('[ESCALATE]')) {
      const summary = aiResponse.replace('[ESCALATE]', '').trim()

      // Create a support ticket
      const ticket = await prisma.ticket.create({
        data: {
          accountId: req.user!.accountId,
          title: `Chat escalation: ${summary.slice(0, 100)}`,
          description: `Escalated from chat. Customer message: "${body}"\n\nAI summary: ${summary}`,
          priority: 'medium',
        },
      })

      // Update conversation
      await prisma.chatConversation.update({
        where: { id: conversation.id },
        data: { status: 'escalated', ticketId: ticket.id, summary },
      })

      const escalateMsg = await prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          body: `I've created a support ticket for you (Ticket: "${ticket.title}"). Your team will follow up shortly. You can track it in the Tickets section. Is there anything else I can help with?`,
        },
      })

      // Start a new conversation for future messages
      res.json({
        success: true,
        data: {
          customerMessage: { id: customerMsg.id, role: 'customer', body, createdAt: customerMsg.createdAt.toISOString() },
          assistantMessage: { id: escalateMsg.id, role: 'assistant', body: escalateMsg.body, createdAt: escalateMsg.createdAt.toISOString() },
          escalated: true,
          ticketId: ticket.id,
        },
      })
      return
    }

    // Save AI response
    const assistantMsg = await prisma.chatMessage.create({
      data: { conversationId: conversation.id, role: 'assistant', body: aiResponse },
    })

    res.json({
      success: true,
      data: {
        customerMessage: { id: customerMsg.id, role: 'customer', body, createdAt: customerMsg.createdAt.toISOString() },
        assistantMessage: { id: assistantMsg.id, role: 'assistant', body: aiResponse, createdAt: assistantMsg.createdAt.toISOString() },
        escalated: false,
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('Chat error:', err)
    res.status(500).json({ success: false, error: 'Failed to send message' })
  }
})

// Start new conversation (close current)
router.post('/new', requireAuth, async (req, res) => {
  try {
    await prisma.chatConversation.updateMany({
      where: { customerId: req.user!.sub, status: 'active' },
      data: { status: 'resolved' },
    })
    res.json({ success: true })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to start new conversation' })
  }
})

// Admin: get all conversations
router.get('/admin/conversations', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin' && req.user!.role !== 'support_agent') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  try {
    const conversations = await prisma.chatConversation.findMany({
      include: {
        customer: { select: { firstName: true, lastName: true, email: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    })

    res.json({
      success: true,
      data: conversations.map(c => ({
        id: c.id,
        customerName: `${c.customer.firstName} ${c.customer.lastName}`,
        customerEmail: c.customer.email,
        status: c.status,
        ticketId: c.ticketId,
        messageCount: c.messages.length,
        lastMessage: c.messages[0] ? { body: c.messages[0].body, role: c.messages[0].role, createdAt: c.messages[0].createdAt } : null,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load conversations' })
  }
})

export default router
