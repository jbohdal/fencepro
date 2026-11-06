/**
 * A new lead's texts, sent from Jonathan's own phone, never by Twilio
 * (Jonathan, Nov 6 2026: "switch both to the tap to send versions you
 * suggested: 'Text [name] thanks' on the new lead's card and in the push;
 * follow ups 1/2/3 as Today tasks that close when they book").
 *
 * When a website or phone lead comes in with a phone number (lib/intake.ts,
 * widgetDrawQuote.ts, widgetPartialLead.ts, beside its push), four tasks are
 * made, each with the text ready (Today's "Send the text" opens the phone's
 * Messages with it written; the person presses send):
 *
 *   thanks       at once      "Thanks for reaching out ..."; also the
 *                             "Text <name> thanks" button on the lead's card
 *                             and its Assign screen (where the push opens),
 *                             until it is sent or marked done
 *   follow up 1  24 hours     "... would you like to schedule a free estimate?"
 *   follow up 2  3 days       "... want us to swing by for a quick estimate?"
 *   follow up 3  7 days       "... last check-in ..."
 *
 * The words are the ones Twilio used to send, with the company name in front
 * and "Reply STOP to opt out." at the end (lib/customerText.ts). No yes to
 * texts is needed: the person sends it from their own phone.
 *
 * The follow ups close by themselves once the lead books (an appointment on
 * the customer, or on another customer with the same phone), its card is
 * finished (sold, lost) or the customer is gone; the thanks closes on the
 * last two only. A lead that booked when it came in (the website chat) gets
 * no follow ups, and the same person sending again gets no second set.
 * The automation worker's sweep checks every 5 minutes (closeBookedLeadTexts).
 *
 * Whose list: nobody's until the lead is assigned (the owner's and the
 * office's Today list the company's tasks that name nobody), then the person
 * it was assigned to (lib/leadAssign.ts assignLead, moveLeadTexts).
 */

import prisma from './prisma.js'
import { withLock } from './once.js'
import { customerText } from './customerText.js'
import { loadPipelineStages } from './pipelineStages.js'
import { isFinishedStage } from './pipelineStageModel.js'

export type LeadTextKind = 'thanks' | 'f1' | 'f2' | 'f3'

const COMPANY = () => process.env.COMPANY_NAME || 'Getter Done Fence'
const HOUR = 3_600_000

/** sms: link with the text filled in ("?&body=" opens it on both iPhone and Android), as automations' tasks write it. */
const smsLink = (phone: string, body: string) => `sms:${phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(body)}`

/** The texts, in order: when each is due after the lead came in, its task title and its words. */
export const LEAD_TEXTS: Array<{ kind: LeadTextKind; afterHours: number; title: (name: string) => string; words: (first: string) => string }> = [
  { kind: 'thanks', afterHours: 0, title: n => `Text ${n} thanks`, words: f => `Thanks for reaching out${f === 'there' ? '' : ` ${f}`}! We received your info and we'll confirm your estimate shortly.` },
  { kind: 'f1', afterHours: 24, title: n => `Text ${n}: follow up 1 of 3`, words: f => `Hi ${f}, we noticed you were looking into fence options. Would you like to schedule a free estimate? Just reply with a good time!` },
  { kind: 'f2', afterHours: 72, title: n => `Text ${n}: follow up 2 of 3`, words: f => `Hey ${f}, just following up. We'd love to help with your fence project. Want us to swing by for a quick estimate?` },
  { kind: 'f3', afterHours: 168, title: n => `Text ${n}: follow up 3 of 3`, words: f => `Hi ${f}, last check-in from us! If you're still considering a fence, we're here to help. Feel free to reach out anytime.` },
]

/** createdBy of a lead text's task: `lead-texts:<customer id>:<kind>`. */
export const leadTextKey = (contactId: string, kind: LeadTextKind) => `lead-texts:${contactId}:${kind}`
const PREFIX = 'lead-texts:'
const kindOf = (createdBy: string | null): LeadTextKind | null => (createdBy?.startsWith(PREFIX) ? (createdBy.split(':')[2] as LeadTextKind) : null)
const contactOf = (createdBy: string | null): string | null => (createdBy?.startsWith(PREFIX) ? createdBy.split(':')[1] : null)

/** The whole text as the customer reads it: "Getter Done Fence: Thanks for reaching out Jane! ... Reply STOP to opt out." */
export function leadText(kind: LeadTextKind, firstName: string | null | undefined, company = COMPANY()): string {
  const word = String(firstName ?? '').trim().split(/\s+/)[0] ?? ''
  const first = /^[A-Za-z][A-Za-z'.-]*$/.test(word) && !/^unknown$/i.test(word) ? word : 'there'
  return customerText(LEAD_TEXTS.find(t => t.kind === kind)!.words(first), company)
}

/** A task's description: the words, then the sms: link Today shows as "Send the text". */
export function leadTextDescription(kind: LeadTextKind, phone: string, firstName: string | null | undefined, company = COMPANY()): string {
  const text = leadText(kind, firstName, company)
  return `${text}\n${smsLink(phone, text)}`
}

export interface LeadTextStart {
  accountId: string; contactId: string; name: string; phone?: string | null; cardId?: string | null; arrivedAt?: Date; assignedTo?: string | null
  /** The name the texts say "Hi" to; null when the lead gave none ("Hi there"). Left out: the first word of `name`. */
  firstName?: string | null
  /** Booked when it came in (a website chat booking): the thanks only. */
  booked?: boolean
}

/** In the background, beside the lead's push: never slows or fails the intake. */
const inFlight = new Set<Promise<unknown>>()
export function startLeadTextsSoon(s: LeadTextStart): void {
  const p = startLeadTexts(s)
    .catch(err => console.error('[lead-texts] making the tasks failed:', String((err as Error)?.message || err).slice(0, 200)))
    .finally(() => { inFlight.delete(p) })
  inFlight.add(p)
}
export async function leadTextsSettled(): Promise<void> {
  while (inFlight.size) await Promise.allSettled([...inFlight])
}

/** The last 10 digits of a phone: how the same person is known across customers (each website lead is a new customer). */
const digitsOf = (phone: string | null | undefined) => String(phone ?? '').replace(/\D/g, '').slice(-10)

/** Customers of the company with this phone number (this one included). */
async function samePhone(accountId: string, contactId: string, phone: string): Promise<string[]> {
  const d = digitsOf(phone)
  if (d.length < 7) return [contactId]
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "CrmContact" WHERE "accountId" = ${accountId} AND "deletedAt" IS NULL AND right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = ${d}`
  return [...new Set([contactId, ...rows.map(r => r.id)])]
}

/**
 * Make the lead's four tasks (only the thanks when it already booked; none without a phone). Once per person: a
 * second lead from the same phone number (a new customer each time) makes none while the first one's texts are
 * open, and none at all once that person booked a visit (review Nov 6 2026).
 */
export async function startLeadTexts(s: LeadTextStart): Promise<number> {
  const phone = String(s.phone ?? '').trim()
  if (!phone.replace(/\D/g, '')) return 0
  const at = s.arrivedAt ?? new Date()
  const people = await samePhone(s.accountId, s.contactId, phone)
  const booked = s.booked || await prisma.appointment.count({ where: { accountId: s.accountId, crmContactId: { in: people }, deletedAt: null } }) > 0
  const card = s.cardId ?? await cardOf(s.accountId, s.contactId)
  const name = String(s.name || '').trim() || 'the new lead'
  const first = s.firstName !== undefined ? s.firstName : name
  return withLock(`lead-texts:${digitsOf(phone) || s.contactId}`, async tx => {
    const had = await tx.task.count({ where: { createdBy: { startsWith: `${PREFIX}${s.contactId}:` } } })
    if (had) return 0
    // The same person already has texts waiting, or booked from an earlier lead: nothing more to send.
    const others = people.filter(id => id !== s.contactId)
    if (others.length && await tx.task.count({ where: { status: { in: ['pending', 'in_progress'] }, OR: others.map(id => ({ createdBy: { startsWith: `${PREFIX}${id}:` } })) } })) return 0
    if (others.length && booked && !s.booked) return 0
    let made = 0
    for (const t of LEAD_TEXTS) {
      if (booked && t.kind !== 'thanks') continue
      await tx.task.create({
        data: {
          title: t.title(name).slice(0, 200), description: leadTextDescription(t.kind, phone, first),
          assignedTo: s.assignedTo?.trim() || null, jobId: card, jobName: name,
          dueDate: new Date(at.getTime() + t.afterHours * HOUR), createdBy: leadTextKey(s.contactId, t.kind), priority: t.kind === 'thanks' ? 'high' : 'normal',
        },
      })
      made++
    }
    return made
  })
}

/** The customer's open card on the Sales Pipeline, if any (the task names it, so a deleted customer's tasks drop off Today). */
async function cardOf(accountId: string, contactId: string): Promise<string | null> {
  const board = await prisma.pipelineState.findUnique({ where: { accountId }, select: { leads: true } }).catch(() => null)
  const card = ((board?.leads as any[]) ?? []).find(l => l && typeof l === 'object' && l.customerId === contactId)
  return typeof card?.id === 'string' ? card.id : null
}

/** The lead's thanks text while it is still to send (the card's and the Assign screen's button), else null. */
export async function openThanks(contactId: string): Promise<{ taskId: string; text: string; phone: string } | null> {
  const t = await prisma.task.findFirst({ where: { createdBy: leadTextKey(contactId, 'thanks'), status: { in: ['pending', 'in_progress'] } }, select: { id: true, description: true } })
  if (!t?.description) return null
  const [text, link] = t.description.split('\n')
  const phone = /^sms:([^?]+)/.exec(link ?? '')?.[1] ?? ''
  return { taskId: t.id, text, phone }
}

/** The thanks was sent (the button was tapped): its task is done. */
export async function markThanksSent(contactId: string): Promise<boolean> {
  const r = await prisma.task.updateMany({ where: { createdBy: leadTextKey(contactId, 'thanks'), status: { in: ['pending', 'in_progress'] } }, data: { status: 'completed', completedAt: new Date() } })
  return r.count > 0
}

/** The lead was assigned: its open texts go on that person's list. */
export async function moveLeadTexts(contactId: string, to: string): Promise<number> {
  const r = await prisma.task.updateMany({ where: { createdBy: { startsWith: `${PREFIX}${contactId}:` }, status: { in: ['pending', 'in_progress'] } }, data: { assignedTo: to.trim() || null } })
  return r.count
}

const day = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric' })

/**
 * Close the follow ups of leads that booked (an appointment on the customer), whose card is finished (sold,
 * lost), or whose customer is deleted or archived. The thanks stays until it is sent. Each closed task's
 * description ends "Closed by itself on <date>: <why>." as the other self closing tasks do.
 */
export async function closeBookedLeadTexts(now = new Date()): Promise<number> {
  const open = await prisma.task.findMany({ where: { createdBy: { startsWith: PREFIX }, status: { in: ['pending', 'in_progress'] } }, select: { id: true, createdBy: true, description: true } })
  const follow = open
  if (!follow.length) return 0
  const ids = [...new Set(follow.map(t => contactOf(t.createdBy)!).filter(Boolean))]
  const contacts = await prisma.crmContact.findMany({ where: { id: { in: ids } }, select: { id: true, accountId: true, deletedAt: true, archivedAt: true, phone: true } })
  const byId = new Map(contacts.map(c => [c.id, c]))
  // Booked: an appointment on the customer, or on another customer with the same phone (the same person, an earlier lead).
  const booked = new Set<string>()
  for (const c of contacts) {
    const people = c.accountId && c.phone ? await samePhone(c.accountId, c.id, c.phone) : [c.id]
    if (await prisma.appointment.count({ where: { crmContactId: { in: people }, deletedAt: null } })) booked.add(c.id)
  }
  const accounts = [...new Set(contacts.map(c => c.accountId).filter((x): x is string => !!x))]
  const finished = new Set<string>()
  for (const accountId of accounts) {
    const [board, stages] = await Promise.all([
      prisma.pipelineState.findUnique({ where: { accountId }, select: { leads: true } }),
      loadPipelineStages(accountId).then(s => s.stages).catch(() => []),
    ])
    const cards = ((board?.leads as any[]) ?? []).filter(l => l && typeof l === 'object' && ids.includes(l.customerId))
    for (const id of ids) {
      const mine = cards.filter(l => l.customerId === id)
      if (mine.length && mine.every(l => isFinishedStage(stages, l.stage))) finished.add(id)
    }
  }
  let closed = 0
  for (const t of follow) {
    const id = contactOf(t.createdBy)!
    const c = byId.get(id)
    const why = !c || c.deletedAt || c.archivedAt ? 'the customer is no longer on file' : booked.has(id) ? 'they booked a visit' : finished.has(id) ? 'their card is sold or lost' : null
    // The thanks stays to send after they book; it closes only when the customer is gone or the card finished.
    if (!why || (kindOf(t.createdBy) === 'thanks' && why === 'they booked a visit')) continue
    const r = await prisma.task.updateMany({
      where: { id: t.id, status: { in: ['pending', 'in_progress'] } },
      data: { status: 'completed', completedAt: now, description: `${t.description ?? ''}\nClosed by itself on ${day(now)}: ${why}.`.slice(0, 4000) },
    })
    closed += r.count
  }
  return closed
}

/** For the tests' clean up: these customers' lead texts, once any still being made in the background are made. */
export async function removeLeadTextsOf(contactIds: string[]): Promise<number> {
  await leadTextsSettled()
  if (!contactIds.length) return 0
  const r = await prisma.task.deleteMany({ where: { OR: contactIds.map(id => ({ createdBy: { startsWith: `${PREFIX}${id}:` } })) } })
  return r.count
}
