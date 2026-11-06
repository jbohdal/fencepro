/**
 * The office site plan of a sold job (Jonathan, Nov 5-6 2026): saved on the
 * server (SitePlan, one per job, a SitePlanRevision per save), checked against
 * the quote before it is marked done, and read by the crew's install packet,
 * the customer's portal and the permit sheet. The plan itself and its math
 * are web/src/sitePlanData.ts and web/src/sitePlanSvg.ts, run here through
 * the pricing bundle (pricingModule), so the server and the editor agree.
 *
 * Who: the owner and the office open and change it; a Salesman opens it read
 * only for a job of the Salesman's own (lib/salesScope.ts; another job is a
 * 404); the Installer and anyone else are refused (403). No price is ever in
 * a plan.
 *
 * Settings (config.sitePlan; missing → defaults): tolFt and tolPct (how far
 * drawn feet may differ from quoted before it is flagged), setbackFt (how
 * close to the property line before a warning), parcelSources (lib/parcels.ts).
 */

import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { Prisma } from '@prisma/client'
import { can, roleOf, sameJson } from './permissions.js'
import { isSalesman, salesScopeOf, idInSalesScope } from './salesScope.js'
import { jobCounty } from './county.js'
import { mediaDir } from './media.js'
import { isUniqueViolation } from './once.js'
import { parcelSourcesOf, type ParcelSource } from './parcels.js'

// ── The web's site plan code, as the pricing bundle exports it ───────────────

export interface LatLng { lat: number; lng: number }
export type SitePlanData = any
export interface CrewPostT { n: number; kind: 'corner' | 'end' | 'line' | 'gate' | 'tee'; at: LatLng; sideId: string | null }
export interface CrewSideT { id: string; name: string; ft: number; pieces: Array<{ ft: number; sections: number; spacingFt: number }> }
export interface SiteModule {
  planFlags(plan: SitePlanData, yard: unknown, s?: { tolFt: number; tolPct: number }): Array<{ key: string; sideId: string | null; text: string; kind: string }>
  openFlags(plan: SitePlanData, flags: Array<{ key: string; text: string }>): Array<{ key: string; text: string }>
  crewPosts(plan: SitePlanData, sectionsOf: (sideId: string, pieceFt: number, piece: number) => number): { posts: CrewPostT[]; sides: CrewSideT[] }
  builtFt(plan: SitePlanData, side: any): number
  propertyLineWarnings(plan: SitePlanData, setbackFt?: number): string[]
  quoteSectionsOf(plan: SitePlanData, yard: unknown, runSections: unknown, widthFt: number): (sideId: string, pieceFt: number) => number
  sitePlanSvg(plan: SitePlanData, o: Record<string, unknown>): string
  planFrame(plan: SitePlanData, W: number, H: number, o?: Record<string, unknown>): { W: number; H: number; scale: number; at: (p: LatLng) => { x: number; y: number } }
  planExtent(plan: SitePlanData, fit?: "all" | "fence"): { minX: number; maxX: number; minY: number; maxY: number }
  crewSheetSize(plan: SitePlanData, posts: CrewPostT[], o: { fontSize: number; minWidth?: number; maxWidth?: number }): { width: number; height: number; scale: number }
  gateLeaves(plan: SitePlanData, side: any, g: any): Array<{ hingeFt: number; towardFt: number }>
  feetLabel(ft: number): string
  changeOrderSectionWidthFor(data: unknown, fenceStyle: string): number
  applyChange(plan: SitePlanData, c: unknown): SitePlanData
  walkingOrder(plan: SitePlanData): Array<{ side: any; flip: boolean }>
  toFeet(origin: LatLng, at: LatLng): { x: number; y: number }
}
export const siteModule = async () => (await pricingModule()) as unknown as SiteModule

// ── Settings ─────────────────────────────────────────────────────────────────

export interface SitePlanSettings { tolFt: number; tolPct: number; setbackFt: number; parcelSources: Record<string, ParcelSource[]> }
export const SITE_PLAN_DEFAULTS = { tolFt: 3, tolPct: 3, setbackFt: 0 }

export function sitePlanSettingsOf(config: unknown): SitePlanSettings {
  const s = ((config as any)?.sitePlan ?? {}) as Record<string, unknown>
  const num = (v: unknown, d: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : d)
  return {
    tolFt: num(s.tolFt, SITE_PLAN_DEFAULTS.tolFt, 1000),
    tolPct: num(s.tolPct, SITE_PLAN_DEFAULTS.tolPct, 100),
    setbackFt: num(s.setbackFt, SITE_PLAN_DEFAULTS.setbackFt, 1000),
    parcelSources: parcelSourcesOf(s.parcelSources),
  }
}

export async function sitePlanSettings(accountId: string): Promise<SitePlanSettings> {
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }).catch(() => null)
  return sitePlanSettingsOf(b?.config)
}

// ── Who may ──────────────────────────────────────────────────────────────────

/** The owner and the office change plans (the same people as permits). */
export const editsPlans = (role: string | null | undefined) => can(role, 'permits.change')

/**
 * The job, and whether this login may change its plan; or the refusal sent
 * (403 for the Installer and any other role; 404 for a job not there, or a
 * Salesman's job that is not the Salesman's).
 */
export async function planAccess(req: any, res: any, jobId: string): Promise<{ job: any; canEdit: boolean } | null> {
  const role = roleOf(req)
  const editor = editsPlans(role)
  if (!editor && !isSalesman(role)) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: 'Site plans are for the office.' }); return null }
  const accountId = req.user.crmAccountId
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null } })
  if (!job) { res.status(404).json({ success: false, error: 'Job not found' }); return null }
  if (!editor) {
    const scope = await salesScopeOf(req)
    if (!scope || !(await idInSalesScope('jobs', scope, job.id))) { res.status(404).json({ success: false, error: 'Job not found' }); return null }
  }
  return { job, canEdit: editor }
}

/** The login's name for "saved by" and "drawn by". */
export async function nameOf(req: any): Promise<string> {
  const me = req.user?.id ? await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true, email: true } }).catch(() => null) : null
  return ((me ? `${me.firstName ?? ''} ${me.lastName ?? ''}`.trim() : '') || me?.email || req.user?.email || 'Office').slice(0, 200)
}

// ── The plan's shape (PUT) ───────────────────────────────────────────────────

const id = z.string().min(1).max(64)
const latLng = z.object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) }).strict()
const ft = z.number().finite().min(0).max(100_000)
const gate = z.object({
  id, atFt: ft, widthFt: z.number().finite().gt(0).max(200),
  type: z.enum(['walk', 'double']), swing: z.enum(['in', 'out']), hinge: z.enum(['left', 'right']).nullable(),
}).strict()
const side = z.object({
  id, name: z.string().max(120), a: id, b: id,
  quotedFt: ft.nullable(), yardSideId: id.nullable(), walkStepIds: z.array(id).max(400), gates: z.array(gate).max(30),
  teeFrom: id.nullable().optional(),
}).strict()
const answer = z.object({ kind: z.enum(['keep', 'drawn']), note: z.string().max(2000), by: z.string().max(200), at: z.string().max(40), coId: z.string().min(1).max(64).nullable().optional() }).strict()
const ring = (max: number) => z.array(latLng).max(max)

/** A survey picture's address as this server gives it: /api/site-plans/<job>/survey/<file>. */
export const SURVEY_FILE = /^[0-9a-f-]{36}\.(png|jpg)$/
export const surveyUrl = (jobId: string, file: string) => `/api/site-plans/${encodeURIComponent(jobId)}/survey/${file}`

export function planSchemaFor(jobId: string) {
  const survey = z.object({
    url: z.string().max(300).refine(u => {
      const m = /^\/api\/site-plans\/([^/]+)\/survey\/([^/?#]+)$/.exec(u)
      return !!m && decodeURIComponent(m[1]) === jobId && SURVEY_FILE.test(m[2])
    }, 'The survey picture must be one uploaded to this job\'s plan.'),
    w: z.number().int().positive().max(40_000), h: z.number().int().positive().max(40_000),
    p1: z.object({ px: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(), at: latLng }).strict(),
    p2: z.object({ px: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(), at: latLng }).strict(),
    ft: z.number().finite().gt(0).max(100_000),
    opacity: z.number().finite().min(0).max(1),
  }).strict()
  return z.object({
    v: z.literal(1),
    // An older tab sends origin.source too: taken and dropped.
    origin: z.object({ lat: latLng.shape.lat, lng: latLng.shape.lng, source: z.string().max(200).optional() }).strict().transform(o => ({ lat: o.lat, lng: o.lng })),
    posts: z.array(latLng.extend({ id })).max(3000),
    sides: z.array(side).max(500),
    house: z.array(ring(1000)).max(20),
    startPostId: id.nullable(),
    notes: z.string().max(10_000),
    parcel: z.object({ id: z.string().max(80), rings: z.array(ring(5000)).max(30), source: z.string().max(200), fetchedAt: z.string().max(40) }).strict().nullable(),
    neighbors: z.array(z.array(ring(2000)).max(30)).max(80).optional(),
    survey: survey.nullable(),
    answers: z.record(z.string().max(120), answer).refine(a => Object.keys(a).length <= 1000, 'Too many answers.'),
    permitAerial: z.boolean().optional(),
    pending: z.array(z.object({
      id, coId: id, coNumber: z.number().int().min(0).max(100_000).nullable(),
      kind: z.enum(['gate', 'longer']), sideId: id, gate: gate.optional(), newFt: z.number().finite().gt(0).max(100_000).optional(),
      by: z.string().max(200), at: z.string().max(40),
    }).strict()).max(100).optional(),
  }).strict().superRefine((p, ctx) => {
    const posts = new Set<string>()
    for (const q of p.posts) { if (posts.has(q.id)) ctx.addIssue({ code: 'custom', message: `Post ${q.id} is in the plan twice.` }); posts.add(q.id) }
    const sides = new Set<string>()
    for (const s of p.sides) {
      if (sides.has(s.id)) ctx.addIssue({ code: 'custom', message: `Side ${s.name || s.id} is in the plan twice.` })
      sides.add(s.id)
      if (!posts.has(s.a) || !posts.has(s.b)) ctx.addIssue({ code: 'custom', message: `Side ${s.name || s.id} ends at a post that is not in the plan.` })
    }
    for (const s of p.sides) if (s.teeFrom && !sides.has(s.teeFrom)) ctx.addIssue({ code: 'custom', message: `Side ${s.name || s.id} is drawn from a side that is not in the plan.` })
    if (p.startPostId && !posts.has(p.startPostId)) ctx.addIssue({ code: 'custom', message: 'The start post is not in the plan.' })
    for (const c of p.pending ?? []) {
      if (!sides.has(c.sideId)) ctx.addIssue({ code: 'custom', message: `Change order CO-${c.coNumber ?? '?'} waits on a side that is not in the plan.` })
      if (c.kind === 'gate' ? !c.gate : !c.newFt) ctx.addIssue({ code: 'custom', message: `Change order CO-${c.coNumber ?? '?'}'s change on the plan is missing its ${c.kind === 'gate' ? 'gate' : 'feet'}.` })
    }
  })
}

/** Is a survey's picture on disk for this job (a URL that passes the shape check but was never uploaded is refused). */
export function surveyFileOf(accountId: string, jobId: string, url: string): string | null {
  const file = url.split('/').pop() ?? ''
  if (!SURVEY_FILE.test(file)) return null
  const full = path.join(planDir(accountId, jobId), file)
  return fs.existsSync(full) ? full : null
}

/** Where a job's plan files live (survey pictures, permit sheets): private, served only through routes/sitePlans.ts. */
export function planDir(accountId: string, jobId: string): string {
  return mediaDir(accountId, 'site-plans', jobId.replace(/[^\w-]/g, ''))
}

// ── Reading ──────────────────────────────────────────────────────────────────

export const isSignedQuote = (q: { status?: string | null; acceptedAt?: Date | null; soldAt?: Date | null } | null | undefined) => !!q && !!(q.acceptedAt || q.soldAt || q.status === 'SOLD')

/** GET /api/site-plans/:jobId */
export async function planPayload(accountId: string, job: any, canEdit: boolean) {
  // A change order approved, signed or voided since: its waiting change put on the plan or taken off first.
  if (job.quoteId) await reconcilePlanChanges(accountId, job.quoteId).catch(err => console.error('[site-plans] change orders:', err))
  const [row, quote, settings, permit] = await Promise.all([
    prisma.sitePlan.findUnique({ where: { jobId: job.id } }),
    job.quoteId ? prisma.savedQuote.findFirst({ where: { id: job.quoteId, accountId }, select: { id: true, status: true, acceptedAt: true, soldAt: true, layout: true } }) : null,
    sitePlanSettings(accountId),
    prisma.permit.findUnique({ where: { jobId: job.id }, select: { county: true } }).catch(() => null),
  ])
  const revisions = row ? await prisma.sitePlanRevision.findMany({ where: { planId: row.id }, orderBy: { revision: 'desc' }, take: 50, select: { revision: true, by: true, at: true, note: true } }) : []
  const current = await currentFence(accountId, job.quoteId)
  return {
    plan: row ? (row.data as SitePlanData) : null,
    revision: row?.revision ?? 0,
    doneAt: row?.doneAt ?? null,
    // The revision it was marked done at, and whether the working plan has changed since (the crew still has the done copy).
    doneRevision: row?.doneAt ? (row.doneRevision ?? null) : null,
    changedSinceDone: !!row?.doneAt && !!row.doneData && !sameJson(asSold(row.data), row.doneData),
    doneBy: row?.doneBy ?? null,
    updatedAt: row?.updatedAt ?? null,
    revisions,
    job: {
      id: job.id, quoteId: job.quoteId ?? null, address: job.customerAddress, customerName: job.customerName,
      county: await jobCounty(job, row ? (row.data as any)?.origin ?? null : null, permit?.county),
      lat: typeof job.lat === 'number' ? job.lat : null, lng: typeof job.lng === 'number' ? job.lng : null,
    },
    quote: quote ? { id: quote.id, status: quote.status, signed: isSignedQuote(quote), layout: quote.layout ?? null } : null,
    // The job's fence now: the signed quote with its approved and signed change orders. The plan is checked against this.
    current,
    settings: { tolFt: settings.tolFt, tolPct: settings.tolPct, setbackFt: settings.setbackFt },
    permitSheet: row?.permitPdfPath ? { url: `/api/site-plans/${encodeURIComponent(job.id)}/permit-sheet.pdf` } : null,
    canEdit,
  }
}

// ── Saving ───────────────────────────────────────────────────────────────────

export class PlanConflict extends Error { constructor(msg: string) { super(msg) } }

/**
 * Save a plan made from `baseRevision`: the next revision, and its row in the
 * history. Saved since by someone else (another revision): PlanConflict. A
 * plan marked done keeps its done mark.
 */
export async function savePlan(accountId: string, job: { id: string; quoteId: string | null }, plan: SitePlanData, baseRevision: number, by: string, note: string): Promise<{ revision: number; updatedAt: Date }> {
  return prisma.$transaction(async tx => {
    const row = await tx.sitePlan.findUnique({ where: { jobId: job.id } })
    let saved
    if (!row) {
      if (baseRevision !== 0) throw new PlanConflict('This plan was removed or never saved. Open it again.')
      try {
        saved = await tx.sitePlan.create({ data: { accountId, jobId: job.id, quoteId: job.quoteId, revision: 1, data: plan } })
      } catch (e) {
        if (isUniqueViolation(e)) throw new PlanConflict('Someone else saved this plan at the same moment.')
        throw e
      }
    } else {
      if (row.accountId !== accountId) throw new PlanConflict('This plan belongs to another company.')
      const n = await tx.sitePlan.updateMany({ where: { id: row.id, revision: baseRevision }, data: { revision: baseRevision + 1, data: plan, quoteId: job.quoteId ?? row.quoteId } })
      if (n.count !== 1) throw new PlanConflict('Someone else saved this plan since you opened it.')
      saved = (await tx.sitePlan.findUnique({ where: { id: row.id } }))!
    }
    await tx.sitePlanRevision.create({ data: { planId: saved.id, revision: saved.revision, data: plan, by, note: note.slice(0, 500) } })
    return { revision: saved.revision, updatedAt: saved.updatedAt }
  })
}

/** The flags still open on the saved plan, checked against the job's fence now (the quote with its approved change orders) with Settings' tolerances. */
export async function openFlagsOf(accountId: string, plan: SitePlanData, current: CurrentFence | null): Promise<string[]> {
  const [m, s] = await Promise.all([siteModule(), sitePlanSettings(accountId)])
  const flags = m.planFlags(plan, current?.yard ?? null, { tolFt: s.tolFt, tolPct: s.tolPct })
  // An answer waiting on a change order (its coId) counts once that change order is approved or signed (reconcilePlanChanges drops the coId then).
  const waiting = (f: { key: string }) => !!plan.answers?.[f.key]?.coId
  return [...m.openFlags(plan, flags), ...flags.filter(f => plan.answers?.[f.key] && waiting(f) && !m.openFlags(plan, [f]).length)]
    .map(f => (waiting(f) ? `${f.text} (waiting on its change order to be signed or approved)` : f.text))
}

/**
 * Mark the plan done: no flag left open. Sets layout.planDone on the quote
 * ("Site plan needed" off; web/src/yardLayout.ts sitePlanNeeded) and nothing
 * else on it: no reprice.
 */
export async function markDone(accountId: string, job: { id: string; quoteId: string | null }, revision: number, by: string): Promise<{ ok: true; doneAt: Date } | { ok: false; status: number; error: string; open?: string[] }> {
  const row = await prisma.sitePlan.findUnique({ where: { jobId: job.id } })
  if (!row || row.accountId !== accountId) return { ok: false, status: 409, error: 'Save the plan first.' }
  if (row.revision !== revision) return { ok: false, status: 409, error: 'Someone else saved this plan since you opened it.' }
  const quote = job.quoteId ? await prisma.savedQuote.findFirst({ where: { id: job.quoteId, accountId }, select: { id: true } }) : null
  const open = await openFlagsOf(accountId, asSold(row.data), await currentFence(accountId, job.quoteId))
  if (open.length) return { ok: false, status: 409, error: 'Answer every flag first.', open }
  const doneAt = new Date()
  await prisma.$transaction(async tx => {
    // The plan exactly as done (no change order still waiting): what the crew, the permit sheet and the customer read.
    const n = await tx.sitePlan.updateMany({ where: { id: row.id, revision }, data: { doneAt, doneBy: by, doneData: asSold(row.data), doneRevision: revision } })
    if (n.count !== 1) throw new PlanConflict('Someone else saved this plan since you opened it.')
    if (quote) await setPlanDone(tx, quote.id, true)
  })
  return { ok: true, doneAt }
}

/** Reopen a done plan: "Site plan needed" shows again on a walked quote. */
export async function reopen(accountId: string, job: { id: string; quoteId: string | null }): Promise<boolean> {
  const row = await prisma.sitePlan.findUnique({ where: { jobId: job.id } })
  if (!row || row.accountId !== accountId) return false
  await prisma.$transaction(async tx => {
    await tx.sitePlan.update({ where: { id: row.id }, data: { doneAt: null, doneBy: null, doneData: Prisma.DbNull, doneRevision: null } })
    if (job.quoteId) await setPlanDone(tx, job.quoteId, false)
  })
  return true
}

/** layout.planDone on the quote, read and written in one statement so a save of the quote at the same moment keeps both. Its updatedAt in UTC, as Prisma keeps it (NOW() is the database's local time: a phone's since-sync skipped the change and the job window kept "Site plan needed" until a reload). */
async function setPlanDone(tx: any, quoteId: string, done: boolean): Promise<void> {
  await tx.$executeRaw`UPDATE "SavedQuote" SET "layout" = jsonb_set(COALESCE("layout", '{}'::jsonb), '{planDone}', ${done ? 'true' : 'false'}::jsonb, true), "updatedAt" = (NOW() AT TIME ZONE 'UTC') WHERE "id" = ${quoteId} AND "layout" IS NOT NULL`
}

// ── Pictures ─────────────────────────────────────────────────────────────────

/** A done plan's picture for the customer (no crew numbers), only once the quote is signed; '' otherwise. */
export async function customerPlanSvg(q: { id: string; accountId: string; status?: string | null; acceptedAt?: Date | null; soldAt?: Date | null }): Promise<string> {
  if (!isSignedQuote(q)) return ''
  const row = await prisma.sitePlan.findFirst({ where: { accountId: q.accountId, quoteId: q.id, doneAt: { not: null } }, orderBy: { updatedAt: 'desc' } }).catch(() => null)
  if (!row) return ''
  const job = await prisma.savedJob.findFirst({ where: { id: row.jobId, deletedAt: null }, select: { id: true } }).catch(() => null)
  if (!job) return ''
  const m = await siteModule()
  return m.sitePlanSvg(donePlanOf(row), { width: 760, height: 560, propertyLine: true, neighbors: false })
}

/** The width each crew section is spaced at when the quote's own count does not match a piece: the style's section width (chain link at most 10 ft). */
export async function sectionWidthFor(accountId: string, fenceStyle: string): Promise<number> {
  if (!fenceStyle) return 8
  try {
    const { dataFor } = await import('./quotePricing.js')
    const w = Number((await siteModule()).changeOrderSectionWidthFor(await dataFor(accountId), fenceStyle)) || 0
    const chain = /^cl[\s-]|chain/i.test(fenceStyle)
    return w > 0 ? (chain ? Math.min(10, w) : w) : chain ? 10 : 8
  } catch { return 8 }
}

/**
 * The job's fence as it is now: the signed quote with every approved or
 * signed change order's change (lib/changeOrderWork.ts workNow: the newest
 * approved change order's work, rebuilt on the earlier ones), else the signed
 * quote's. GET /api/site-plans `current`; the done check, the crew's sheet and
 * the permit sheet read it.
 */
export interface CurrentFence {
  fenceStyle: string
  /** The yard as priced (null: a typed run list). */
  yard: any | null
  /** Feet of each run over 0, in the order the yard gives them. */
  runs: number[]
  /** Sections in each of those runs, as priced. */
  runSections: number[]
  /** Each run's panel pick ('auto', '6ft', '8ft'), when the work kept one. */
  runRails: string[] | null
  /** The change orders it includes (approved or signed, with a change to the work), by number. */
  changeOrders: number[]
}

export async function currentFence(accountId: string, quoteId: string | null | undefined): Promise<CurrentFence | null> {
  if (!quoteId) return null
  const { workNow } = await import('./changeOrderWork.js')
  const { work, row } = await workNow(accountId, quoteId)
  if (!work) return null
  const nums = (a: unknown) => (Array.isArray(a) ? a.map(Number).filter(n => Number.isFinite(n)) : [])
  const layout = (work.layout ?? null) as any
  const included = row ? (await prisma.changeOrder.findMany({ where: { accountId, quoteId, status: 'approved', deletedAt: null, approvedAt: { lte: (row as any).approvedAt ?? new Date() } }, select: { number: true, work: true }, orderBy: { number: 'asc' } })).filter(r => !!r.work).map(r => r.number) : []
  return {
    fenceStyle: row ? String(work.fenceStyle || '') : chosenStyleOf(work),
    yard: layout?.yard ?? null,
    runs: nums(work.runs).filter(f => f > 0),
    runSections: nums(layout?.runSections),
    runRails: Array.isArray(work.runRails) ? work.runRails.map(String) : null,
    changeOrders: included,
  }
}

/** The crew's posts for a plan, spaced as the job's fence is now counted (the quote with its approved change orders). */
export async function crewPlanFor(accountId: string, plan: SitePlanData, current: CurrentFence | null, jobStyle: string) {
  const m = await siteModule()
  const style = current?.fenceStyle || jobStyle
  const width = await sectionWidthFor(accountId, style)
  const runSections = current?.runSections ?? null
  const fromYard = m.quoteSectionsOf(plan, current?.yard ?? null, runSections, width)
  // A typed run list (no yard): each piece takes the run of the same feet, each run once.
  const runs = !current?.yard && current && current.runs.length === current.runSections.length ? current.runs.map((ft, i) => ({ ft, sections: current.runSections[i], used: false })) : []
  const sectionsOf = (sideId: string, pieceFt: number) => {
    const hit = runs.find(r => !r.used && r.sections > 0 && Math.abs(r.ft - pieceFt) <= 1)
    if (hit) { hit.used = true; return hit.sections }
    return fromYard(sideId, pieceFt)
  }
  return { ...m.crewPosts(plan, (sideId, pieceFt) => sectionsOf(sideId, pieceFt)), m, style }
}

/** The fence style the customer chose (a proposal's chosen option), else the quote's. */
export function chosenStyleOf(q: { fenceStyle?: string | null; chosenOption?: number | null; proposal?: any } | null): string {
  if (!q) return ''
  const opt = q.proposal && q.chosenOption != null ? q.proposal?.options?.[q.chosenOption] : null
  return String(opt?.fenceStyle || q.fenceStyle || '')
}

// ── Change orders from the plan ──────────────────────────────────────────────

/**
 * The plan the crew, the permit sheet and the customer read: the copy frozen
 * when it was marked done (doneData), never the working plan the office keeps
 * editing. A plan marked done before the copy was kept (Nov 6 2026): its plan
 * as saved.
 */
export function donePlanOf(row: { data: unknown; doneData?: unknown }): SitePlanData {
  return asSold((row.doneData ?? row.data) as SitePlanData)
}

/** The plan as built and sold: a change order still waiting (pending) is never on the crew's or permit sheet or the customer's pages. */
export function asSold(plan: SitePlanData): SitePlanData {
  if (!plan || typeof plan !== 'object') return plan
  const { pending: _p, ...rest } = plan as any
  return rest
}

/** "added a 4 ft single gate on Back", "Back made 130 ft". */
function changeWords(plan: SitePlanData, c: any): string {
  const side = plan.sides?.find((s: any) => s.id === c.sideId)?.name || 'a side'
  if (c.kind === 'gate' && c.gate) return `added a ${Math.round(c.gate.widthFt * 10) / 10} ft ${c.gate.type === 'double' ? 'double' : 'single'} gate on ${side}`
  return `${side} made ${Math.round((c.newFt ?? 0) * 10) / 10} ft`
}

/**
 * The plan's waiting changes against their change orders: each one approved
 * (or signed) is put on the plan with applyChange, each voided or removed is
 * taken off; a new revision for each change order (by who approved it, or
 * "Customer signed"; note "Change order CO-n: ..."). Called when a change
 * order is approved, signed or voided (lib/changeOrders.ts) and when the plan
 * is opened. Returns how many revisions were written.
 */
export async function reconcilePlanChanges(accountId: string, quoteId: string, db: any = prisma, opts: { by?: string } = {}): Promise<number> {
  const job = await db.savedJob.findFirst({ where: { accountId, quoteId, deletedAt: null }, select: { id: true } })
  if (!job) return 0
  const row = await db.sitePlan.findUnique({ where: { jobId: job.id } })
  if (!row || row.accountId !== accountId) return 0
  const answersOf = (p: any): Record<string, any> => (p && typeof p.answers === 'object' && p.answers ? p.answers : {})
  const pending: any[] = Array.isArray((row.data as any)?.pending) ? (row.data as any).pending : []
  // Answers waiting on a change order ("Use the drawn length" through one): in the working plan or the done copy.
  const waitingIds = [row.data, row.doneData].flatMap(p => Object.values(answersOf(p)).map((a: any) => a?.coId).filter(Boolean)).map(String)
  if (!pending.length && !waitingIds.length) return 0
  const coIds = [...new Set([...pending.map(p => String(p.coId)), ...waitingIds])]
  const cos = await db.changeOrder.findMany({ where: { id: { in: coIds } }, select: { id: true, accountId: true, quoteId: true, number: true, status: true, deletedAt: true, approvedBy: true, signedAt: true } })
  const m = await siteModule()
  let plan: SitePlanData = row.data
  // The done copy the crew reads takes an approved change too (the crew must get the paid change); a voided one was never on it.
  let done: SitePlanData | null = row.doneData ?? null
  let rev = row.revision
  let approved = false
  const writes: Array<{ revision: number; data: SitePlanData; by: string; note: string }> = []
  /** Each answer waiting on this change order: kept (its coId dropped) when it went through, taken off when it did not. */
  const settleAnswers = (p: any, coId: string, keep: boolean): { plan: any; n: number } => {
    if (!p) return { plan: p, n: 0 }
    const answers = { ...answersOf(p) }
    let n = 0
    for (const [k, a] of Object.entries(answers)) {
      if (a?.coId !== coId) continue
      n++
      if (keep) { const { coId: _c, ...rest } = a; answers[k] = rest } else delete answers[k]
    }
    return { plan: n ? { ...p, answers } : p, n }
  }
  for (const coId of coIds) {
    const co = cos.find((c: any) => c.id === coId && c.accountId === accountId && c.quoteId === quoteId)
    const mine = (plan.pending ?? []).filter((p: any) => p.coId === coId)
    const waiting = Object.values(answersOf(plan)).some((a: any) => a?.coId === coId) || Object.values(answersOf(done)).some((a: any) => a?.coId === coId)
    if (!mine.length && !waiting) continue
    const n = co?.number ?? mine[0]?.coNumber ?? '?'
    if (co && !co.deletedAt && co.status === 'approved') {
      approved = true
      const words: string[] = mine.map((c: any) => changeWords(plan, c))
      for (const c of mine) { plan = m.applyChange(plan, c); if (done) done = asSold(m.applyChange(done, c)) }
      const a = settleAnswers(plan, coId, true); plan = a.plan
      done = settleAnswers(done, coId, true).plan
      if (a.n) words.push(`its drawn length${a.n === 1 ? '' : 's'} kept`)
      writes.push({ revision: ++rev, data: plan, by: co.signedAt ? 'Customer signed' : (co.approvedBy || 'Office'), note: `Change order CO-${n}: ${words.join('; ')}` })
    } else if (!co || co.deletedAt || co.status === 'void') {
      const what = co && !co.deletedAt ? 'voided' : 'removed'
      const parts: string[] = []
      if (mine.length) { plan = { ...plan, pending: (plan.pending ?? []).filter((p: any) => p.coId !== coId) }; parts.push('its change taken off the plan') }
      const a = settleAnswers(plan, coId, false); plan = a.plan
      done = settleAnswers(done, coId, false).plan
      if (a.n) parts.push(`its answer${a.n === 1 ? '' : 's'} taken off`)
      // Who voided it (the change order's own save passes them); a removal found later on opening the plan: the office.
      writes.push({ revision: ++rev, data: plan, by: opts.by || 'Office', note: `Change order CO-${n} ${what}: ${parts.join('; ') || 'nothing on the plan'}` })
    }
  }
  if (!writes.length) return 0
  if (!(plan.pending ?? []).length) plan = asSold(plan)
  // The done copy keeps the paid change even when the working plan now has a question open: said on the revision.
  if (row.doneAt && approved) {
    const open = await openFlagsOf(accountId, asSold(plan), await currentFence(accountId, quoteId)).catch(() => [] as string[])
    if (open.length) writes[writes.length - 1].note += `. The crew's copy has the change; the plan has a question to answer: ${open.join(' ')}`
  }
  const saved = await db.sitePlan.updateMany({ where: { id: row.id, revision: row.revision }, data: { revision: rev, data: plan, ...(done ? { doneData: done } : {}) } })
  // Saved by someone else at this very moment: the next open of the plan puts it right.
  if (saved.count !== 1) return 0
  for (const w of writes) await db.sitePlanRevision.create({ data: { planId: row.id, revision: w.revision, data: w.data, by: w.by, note: w.note.slice(0, 500) } })
  return writes.length
}
