/**
 * What a change order does to the work (Jonathan, Oct 22 2026): once one is
 * approved, everything follows it, so a change made from the yard drawing
 * keeps the work as it becomes, priced on the server with the quote builder's
 * own math (lib/quotePricing.ts, web/src/quoteJob.ts):
 *
 *   work         the quote's fields after the change (style, runs, rails,
 *                posts, gates, tear out, sections, footage, the yard as drawn
 *                and its plan picture) with the pull sheet and costs it prices
 *                to today, and the inputs it was priced from;
 *   costDelta    what the change does to the quoted cost: the new work priced
 *                today minus the work before it priced today (a cost change
 *                since signing never counts), in cents;
 *   warranty     the contract's warranty before and after, when the change
 *                switches it (no dig <-> dig set gives Lifetime <-> 1 Year).
 *
 * "The work now" of a signed job is the newest approved change order with
 * work, else the signed quote. Typed lines (no drawing) change the price only.
 * The signed quote itself is never changed.
 *
 * A move or a repair changed in the quote builder keeps its work the same way
 * (Nov 2 2026: without it the next change order opened on the signed work but
 * was priced against the contract, and handed the last one's amount back).
 * Beside the shape, its work has its own inputs (the old line, the repair's
 * items; `inputs` below). Typed or picked lines on one stay price only.
 *
 * Money in integer cents, except the quote's own dollar fields kept in `work`
 * (materialCost, laborCost, ...) the way a saved quote has them.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { dataFor, requestFrom } from './quotePricing.js'
import { shapeOf, sameShape, applyChange, clashes, sidesOf, singleTouches, ownChangeWords, ownGateChanges, type WorkShape, type ChangeStep, type DeriveRuns } from './changeOrderMerge.js'

type Json = any

export interface WorkInput {
  /** The quote builder's request (QuoteJobRequest): the inputs to price. */
  request: Json
  /** The yard as drawn and each run's sections. */
  layout?: Json
  /** The site plan picture of the new drawing (SVG). */
  planSvg?: string | null
}

export interface SheetLine { item: string; qty: number; unitCost?: number; total?: number; moneyOnly?: boolean; jobLotPiece?: boolean }

export interface StoredWork {
  request: Json
  /** A move's or repair's inputs the change started from (inputs). */
  baseInputs?: WorkInputs
  /** A move or repair: what the crew does now and what it needs (never a cost), for the packet. */
  workDetail?: WorkDetail | null
  /** Voided: the job it left, and what that left between the contract and the work's price today (routes/change-orders.ts). */
  afterVoid?: { feet: number; sections: number; gapCents: number } | null
  fenceStyle: string
  runs: number[]
  runRails?: string[]
  corners: number
  ends: number
  walkGates: number
  dblGates: number
  tearOutSections: number
  tearOutGates: number
  sections: number
  footage: number
  layout: Json | null
  planSvg: string | null
  pullSheet: SheetLine[]
  materialCost: number
  laborCost: number
  tearOutCost: number
  totalCOGS: number
  pricedAt: string
}

export interface CostDelta { materialCents: number; laborCents: number; tearOutCents: number; totalCents: number }

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const cents = (dollars: unknown) => Math.round(num(dollars) * 100)
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const sumFt = (runs: number[]) => Math.round(runs.reduce((s, f) => s + (f > 0 ? f : 0), 0) * 100) / 100

/** A typed run list's gate widths kept on its layout ({ walk, dbl } in feet), or null. */
function typedGateWidths(layout: Json): { walk: number[]; dbl: number[] } | null {
  const g = isObj(layout) ? layout.gateWidths : null
  const ok = (a: unknown): a is number[] => Array.isArray(a) && a.every(x => typeof x === 'number' && Number.isFinite(x) && x > 0)
  return isObj(g) && ok(g.walk) && ok(g.dbl) ? { walk: g.walk, dbl: g.dbl } : null
}

/** A move's or repair's own inputs, as a request or a saved quote's work keeps them. Null: a new fence. */
export type WorkInputs = { move: Json } | { repair: Json } | null

/** What a move's or repair's packet and pages read from its work, as the work is now. */
export interface WorkDetail { crew: string[]; description: string; needs811: boolean; move?: Json; repair?: Json }

/** The inputs of a saved quote or of a change order's stored work. */
export function inputs(x: Json): WorkInputs {
  const r = isObj(x?.request) ? x.request : isObj(x?.work) ? x.work : null
  const kind = r?.jobType ?? r?.type
  if (kind === 'move' && isObj(r.move)) return { move: r.move }
  if (kind === 'repair' && isObj(r.repair)) return { repair: r.repair }
  return null
}

/** The same, whatever order the keys were saved in; a count of 0 is the same as none. */
function sameData(a: unknown, b: unknown): boolean {
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].every(k => sameData(a[k], b[k]))
  }
  const v = (x: unknown) => (x === 0 || x === undefined ? null : x)
  return JSON.stringify(v(a)) === JSON.stringify(v(b))
}

/** A move's counts: the old line's length and what is on it. */
const COUNT_INPUTS = new Set(['oldFt', 'oldSections', 'oldPosts', 'oldWalkGates', 'oldDblGates'])
/** Where to draw or what started the list: they change no price and never clash. */
const NOT_THE_WORK = new Set(['oldLinePlan', 'tapped', 'what'])
const INPUT_WORDS: Record<string, string> = { oldPostType: 'the old post type', postType: 'the post type', newPostCaps: 'new post caps', damagePct: 'the damage allowance', replaceGates: 'the gates to replace', gateKind: 'the gate type', repairParts: 'the parts for a section repair', debrisCleared: 'the debris', items: 'the repair list' }

/** The single values a change order's inputs set (counts add up, so never these). */
function inputTouches(base: WorkInputs, mine: WorkInputs): string[] {
  const key = mine && 'move' in mine ? 'move' : 'repair'
  const was = (base as Json)?.[key], now = (mine as Json)?.[key]
  if (!isObj(was) || !isObj(now)) return []
  return [...new Set([...Object.keys(was), ...Object.keys(now)])]
    .filter(k => !COUNT_INPUTS.has(k) && !NOT_THE_WORK.has(k) && k !== 'items' && !sameData(was[k], now[k]))
    .map(k => INPUT_WORDS[k] ?? k)
}

/**
 * One change order's own input changes put on the inputs as they are. Counts
 * take the change's difference (a repair's items, a move's old line), so two
 * change orders add up, signed in any order, and a void takes off only its own,
 * the way a gate count does (changeOrderMerge.ts plus). A single value (a post
 * type, new caps) takes the change's value, and two that collide are said in
 * `conflicts`; signingClash stops them being signed.
 */
function putInputs(cur: WorkInputs, base: WorkInputs, mine: WorkInputs, conflicts: string[]): WorkInputs {
  if (!cur || !mine) return cur
  const key = 'move' in cur ? 'move' : 'repair'
  const was = (base as Json)?.[key] ?? (cur as Json)[key], now = (mine as Json)[key]
  if (!now) return cur
  const out: Json = { ...(cur as Json)[key] }
  for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (sameData(was[k], now[k])) continue
    if (COUNT_INPUTS.has(k) && [was[k], now[k], out[k]].every(x => typeof x === 'number')) { out[k] = Math.max(0, out[k] + now[k] - was[k]); continue }
    if (isObj(was[k]) && isObj(now[k])) {
      const inner: Json = { ...(isObj(out[k]) ? out[k] : {}) }
      for (const i of new Set([...Object.keys(was[k]), ...Object.keys(now[k])])) {
        if (sameData(was[k][i], now[k][i])) continue
        const counts = [was[k][i], now[k][i]].every(x => x === undefined || typeof x === 'number')
        inner[i] = counts ? Math.max(0, num(inner[i]) + num(now[k][i]) - num(was[k][i])) : now[k][i]
      }
      out[k] = inner
    } else {
      if (!NOT_THE_WORK.has(k) && !sameData(out[k], was[k]) && !sameData(out[k], now[k])) conflicts.push(INPUT_WORDS[k] ?? k)
      out[k] = now[k]
    }
  }
  return { [key]: out } as WorkInputs
}

/** The quote builder's request for a saved quote (or a change order's stored work). */
export function requestOfQuote(q: Json): Json {
  const runs: number[] = Array.isArray(q?.runs) ? q.runs.map((r: Json) => num(typeof r === 'number' ? r : r?.ft)) : []
  const rails: Json[] = Array.isArray(q?.runRails) ? q.runRails : []
  return {
    fenceStyle: String(q?.fenceStyle ?? ''),
    runs: runs.map((ft, i) => ({ ft, rail: rails[i] === '6ft' || rails[i] === '8ft' ? rails[i] : 'auto' })),
    corners: num(q?.corners), ends: num(q?.ends), walkGates: num(q?.walkGates), dblGates: num(q?.dblGates),
    ...(num(q?.layout?.teeLinePosts) > 0 ? { extraLinePosts: Math.round(num(q.layout.teeLinePosts)) } : {}),
    // The drawing: chain link gate leaves are priced by its gate widths (quoteJob.ts).
    ...(isObj(q?.layout?.yard) ? { yard: q.layout.yard } : {}),
    // A typed run list: the gate widths kept with it (the drawing's when it was typed from one).
    ...(!isObj(q?.layout?.yard) && typedGateWidths(q?.layout) ? { gateWidths: typedGateWidths(q.layout) } : {}),
    tearOutSections: num(q?.tearOutSections), tearOutGates: num(q?.tearOutGates),
    extraLaborHrs: num(q?.adjLaborHrs), hasSalesman: !!q?.hasSalesman, priceAdjust: num(q?.priceAdjust),
    overrides: {},
    // A move or repair is priced as one (its cost difference too), never as a new fence of the same runs.
    ...(() => { const i = inputs(q); return i ? { jobType: 'move' in i ? 'move' : 'repair', ...i } : { jobType: 'new' } })(),
  }
}

/**
 * A new fence: the work picked sections and gates leave. A move or a repair
 * has no such thing: its picked lines are priced from a list, not from its own
 * math, so they stay price only (its work comes from the quote builder).
 */
export const workChangeable = (q: { work?: unknown } | null | undefined) => !(isObj(q?.work) && (q!.work.type === 'move' || q!.work.type === 'repair'))

/** Price a request on the server, with the signed quote's cost choices (its sub rate, labor, Overhead %). */
async function price(accountId: string, body: Json, signed: Json) {
  const m = await pricingModule() as Json
  // The real work and its real costs, never a change order's price (web changeOrderPricing.ts): changeBase stays out.
  const { req, overheadPct } = requestFrom({ ...body, keepCents: false, changeBase: null }, signed, m.importedOldPrice, m.keepsCents)
  const job = m.quoteJobFor(await dataFor(accountId), req, overheadPct)
  return { req, job }
}

/** The work after the change, priced today. */
export async function priceWork(accountId: string, signed: Json, input: WorkInput): Promise<StoredWork> {
  const { req, job } = await price(accountId, input.request, signed)
  if (!job.style) throw Object.assign(new Error('Pick a fence style for the change.'), { status: 400 })
  const runs: number[] = req.runs.filter((r: Json) => r.ft > 0).map((r: Json) => r.ft)
  const rails: string[] = req.runs.filter((r: Json) => r.ft > 0).map((r: Json) => r.rail ?? 'auto')
  const t = job.totals
  // A typed run list keeps its gate widths with the work (as priced: the request's), so the job's rebuilt work prices them the same.
  const typedWidths = isObj(input.layout) && !isObj(input.layout.yard) && isObj(req.gateWidths) ? { gateWidths: req.gateWidths } : {}
  const layout = isObj(input.layout) ? { yard: input.layout.yard ?? null, runSections: Array.isArray(input.layout.runSections) ? input.layout.runSections : job.calc.perRunSections?.filter((_: unknown, i: number) => (req.runs[i]?.ft ?? 0) > 0) ?? null, ...(num(input.layout.teeLinePosts) > 0 ? { teeLinePosts: num(input.layout.teeLinePosts) } : {}), ...typedWidths } : null
  const planSvg = typeof input.planSvg === 'string' && input.planSvg.length <= 400_000 && /^<svg[\s>]/.test(input.planSvg.trim()) ? input.planSvg : null
  return {
    request: req, fenceStyle: req.fenceStyle, runs, ...(rails.some(r => r !== 'auto') ? { runRails: rails } : {}),
    corners: req.corners, ends: req.ends, walkGates: req.walkGates, dblGates: req.dblGates, tearOutSections: req.tearOutSections, tearOutGates: req.tearOutGates,
    // A move's or repair's own count, as a saved quote keeps it (quotePricing.ts withServerCosts).
    sections: job.work ? job.work.sections : job.calc.sections, footage: sumFt(runs), layout, planSvg,
    ...(job.work ? { workDetail: { crew: job.work.crew, description: job.work.description, needs811: job.work.needs811, ...(inputs({ request: req }) ?? {}) } } : {}),
    pullSheet: (job.pullSheet as SheetLine[]).map(l => ({ item: l.item, qty: l.qty, unitCost: l.unitCost, total: l.total, ...(l.moneyOnly || l.jobLotPiece ? { moneyOnly: true } : {}) })),
    materialCost: t.materialCost, laborCost: t.laborCost, tearOutCost: t.tearOutCost, totalCOGS: t.totalCOGS, pricedAt: new Date().toISOString(),
  }
}

/** The cost of a request priced today, in cents. */
async function costToday(accountId: string, body: Json, signed: Json): Promise<CostDelta> {
  const { job } = await price(accountId, body, signed)
  const t = job.totals
  return { materialCents: cents(t.materialCost), laborCents: cents(t.laborCost), tearOutCents: cents(t.tearOutCost), totalCents: cents(t.totalCOGS) }
}

/** The new work's cost minus the work before it, both priced today. */
export async function costDeltaOf(accountId: string, signed: Json, before: Json, after: StoredWork): Promise<CostDelta> {
  const was = await costToday(accountId, isObj(before?.request) ? before.request : requestOfQuote(before), signed)
  const now = { materialCents: cents(after.materialCost), laborCents: cents(after.laborCost), tearOutCents: cents(after.tearOutCost), totalCents: cents(after.totalCOGS) }
  return { materialCents: now.materialCents - was.materialCents, laborCents: now.laborCents - was.laborCents, tearOutCents: now.tearOutCents - was.tearOutCents, totalCents: now.totalCents - was.totalCents }
}

type CoRow = { id: string; number: number; status: string; approvedAt: Date | null; createdAt?: Date | null; voidedAt?: Date | null; work: unknown; scope?: unknown; lines?: unknown; reason?: string; totalCents?: number; contractRev?: number | null; deletedAt?: Date | null }

/**
 * The job's work after an approved change order: the change order's own
 * drawing when it was drawn from the work as it then was, else the work
 * rebuilt with its change put on the earlier ones' (kept as `work.applied`
 * by rebuildJobWork; lib/changeOrderMerge.ts).
 */
export function effectiveWork(r: { work: unknown }): unknown {
  return isObj(r.work) && isObj(r.work.applied) ? r.work.applied : r.work
}

/** The approved change orders of a quote in the order they were approved. */
export function approvedInOrder<T extends CoRow>(rows: T[]): T[] {
  return rows.filter(r => r.status === 'approved' && !r.deletedAt)
    .sort((a, b) => (a.approvedAt?.getTime() ?? 0) - (b.approvedAt?.getTime() ?? 0) || a.number - b.number)
}

/** The newest approved change order that changed the work (null: the work is as signed). */
export function currentWorkRow<T extends CoRow>(rows: T[]): (T & { work: StoredWork }) | null {
  const withWork = approvedInOrder(rows).filter(r => isObj(r.work))
  const last = withWork[withWork.length - 1]
  return last ? ({ ...last, work: effectiveWork(last) } as T & { work: StoredWork }) : null
}

// ── More than one change order with a drawing (lib/changeOrderMerge.ts) ─────

const OPEN = new Set(['needs_ok', 'draft', 'sent'])

/** How the server turns a yard into runs and posts (the builder's own count, through the estimate bundle). */
export async function deriveFor(accountId: string): Promise<DeriveRuns> {
  const m = await pricingModule()
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
  return (yard, style) => (m.deriveYardRuns ? m.deriveYardRuns(b?.config ?? null, yard, style) : null)
}

/**
 * The drawing a change order started from. Kept on it (`work.base`) since
 * Oct 26 2026; one made before that started from the work as it was when it
 * was made: the signed quote with the change orders approved by then.
 */
function baseOf(r: CoRow, quote: WorkShape, approvedBefore: Array<{ at: number; shape: WorkShape }>): WorkShape {
  if (isObj(r.work) && isObj(r.work.base)) return shapeOf(r.work.base)
  const made = r.createdAt ? new Date(r.createdAt).getTime() : Infinity
  const before = approvedBefore.filter(a => a.at < made)
  return before.length ? before[before.length - 1].shape : quote
}

export interface FoldedStep { row: CoRow; step: ChangeStep; shape: WorkShape; merged: boolean; conflicts: string[]; inputs: WorkInputs }

/**
 * The work's shape after each approved change order with a drawing, in the
 * order they were approved, then (open: true) each one still open, by number.
 * Shapes only (no prices): what a new change order starts from, and what the
 * job's work must be.
 */
export function foldShapes(quote: Json, rows: CoRow[], derive: DeriveRuns, opts: { open?: boolean } = {}): { shape: WorkShape; steps: FoldedStep[]; inputs: WorkInputs } {
  const start = shapeOf(quote)
  const approved = approvedInOrder(rows).filter(r => isObj(r.work))
  const open = opts.open ? rows.filter(r => OPEN.has(r.status) && !r.deletedAt && isObj(r.work)).sort((a, b) => a.number - b.number) : []
  let cur = start
  let ins = inputs(quote)
  const snaps: Array<{ at: number; shape: WorkShape }> = []
  const steps: FoldedStep[] = []
  for (const r of [...approved, ...open]) {
    const step: ChangeStep = { number: r.number, base: baseOf(r, start, snaps), work: shapeOf(r.work) }
    const out = applyChange(cur, step, derive)
    ins = putInputs(ins, ((r.work as Json).baseInputs ?? null) as WorkInputs, inputs(r.work), out.conflicts)
    steps.push({ row: r, step, shape: out.shape, merged: out.merged, conflicts: out.conflicts, inputs: ins })
    cur = out.shape
    if (r.status === 'approved' && r.approvedAt) snaps.push({ at: new Date(r.approvedAt).getTime(), shape: cur })
  }
  return { shape: cur, steps, inputs: ins }
}

/** Was `r` drawn with `v`'s change in it: `v` was on the job, signed or still open, when `r` was made. */
export function drawnWith(r: CoRow, v: CoRow): boolean {
  const at = (d: Date | null | undefined) => (d ? new Date(d).getTime() : null)
  const made = at(r.createdAt), was = at(v.createdAt), gone = at(v.voidedAt)
  return r.id !== v.id && made !== null && was !== null && was < made && (gone === null || gone > made)
}

/** A change order's step for the checks below (no fold: only what it changes). */
const stepOf = (r: CoRow, quote: WorkShape): ChangeStep => ({ number: r.number, base: isObj((r.work as Json)?.base) ? shapeOf((r.work as Json).base) : quote, work: shapeOf(r.work) })

/**
 * Why this change order can't be signed yet (null: it can). Lengths and counts
 * add up in any order, but a single value (a gate on a side, the style, a post
 * type, new caps) can't, so job and contract would part (Nov 2 2026):
 * drawn on one still open that sets the same value: that one goes first, or is
 * voided; set beside a signed one, neither knowing the other: one is voided.
 * Other change orders' sides it needs count the same. A void leaves nothing to
 * wait for. Said to the office, and to a customer as a call us.
 */
export function signingClash(me: CoRow, rows: CoRow[], quote: Json): string | null {
  if (!isObj(me.work)) return null
  const start = shapeOf(quote), mine = stepOf(me, start)
  const singles = (r: CoRow, s: ChangeStep) => [...singleTouches(s), ...inputTouches(((r.work as Json).baseInputs ?? null) as WorkInputs, inputs(r.work))]
  const set = new Set(singles(me, mine))
  for (const o of rows) {
    if (o.id === me.id || o.status === 'void' || o.deletedAt || !isObj(o.work)) continue
    const theirs = stepOf(o, start)
    const same = singles(o, theirs).filter(x => set.has(x))
    const needs = sidesOf(theirs).added.some(id => sidesOf(mine).changed.includes(id)) ? ['a side it added'] : []
    const what = [...same, ...needs]
    if (!what.length) continue
    if (OPEN.has(o.status) && o.number < me.number) return `CO-${me.number} and CO-${o.number} both change ${what.join(', ')}, and CO-${o.number} is not signed yet. Have CO-${o.number} signed first, or void it.`
    if (o.status === 'approved' && !drawnWith(me, o) && !drawnWith(o, me)) return `CO-${me.number} and CO-${o.number} both change ${what.join(', ')}, and neither was made with the other in it. Void one of them.`
  }
  return null
}

/** What is left when a change order is voided: said to whoever voids it, kept on it for the job history and the next change order. */
export interface AfterVoid { warning: string | null; feet: number; sections: number; gapCents: number }

const dollars = (c: number) => `$${(Math.abs(c) / 100).toLocaleString('en-US')}`
/** Under this it is whole dollar and post rounding, no gap worth a word. */
const GAP_WORTH_SAYING = 500

/**
 * After a change order with work is voided. Null for typed lines: they changed
 * no work, so voiding one says nothing about it. What is said is what the fold
 * did: the voided change out of the job, unless a later one changed the same
 * thing (then it stayed); and when one was signed, the difference the void left
 * between the contract and what the work prices at today, whichever way. The
 * price is kept; the next change order shows that on its own line.
 */
export async function afterVoid(accountId: string, quote: Json, voided: CoRow, wasSigned: boolean, rows: CoRow[]): Promise<AfterVoid | null> {
  if (!isObj(voided.work)) return null
  const derive = await deriveFor(accountId)
  const now = foldShapes(quote, rows, derive)
  const feet = sumFt(now.shape.runs)
  const later = rows.filter(r => r.status !== 'void' && !r.deletedAt && isObj(r.work) && drawnWith(r, voided)).sort((a, b) => a.number - b.number)
  const list = later.map(r => `CO-${r.number}`).join(later.length > 2 ? ', ' : ' and ')
  const one = later.length === 1
  const stayed = [...new Set(now.steps.flatMap(s => s.conflicts))]
  const bits: string[] = []
  if (later.length) bits.push(stayed.length
    ? `${list} also changed ${stayed.join(', ')}, so that stays as ${one ? 'it' : 'they'} left it, and CO-${voided.number}'s amount is off the contract.`
    : `CO-${voided.number}'s change is out of the job now and ${list} ${one ? 'keeps its' : 'keep their'} own, at the price worked out then.`)
  let gapCents = 0
  if (wasSigned && later.length) {
    const was = foldShapes(quote, rows.map(r => (r.id === voided.id ? { ...r, status: 'approved' } : r)), derive)
    const priceOf = async (f: { shape: WorkShape; inputs: WorkInputs }) => {
      const { job } = await price(accountId, { ...requestForShape(f.shape, requestOfQuote(quote)), ...(f.inputs ?? {}) }, quote)
      return cents(job.totals.price)
    }
    gapCents = (await priceOf(now)) - (await priceOf(was)) + num(voided.totalCents)
    if (Math.abs(gapCents) < GAP_WORTH_SAYING) gapCents = 0
    else bits.push(`That leaves the contract ${dollars(gapCents)} ${gapCents > 0 ? 'under' : 'over'} what this work prices at today. The next change order shows it on its own line.`)
  }
  if (later.length) bits.push(`The job is ${feet} ft now. Check it against the contract before the crew goes.`)
  return { warning: bits.length ? bits.join(' ') : null, feet, sections: 0, gapCents }
}

/** The quote builder's request for a shape, with the other choices of `like` (a stored request). */
export function requestForShape(shape: WorkShape, like: Json): Json {
  const rails = shape.runRails ?? []
  const req: Json = {
    ...(isObj(like) ? like : {}), fenceStyle: shape.fenceStyle,
    runs: shape.runs.map((ft, i) => ({ ft, rail: rails[i] === '6ft' || rails[i] === '8ft' ? rails[i] : 'auto' })),
    corners: shape.corners, ends: shape.ends, walkGates: shape.walkGates, dblGates: shape.dblGates,
    tearOutSections: shape.tearOutSections, tearOutGates: shape.tearOutGates,
  }
  if (num(shape.teeLinePosts) > 0) req.extraLinePosts = Math.round(num(shape.teeLinePosts)); else delete req.extraLinePosts
  // Gate widths come from the shape's drawing (chain link gate leaves by width), or the widths a typed
  // run list keeps (a drawn 10 ft double gate typed as a run list), never from `like`.
  delete req.gateWidths
  if (!isObj(shape.yard) && shape.gateWidths) req.gateWidths = shape.gateWidths
  if (isObj(shape.yard)) req.yard = shape.yard; else delete req.yard
  return req
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * The job's work rebuilt from the signed quote and every approved change
 * order, in the order they were approved, each one's own change put on the
 * ones before it. A change order drawn from the work as it then was keeps its
 * own priced work; one whose change had to be put on another's is priced
 * again and kept as its `work.applied`. Returns the work now (null: as signed).
 */
export async function rebuildJobWork(accountId: string, quoteId: string, tx: any = prisma): Promise<{ work: StoredWork | null; conflicts: string[] }> {
  const rows: CoRow[] = await tx.changeOrder.findMany({ where: { accountId, quoteId, deletedAt: null } })
  if (!rows.some(r => isObj(r.work))) return { work: null, conflicts: [] }
  const q = await tx.savedQuote.findFirst({ where: { id: quoteId, accountId } })
  if (!q) return { work: null, conflicts: [] }
  const { steps } = foldShapes(q, rows, await deriveFor(accountId))
  const conflicts: string[] = []
  let now: StoredWork | null = null
  const done = new Set<string>()
  for (const s of steps) {
    const own = s.row.work as Json
    let applied: StoredWork | null = null
    // A move's or repair's inputs another change order changed too: its own request no longer holds them all.
    if (s.merged || !sameData(s.inputs, inputs(own))) {
      // Rebuilt already for the same work: kept as it was priced (a later approval does not price it again).
      if (isObj(own.applied) && sameShape(shapeOf(own.applied), s.shape) && sameData(inputs(own.applied), s.inputs)) applied = own.applied as StoredWork
      else {
        const layout = s.shape.yard ? { yard: s.shape.yard, ...(num(s.shape.teeLinePosts) > 0 ? { teeLinePosts: s.shape.teeLinePosts } : {}) }
          // A run list keeps its gate widths with the work (the builder and packet read them from the layout).
          : s.shape.gateWidths ? { yard: null, gateWidths: s.shape.gateWidths } : null
        applied = await priceWork(accountId, q, { request: { ...requestForShape(s.shape, own.request), ...(s.inputs ?? {}) }, layout, planSvg: null })
      }
      for (const c of s.conflicts) conflicts.push(`CO-${s.row.number}: ${c}`)
    }
    done.add(s.row.id)
    if (!same(own.applied ?? null, applied)) await keepApplied(tx, s.row.id, own, applied)
    now = applied ?? (own as StoredWork)
  }
  // One no longer approved (voided) keeps no rebuilt work.
  for (const r of rows) if (!done.has(r.id) && isObj(r.work) && isObj((r.work as Json).applied)) await keepApplied(tx, r.id, r.work, null)
  return { work: now, conflicts }
}

async function keepApplied(tx: any, id: string, own: Json, applied: StoredWork | null) {
  const { applied: _old, ...rest } = own; void _old
  await tx.changeOrder.update({ where: { id }, data: { work: (applied ? { ...rest, applied } : rest) as any } })
}

/**
 * What a new change order with a drawing starts from: the signed quote with
 * every approved change order's change and every still open one's (Waiting
 * for OK, draft, sent), and the open ones it includes.
 */
export async function startOfChange(accountId: string, quoteId: string, tx: any = prisma, exclude: string | null = null): Promise<{ shape: WorkShape; like: Json; quote: Json; open: CoRow[]; steps: FoldedStep[]; inputs: WorkInputs } | null> {
  const q = await tx.savedQuote.findFirst({ where: { id: quoteId, accountId } })
  if (!q) return null
  // `exclude`: the change order being worked out again (its lines changed), never on top of itself.
  const rows: CoRow[] = await tx.changeOrder.findMany({ where: { accountId, quoteId, deletedAt: null, ...(exclude ? { id: { not: exclude } } : {}) } })
  const { shape, steps, inputs: ins } = foldShapes(q, rows, await deriveFor(accountId), { open: true })
  const last = steps[steps.length - 1]
  const like = last && isObj(last.row.work) && isObj((last.row.work as Json).request) ? (last.row.work as Json).request : requestOfQuote(q)
  return { shape, like: ins ? { ...like, ...ins } : like, quote: q, open: steps.filter(s => OPEN.has(s.row.status)).map(s => s.row), steps, inputs: ins }
}

/**
 * Said when a change order is made while others with a drawing are still
 * open: it starts from their drawing and adds only its own change; when it
 * changes the same thing as one of them, which one is signed last decides it.
 */
export function openNotice(me: string, start: { steps: FoldedStep[] }, mine: ChangeStep): string | null {
  const open = start.steps.filter(s => OPEN.has(s.row.status))
  if (!open.length) return null
  const names = open.map(s => `CO-${s.row.number}`)
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  const clash = open.map(s => ({ n: s.row.number, what: clashes(s.step, mine) })).filter(c => c.what.length)
  const base = `${me} is drawn on top of ${list} (not signed yet) and adds only its own change.`
  if (!clash.length) return `${base} They can be signed in any order; the job keeps every change that is signed.`
  return `${base} But ${me.toLowerCase()} changes the same thing as ${clash.map(c => `CO-${c.n} (${c.what.join('; ')})`).join(' and ')}, so it can't be signed until ${clash.map(c => `CO-${c.n}`).join(' and ')} ${clash.length === 1 ? 'is' : 'are'} signed or cancelled.`
}

/** The work now: the newest approved change order's, else the signed quote's own fields. */
export async function workNow(accountId: string, quoteId: string, tx: any = prisma): Promise<{ work: Json; row: CoRow | null }> {
  const rows = await tx.changeOrder.findMany({ where: { accountId, quoteId, deletedAt: null }, select: { id: true, number: true, status: true, approvedAt: true, work: true, deletedAt: true } })
  const row = currentWorkRow(rows as CoRow[])
  if (row) return { work: row.work, row }
  const q = await tx.savedQuote.findFirst({ where: { id: quoteId, accountId } })
  return { work: q, row: null }
}

/** What the change does to the work, as differences (the change order's scope). */
export function scopeOf(before: Json, after: StoredWork): Record<string, number | string> {
  const s: Record<string, number | string> = {}
  const ftWas = sumFt((Array.isArray(before?.runs) ? before.runs : []).map((r: Json) => num(typeof r === 'number' ? r : r?.ft)))
  const d = Math.round((after.footage - ftWas) * 100) / 100
  if (d) s.footageFt = d
  const sec = after.sections - num(before?.sections)
  if (sec) s.sections = sec
  const wg = after.walkGates - num(before?.walkGates)
  if (wg) s.walkGates = wg
  const dg = after.dblGates - num(before?.dblGates)
  if (dg) s.dblGates = dg
  if (after.fenceStyle && after.fenceStyle !== before?.fenceStyle) { s.fromStyle = String(before?.fenceStyle ?? ''); s.toStyle = after.fenceStyle }
  return s
}

// ── Words ────────────────────────────────────────────────────────────────────

const usd = (c: number) => '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })
/** "+$450", "-$75". */
export const signedUsd = (c: number) => `${c < 0 ? '-' : '+'}${usd(c)}`
const a = (n: number, one: string, many = `${one}s`) => (Math.abs(n) === 1 ? `a ${one}` : `${Math.abs(n)} ${many}`)

/** "added 12 ft and a walk gate", from the scope; else the lines' descriptions. */
export function whatChanged(co: { scope?: unknown; lines?: unknown; reason?: string }, styleName: (code: string) => string = c => c): string {
  const s = isObj(co.scope) ? co.scope : null
  const add: string[] = [], remove: string[] = []
  const put = (n: number, words: string) => { if (n > 0) add.push(words); else if (n < 0) remove.push(words) }
  if (s) {
    if (num(s.footageFt)) put(num(s.footageFt), `${Math.abs(Math.round(num(s.footageFt) * 100) / 100)} ft`)
    if (num(s.walkGates)) put(num(s.walkGates), a(num(s.walkGates), 'walk gate'))
    if (num(s.dblGates)) put(num(s.dblGates), a(num(s.dblGates), 'double gate'))
  }
  const bits: string[] = []
  if (add.length) bits.push(`added ${join(add)}`)
  if (remove.length) bits.push(`removed ${join(remove)}`)
  if (s?.toStyle && s.toStyle !== s.fromStyle) bits.push(`changed the fence to ${styleName(String(s.toStyle))}`)
  if (bits.length) return join(bits)
  // The price difference line says nothing of the change (web changeOrderPricing.ts DIFFERENCE_LINE).
  const lines = (Array.isArray(co.lines) ? co.lines : []).map((l: Json) => String(l?.description ?? '').trim()).filter(t => t && !/^(Price difference|Changes to the work)( at|, at) today's prices$/.test(t))
  return lines.length ? lines.join(', ') : (co.reason || 'see the change order')
}
const join = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** "Oct 22" in Ocala. */
export const shortDay = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })

/** "Change order CO-1 approved: +$450 (added 12 ft and a walk gate), by Jonathan, Oct 22". */
export function approvedText(co: { number: number; totalCents: number; approvedAt: Date | null; approvedBy?: string | null; verbalBy?: string | null; signedBy?: string | null; signedAt?: Date | null; scope?: unknown; lines?: unknown; reason?: string }, styleName?: (c: string) => string): string {
  const by = co.verbalBy ? `${co.verbalBy} (verbal)${co.signedAt && co.signedBy ? `, signed by ${co.signedBy}` : ''}` : co.signedAt && co.signedBy ? `${co.signedBy} (signed)` : (co.approvedBy || 'the office')
  return `Change order CO-${co.number} approved: ${signedUsd(co.totalCents)} (${whatChanged(co, styleName)}), by ${by}${co.approvedAt ? `, ${shortDay(co.approvedAt)}` : ''}`
}

// ── Pull sheet revisions ─────────────────────────────────────────────────────

export interface LineChange { item: string; was: number; now: number }

/** Line by line: what a pull sheet revision changed (added, removed or a different quantity). Money-only lines are left out. */
export function sheetChanges(before: SheetLine[], after: SheetLine[]): LineChange[] {
  const total = (ls: SheetLine[]) => {
    const m = new Map<string, number>()
    for (const l of ls) if (!l.moneyOnly && l.item) m.set(l.item, Math.round(((m.get(l.item) ?? 0) + num(l.qty)) * 100) / 100)
    return m
  }
  const b = total(before), a2 = total(after)
  const out: LineChange[] = []
  for (const [item, now] of a2) { const was = b.get(item) ?? 0; if (was !== now) out.push({ item, was, now }) }
  for (const [item, was] of b) if (!a2.has(item) && was) out.push({ item, was, now: 0 })
  return out
}

// ── Schedule ─────────────────────────────────────────────────────────────────

/** Crew days for a job of this many sections (the same rule as a job made from a quote: about 15 a day). */
export const daysFor = (sections: number) => Math.max(1, Math.ceil(Math.max(0, sections) / 15))

const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay()
const addDay = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Working days from `start` to `end`, both counted (Settings' work days, Mon-Thu by default). */
export function workDaysBetween(start: string, end: string, workDays: number[]): number {
  let n = 0
  for (let d = start, i = 0; d <= end && i < 400; d = addDay(d, 1), i++) if (workDays.includes(weekday(d))) n++
  return n
}

/** The last working day of a job of `days` days starting `start`. */
export function lastWorkDay(start: string, days: number, workDays: number[]): string {
  let d = start, left = Math.max(1, days)
  for (let i = 0; i < 400; i++) {
    if (workDays.includes(weekday(d))) { left--; if (left === 0) return d }
    d = addDay(d, 1)
  }
  return d
}

/**
 * Does the scheduled install still fit? Null when it does (or the job is not
 * scheduled). Else the words to show: the days it needs, the days it is
 * booked for, and the crew's next job it would run into.
 */
export async function scheduleFit(accountId: string, jobId: string, tx: any = prisma): Promise<string | null> {
  const job = await tx.savedJob.findFirst({ where: { id: jobId, accountId }, select: { id: true, scheduledDate: true, scheduledEndDate: true, estimatedDays: true, crewAssigned: true, completedDate: true } })
  if (!job || !isDay(job.scheduledDate) || job.completedDate) return null
  // The crew finished the whole job ("We finished the whole job", or a Finish on the last crew day): nothing to fit
  // any more, even when it took fewer days than planned (round 3, Oct 26 2026).
  const { installTimes, crewFinishedJob } = await import('./crewInstall.js')
  if (crewFinishedJob(await installTimes(job.id), isDay(job.scheduledEndDate) ? job.scheduledEndDate : job.scheduledDate)) return null
  const settings = await tx.scheduleSettings.findUnique({ where: { accountId } }).catch(() => null)
  const workDays: number[] = Array.isArray(settings?.workDays) && settings.workDays.length ? settings.workDays : [1, 2, 3, 4]
  const need = Math.max(1, job.estimatedDays || 1)
  const end = lastWorkDay(job.scheduledDate, need, workDays)
  const problems: string[] = []
  if (isDay(job.scheduledEndDate) && job.scheduledEndDate >= job.scheduledDate) {
    const booked = workDaysBetween(job.scheduledDate, job.scheduledEndDate, workDays)
    if (booked < need) problems.push(`it needs ${need} crew day${need === 1 ? '' : 's'} now and is booked for ${booked} (${job.scheduledDate} to ${job.scheduledEndDate})`)
  }
  if (job.crewAssigned) {
    const next = await tx.savedJob.findFirst({
      where: { accountId, id: { not: job.id }, deletedAt: null, archivedAt: null, crewAssigned: job.crewAssigned, scheduledDate: { gt: job.scheduledDate, lte: end }, completedDate: null },
      orderBy: { scheduledDate: 'asc' }, select: { customerName: true, scheduledDate: true },
    })
    if (next) problems.push(`it now runs to ${end}, into ${job.crewAssigned}'s next job (${next.customerName}, ${next.scheduledDate})`)
  }
  return problems.length ? `The scheduled install no longer fits: ${problems.join('; ')}.` : null
}

// ── The crew's install packet ────────────────────────────────────────────────

/** One signed change order's own change, for the crew (never a price). */
export interface PacketChangeItem { number: number; rev: number | null; approvedAt: Date; what: string }
export interface PacketChange extends PacketChangeItem {
  work: StoredWork
  /** Change orders voided since: their change is off the job. */
  voided?: Array<{ number: number; voidedAt: Date }>
  all: PacketChangeItem[]
  /** The work's runs by the drawing's side names, same order as work.runs (null: "Run 1", "Run 2"). */
  runNames?: string[] | null
}

/**
 * "added 10 ft (Left side 40 ft → 50 ft)": its own change, side by side when
 * it came from the drawing. A gate put in, taken out or changed says its side
 * (round 3 recheck): "added a walk gate in the Back side (4 ft of fence
 * becomes the gate)", never "added a walk gate and removed 4 ft".
 */
export function ownWhat(r: { work?: unknown; scope?: unknown; lines?: unknown; reason?: string }, voidedBelow = false): string {
  // Drawn on one voided since: its feet before and after are gone, its own difference is still true.
  if (voidedBelow) return whatChanged(r as any)
  const sides = ownChangeWords(r.work)
  const gates = ownGateChanges(r.work)
  if (!gates.length) {
    const what = whatChanged(r as any)
    // A typed line that says its sides already ("Add 10 ft of fence (Left side 40 ft → 50 ft)"): not twice.
    return sides && !what.includes(sides) ? `${what} (${sides})` : what
  }
  const s = isObj(r.scope) ? r.scope : {}
  const added = gates.filter(g => g.kind === 'added').map(g => g.words)
  const bits = [
    ...(added.length ? [`added ${join(added)}`] : []),
    ...gates.filter(g => g.kind !== 'added').map(g => g.words),
    // Sides made longer or shorter, by name (the feet a gate takes out of its side are in its own words).
    ...(sides ? [sides] : []),
    ...(s.toStyle && s.toStyle !== s.fromStyle ? [`changed the fence to ${String(s.toStyle)}`] : []),
  ]
  return join(bits)
}

/**
 * The work after the crew's packet was sent: the newest approved change order
 * that changed it (null: the packet is up to date), and every change order
 * with a drawing approved since (round 3 recheck, Oct 26 2026: the packet said
 * only the last one, "Changed: change order CO-1, added 10 ft", when CO-2's
 * walk gate had come in since too). The packet page then shows the work as it
 * is now and each change (routes/installPacket.ts).
 */
export async function packetChange(accountId: string, quoteId: string | null | undefined, since: Date): Promise<PacketChange | null> {
  if (!quoteId) return null
  const every = await prisma.changeOrder.findMany({ where: { accountId, quoteId, status: { in: ['approved', 'void'] }, deletedAt: null } })
  const rows = every.filter(r => r.status === 'approved')
  const gone = every.filter(r => r.status === 'void' && r.approvedAt && r.voidedAt && r.voidedAt > since && isObj(r.work))
  const cur = currentWorkRow(rows as any[])
  const fresh = !!cur?.approvedAt && cur.approvedAt > since
  if (!fresh && !gone.length) return null
  const below = (r: any) => every.some(v => v.status === 'void' && isObj(v.work) && drawnWith(r, v as any))
  const item = (r: any): PacketChangeItem => ({ number: r.number, rev: r.contractRev ?? null, approvedAt: r.approvedAt, what: ownWhat(r, below(r)) })
  const voided = gone.map(v => ({ number: v.number, voidedAt: v.voidedAt! })).sort((a, b) => a.number - b.number)
  const all = approvedInOrder(rows as any[]).filter(r => isObj(r.work) && r.approvedAt && r.approvedAt > since).map(item)
  if (cur) return { ...item(cur), work: cur.work as StoredWork, voided, all: all.length ? all : fresh ? [item(cur)] : [], runNames: await runNamesOf(accountId, cur.work as StoredWork).catch(() => null) }
  // Every change with work voided: the job is the signed quote again.
  const q = await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId } }) as Json
  if (!q) return null
  const runs: number[] = (Array.isArray(q.runs) ? q.runs : []).map((f: unknown) => num(f)).filter((f: number) => f > 0)
  const work = { fenceStyle: q.fenceStyle, runs, walkGates: q.walkGates, dblGates: q.dblGates, sections: q.sections, footage: sumFt(runs), pullSheet: q.pullSheet ?? [], layout: q.layout ?? null, planSvg: null, ...(q.work?.crew ? { workDetail: { crew: q.work.crew, description: q.work.description ?? '', needs811: !!q.work.needs811 } } : {}) } as unknown as StoredWork
  return { number: voided[voided.length - 1].number, rev: null, approvedAt: voided[voided.length - 1].voidedAt, what: 'voided', work, voided, all: [] }
}

/**
 * The work's runs by the drawing's side names ("Back", "Left side (2 of 2)"),
 * the way the packet names them when it is made (web installPacket.tsx);
 * null when the work has no drawing or its runs do not match it.
 */
export async function runNamesOf(accountId: string, w: StoredWork): Promise<string[] | null> {
  const yard = isObj(w?.layout) && isObj(w.layout.yard) ? w.layout.yard : null
  if (!yard || !Array.isArray(w.runs) || !w.runs.length) return null
  const d = (await deriveFor(accountId))(yard, w.fenceStyle)
  if (!d?.runNames) return null
  const named = d.runs.map((ft, i) => ({ ft, name: d.runNames![i] })).filter(r => r.ft > 0)
  const runs = w.runs.filter(ft => ft > 0)
  if (named.length !== runs.length || named.some((r, i) => Math.abs(r.ft - runs[i]) > 0.01)) return null
  return named.map(r => r.name || '')
}

/** The words of signed change orders with no work (typed or picked), for the crew: no price, ever, even one typed in the words. */
export async function typedLinesFor(accountId: string, quoteId: string | null | undefined): Promise<string[]> {
  if (!quoteId) return []
  const rows = await prisma.changeOrder.findMany({ where: { accountId, quoteId, status: 'approved', deletedAt: null }, orderBy: { number: 'asc' } })
  return rows.filter(r => !isObj(r.work)).flatMap(r => (Array.isArray(r.lines) ? r.lines as Json[] : []))
    .map(l => String(l?.description ?? '').replace(/[-+−]?\$\s?[\d,]+(\.\d+)?/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/** "Changed: change order CO-1" / "Changed: change orders CO-1 and CO-2". */
export function packetChangeHeading(c: PacketChange): string {
  const names = [...c.all.map(a => `CO-${a.number}`), ...(c.voided ?? []).map(v => `CO-${v.number} (voided)`)]
  return `Changed: change order${names.length > 1 ? 's' : ''} ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]}`
}

/** A packet's snapshot with the work as it is now (quantities only, never a cost). */
export function packetWithChange<S extends Record<string, any>>(s: S, c: PacketChange | null): S {
  if (!c) return s
  const w = c.work
  const gates = [w.walkGates ? `${w.walkGates} walk gate${w.walkGates > 1 ? 's' : ''}` : '', w.dblGates ? `${w.dblGates} double gate${w.dblGates > 1 ? 's' : ''}` : ''].filter(Boolean)
  const runSections: number[] = Array.isArray(w.layout?.runSections) ? w.layout.runSections : []
  return {
    ...s, style: w.fenceStyle || s.style, footageFt: w.footage, sections: w.sections,
    pullSheet: (w.pullSheet ?? []).filter(l => !l.moneyOnly).map(l => ({ item: l.item, qty: l.qty })),
    // A move's or repair's steps for the crew, as the work is now.
    ...(w.workDetail && s.work ? { work: { ...s.work, steps: w.workDetail.crew, needs811: w.workDetail.needs811 } } : {}),
    // The new drawing when it came with the change; else the old plan is left out (it no longer matches).
    planSvg: w.planSvg ?? (c.voided?.length ? s.planSvg : undefined),
    // Each run by its side where the drawing names it ("Back"), else "Run 3".
    runs: w.runs.map((ft, i) => ({ label: c.runNames?.[i] || `Run ${i + 1}`, length: `${ft} ft`, sections: runSections[i] ?? 0, spacing: '' })),
    posts: undefined, gates, skips: s.skips,
  }
}
