/**
 * Everything a rule needs to know about one card (sales pipeline) or job
 * (Operations): who the customer is, where, what was sold, the stage, the
 * permit, dates and links. Conditions are checked against it and templates
 * ({first name}, {install date}, {proposal link}) are filled from it.
 */

import prisma from '../prisma.js'
import { countyPoint, suggestCounty } from '../addressIndex.js'
import { getFrontendBase } from '../urls.js'
import { plainStyleName } from '../estimates.js'
import type { Board, Condition } from './types.js'
import { stageOfJob, stageById, START_OPS_STAGES, type OpsStageDef, type OpsJobLike } from '../opsStageModel.js'
import { loadOpsStages } from '../opsStages.js'

export const CLOSED_SALES = new Set(['Lost Sale', 'No Answer', 'Paid & Closed'])

/**
 * The Operations stage a job is in (its id), by the company's list from
 * Settings > Operations Stages (lib/opsStages.ts loadOpsStages): the same rule
 * as the board (opsStageModel.stageOfJob).
 */
export function opsStageOfJob(job: OpsJobLike, stages: OpsStageDef[] = START_OPS_STAGES): string {
  return stageOfJob(stages, job)
}

/** A stage's name in the company's list (its id when it is not there). */
export const opsStageName = (stages: OpsStageDef[], id: string) => stageById(stages, id)?.name ?? id

export const floridaDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

export interface EntityContext {
  board: Board
  entityKind: 'card' | 'job'
  entityId: string
  card: any | null
  job: any | null
  stage: string
  stageLabel: string
  customerId: string | null
  firstName: string
  lastName: string
  name: string
  email: string
  phone: string
  address: string
  city: string
  county: string
  /** The fence's plain name ("White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig"): what {{style}} writes. */
  style: string
  /** The style's internal name (its old code, e.g. "WV-ND 6'x8' Privacy"); a "style" condition matches either. */
  styleCode: string
  priceCents: number
  salesman: string
  tags: string[]
  permit: any | null
  permitRequired: boolean
  installDate: string
  appointmentAt: Date | null
  proposalSentDate: string
  proposalLink: string
  quoteId: string | null
}

export async function loadLeads(accountId: string): Promise<{ leads: any[]; version: number }> {
  const p = await prisma.pipelineState.findUnique({ where: { accountId } })
  return { leads: ((p?.leads as any[]) ?? []).filter(Boolean), version: p?.version ?? 0 }
}

/** The job that goes with a pipeline card: its quote's job, else the customer's newest open job. */
export async function jobForCard(accountId: string, card: any): Promise<any | null> {
  if (!card) return null
  if (card.jobId) {
    const j = await prisma.savedJob.findFirst({ where: { id: String(card.jobId), accountId, archivedAt: null } })
    if (j) return j
  }
  if (card.quoteId) {
    const j = await prisma.savedJob.findFirst({ where: { accountId, quoteId: String(card.quoteId), archivedAt: null } })
    if (j) return j
  }
  if (!card.customerId) return null
  return prisma.savedJob.findFirst({ where: { accountId, crmContactId: String(card.customerId), archivedAt: null }, orderBy: { createdAt: 'desc' } })
}

/** The pipeline card that goes with a job: the customer's open card, else their newest. */
export function cardForJob(leads: any[], job: any): any | null {
  if (!job?.crmContactId) return null
  const mine = leads.filter(l => l?.customerId === job.crmContactId)
  return mine.find(l => !CLOSED_SALES.has(l.stage)) ?? mine[0] ?? null
}

export function cityOf(address: string): string {
  const parts = address.split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length >= 3) return parts[parts.length - 2]
  if (parts.length === 2) return parts[1].replace(/\b(FL|Florida)\b.*$/i, '').trim()
  return ''
}

/** Marion when the address is in the county's own parcel list; otherwise what the permit says, or empty. */
export function countyOf(address: string, permitCounty?: string | null): string {
  if (address && countyPoint(address)) return 'Marion'
  return permitCounty && permitCounty !== 'Marion' ? permitCounty : (address && suggestCounty(address.split(',')[0], 1).length ? 'Marion' : '')
}

export function proposalLinkFor(token: string | null | undefined): string {
  if (!token) return ''
  const base = getFrontendBase()
  try {
    const u = new URL(base)
    if (u.hostname.endsWith('.ts.net')) return `${u.protocol}//${u.hostname}:8443/p/${token}`
  } catch { /* fall through */ }
  return `${base}/p/${token}`
}

const dollarsToCents = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? Math.round(v * 100) : 0 }

/** Build the context for a card or job. Null when it no longer exists. */
export async function buildContext(accountId: string, board: Board, entityId: string, preloaded?: { leads?: any[] }): Promise<EntityContext | null> {
  const leads = preloaded?.leads ?? (await loadLeads(accountId)).leads
  let card: any | null = null
  let job: any | null = null
  if (board === 'sales') {
    card = leads.find(l => l?.id === entityId) ?? null
    if (!card) return null
    job = await jobForCard(accountId, card)
  } else {
    job = await prisma.savedJob.findFirst({ where: { id: entityId, accountId, archivedAt: null } })
    if (!job) return null
    card = cardForJob(leads, job)
  }
  const customerId: string | null = card?.customerId ?? job?.crmContactId ?? null
  const contact = customerId ? await prisma.crmContact.findFirst({ where: { id: customerId, accountId } }) : null
  const permit = job ? await prisma.permit.findUnique({ where: { jobId: job.id } }) : null
  const quotes = customerId
    ? await prisma.savedQuote.findMany({ where: { accountId, crmContactId: customerId, archivedAt: null }, orderBy: { updatedAt: 'desc' }, take: 20 })
    : []
  const quote = (job?.quoteId ? quotes.find(q => q.id === job.quoteId) : null) ?? quotes.find(q => q.status === 'SOLD') ?? quotes[0] ?? null
  const shared = (quote?.shareToken && !quote.shareDisabledAt ? quote : null) ?? quotes.find(q => q.shareToken && !q.shareDisabledAt) ?? null
  const sent = quotes.find(q => q.status === 'SENT') ?? null
  const appt = customerId
    ? await prisma.appointment.findFirst({ where: { accountId, crmContactId: customerId, startAt: { gte: new Date(Date.now() - 12 * 3600_000) }, status: { notIn: ['cancelled', 'completed', 'no_show'] } }, orderBy: { startAt: 'asc' } })
    : null

  const firstName = String(contact?.firstName ?? card?.firstName ?? (job?.customerName || '').split(/\s+/)[0] ?? '').trim()
  const lastName = String(contact?.lastName ?? card?.lastName ?? (job?.customerName || '').split(/\s+/).slice(1).join(' ') ?? '').trim()
  const address = String(job?.customerAddress || card?.address || contact?.serviceAddress || quote?.customerAddress || '').trim()
  const tags = [
    ...(Array.isArray(contact?.tags) ? (contact!.tags as unknown[]).map(String) : []),
    ...(Array.isArray(card?.tags) ? (card.tags as unknown[]).map(String) : []),
  ]
  const opsStages = board === 'ops' ? (await loadOpsStages(accountId)).stages : START_OPS_STAGES
  const stage = board === 'sales' ? String(card?.stage ?? '') : opsStageOfJob(job, opsStages)
  return {
    board, entityKind: board === 'sales' ? 'card' : 'job', entityId,
    card, job, stage, stageLabel: board === 'sales' ? stage : opsStageName(opsStages, stage),
    customerId,
    firstName, lastName, name: `${firstName} ${lastName}`.trim() || String(job?.customerName || 'the customer'),
    email: String(contact?.email || card?.email || job?.customerEmail || '').trim(),
    phone: String(contact?.phone || card?.phone || job?.customerPhone || '').trim(),
    address,
    city: String(contact?.city || cityOf(address) || ''),
    county: countyOf(address, permit?.county),
    styleCode: String(job?.fenceStyle || card?.fenceType || quote?.fenceStyle || ''),
    style: await plainStyleName(String(job?.fenceStyle || card?.fenceType || quote?.fenceStyle || '')),
    priceCents: job?.contractValue ? dollarsToCents(job.contractValue) : dollarsToCents(card?.jobValue || card?.quotePrice || quote?.finalPrice || 0),
    salesman: String(card?.assignedRep || job?.salesRep || quote?.salesRep || ''),
    tags,
    permit,
    permitRequired: !!permit && permit.status !== 'not_needed',
    installDate: String(job?.scheduledDate || card?.installDate || ''),
    appointmentAt: appt?.startAt ?? null,
    proposalSentDate: sent ? String((sent.proposal as any)?.createdAt || sent.date || '').slice(0, 10) : '',
    proposalLink: proposalLinkFor(shared?.shareToken),
    quoteId: quote?.id ?? null,
  }
}

const niceDate = (ymd: string) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(ymd)) return ymd
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
}
const money = (cents: number) => '$' + Math.round(cents / 100).toLocaleString('en-US')

/** The fields a template can use, as shown in the rule editor. */
export const TEMPLATE_FIELDS = ['first name', 'last name', 'name', 'phone', 'email', 'address', 'city', 'style', 'price', 'salesman', 'install date', 'appointment', 'proposal link', 'stage', 'permit number', 'permit portal'] as const

/** Fill {first name}, {install date}, ... A field with nothing to put in becomes empty. */
export function fillTemplate(text: string, ctx: EntityContext, extra: Record<string, string> = {}): string {
  const values: Record<string, string> = {
    'first name': ctx.firstName, 'last name': ctx.lastName, name: ctx.name, phone: ctx.phone, email: ctx.email,
    address: ctx.address, city: ctx.city, style: ctx.style, price: ctx.priceCents ? money(ctx.priceCents) : '',
    salesman: ctx.salesman, 'install date': niceDate(ctx.installDate),
    appointment: ctx.appointmentAt ? ctx.appointmentAt.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '',
    'proposal link': ctx.proposalLink, stage: ctx.stageLabel, 'permit number': ctx.permit?.permitNumber ?? '',
    ...extra,
  }
  return text.replace(/\{([a-z ]+)\}/gi, (whole, key: string) => {
    const k = key.trim().toLowerCase()
    return k in values ? values[k] : whole
  })
}

export interface ConditionResult { condition: Condition; ok: boolean; actual: string }

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()

export function evalCondition(c: Condition, ctx: EntityContext): ConditionResult {
  const text = typeof c.value === 'string' ? c.value : ''
  const r = (ok: boolean, actual: string): ConditionResult => ({ condition: c, ok, actual })
  switch (c.field) {
    case 'stage': return r(c.op === 'is_not' ? norm(ctx.stage) !== norm(text) && norm(ctx.stageLabel) !== norm(text) : norm(ctx.stage) === norm(text) || norm(ctx.stageLabel) === norm(text), ctx.stageLabel)
    case 'style': {
      // Rules written with the old code ("WV-ND") and rules written with the plain name both keep working.
      const one = (v: string) => (c.op === 'is' ? norm(v) === norm(text) : norm(v).includes(norm(text)))
      const hit = one(ctx.style) || one(ctx.styleCode ?? '')
      return r(c.op === 'is_not' ? !hit : hit, ctx.style || '(none)')
    }
    case 'price': {
      const v = typeof c.value === 'object' && c.value ? c.value : {}
      const ok = (v.minCents == null || ctx.priceCents >= v.minCents) && (v.maxCents == null || ctx.priceCents <= v.maxCents)
      return r(ok, money(ctx.priceCents))
    }
    case 'city': return r(c.op === 'is_not' ? norm(ctx.city) !== norm(text) : norm(ctx.city) === norm(text), ctx.city || '(unknown)')
    case 'county': return r(c.op === 'is_not' ? norm(ctx.county) !== norm(text) : norm(ctx.county) === norm(text), ctx.county || '(unknown)')
    case 'salesman': return r(c.op === 'is_not' ? norm(ctx.salesman) !== norm(text) : norm(ctx.salesman) === norm(text), ctx.salesman || '(none)')
    case 'tag': {
      const has = ctx.tags.some(t => norm(t) === norm(text))
      return r(c.op === 'has_not' || c.op === 'is_not' ? !has : has, ctx.tags.join(', ') || '(no tags)')
    }
    case 'permit_required': {
      const want = c.value === true || norm(c.value) === 'true' || norm(c.value) === 'yes'
      return r(ctx.permitRequired === want, ctx.permit ? `permit ${ctx.permit.status.replace(/_/g, ' ')}` : 'no permit record')
    }
  }
}

export function evalConditions(conds: Condition[], ctx: EntityContext): { ok: boolean; results: ConditionResult[] } {
  const results = conds.map(c => evalCondition(c, ctx))
  return { ok: results.every(x => x.ok), results }
}
