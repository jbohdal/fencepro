/**
 * Warranties per option on the server (the rules are web/src/warranties.ts,
 * run through the pricing bundle like every other shared rule):
 *
 *   - the one-time step that saves the two starting warranties and which
 *     install gets which into Settings (config.warranties);
 *   - stamping each proposal option's warranty when a quote is saved, and
 *     keeping the words a sent or signed proposal went out with;
 *   - a job's warranty: the accepted option's, its start (the install date)
 *     and end, and whether each service call on the job is covered.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { lockAccountState } from './lockState.js'

export type WarrantyTerm = 'lifetime' | 'years' | 'unknown'
export interface OptionWarranty { id: string | null; name: string; text: string; term: WarrantyTerm; years?: number }
export interface Coverage { covered: boolean | null; label: string; why: string; overridden: boolean }
export interface CoverageOverride { covered: boolean; reason: string; by: string; at: string }

export const WARRANTIES_KEY = 'migration:warranties-2026-10'

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Settings → Warranties, once per company, ever (AccountKeyValue
 * 'migration:warranties-2026-10'): the Lifetime Craftsmanship and 1 Year
 * Workmanship warranties, vinyl no dig → Lifetime, everything else → 1 Year,
 * and wood's "No warranty on the wood itself." A company that already has
 * warranties saved keeps them. Run with the other start-up steps, in turn,
 * with the Settings row locked (lib/lockState.ts).
 */
export async function ensureWarranties(accountId: string): Promise<{ added: boolean } | null> {
  const m = await pricingModule()
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'warranties:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: WARRANTIES_KEY } } })
    if (done) return null
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    if (!b) return null
    const cfg = (isObj(b.config) ? b.config : {}) as Record<string, unknown>
    const added = !isObj(cfg.warranties)
    if (added) {
      await tx.businessState.update({ where: { accountId }, data: { config: { ...cfg, warranties: m.defaultWarrantySettings() } as any, version: { increment: 1 } } })
    }
    await tx.accountKeyValue.create({ data: { accountId, key: WARRANTIES_KEY, value: { at: new Date().toISOString(), added } as any } })
    return { added }
  }, { timeout: 20_000 })
}

/** At server start: every company with saved settings. */
export async function ensureWarrantiesAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const out = await ensureWarranties(r.accountId)
      if (out?.added) console.log(`[warranties] Lifetime and 1 Year warranties added to Settings for ${r.accountId}`)
    } catch (err) { console.error('[warranties] could not add the starting warranties:', err) }
  }
}

async function configOf(accountId: string): Promise<unknown> {
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
  return b?.config ?? null
}

/**
 * The proposal to save, each option with its warranty. `existing`: the quote
 * as saved (null for a new one); `frozen`: it was sent or signed, so options
 * already on it keep the warranty they went out with.
 */
export async function stampQuoteWarranties(accountId: string, proposal: unknown, existing: { proposal?: unknown } | null, frozen: boolean): Promise<unknown> {
  if (!isObj(proposal) || !Array.isArray(proposal.options)) return proposal
  const m = await pricingModule()
  return m.stampWarranties(await configOf(accountId), proposal, existing?.proposal ?? null, frozen)
}

/** YYYY-MM-DD in Ocala. */
export function nyDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** The install date a warranty starts on: the job's completed date, else the day its walkthrough was finished. */
export async function installDateOf(job: { id: string; completedDate: string | null }): Promise<string | null> {
  if (job.completedDate && /^\d{4}-\d{2}-\d{2}$/.test(job.completedDate)) return job.completedDate
  const w = await prisma.walkthrough.findUnique({ where: { jobId: job.id }, select: { completedAt: true } })
  return w?.completedAt ? nyDay(w.completedAt) : null
}

type QuoteRow = { id: string; accountId: string; proposal: unknown; chosenOption: number | null; fenceStyle: string; status: string; acceptedAt: Date | null; soldAt?: Date | null; work?: unknown }

/**
 * The warranty a quote was signed (or will be signed) for: the accepted
 * option's frozen warranty, else the option of the quote's own style, else
 * the proposal's one block of warranty words; with no proposal, what
 * Settings give the style now (`from: 'settings'`).
 */
export async function quoteWarranty(q: QuoteRow | null, fenceStyle: string, config?: unknown): Promise<{ warranty: OptionWarranty | null; from: 'option' | 'proposal' | 'settings' | null }> {
  const m = await pricingModule()
  const cfg = config === undefined ? (q ? await configOf(q.accountId) : null) : config
  const settings = m.warrantySettingsOf(cfg)
  const signed = q ? m.signedOptionWarranty(q, settings) : null
  if (signed) return { warranty: signed.warranty, from: signed.from }
  const style = q?.fenceStyle || fenceStyle
  if (!style) return { warranty: null, from: null }
  const kind = q && isObj(q.work) && (q.work.type === 'move' || q.work.type === 'repair') ? q.work.type as 'move' | 'repair' : null
  return { warranty: m.styleWarranty(cfg, style, kind), from: 'settings' }
}

export interface ServiceCall {
  id: string
  type: string
  status: string
  /** The day it is (or was) on, YYYY-MM-DD; the day it was booked when it has no time yet. */
  day: string
  notes: string
  coverage: Coverage
  override: CoverageOverride | null
}

export interface JobWarranty {
  jobId: string
  quoteId: string | null
  warranty: OptionWarranty | null
  /** option: the signed option's own warranty; proposal: the one block of words an older proposal had; settings: no proposal, today's Settings for the style. */
  from: 'option' | 'proposal' | 'settings' | null
  signed: boolean
  start: string | null
  end: string | null
  endText: string
  /** The signed contract PDF can be opened (the quote was accepted or sold). */
  contract: boolean
  serviceCalls: ServiceCall[]
}

export const SERVICE_TYPES = ['service', 'warranty'] as const

/** Everything the job page shows about the warranty. */
export async function jobWarranty(accountId: string, jobId: string): Promise<JobWarranty | null> {
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId }, select: { id: true, quoteId: true, fenceStyle: true, completedDate: true } })
  if (!job) return null
  const q = job.quoteId ? await prisma.savedQuote.findFirst({
    where: { id: job.quoteId, accountId },
    select: { id: true, accountId: true, proposal: true, chosenOption: true, fenceStyle: true, status: true, acceptedAt: true, soldAt: true, work: true },
  }) : null
  const m = await pricingModule()
  const { warranty, from } = await quoteWarranty(q, job.fenceStyle, await configOf(accountId))
  const start = await installDateOf(job)
  const period = m.warrantyPeriod(warranty, start)
  const appts = await prisma.appointment.findMany({
    where: { accountId, jobId: job.id, type: { in: [...SERVICE_TYPES] }, archivedAt: null },
    orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, type: true, status: true, startAt: true, createdAt: true, notes: true, warrantyOverride: true },
  })
  const serviceCalls = appts.map(a => {
    const day = nyDay(a.startAt ?? a.createdAt)
    const o: any = a.warrantyOverride
    const override = isObj(o) && typeof o.covered === 'boolean' ? o as CoverageOverride : null
    return { id: a.id, type: a.type, status: a.status, day, notes: a.notes, coverage: m.serviceCoverage(warranty, start, day, override) as Coverage, override }
  })
  return {
    jobId: job.id, quoteId: q?.id ?? null, warranty, from,
    signed: !!q && (q.status === 'SOLD' || !!q.acceptedAt || !!q.soldAt),
    start: period.start, end: period.end, endText: period.endText,
    contract: !!q && (!!q.acceptedAt || q.status === 'SOLD' || !!q.soldAt) && isObj(q.proposal) && Array.isArray((q.proposal as any).options),
    serviceCalls,
  }
}
