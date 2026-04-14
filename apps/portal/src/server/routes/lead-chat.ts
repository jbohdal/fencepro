/**
 * Public Lead Chat API
 *
 * No auth required — this is the website chatbot for lead generation.
 * Uses Claude API + the quote engine for real pricing.
 * Stores conversations and auto-creates leads.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { quickEstimate, getAvailableStyles } from '../lib/quoteEngine.js'
import { scoreLead, leadPriority } from '../lib/leadScoring.js'
import { sendLeadConfirmation } from '../lib/sms.js'
import { scheduleFollowUps } from '../lib/followUpScheduler.js'
import { writeAuditLog } from '../middleware/audit.js'

const router = Router()

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const AI_MODEL = process.env.AI_CHAT_MODEL || 'claude-sonnet-4-20250514'
const COMPANY_NAME = process.env.COMPANY_NAME || 'GD Fence Pro'

// ── Load knowledge base entries from database ──
async function loadKnowledgeBase(): Promise<string> {
  try {
    const entries = await prisma.knowledgeEntry.findMany({
      where: { active: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    })
    if (entries.length === 0) return ''

    let kb = '\n\nCOMPANY KNOWLEDGE BASE:\n'
    let currentCat = ''
    for (const entry of entries) {
      if (entry.category !== currentCat) {
        currentCat = entry.category
        kb += `\n--- ${currentCat.toUpperCase()} ---\n`
      }
      kb += `\n**${entry.title}**\n${entry.content}\n`
    }
    return kb
  } catch {
    return ''
  }
}

// ── Build the system prompt with live pricing data ──
async function buildSystemPrompt(): Promise<string> {
  // Get real per-foot pricing from the quote engine
  const styles = getAvailableStyles()
  const samplePricing: string[] = []

  const samplesToRun = [
    { style: "WV-ND 6'x6' Privacy", label: 'White Vinyl Privacy (6x6)' },
    { style: "WV-ND 6'x8' Privacy", label: 'White Vinyl Privacy (6x8)' },
    { style: "TV-ND 6'x6' Privacy", label: 'Tan Vinyl Privacy (6x6)' },
    { style: "WV-DS 6'x6' Privacy", label: 'White Vinyl Dig-Set (6x6)' },
    { style: "CL - 4' Galv", label: 'Chain Link 4ft Galvanized' },
    { style: "CL - 6' Galv", label: 'Chain Link 6ft Galvanized' },
    { style: "CL - 6' Black", label: 'Chain Link 6ft Black' },
    { style: "CL - Com 6'", label: 'Commercial Chain Link 6ft' },
    { style: "Alum - ND - Emily - 48", label: 'Aluminum (Emily 48)' },
  ]

  for (const s of samplesToRun) {
    try {
      const q = quickEstimate(s.style, 100, 1, 0)
      samplePricing.push(`- ${s.label}: ~$${q.pricePerFoot.toFixed(2)}/ft installed (100ft example: $${q.finalPrice.toLocaleString()})`)
    } catch { /* skip unavailable styles */ }
  }

  const basePrompt = `You are Alex, the virtual sales assistant for ${COMPANY_NAME}, a professional fence installation company in Florida. You are friendly, confident, and knowledgeable — not robotic.

YOUR JOB:
1. Qualify leads by collecting project details naturally through conversation
2. Give accurate price estimates using the pricing data below
3. Guide customers toward scheduling a free in-person estimate
4. Answer questions about fencing materials, timelines, permits, durability

PRICING (per linear foot installed, including standard 1 walk gate):
${samplePricing.join('\n')}

Gates add to the price:
- Walk gate: ~$140-200 extra
- Double gate: ~$280-400 extra

IMPORTANT PRICING RULES:
- These are REAL calculated prices from our system, not ranges
- Present them as estimates: "Based on [footage] of [type], your project would be approximately $X,XXX"
- Always mention "We can confirm the exact price with a free in-person estimate"
- NEVER share internal costs, margins, COGS, or markup formulas
- NEVER share material costs or labor rates

QUALIFICATION — Collect these naturally through conversation:
1. Fence type (vinyl, chain link, aluminum, etc.)
2. Approximate linear footage
3. Number of gates needed
4. Property type (residential / commercial)
5. Zip code or city
6. Timeline (ASAP, 1-3 months, 3-6 months)
7. Budget range (optional)

WHEN YOU HAVE ENOUGH INFO TO QUOTE:
Use the calculate_estimate tool to get a real price. Then present it naturally.

BOOKING — Once they seem interested, collect:
- Name
- Phone number
- Email
- Property address
- Preferred time for estimate visit

When you have their contact info, use the submit_lead tool.

OBJECTION HANDLING:
- "Too expensive" → "I get it — fencing is an investment. We offer financing, and our materials come with manufacturer warranties. Want me to have someone come out for exact numbers? No obligation."
- "Just comparing" → "Smart! Make sure you're comparing same materials and warranty. We'd love to be one of your estimates — completely free."
- "Need to think" → "No rush! Want me to get you on the schedule for a free estimate so you have real numbers? You can always reschedule."

RULES:
- Keep responses concise — 2-3 sentences max unless they ask for detail
- Never badmouth competitors
- If you can't answer something, offer to connect them with a team member
- If they ask for a human, collect name + phone and submit the lead
- Start the conversation with a friendly greeting and ask what they're looking for

AVAILABLE FENCE STYLES:
${styles.map(s => `- ${s.name} (${s.category})`).join('\n')}
`

  // Append knowledge base entries
  const kb = await loadKnowledgeBase()
  if (kb) {
    return basePrompt + '\n' + kb + '\n\nUse the knowledge base above to answer customer questions accurately. If a topic is covered in the knowledge base, reference that information.'
  }

  return basePrompt
}

// ── Tool definitions for Claude ──
const TOOLS = [
  {
    name: 'calculate_estimate',
    description: 'Calculate a real fence project estimate based on the project details collected from the customer. Call this when you have the fence type and approximate footage.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fenceStyle: {
          type: 'string' as const,
          description: 'The exact fence style name from the available styles list (e.g., "WV-ND 6\'x6\' Privacy", "CL - 6\' Galv")',
        },
        linearFootage: {
          type: 'number' as const,
          description: 'Total linear feet of fence needed',
        },
        walkGates: {
          type: 'number' as const,
          description: 'Number of walk gates (default 1)',
        },
        dblGates: {
          type: 'number' as const,
          description: 'Number of double/drive gates (default 0)',
        },
      },
      required: ['fenceStyle', 'linearFootage'],
    },
  },
  {
    name: 'submit_lead',
    description: 'Submit the lead to the CRM when you have collected contact information from the customer. Call this when you have at least a name and phone or email.',
    input_schema: {
      type: 'object' as const,
      properties: {
        firstName: { type: 'string' as const },
        lastName: { type: 'string' as const },
        email: { type: 'string' as const },
        phone: { type: 'string' as const },
        address: { type: 'string' as const },
        city: { type: 'string' as const },
        zipCode: { type: 'string' as const },
        fenceType: { type: 'string' as const },
        linearFootage: { type: 'number' as const },
        propertyType: { type: 'string' as const, enum: ['residential', 'commercial'] },
        timeline: { type: 'string' as const, enum: ['asap', 'one_to_three_months', 'three_to_six_months', 'just_looking'] },
        notes: { type: 'string' as const },
      },
      required: ['firstName'],
    },
  },
]

// ── Handle tool calls ──
async function handleToolCall(name: string, input: Record<string, unknown>, sessionId: string): Promise<string> {
  if (name === 'calculate_estimate') {
    try {
      const style = input.fenceStyle as string
      const footage = input.linearFootage as number
      const walkGates = (input.walkGates as number) || 1
      const dblGates = (input.dblGates as number) || 0

      const quote = quickEstimate(style, footage, walkGates, dblGates)

      return JSON.stringify({
        fenceStyle: quote.fenceStyleDisplay,
        totalFootage: quote.totalFootage,
        sections: quote.sections,
        estimatedPrice: quote.finalPrice,
        pricePerFoot: quote.pricePerFoot,
        walkGates,
        dblGates,
      })
    } catch (err) {
      return JSON.stringify({ error: `Could not calculate: ${err instanceof Error ? err.message : 'unknown style'}` })
    }
  }

  if (name === 'submit_lead') {
    try {
      const scoring = scoreLead({
        fenceType: input.fenceType as string,
        linearFootage: input.linearFootage as number,
        propertyType: input.propertyType as string,
        timeline: input.timeline as string,
        email: input.email as string,
        phone: input.phone as string,
        address: input.address as string,
        zipCode: input.zipCode as string,
      })

      const tags: string[] = []
      if (input.fenceType) tags.push(input.fenceType as string)
      if (input.timeline) tags.push(input.timeline as string)
      if (input.propertyType) tags.push(input.propertyType as string)
      if (scoring.total >= 70) tags.push('high_priority')

      const lead = await prisma.lead.create({
        data: {
          firstName: input.firstName as string || null,
          lastName: input.lastName as string || null,
          email: input.email as string || null,
          phone: input.phone as string || null,
          address: input.address as string || null,
          city: input.city as string || null,
          zipCode: input.zipCode as string || null,
          fenceType: input.fenceType as string || null,
          linearFootage: input.linearFootage ? Number(input.linearFootage) : null,
          propertyType: input.propertyType as string || null,
          timeline: input.timeline as any || null,
          notes: input.notes as string || null,
          source: 'website_chat',
          score: scoring.total,
          scoringDetails: JSON.parse(JSON.stringify(scoring)),
          tags,
          stage: scoring.total >= 60 ? 'qualified' : 'new_lead',
          botpressConversationId: sessionId,
        },
      })

      // Fire-and-forget SMS + follow-ups
      if (input.phone) {
        sendLeadConfirmation(input.phone as string, input.firstName as string).catch(() => {})
        scheduleFollowUps(lead.id).catch(() => {})
      }

      await writeAuditLog(null, 'lead_created', {
        leadId: lead.id,
        score: scoring.total,
        source: 'website_chat',
      })

      console.log(`[LeadChat] Lead created: ${lead.id} | Score: ${scoring.total} | Priority: ${leadPriority(scoring.total)}`)

      return JSON.stringify({
        success: true,
        leadId: lead.id,
        score: scoring.total,
        message: 'Lead submitted successfully',
      })
    } catch (err) {
      console.error('[LeadChat] Submit lead error:', err)
      return JSON.stringify({ error: 'Failed to submit lead' })
    }
  }

  return JSON.stringify({ error: 'Unknown tool' })
}

// ── In-memory session store (simple — use Redis in production) ──
interface ChatSession {
  messages: { role: 'user' | 'assistant'; content: string }[]
  createdAt: number
}

const sessions = new Map<string, ChatSession>()

// Clean up sessions older than 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(id)
  }
}, 15 * 60 * 1000)

// ── Chat endpoint ──
const messageSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1).max(2000),
})

router.post('/message', async (req, res) => {
  try {
    const { sessionId, message } = messageSchema.parse(req.body)

    // Get or create session
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { messages: [], createdAt: Date.now() })
    }
    const session = sessions.get(sessionId)!

    // Add user message
    session.messages.push({ role: 'user', content: message })

    // Call AI
    const response = await getAIResponse(session.messages, sessionId)

    // Add assistant response
    session.messages.push({ role: 'assistant', content: response })

    res.json({ success: true, data: { reply: response, sessionId } })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    console.error('[LeadChat] Error:', err)
    res.status(500).json({ success: false, error: 'Failed to process message' })
  }
})

// Get session history (for page refreshes)
router.get('/session/:sessionId', (req, res) => {
  const sessionId = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId
  const session = sessions.get(sessionId || '')
  if (!session) {
    res.json({ success: true, data: { messages: [] } })
    return
  }
  res.json({ success: true, data: { messages: session.messages } })
})

// ── AI Response with tool use ──
async function getAIResponse(messages: { role: string; content: string }[], sessionId: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    return getFallbackResponse(messages[messages.length - 1]?.content || '')
  }

  try {
    const systemPrompt = await buildSystemPrompt()

    // Initial API call
    let apiMessages: { role: 'user' | 'assistant'; content: any }[] = messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    let response = await callClaude(systemPrompt, apiMessages)

    // Handle tool use loop (max 3 iterations)
    let iterations = 0
    while (response.stop_reason === 'tool_use' && iterations < 3) {
      iterations++

      const toolUseBlocks = response.content.filter((b: any) => b.type === 'tool_use')
      const textBlocks = response.content.filter((b: any) => b.type === 'text')

      // Build assistant message with all content blocks
      apiMessages = [
        ...apiMessages,
        { role: 'assistant' as const, content: response.content },
      ]

      // Process each tool call and add results
      const toolResults: any[] = []
      for (const toolUse of toolUseBlocks) {
        const result = await handleToolCall(toolUse.name, toolUse.input, sessionId)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        })
      }

      apiMessages = [
        ...apiMessages,
        { role: 'user' as const, content: toolResults },
      ]

      response = await callClaude(systemPrompt, apiMessages)
    }

    // Extract final text
    const textContent = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')

    return textContent || 'How can I help you with your fence project?'
  } catch (err) {
    console.error('[LeadChat] AI error:', err)
    return getFallbackResponse(messages[messages.length - 1]?.content || '')
  }
}

async function callClaude(system: string, messages: any[]): Promise<any> {
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
      system,
      messages,
      tools: TOOLS,
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error('[LeadChat] Claude API error:', res.status, errText)
    throw new Error(`Claude API ${res.status}`)
  }

  return res.json()
}

// ── Fallback when no AI key ──
function getFallbackResponse(message: string): string {
  const lower = message.toLowerCase()

  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey'))
    return `Hey there! I'm Alex from ${COMPANY_NAME}. Looking to get a fence quote or have questions? I can help with pricing, materials, timelines — you name it!`

  if (lower.includes('price') || lower.includes('cost') || lower.includes('how much') || lower.includes('quote') || lower.includes('estimate'))
    return `Great question! Our pricing depends on the fence type, footage, and layout. For a rough idea: vinyl privacy runs about $30-35/ft installed, chain link around $12-18/ft, and aluminum about $30-40/ft. Want me to calculate a more specific estimate? Just tell me what type of fence and how many feet you need!`

  if (lower.includes('vinyl'))
    return `Vinyl is our most popular option! Our white vinyl privacy fence (6x6) runs about $32-35 per foot installed. It's low-maintenance, looks great, and comes with a manufacturer warranty. How many linear feet are you thinking?`

  if (lower.includes('chain') || lower.includes('chainlink'))
    return `Chain link is a great budget-friendly option! Galvanized runs about $12-15/ft, and black vinyl-coated is about $18-22/ft installed. How many feet do you need?`

  if (lower.includes('aluminum'))
    return `Aluminum fencing is beautiful and durable — great for pools and front yards. Our Emily style runs about $30-35/ft installed. How much footage are you looking at?`

  if (lower.includes('schedule') || lower.includes('appointment') || lower.includes('come out'))
    return `I'd love to get you on the schedule for a free estimate! Can you share your name, phone number, and the property address? Our team will reach out to confirm a time.`

  if (lower.includes('gate'))
    return `Gates are an important part of the project! Walk gates typically add $140-200 to the total, and double/drive gates add $280-400 depending on the style. How many of each do you need?`

  return `I can help you with fence pricing, materials, and scheduling a free estimate. What type of fence are you interested in? We do vinyl, chain link, aluminum, and commercial fencing.`
}

export default router
