/**
 * A quote sent from the website widget (/p/quote): the customer, the quote
 * and the pipeline card are saved together in one transaction, so EZ Biz
 * never has one without the others. The price is worked out again here from
 * the yard and style (the quote builder's math), never taken from the page.
 *
 * Sending the same quote twice (the customer's phone did not hear the
 * answer) returns the first one: the page's submission id is the key.
 */

import crypto from 'crypto'
import prisma from './prisma.js'
import { estimateJob } from './estimates.js'
import { findOrCreateContact, resolveIntakeAccountId } from './intake.js'
import { applyPipelineDelta } from './pipelineDelta.js'
import { recordCardMoves } from './automations/hooks.js'

export interface WidgetSubmission {
  submissionId: string
  name: string
  phone: string
  email?: string
  address: string
  fenceStyle: string
  /** What the customer picked, in words ("Vinyl, Privacy, 6 ft sections, no dig, 6ft, White"). */
  choice: string
  /** The yard as drawn (web/src/yardLayout.ts YardLayout). */
  yard?: unknown
  runs: number[]
  corners: number
  ends: number
  walkGates: number
  dblGates: number
  wantsVisit: boolean
  notes?: string
  photos?: string[]
}

export interface WidgetResult { quoteId: string; contactId: string; cardId: string; price: number; duplicate: boolean }

const DEFAULT_FIRST_STAGE = 'First Contact'
class PipelineBusy extends Error {}
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export async function submitWidgetQuote(input: WidgetSubmission): Promise<WidgetResult> {
  const accountId = await resolveIntakeAccountId()
  if (!accountId) throw new Error('No company is set up on this server yet')

  const already = await prisma.intakeLead.findUnique({ where: { source_sourceRef: { source: 'ez_quote', sourceRef: input.submissionId } } })
  if (already) {
    const p = (already.payload ?? {}) as Record<string, unknown>
    return { quoteId: String(p.quoteId ?? ''), contactId: already.crmContactId ?? '', cardId: String(p.cardId ?? ''), price: already.estimate ?? 0, duplicate: true }
  }

  const job = { fenceStyle: input.fenceStyle, runs: input.runs, corners: input.corners, ends: input.ends, walkGates: input.walkGates, dblGates: input.dblGates }
  const est = await estimateJob(job)
  const price = Math.round(est.price)
  const today = day()
  const summary = [
    'Website quote (instant quote page)',
    `${est.totalFootage} ft of ${input.choice}`,
    input.walkGates || input.dblGates ? `Gates: ${input.walkGates} walk, ${input.dblGates} double` : 'No gates',
    `Estimate shown to the customer: ${money(price)}`,
    `Asked for an on site estimate: ${input.wantsVisit ? 'yes' : 'no'}`,
    input.address ? `Address: ${input.address}` : '',
    input.photos?.length ? `Photos: ${input.photos.length}\n${input.photos.join('\n')}` : '',
    input.notes ? `Customer notes: ${input.notes}` : '',
  ].filter(Boolean).join('\n')

  let out: WidgetResult | null = null
  for (let attempt = 0; attempt < 5 && !out; attempt++) {
    try {
      out = await prisma.$transaction(async tx => {
        const contact = await findOrCreateContact(accountId, { name: input.name, phone: input.phone, email: input.email, address: input.address, leadSource: 'Website Quote' }, tx)
        const quote = await tx.savedQuote.create({
          data: {
            accountId, crmContactId: contact.id,
            customerName: contact.created ? input.name : (contact.name || input.name),
            customerPhone: input.phone, customerEmail: input.email ?? '', customerAddress: input.address,
            leadSource: 'Website Quote',
            fenceStyle: est.style.name, runs: input.runs, corners: input.corners, ends: input.ends, walkGates: input.walkGates, dblGates: input.dblGates,
            layout: JSON.parse(JSON.stringify({ yard: input.yard ?? null, runSections: est.perRunSections })),
            sections: est.sections, materialCost: est.materialCost, laborCost: est.laborCost, tearOutCost: est.tearOutCost, totalCOGS: est.totalCOGS,
            finalPrice: est.price, gmPct: est.gmPct, pullSheet: JSON.parse(JSON.stringify(est.pullSheet)),
            status: 'DRAFT', date: today,
            notes: `From the website instant quote (an estimate the customer saw: ${money(price)}).${input.notes ? `\nCustomer notes: ${input.notes}` : ''}`,
          },
        })

        // One open card per customer: a second website quote updates it.
        const header = `Website quote ${today} · estimate shown ${money(price)}`
        const cur = await tx.pipelineState.findUnique({ where: { accountId } })
        const leads = ((cur?.leads as any[]) ?? [])
        const stages = ((cur?.stages as any[]) ?? [])
        const existing = leads.find(l => l?.customerId === contact.id)
        const [first, ...rest] = (contact.created ? input.name : (contact.name || input.name)).trim().split(/\s+/)
        const card = existing
          ? { ...existing, notes: [header, existing.notes].filter(Boolean).join('\n'), fenceType: existing.fenceType || input.choice, quotePrice: existing.quotePrice || price }
          : {
              id: crypto.randomUUID(), customerId: contact.id, firstName: first || 'Unknown', lastName: rest.join(' '),
              phone: input.phone, email: input.email ?? '', address: input.address, leadSource: 'Website Quote', leadTemp: 0,
              fenceType: input.choice, sections: est.sections, quotePrice: price, crew: '', scheduledDate: '', jobValue: 0,
              paymentStatus: '', balanceDue: 0, notes: header, stage: (stages[0] as string) || DEFAULT_FIRST_STAGE,
              createdAt: today, lastMoved: today, assignedRep: '',
            }
        if (!cur) {
          await tx.pipelineState.create({ data: { accountId, leads: [card], stages: [] } })
        } else {
          const next = applyPipelineDelta({ leads, stages }, { upsert: [{ lead: card, before: existing ? undefined : (leads[0]?.id ?? null) }], remove: [] })
          const done = await tx.pipelineState.updateMany({ where: { accountId, version: cur.version }, data: { leads: JSON.parse(JSON.stringify(next.leads)), version: { increment: 1 } } })
          if (done.count === 0) throw new PipelineBusy()
          // A new card (or one moved) is saved for automations in the same step.
          await recordCardMoves(accountId, leads, next.leads, cur.version + 1, tx)
        }

        // Kept as a website lead too (already on the pipeline, so the app does not add it again).
        await tx.intakeLead.create({
          data: {
            accountId, source: 'ez_quote', sourceRef: input.submissionId, crmContactId: contact.id, status: 'imported', importedAt: new Date(),
            name: input.name.slice(0, 200), phone: input.phone.slice(0, 40), email: (input.email ?? '').slice(0, 200), address: input.address.slice(0, 500),
            fenceType: input.choice.slice(0, 120), summary: summary.slice(0, 8000), estimate: price,
            payload: JSON.parse(JSON.stringify({ ...input, quoteId: quote.id, cardId: card.id })),
          },
        })
        await tx.crmContactNote.create({ data: { crmContactId: contact.id, accountId, body: summary.slice(0, 19000), isPinned: false, createdBy: 'Website instant quote' } })
        return { quoteId: quote.id, contactId: contact.id, cardId: card.id, price, duplicate: false }
      })
    } catch (e) {
      if (!(e instanceof PipelineBusy)) throw e
    }
  }
  if (!out) throw new Error('The pipeline was busy; try again')
  await prisma.notification.create({
    data: { title: `Website quote: ${input.name}`, body: `${input.choice} · ${est.totalFootage} ft · ${money(price)}`.slice(0, 400), type: 'info' },
  }).catch(err => console.error('[widget] notification failed:', err))
  return out
}
