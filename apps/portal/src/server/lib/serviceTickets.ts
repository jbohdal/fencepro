/**
 * Warranty and service requests (Jonathan, Oct 22 2026). The words and plain
 * rules are serviceTicketModel.ts; this is the database side.
 *
 *   pastCustomerBadges  every customer with a completed job: the warranty of
 *                       their latest install and its date ("Past customer ·
 *                       Lifetime Craftsmanship Warranty · installed Oct 20, 2026")
 *   jobContext          what the request form shows for a job: its warranty
 *                       (name, words, dates), a hint per issue, the customer's
 *                       texting answer
 *   tickets             made on a job, with the job's warranty and the hint as
 *                       they were that day; stages New → Photos requested →
 *                       Photos received → Scheduled → Fixed → Closed
 *   photo link          /p/s/<link>, no login, 14 days from the last "Ask for
 *                       photos"; what arrives (or comes in through the portal)
 *                       lands on the ticket as Internal, moves it to Photos
 *                       received and tells Jonathan and the customer's
 *                       card owner (bell and push; cardOwnerOf)
 *   decision            covered or not covered with a reason (owner and office);
 *                       covered work's cost entered at Fixed (ServiceWorkCost)
 *   report              tickets by month, covered vs not, cost of covered work
 *                       by style and installer
 *
 * Nothing here ever sends anything to a customer: "Ask for photos" makes the
 * link, and the office's own phone sends the text (an sms: link).
 */

import crypto from 'crypto'
import prisma from './prisma.js'
import { pricingModule, plainStyleName } from './estimates.js'
import { quoteWarranty, jobWarranty, nyDay, type OptionWarranty } from './warranties.js'
import { acknowledgedUpdate } from './warrantyUpdates.js'
import { serializeMedia } from './media.js'
import { landedCostOn } from './priceHistory.js'
import { toCents, qty } from './jobCostingMath.js'
import { peopleOf } from './followUps.js'
import { holdOutbound, realDeliveryAllowed } from './outboundGate.js'
import { describeTextConsent, asTextConsent } from './textConsentModel.js'
import {
  hintFor, hintsFor, warrantyKindOf, issueLabel, stageLabel, stageForCustomer, isOpenStage, HINT_LABEL, PHOTO_LINK_DAYS, serviceReport,
  type PastCustomerBadge, type Hint, type Issue, type Stage, type ReportTicket,
} from './serviceTicketModel.js'

export type TicketRow = NonNullable<Awaited<ReturnType<typeof prisma.serviceTicket.findUnique>>>
type Actor = { id: string | null; name: string }

const DONE_STATUSES = ['completed', 'invoiced', 'paid'] as const
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const DAY = /^\d{4}-\d{2}-\d{2}/
export const today = () => nyDay(new Date())
const err = (status: number, message: string) => Object.assign(new Error(message), { status })

async function configOf(accountId: string): Promise<unknown> {
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
  return b?.config ?? null
}

// ── Past customer badge ──────────────────────────────────────────────────────

const badgeCache = new Map<string, { at: number; stamp: string; list: PastCustomerBadge[] }>()
const BADGE_TTL_MS = 30_000
/** A job finished or a warranty changed: the next ask works the badges out again. */
export function forgetBadges(accountId: string) { badgeCache.delete(accountId) }

/**
 * Every customer with a completed job (Completed, Invoiced or Paid, or a
 * completed date): the warranty of their latest install (the signed option's,
 * or an acknowledged warranty update; Settings for the style when there is no
 * proposal) and its install date. Worked out for the whole company in a few
 * queries, kept 30 seconds while no job changes.
 */
export async function pastCustomerBadges(accountId: string): Promise<PastCustomerBadge[]> {
  // Kept 30 seconds, and only while no job changed (a job just marked complete shows at once).
  const agg = await prisma.savedJob.aggregate({ where: { accountId, deletedAt: null }, _max: { updatedAt: true }, _count: { _all: true } })
  const stamp = `${agg._count._all}:${agg._max.updatedAt?.getTime() ?? 0}`
  const hit = badgeCache.get(accountId)
  if (hit && hit.stamp === stamp && Date.now() - hit.at < BADGE_TTL_MS) return hit.list
  const jobs = await prisma.savedJob.findMany({
    where: { accountId, deletedAt: null, OR: [{ status: { in: [...DONE_STATUSES] } }, { completedDate: { not: null } }] },
    select: { id: true, quoteId: true, crmContactId: true, fenceStyle: true, completedDate: true },
  })
  const quoteIds = jobs.map(j => j.quoteId).filter((x): x is string => !!x)
  const [quotes, walks, acked, config] = await Promise.all([
    quoteIds.length ? prisma.savedQuote.findMany({
      where: { accountId, id: { in: quoteIds }, deletedAt: null },
      select: { id: true, accountId: true, proposal: true, chosenOption: true, fenceStyle: true, status: true, acceptedAt: true, soldAt: true, work: true, crmContactId: true },
    }) : [],
    prisma.walkthrough.findMany({ where: { accountId, jobId: { in: jobs.map(j => j.id) }, completedAt: { not: null } }, select: { jobId: true, completedAt: true } }),
    quoteIds.length ? prisma.warrantyUpdate.findMany({ where: { accountId, quoteId: { in: quoteIds }, acknowledgedAt: { not: null } }, select: { quoteId: true } }) : [],
    configOf(accountId),
  ])
  const qById = new Map(quotes.map(q => [q.id, q]))
  const walkDay = new Map(walks.map(w => [w.jobId, nyDay(w.completedAt!)]))
  const ackQuotes = new Set(acked.map(a => a.quoteId))
  const best = new Map<string, PastCustomerBadge>()
  for (const j of jobs) {
    const q = j.quoteId ? qById.get(j.quoteId) ?? null : null
    const customerId = j.crmContactId ?? q?.crmContactId ?? null
    if (!customerId) continue
    let warranty: OptionWarranty | null = (await quoteWarranty(q, j.fenceStyle, config)).warranty
    if (q && ackQuotes.has(q.id)) warranty = (await acknowledgedUpdate(q))?.warranty ?? warranty
    const installDate = j.completedDate && DAY.test(j.completedDate) ? j.completedDate.slice(0, 10) : walkDay.get(j.id) ?? null
    const was = best.get(customerId)
    const badge: PastCustomerBadge = { customerId, jobId: j.id, warrantyName: warranty?.name ?? null, installDate, jobs: (was?.jobs ?? 0) + 1 }
    // The latest install wins; a job with a date over one without.
    if (!was || (installDate ?? '') > (was.installDate ?? '')) best.set(customerId, badge)
    else was.jobs = badge.jobs
  }
  const list = [...best.values()]
  badgeCache.set(accountId, { at: Date.now(), stamp, list })
  return list
}

export async function pastCustomerBadge(accountId: string, customerId: string): Promise<PastCustomerBadge | null> {
  return (await pastCustomerBadges(accountId)).find(b => b.customerId === customerId) ?? null
}

// ── A job's warranty for the request form ────────────────────────────────────

export interface JobContext {
  jobId: string
  customerId: string | null
  customerName: string
  firstName: string
  phone: string
  address: string
  fenceStyle: string
  completed: boolean
  warranty: { id: string | null; name: string; text: string; term: string; years: number | null } | null
  installDate: string | null
  end: string | null
  endText: string
  kind: ReturnType<typeof warrantyKindOf>
  hints: Record<Issue, { hint: Hint; label: string; why: string }>
  textConsent: { state: 'yes' | 'no' | 'unknown'; words: string }
}

export async function jobContext(accountId: string, jobId: string): Promise<JobContext | null> {
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null } })
  if (!job) return null
  const w = await jobWarranty(accountId, job.id)
  const m = await pricingModule()
  const kind = warrantyKindOf({ term: w?.warranty?.term ?? 'none', installDate: w?.start ?? null, end: w?.end ?? null }, today())
  const endText = w?.end ? m.dayText(w.end) : null
  const hints = Object.fromEntries(Object.entries(hintsFor(kind, endText)).map(([k, r]) => [k, { hint: r.hint, label: HINT_LABEL[r.hint], why: r.why }])) as JobContext['hints']
  const contact = job.crmContactId ? await prisma.crmContact.findFirst({ where: { id: job.crmContactId, accountId } }) : null
  return {
    jobId: job.id, customerId: job.crmContactId, customerName: job.customerName || (contact ? `${contact.firstName} ${contact.lastName}`.trim() : ''),
    firstName: contact?.firstName || job.customerName.split(' ')[0] || '', phone: contact?.phone || job.customerPhone || '',
    address: job.customerAddress || contact?.serviceAddress || '', fenceStyle: await plainStyleName(job.fenceStyle),
    completed: (DONE_STATUSES as readonly string[]).includes(job.status) || !!job.completedDate,
    warranty: w?.warranty ? { id: w.warranty.id, name: w.warranty.name, text: w.warranty.text, term: w.warranty.term, years: w.warranty.years ?? null } : null,
    installDate: w?.start ?? null, end: w?.end ?? null, endText: w?.endText ?? 'No warranty on file', kind, hints,
    textConsent: { state: asTextConsent(contact?.textConsent), words: contact ? describeTextConsent({ textConsent: asTextConsent(contact.textConsent), textConsentAt: contact.textConsentAt?.toISOString() ?? null, textConsentBy: contact.textConsentBy, textConsentSource: contact.textConsentSource as any }) : 'No customer on this job' },
  }
}

// ── Tickets ──────────────────────────────────────────────────────────────────

export interface HistoryEntry { at: string; by: string; kind: string; text: string }
const historyOf = (t: { history: unknown }): HistoryEntry[] => (Array.isArray(t.history) ? t.history as unknown as HistoryEntry[] : [])
const entry = (by: string, kind: string, text: string): HistoryEntry => ({ at: new Date().toISOString(), by, kind, text })

/** Make a ticket on a job. `id`: the screen's own id, so a second tap makes one ticket. */
export async function createTicket(accountId: string, actor: Actor, b: { id?: string; jobId: string; issue: Issue; notes: string }): Promise<TicketRow> {
  if (b.id) {
    const again = await prisma.serviceTicket.findUnique({ where: { id: b.id } })
    if (again) { if (again.accountId !== accountId) throw err(409, 'Invalid id'); return again }
  }
  const ctx = await jobContext(accountId, b.jobId)
  if (!ctx) throw err(404, 'Job not found')
  const job = (await prisma.savedJob.findUnique({ where: { id: b.jobId }, select: { quoteId: true } }))!
  const m = await pricingModule()
  const h = hintFor(ctx.kind, b.issue, ctx.end ? m.dayText(ctx.end) : null)
  try {
    const made = await prisma.serviceTicket.create({
      data: {
        ...(b.id ? { id: b.id } : {}), accountId, jobId: ctx.jobId, crmContactId: ctx.customerId, quoteId: job.quoteId ?? null,
        issue: b.issue, notes: b.notes, stage: 'new',
        warrantyId: ctx.warranty?.id ?? null, warrantyName: ctx.warranty?.name ?? '', warrantyText: ctx.warranty?.text ?? '',
        warrantyTerm: ctx.warranty?.term ?? 'none', warrantyYears: ctx.warranty?.years ?? null, installDate: ctx.installDate, warrantyEnd: ctx.end,
        hint: h.hint, hintWhy: h.why, createdBy: actor.name, createdById: actor.id,
        history: [entry(actor.name, 'made', `${issueLabel(b.issue)}. ${HINT_LABEL[h.hint]}: ${h.why}`)] as any,
      },
    })
    return made
  } catch (e) {
    if ((e as any)?.code === 'P2002' && b.id) { const won = await prisma.serviceTicket.findUnique({ where: { id: b.id } }); if (won) return won }
    throw e
  }
}

/** The ticket, in this company, not deleted. */
export async function ticketOf(accountId: string, id: string): Promise<TicketRow | null> {
  return prisma.serviceTicket.findFirst({ where: { id, accountId, deletedAt: null } })
}

/** A change to a ticket, with its history line; the version goes up so other screens load it again. */
async function change(t: TicketRow, data: Record<string, unknown>, h: HistoryEntry | null): Promise<TicketRow> {
  return prisma.serviceTicket.update({
    where: { id: t.id },
    data: { ...data, ...(h ? { history: [...historyOf(t), h] as any } : {}), version: { increment: 1 } },
  })
}

export const linkPath = (token: string) => `/p/s/${token}`
export const linkOpen = (t: { uploadToken: string | null; uploadExpiresAt: Date | null }, now = Date.now()) => !!t.uploadToken && !!t.uploadExpiresAt && t.uploadExpiresAt.getTime() > now

/**
 * "Ask for photos": the ticket's no login link, open 14 days from now (the
 * same link again when it is still open), and the ticket at Photos requested.
 */
export async function askForPhotos(t: TicketRow, actor: Actor): Promise<TicketRow> {
  if (!isOpenStage(t.stage)) throw err(409, 'This request is closed.')
  const token = linkOpen(t) ? t.uploadToken! : crypto.randomBytes(24).toString('base64url')
  const expires = new Date(Date.now() + PHOTO_LINK_DAYS * 86_400_000)
  const stage: Stage = t.stage === 'new' ? 'photos_requested' : t.stage as Stage
  return change(t, { uploadToken: token, uploadExpiresAt: expires, photosRequestedAt: new Date(), stage },
    entry(actor.name, 'photos_asked', `Asked for photos (link open until ${nyDay(expires)}).`))
}

/** Move the ticket by hand (any stage but Fixed, which carries the work's cost). */
export async function setStage(t: TicketRow, stage: Stage, actor: Actor, note = ''): Promise<TicketRow> {
  if (stage === t.stage) return t
  const data: Record<string, unknown> = { stage }
  if (stage === 'closed') data.closedAt = new Date()
  if (t.stage === 'closed') data.closedAt = null
  if (stage === 'photos_received' && !t.photosReceivedAt) data.photosReceivedAt = new Date()
  return change(t, data, entry(actor.name, stage === 'closed' ? 'closed' : t.stage === 'closed' ? 'reopened' : 'stage', `${stageLabel(t.stage)} → ${stageLabel(stage)}${note ? `: ${note}` : ''}`))
}

/** Covered or not covered, with why (null: undecided again). */
export async function decide(t: TicketRow, d: { decision: 'covered' | 'not_covered' | null; reason: string; shared: boolean }, actor: Actor): Promise<TicketRow> {
  const words = d.decision === 'covered' ? 'Covered' : d.decision === 'not_covered' ? 'Not covered' : 'Undecided'
  return change(t, {
    decision: d.decision, decisionReason: d.decision ? d.reason : '', decisionBy: d.decision ? actor.name : null, decisionAt: d.decision ? new Date() : null,
    decisionShared: d.decision ? d.shared : false,
  }, entry(actor.name, 'decided', `${words}${d.reason ? `: ${d.reason}` : ''}${d.decision && d.shared ? ' (shown to the customer)' : ''}`))
}

/** The service appointment that books the visit (made with the app's booking dialog): the ticket is Scheduled. */
export async function linkAppointment(t: TicketRow, appointmentId: string, actor: Actor): Promise<TicketRow> {
  const a = await prisma.appointment.findFirst({ where: { id: appointmentId }, select: { id: true, accountId: true, startAt: true, jobId: true, type: true } })
  if (a && a.accountId !== t.accountId) throw err(404, 'Appointment not found')
  // Booked on a phone with no signal: it reaches the server after this; the ticket shows it once it does (ticketView).
  if (a && !a.jobId) await prisma.appointment.update({ where: { id: a.id }, data: { jobId: t.jobId, version: { increment: 1 } } })
  const stage: Stage = t.stage === 'fixed' || t.stage === 'closed' ? t.stage as Stage : 'scheduled'
  return change(t, { appointmentId, scheduledAt: new Date(), stage }, entry(actor.name, 'booked', `Visit booked${a?.startAt ? ` for ${nyDay(a.startAt)}` : ''}.`))
}

export interface CostInput {
  fixedOn: string
  crew: Array<{ name: string; hours: number }>
  materials: Array<{ inventoryItemId?: string | null; part: string; qty: number; unitCents?: number | null }>
}

/**
 * Covered work's cost, as job costing would: crew hours × the hourly rate
 * saved when the job was signed (Settings' rate that day for a job signed
 * before job costing), each part × its landed cost on the day fixed (a part
 * not in Inventory at the cost typed). Integer cents.
 */
export async function costOf(t: TicketRow, input: CostInput) {
  const job = await prisma.savedJob.findUnique({ where: { id: t.jobId }, select: { quoteId: true, fenceStyle: true, crewAssigned: true } })
  const quoted = job?.quoteId ? await prisma.jobQuotedCost.findUnique({ where: { accountId_quoteId: { accountId: t.accountId, quoteId: job.quoteId } }, select: { labor: true } }) : null
  const saved = isObj(quoted?.labor) ? Number((quoted!.labor as any).hourlyCostCents) : NaN
  let hourlyCostCents: number, hourlySource: string
  if (Number.isFinite(saved) && saved > 0) { hourlyCostCents = Math.round(saved); hourlySource = 'hourly rate saved when the job was signed' }
  else {
    const cfg = await configOf(t.accountId) as any
    hourlyCostCents = toCents(cfg?.pricing?.manHourRate)
    hourlySource = "Settings' hourly rate on the day entered (none saved when the job was signed)"
  }
  const crew = input.crew.map(c => ({ name: c.name.trim(), hours: qty(c.hours) })).filter(c => c.name || c.hours > 0)
  const hours = Math.round(crew.reduce((s, c) => s + c.hours, 0) * 100) / 100
  const laborCents = Math.round(hours * hourlyCostCents)
  const materials = []
  for (const l of input.materials) {
    const n = qty(l.qty)
    if (!n || !l.part.trim()) continue
    let unitCents = 0, source = 'none'
    const landed = l.inventoryItemId ? await landedCostOn(t.accountId, l.inventoryItemId, input.fixedOn) : null
    if (landed) { unitCents = landed.cents; source = landed.source }
    else if (typeof l.unitCents === 'number' && l.unitCents >= 0) { unitCents = Math.round(l.unitCents); source = 'entered' }
    materials.push({ inventoryItemId: l.inventoryItemId ?? null, part: l.part.trim(), qty: n, unitCents, totalCents: Math.round(n * unitCents), source })
  }
  const materialCents = materials.reduce((s, x) => s + x.totalCents, 0)
  return {
    fixedOn: input.fixedOn, fenceStyle: job?.fenceStyle ?? '', installer: job?.crewAssigned ?? '', warrantyName: t.warrantyName,
    crew, hours, hourlyCostCents, hourlySource, laborCents, materials, materialCents, totalCents: laborCents + materialCents,
  }
}

/** Fixed. Covered work carries its cost (saved, or entered again over the one saved). */
export async function markFixed(t: TicketRow, input: CostInput | null, actor: Actor): Promise<TicketRow> {
  if (t.stage === 'closed') throw err(409, 'This request is closed.')
  let costLine = ''
  if (t.decision === 'covered') {
    if (!input) throw err(400, 'Enter the crew hours and materials used: covered work is costed.')
    const c = await costOf(t, input)
    const data = { ...c, crew: c.crew as any, materials: c.materials as any, enteredBy: actor.name }
    await prisma.serviceWorkCost.upsert({ where: { ticketId: t.id }, create: { accountId: t.accountId, ticketId: t.id, jobId: t.jobId, ...data }, update: data })
    costLine = ` Covered work: ${c.hours} crew hours, ${c.materials.length} part${c.materials.length === 1 ? '' : 's'}, cost $${(c.totalCents / 100).toFixed(2)}.`
  }
  const day = input?.fixedOn && DAY.test(input.fixedOn) ? input.fixedOn : today()
  return change(t, { stage: 'fixed', fixedAt: new Date(`${day}T17:00:00Z`) }, entry(actor.name, 'fixed', `Fixed on ${day}.${costLine}`))
}

// ── What screens get ─────────────────────────────────────────────────────────

/** The ticket for staff. `costs`: the role sees costs (the covered work's cost). */
export async function ticketView(t: TicketRow, opts: { costs: boolean; photos?: boolean } = { costs: false }) {
  const [job, contact, appt, cost, media] = await Promise.all([
    prisma.savedJob.findUnique({ where: { id: t.jobId }, select: { id: true, customerName: true, customerPhone: true, customerAddress: true, fenceStyle: true, crewAssigned: true, quoteId: true } }),
    t.crmContactId ? prisma.crmContact.findUnique({ where: { id: t.crmContactId }, select: { id: true, firstName: true, lastName: true, phone: true, serviceAddress: true, textConsent: true, textConsentAt: true, textConsentBy: true, textConsentSource: true } }) : null,
    t.appointmentId ? prisma.appointment.findFirst({ where: { id: t.appointmentId, accountId: t.accountId }, select: { id: true, startAt: true, endAt: true, status: true, assignedTo: true, deletedAt: true, jobId: true } }) : null,
    opts.costs ? prisma.serviceWorkCost.findUnique({ where: { ticketId: t.id } }) : null,
    opts.photos === false ? null : prisma.mediaItem.findMany({ where: { accountId: t.accountId, serviceTicketId: t.id, deletedAt: null }, orderBy: { takenAt: 'asc' } }),
  ])
  // A visit that reached the server after it was linked: on the ticket's job (the job page's service calls list it).
  if (appt && !appt.jobId) await prisma.appointment.update({ where: { id: appt.id }, data: { jobId: t.jobId, version: { increment: 1 } } }).catch(() => null)
  const repairQuote = await repairQuoteOf(t)
  const name = contact ? `${contact.firstName} ${contact.lastName}`.trim() : job?.customerName ?? ''
  const consent = asTextConsent(contact?.textConsent)
  return {
    id: t.id, version: t.version, jobId: t.jobId, customerId: t.crmContactId, quoteId: t.quoteId,
    customerName: name, firstName: contact?.firstName || name.split(' ')[0] || '', phone: contact?.phone || job?.customerPhone || '',
    address: job?.customerAddress || contact?.serviceAddress || '', fenceStyle: await plainStyleName(job?.fenceStyle ?? ''), installer: job?.crewAssigned ?? '',
    issue: t.issue, issueLabel: issueLabel(t.issue), notes: t.notes, stage: t.stage, stageLabel: stageLabel(t.stage), open: isOpenStage(t.stage),
    warranty: { id: t.warrantyId, name: t.warrantyName, text: t.warrantyText, term: t.warrantyTerm, years: t.warrantyYears, installDate: t.installDate, end: t.warrantyEnd },
    hint: t.hint, hintLabel: HINT_LABEL[t.hint as Hint] ?? t.hint, hintWhy: t.hintWhy,
    decision: t.decision, decisionReason: t.decisionReason, decisionBy: t.decisionBy, decisionAt: t.decisionAt?.toISOString() ?? null, decisionShared: t.decisionShared,
    appointment: appt && !appt.deletedAt ? { id: appt.id, startAt: appt.startAt?.toISOString() ?? null, endAt: appt.endAt?.toISOString() ?? null, status: appt.status, assignedTo: appt.assignedTo } : null,
    appointmentId: t.appointmentId,
    repairQuote,
    link: t.uploadToken ? { path: linkPath(t.uploadToken), expiresAt: t.uploadExpiresAt?.toISOString() ?? null, open: linkOpen(t) } : null,
    photosRequestedAt: t.photosRequestedAt?.toISOString() ?? null, photosReceivedAt: t.photosReceivedAt?.toISOString() ?? null,
    scheduledAt: t.scheduledAt?.toISOString() ?? null, fixedAt: t.fixedAt?.toISOString() ?? null, closedAt: t.closedAt?.toISOString() ?? null,
    photos: media ? media.map(m => serializeMedia(m)) : undefined,
    photoCount: media ? media.length : undefined,
    cost: cost ? {
      fixedOn: cost.fixedOn, crew: cost.crew, hours: cost.hours, hourlyCostCents: cost.hourlyCostCents, hourlySource: cost.hourlySource, laborCents: cost.laborCents,
      materials: cost.materials, materialCents: cost.materialCents, totalCents: cost.totalCents, enteredBy: cost.enteredBy,
    } : null,
    textConsent: { state: consent, words: contact ? describeTextConsent({ textConsent: consent, textConsentAt: contact.textConsentAt?.toISOString() ?? null, textConsentBy: contact.textConsentBy, textConsentSource: contact.textConsentSource as any }) : 'No customer on this job' },
    history: historyOf(t),
    createdBy: t.createdBy, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
  }
}

/**
 * A not covered ticket's repair quote: the one linked, else the first repair
 * quote made for the customer since the ticket (then linked).
 */
async function repairQuoteOf(t: TicketRow): Promise<{ id: string; status: string; finalPrice: number; date: string } | null> {
  const sel = { id: true, status: true, finalPrice: true, date: true } as const
  if (t.repairQuoteId) return prisma.savedQuote.findFirst({ where: { id: t.repairQuoteId, accountId: t.accountId, deletedAt: null }, select: sel })
  if (t.decision !== 'not_covered' || !t.crmContactId) return null
  const q = await prisma.savedQuote.findFirst({
    where: { accountId: t.accountId, crmContactId: t.crmContactId, deletedAt: null, createdAt: { gte: t.createdAt }, work: { path: ['type'], equals: 'repair' } },
    orderBy: { createdAt: 'asc' }, select: sel,
  })
  if (q) await prisma.serviceTicket.update({ where: { id: t.id }, data: { repairQuoteId: q.id } }).catch(() => null)
  return q
}

export type TicketView = Awaited<ReturnType<typeof ticketView>>

/** Tickets for a list: a customer's, a job's, or the whole company's (open only unless `all`). */
/**
 * `only`: the Salesman's customers and jobs (lib/salesScope.ts); a request is
 * listed when its customer or its job is one of them.
 */
export async function listTickets(accountId: string, f: { customerId?: string; jobId?: string; all?: boolean }, costs: boolean, only: { contactIds: string[]; jobIds: string[] } | null = null): Promise<TicketView[]> {
  const where: any = { accountId, deletedAt: null }
  if (only) where.AND = [{ OR: [{ crmContactId: { in: only.contactIds } }, { jobId: { in: only.jobIds } }] }]
  if (f.jobId) where.jobId = f.jobId
  if (f.customerId) {
    const jobs = await prisma.savedJob.findMany({ where: { accountId, crmContactId: f.customerId, deletedAt: null }, select: { id: true } })
    where.OR = [{ crmContactId: f.customerId }, ...(jobs.length ? [{ jobId: { in: jobs.map(j => j.id) } }] : [])]
  }
  if (!f.all && !f.customerId && !f.jobId) where.stage = { not: 'closed' }
  const rows = await prisma.serviceTicket.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 })
  const counts = rows.length ? await prisma.mediaItem.groupBy({ by: ['serviceTicketId'], where: { accountId, deletedAt: null, serviceTicketId: { in: rows.map(r => r.id) } }, _count: { _all: true } }) : []
  const countOf = new Map(counts.map(c => [c.serviceTicketId, c._count._all]))
  const out = []
  for (const t of rows) {
    const v = await ticketView(t, { costs, photos: false })
    out.push({ ...v, photos: undefined, photoCount: countOf.get(t.id) ?? 0, history: [] })
  }
  return out
}

// ── Photos from the customer (the link and the portal) ───────────────────────

/** The customer's photos and videos on a ticket so far (the limit counts these). */
export function customerFileCount(ticketId: string): Promise<number> {
  return prisma.mediaItem.count({ where: { serviceTicketId: ticketId, source: 'customer', deletedAt: null } })
}

/**
 * A photo or video from the customer landed on the ticket (Internal): the
 * ticket moves to Photos received, and Jonathan and the customer's card owner
 * are told once per "Ask for photos" (the bell, and a push on the live install).
 */
export async function photoArrived(t: TicketRow, via: 'link' | 'portal'): Promise<TicketRow> {
  const first = t.stage === 'new' || t.stage === 'photos_requested'
  const fresh = await change(t, { photosReceivedAt: new Date(), ...(first ? { stage: 'photos_received' } : {}) },
    first ? entry('Customer', 'photos_in', `Photos received from the customer (${via === 'link' ? 'photo link' : 'customer portal'}).`) : null)
  await photosPush(fresh).catch(e => console.error('[service] photos push:', String((e as Error)?.message || e).slice(0, 200)))
  return fresh
}

type Recipient = { id: string; email: string; name: string }

/** The owner (Jonathan): the company's first owner login. */
async function ownerOf(accountId: string): Promise<Recipient | null> {
  const u = await prisma.crmUser.findFirst({ where: { crmAccountId: accountId, role: 'super_admin' as any }, orderBy: { createdAt: 'asc' }, select: { id: true, email: true, firstName: true } })
  return u ? { id: u.id, email: u.email, name: u.firstName || u.email } : null
}

/**
 * The customer's card owner (Jonathan, Oct 22 2026: "photos push goes to me
 * and to the customer's card owner"). The customer's pipeline card (an open
 * one first, then the one moved last: proposalViews.ts cardForContact) names
 * its salesman by name only (lead.assignedRep), so that name is matched to a
 * login only exactly: the login's full name ("First Last"), case and spaces
 * aside; a first name alone or a near miss is never a match. A card with no
 * salesman (or one no login matches) belongs to the login its follow ups are
 * kept for (CardFollowUp.ownerUserId, a login id). Otherwise nobody.
 */
export async function cardOwnerOf(accountId: string, customerId: string | null): Promise<Recipient | null> {
  if (!customerId) return null
  const { cardForContact } = await import('./proposalViews.js')
  const card = await cardForContact(accountId, customerId)
  if (!card) return null
  const { people } = await peopleOf(accountId)
  const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  const rep = norm(card.assignedRep)
  const named = rep ? people.filter(p => norm(p.name) === rep) : []
  // Two logins with the same full name: no guess between them.
  if (named.length === 1) return { id: named[0].id, email: named[0].email, name: named[0].name }
  const row = await prisma.cardFollowUp.findUnique({ where: { accountId_cardId: { accountId, cardId: String(card.id) } }, select: { ownerUserId: true } }).catch(() => null)
  const p = row?.ownerUserId ? people.find(x => x.id === row.ownerUserId) : null
  return p ? { id: p.id, email: p.email, name: p.name } : null
}

export async function photosPush(t: TicketRow, deps: { send?: (accountId: string, msg: { title: string; body: string; url: string; tag: string }, userIds: string[]) => Promise<unknown>; allowed?: boolean } = {}): Promise<{ made: boolean; delivered: boolean; to?: string[] }> {
  const key = `service-photos:${t.id}:${t.photosRequestedAt?.getTime() ?? 0}`
  if (await prisma.automationEffect.findUnique({ where: { key }, select: { key: true } })) return { made: false, delivered: false }
  const job = await prisma.savedJob.findUnique({ where: { id: t.jobId }, select: { customerName: true, crmContactId: true } })
  // Jonathan and the customer's card owner; once each (the card owner may be Jonathan).
  const people = [await ownerOf(t.accountId), await cardOwnerOf(t.accountId, t.crmContactId ?? job?.crmContactId ?? null)]
  const to: Recipient[] = []
  for (const p of people) if (p && !to.some(x => x.id === p.id)) to.push(p)
  if (!to.length) return { made: false, delivered: false }
  const title = `Photos in: ${job?.customerName || 'a customer'}`
  const body = `${issueLabel(t.issue)}. ${t.warrantyName || 'No warranty on file'}. Decide covered or not covered.`
  const url = `/service?ticket=${t.id}`
  try {
    await prisma.$transaction(async tx => {
      await tx.automationEffect.create({ data: { key, runId: 'service-photos', status: 'done', result: { ticketId: t.id, to: to.map(p => p.id) } as any } })
      for (const p of to) await tx.notification.create({ data: { recipientId: p.email, title, body, type: 'info', link: url, jobId: t.jobId } })
    })
  } catch { return { made: false, delivered: false } } // already told for this request
  const ids = to.map(p => p.id)
  if (!(deps.allowed ?? realDeliveryAllowed())) {
    holdOutbound('push', to.map(p => p.name).join(' and '), title, body)
    return { made: true, delivered: false, to: ids }
  }
  const send = deps.send ?? (async (a, msg, userIds) => (await import('./automations/push.js')).sendPush(a, msg, { userIds }))
  await send(t.accountId, { title, body, url, tag: `service-${t.id}` }, ids)
  return { made: true, delivered: true, to: ids }
}

// ── The customer portal ──────────────────────────────────────────────────────

/**
 * The customer's requests for the portal, from an explicit list of fields:
 * the issue, the status in customer words, the day it was made, the visit day,
 * how many photos they sent, and whether they can add more. The decision and
 * its reason only when the office ticked "Show the customer". Never the
 * office's notes, the hint, who decided, the cost or the history.
 */
export async function portalRequests(contact: { id: string; accountId: string | null }, jobIds: string[]) {
  if (!contact.accountId) return []
  const since = new Date(Date.now() - 30 * 86_400_000)
  const rows = await prisma.serviceTicket.findMany({
    where: { accountId: contact.accountId, deletedAt: null, OR: [{ crmContactId: contact.id }, ...(jobIds.length ? [{ jobId: { in: jobIds } }] : [])], AND: [{ OR: [{ stage: { not: 'closed' } }, { closedAt: { gte: since } }] }] },
    orderBy: { createdAt: 'desc' },
  })
  const out = []
  for (const t of rows) {
    const appt = t.appointmentId ? await prisma.appointment.findFirst({ where: { id: t.appointmentId, accountId: t.accountId, deletedAt: null, status: { not: 'cancelled' } }, select: { startAt: true } }) : null
    out.push({
      id: t.id, issue: issueLabel(t.issue), status: stageForCustomer(t.stage), open: isOpenStage(t.stage),
      madeOn: nyDay(t.createdAt), visitOn: appt?.startAt ? nyDay(appt.startAt) : null,
      photosSent: await customerFileCount(t.id), canAddPhotos: isOpenStage(t.stage) && t.stage !== 'fixed',
      decision: t.decisionShared && t.decision ? { covered: t.decision === 'covered', reason: t.decisionReason } : null,
    })
  }
  return out
}

// ── The crew packet: covered work on the job ─────────────────────────────────

/** Covered tickets still to fix on a job: a $0 work order on its crew packet (which stays open for it). */
export async function coveredWorkOn(jobId: string) {
  return prisma.serviceTicket.findMany({ where: { jobId, deletedAt: null, decision: 'covered', stage: { notIn: ['fixed', 'closed'] } }, orderBy: { createdAt: 'asc' } })
}

// ── Report ───────────────────────────────────────────────────────────────────

/** Tickets made from `from` (YYYY-MM) through `to` (YYYY-MM), by month; covered work's cost by style and installer. */
export async function report(accountId: string, from: string, to: string) {
  const start = new Date(`${from}-01T05:00:00Z`)
  const [ty, tm] = to.split('-').map(Number)
  const end = new Date(Date.UTC(ty, tm, 1, 5))
  const rows = await prisma.serviceTicket.findMany({ where: { accountId, deletedAt: null, createdAt: { gte: start, lt: end } }, orderBy: { createdAt: 'asc' } })
  const costs = rows.length ? await prisma.serviceWorkCost.findMany({ where: { ticketId: { in: rows.map(r => r.id) } } }) : []
  const jobs = rows.length ? await prisma.savedJob.findMany({ where: { id: { in: [...new Set(rows.map(r => r.jobId))] }, deletedAt: null }, select: { id: true, fenceStyle: true, crewAssigned: true } }) : []
  const costOfT = new Map(costs.map(c => [c.ticketId, c]))
  const jobOf = new Map(jobs.map(j => [j.id, j]))
  const names = new Map<string, string>()
  const plain = async (s: string) => { if (!names.has(s)) names.set(s, await plainStyleName(s)); return names.get(s)! }
  const tickets: ReportTicket[] = []
  for (const t of rows) {
    const c = costOfT.get(t.id)
    const j = jobOf.get(t.jobId)
    tickets.push({
      id: t.id, month: nyDay(t.createdAt).slice(0, 7), decision: t.decision === 'covered' || t.decision === 'not_covered' ? t.decision : null, stage: t.stage,
      fenceStyle: await plain(c?.fenceStyle || j?.fenceStyle || ''), installer: (c?.installer || j?.crewAssigned || '').trim(),
      costCents: c ? c.totalCents : null, laborCents: c ? c.laborCents : null, materialCents: c ? c.materialCents : null,
    })
  }
  return { from, to, ...serviceReport(tickets) }
}
