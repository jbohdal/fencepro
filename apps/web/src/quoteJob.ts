/**
 * One quote priced the way the quote builder prices it: the new fence (or the
 * move or repair), the 6 ft vs 8 ft line, Good Better Best (or the two
 * options), Compare options, the proposal's options and what is saved with
 * the quote. Pure: the quote builder runs it in the browser for the owner and
 * the office, and the server runs the same code (estimate bundle) for a
 * salesman or installer, whose phone gets prices only (quoteView), never a
 * cost (Jonathan, Oct 2026). A quote a salesman saves gets its costs here, on
 * the server.
 */

import { calculateQuote, widthComparison, type QuoteCalc, type QuoteCalcInput, type QuoteStyle } from './quoteCalc'
import { totalMaterialCost, type LineItem } from './materialCalculator'
import { resolveTiers, tierOptions, type ResolvedTier, type TierPrefs, type TierSet } from './tiers'
import { compareStyles, priceOption, workOption, type ProposalOption } from './proposal'
import {
  priceMove, priceRepair, moveRepairSettings, newFenceBetter, toSavedWork,
  type JobType, type MoveInputs, type RepairInputs, type SavedWork, type WorkResult,
} from './moveRepair'
import { cleanOverrides, type QuotePricingOverrides } from './pricingEngine'
import { isQuotable } from './styleAvailability'
import type { AppConfig, FenceStyle } from './configStore'

export interface QuoteJobRequest {
  fenceStyle: string
  runs: Array<{ ft: number; rail: 'auto' | '6ft' | '8ft' }>
  corners: number
  ends: number
  walkGates: number
  dblGates: number
  tearOutSections: number
  tearOutGates: number
  extraLaborHrs: number
  hasSalesman: boolean
  priceAdjust: number
  overrides: QuotePricingOverrides
  jobType: JobType
  move?: MoveInputs | null
  repair?: RepairInputs | null
  /** The tier set used (the live one, or the one the proposal was sent with). */
  tierSet?: Pick<TierSet, 'category' | 'tiers' | 'popular'> | null
  tierPrefs?: TierPrefs
  /** Price Compare options too. */
  compare?: boolean
  /** Styles ticked for the proposal besides the quote's own. */
  offer?: string[]
  offerNewFence?: boolean
  offerMoveAsIs?: boolean
  /** Style photo ids by name (for the proposal options). */
  photoIds?: Record<string, string>
  /** The style the saved quote already has: kept in the list even when it is not available for new quotes. */
  keepStyle?: string | null
}

export interface QuoteJob {
  style: QuoteStyle | undefined
  calcInput: QuoteCalcInput
  calc: QuoteCalc
  width: { at6: number; at8: number } | null
  work: WorkResult | null
  moveAsIs: WorkResult | null
  repairCheck: (ReturnType<typeof newFenceBetter> & { newFenceCents: number | null; nf: QuoteCalc | null; runsFt: number[] }) | null
  /** A new fence lifted to the minimum job price. */
  newMin: boolean
  totals: {
    manHours: number; materialCost: number; laborCost: number; tearOutCost: number; totalCOGS: number
    price: number; commission: number; grossMargin: number; gmPct: number
  }
  pullSheet: LineItem[]
  tiers: ResolvedTier[]
  compareRows: Array<{ style: QuoteStyle; option: ProposalOption }>
  /** The proposal's options, priced (tiers, then the quote's own style and the ones ticked; or the move / repair options). */
  proposalOptions: ProposalOption[]
  /** What the quote saves as its pricing choices (with the cost factor and overhead it was priced at). */
  pricing: QuotePricingOverrides | undefined
}

/** The styles a quote may use: available for quoting, and the one it already has. */
export function quoteStyles(cfg: AppConfig, keep?: string | null): FenceStyle[] {
  return cfg.fenceStyles.filter(s => isQuotable(s) || s.name === keep)
}

export function priceQuoteJob(cfg: AppConfig, req: QuoteJobRequest, overheadPct: number): QuoteJob {
  const styles = quoteStyles(cfg, req.keepStyle ?? req.fenceStyle)
  const style = styles.find(s => s.name === req.fenceStyle)
  const calcInput: QuoteCalcInput = {
    style, runs: req.runs, corners: req.corners, ends: req.ends, walkGates: req.walkGates, dblGates: req.dblGates,
    tearOutSections: req.tearOutSections, tearOutGates: req.tearOutGates, extraLaborHrs: req.extraLaborHrs,
    hasSalesman: req.hasSalesman, priceAdjust: req.priceAdjust, pricing: cfg.pricing, overrides: req.overrides,
    optimizer: cfg.railOptimizer!,
  }
  const calc = calculateQuote(calcInput)
  const width = widthComparison(calcInput, styles)
  const priced = calc.priced
  const sections = calc.sections

  // Move or repair: moveRepair.ts on the same style, Settings and kits.
  const mr = moveRepairSettings(cfg)
  const newLine = { runs: req.runs.map(r => r.ft), corners: req.corners, ends: req.ends, walkGates: req.walkGates, dblGates: req.dblGates }
  const workCommon = style ? { style, pricing: cfg.pricing, overrides: req.overrides, settings: mr, overheadPct, hasSalesman: req.hasSalesman, priceAdjust: req.priceAdjust, extraLaborHrs: req.extraLaborHrs } : null
  const moveIn = req.move ?? null, repairIn = req.repair ?? null
  const work = !workCommon || req.jobType === 'new' ? null
    : req.jobType === 'move' ? (moveIn ? priceMove(workCommon, moveIn, newLine) : null)
      : (repairIn ? priceRepair(workCommon, repairIn) : null)
  let moveAsIs: WorkResult | null = null
  if (workCommon && req.jobType === 'move' && work && moveIn && moveIn.oldFt > 0) {
    const total = newLine.runs.reduce((t, n) => t + (n > 0 ? n : 0), 0)
    if (total > moveIn.oldFt + 0.01) {
      const k = moveIn.oldFt / total
      moveAsIs = priceMove(workCommon, moveIn, { ...newLine, runs: newLine.runs.map(ft => Math.round(ft * k * 100) / 100) })
    }
  }
  let repairCheck: QuoteJob['repairCheck'] = null
  if (req.jobType === 'repair' && work && style && repairIn) {
    const runs = calc.perRunSections
    const tapped = repairIn.tapped ?? []
    const damagedRuns = tapped.length ? [...new Set(tapped.map(k => Number(k.split(':')[0])))] : runs.map((_, i) => i)
    const damagedByRun = tapped.length
      ? damagedRuns.map(r => ({ damaged: tapped.filter(k => Number(k.split(':')[0]) === r).length, sections: runs[r] ?? 0 }))
      : runs.some(n => n > 0) ? [{ damaged: (repairIn.items.repairSection ?? 0) + (repairIn.items.replaceSection ?? 0), sections: runs.reduce((t, n) => t + n, 0) }] : []
    const runsFt = req.runs.map((r, i) => (damagedRuns.includes(i) ? r.ft : 0))
    const nf = runsFt.some(f => f > 0) ? calculateQuote({ ...calcInput, runs: runsFt.map(ft => ({ ft, rail: 'auto' as const })), tearOutSections: 0, tearOutGates: 0, overrides: { ...req.overrides, finalPrice: undefined } }) : null
    const newFenceCents = nf ? Math.round(nf.priced.price * 100) : null
    repairCheck = { ...newFenceBetter({ repairCents: work.priceCents, newFenceCents, damagedByRun }), newFenceCents, nf, runsFt }
  }

  // The figures the quote shows and saves (QuoteBuilder).
  const newMin = req.jobType === 'new' && mr.minimumAppliesToNew && priced.priceMethod !== 'manual' && priced.price > 0 && Math.round(priced.price * 100) < mr.minimumJobCents
  const totalCOGS = work ? work.costCents / 100 : priced.totalCOGS
  const price = work ? work.priceCents / 100 : newMin ? mr.minimumJobCents / 100 : priced.price
  const commission = work ? work.commissionCents / 100 : newMin ? Math.round(price * priced.commissionPct * 100) / 100 : priced.commissionAmt
  const grossMargin = work ? work.grossMarginCents / 100 : newMin ? Math.round((price - totalCOGS - commission) * 100) / 100 : priced.grossMargin
  const totals = {
    manHours: work ? work.manHours : priced.manHours,
    materialCost: work ? work.materialCents / 100 : totalMaterialCost(calc.materials.items),
    laborCost: work ? work.laborCents / 100 : priced.laborCost,
    tearOutCost: work ? work.disposalCents / 100 : priced.tearOutCost,
    totalCOGS, price, commission, grossMargin,
    gmPct: work ? work.gmPct : newMin ? (price > 0 ? grossMargin / price : 0) : priced.gmPct,
  }

  const tiers = req.tierSet && style && sections > 0 ? resolveTiers(calcInput, cfg.fenceStyles, req.tierSet, req.tierPrefs ?? { off: [], swap: {} }) : []
  const compareRows = req.compare && style && sections > 0 ? compareStyles(style, styles).map(s => ({ style: s, option: priceOption(calcInput, s) })) : []

  // The proposal's options, priced exactly as the quote builder prices them on save.
  const proposalOptions: ProposalOption[] = []
  if (work && style) {
    const runSecs = calc.perRunSections.filter((_, i) => req.runs[i].ft > 0)
    const saved = (w: WorkResult) => toSavedWork(w, req.jobType === 'move' ? { move: moveIn! } : { repair: repairIn! })
    if (req.jobType === 'move') {
      if (moveAsIs && req.offerMoveAsIs !== false) {
        proposalOptions.push(workOption(`Move as is: ${Math.round(moveIn!.oldFt)} ft of your fence on the new line`, style.name, moveAsIs, saved(moveAsIs), runSecs))
        proposalOptions.push({ ...workOption('Move plus new fence for the extra length', style.name, work, saved(work), runSecs), finalPrice: price })
      } else proposalOptions.push({ ...workOption('Move your fence to the new line', style.name, work, saved(work), runSecs), finalPrice: price })
    } else {
      proposalOptions.push({ ...workOption('Repair', style.name, work, saved(work), runSecs), finalPrice: price })
      if (req.offerNewFence && repairCheck?.nf) {
        const o = priceOption({ ...calcInput, runs: repairCheck.runsFt.map(ft => ({ ft, rail: 'auto' as const })), tearOutSections: 0, tearOutGates: 0 }, style)
        proposalOptions.push({ ...o, label: `New fence instead: ${o.label}`, snapshot: { ...o.snapshot, work: null } })
      }
    }
  } else if (style) {
    proposalOptions.push(...tierOptions(tiers, req.photoIds ?? {}).map(o => ({ ...o })))
    const offered = [style, ...styles.filter(s => (req.offer ?? []).includes(s.name) && s.name !== style.name)]
    for (const s of offered) if (!proposalOptions.some(o => o.fenceStyle === s.name)) proposalOptions.push(priceOption(calcInput, s))
  }

  const pricing = cleanOverrides({
    ...req.overrides,
    ...(work ? { costFactor: work.costFactor } : priced.priceMethod === 'cost_factor' ? { costFactor: priced.costFactor } : {}),
    overheadPct,
  })
  return {
    style, calcInput, calc, width, work, moveAsIs, repairCheck, newMin, totals,
    pullSheet: work ? work.pullSheet : calc.materials.items,
    tiers, compareRows, proposalOptions, pricing,
  }
}

/** The move or repair as it is saved with the quote, with every cost line (internal). */
export function savedWorkOf(job: QuoteJob, req: QuoteJobRequest, extra: Pick<SavedWork, 'photoOverride'> = {}): SavedWork | undefined {
  if (!job.work) return undefined
  return toSavedWork(job.work, req.jobType === 'move' ? { move: req.move! } : { repair: req.repair! }, {
    newFence: job.repairCheck?.show && job.repairCheck.newFenceCents ? { cents: job.repairCheck.newFenceCents, offered: !!req.offerNewFence } : null,
    photoOverride: extra.photoOverride ?? null,
  })
}

// ── What a salesman's or installer's phone gets: prices only ────────────────

const lineView = (i: LineItem) => ({ item: i.item, qty: i.qty, ...(i.costSource === 'jobLot' || i.costSource === 'wood' ? { costSource: i.costSource } : {}), ...(i.moneyOnly ? { moneyOnly: true } : {}) })
const optionView = (o: ProposalOption) => ({
  label: o.label, fenceStyle: o.fenceStyle, finalPrice: o.finalPrice, perFoot: o.perFoot, sections: o.sections,
  ...(o.tier ? { tier: o.tier } : {}), ...(o.badge ? { badge: o.badge } : {}), ...(o.photoId ? { photoId: o.photoId } : {}),
})
const workView = (w: WorkResult | null) => (w ? {
  type: w.type, priceCents: w.priceCents, manual: w.manual, minimumApplied: w.minimumApplied, pullSheet: w.pullSheet.map(lineView),
  warnings: w.warnings, description: w.description, crew: w.crew, needs811: w.needs811, sections: w.sections, footage: w.footage, manHours: w.manHours,
} : null)

/**
 * The quote as a salesman or installer sees it: sections, the 6 / 8 ft
 * choice per run, the parts list (no costs), every price, warnings that are
 * not about cost. No material, labor, sub rate, margin, commission, profit,
 * cost factor or Target Profit.
 */
export function quoteView(job: QuoteJob) {
  const c = job.calc
  return {
    sections: c.sections, perRunSections: c.perRunSections, perRunRail: c.perRunRail,
    pullSheet: job.pullSheet.map(lineView),
    materialWarnings: c.materials.warnings,
    price: job.totals.price, pricePerFoot: c.priced.pricePerFoot, newFencePrice: c.priced.price, priceMethod: c.priced.priceMethod,
    manHours: job.totals.manHours,
    crewSize: c.priced.crewSize, crewHours: c.priced.crewHours, crewDays: c.priced.crewDays,
    commissionMode: c.priced.commissionMode,
    newMin: job.newMin,
    width: job.width,
    work: workView(job.work),
    moveAsIs: workView(job.moveAsIs),
    repairCheck: job.repairCheck ? { show: job.repairCheck.show, over50: job.repairCheck.over50, over60: job.repairCheck.over60, newFenceCents: job.repairCheck.newFenceCents, runsFt: job.repairCheck.runsFt, nf: !!job.repairCheck.nf } : null,
    tiers: job.tiers.map(t => ({
      spec: t.spec, category: t.category, popular: t.popular, off: t.off, swapped: t.swapped, reason: t.reason ?? null,
      styleName: t.style?.name ?? null, option: t.option ? optionView(t.option) : null, widthFt: t.widthFt, otherWidth: t.otherWidth, sameAs: t.sameAs ?? null,
    })),
    compare: job.compareRows.map(r => ({ styleName: r.style.name, option: optionView(r.option) })),
    proposalOptions: job.proposalOptions.map(optionView),
  }
}
export type QuoteView = ReturnType<typeof quoteView>
