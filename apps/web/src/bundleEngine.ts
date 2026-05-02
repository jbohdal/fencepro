/**
 * Bundle Engine — applies a QuoteBundle's pricing config to a job input
 * (footage, gates, tearout) and produces a QuoteOption.
 *
 * Mirrors the calculation logic from QuoteBuilder but parameterized by
 * per-bundle overrides: pricingMethod, marginOverride, laborRateOverride,
 * pricePerFootOverride, materialMarkupPercent.
 */

import { calculateMaterials, totalMaterialCost } from './materialCalculator'
import { getConfig, type FenceStyle } from './configStore'
import type { QuoteBundle, QuoteOption, BundleInclusion, BundleAddon } from './bundleStore'
import { sectionsForRun } from './sectionCount'

export interface BundleJobInputs {
  quoteId: string
  fenceStyleId: string    // falls back to bundle.fenceStyleId if absent
  runs: number[]
  corners: number
  ends: number
  walkGates: number
  dblGates: number
  tearOutSections: number
  tearOutGates: number
  adjLaborHrs: number
  hasSalesman: boolean
  priceAdjust: number
  presentationOrder: number
}

export function calculateBundleOption(
  bundle: QuoteBundle,
  inputs: BundleJobInputs,
): Omit<QuoteOption, 'id' | 'createdAt' | 'updatedAt'> {
  const cfg = getConfig()
  const style: FenceStyle | undefined = cfg.fenceStyles.find(s => s.id === (inputs.fenceStyleId || bundle.fenceStyleId))
  const manHourRate = bundle.laborRateOverride ?? cfg.pricing.manHourRate

  const totalFootage = inputs.runs.reduce((s, f) => s + f, 0)
  const sections = style
    ? inputs.runs.reduce((s, ft) => s + sectionsForRun(ft, style.panelWidth), 0)
    : 0

  // Materials
  let materialCost = 0
  if (style && sections > 0) {
    const items = calculateMaterials({
      fenceStyle: style.name,
      runs: inputs.runs,
      corners: inputs.corners,
      ends: inputs.ends,
      walkGates: inputs.walkGates,
      dblGates: inputs.dblGates,
      tearOutSections: inputs.tearOutSections,
      tearOutGates: inputs.tearOutGates,
    })
    materialCost = totalMaterialCost(items)
    if (bundle.materialMarkupPercent) {
      materialCost = materialCost * (1 + bundle.materialMarkupPercent)
    }
  }

  // Labor
  const mhPerWalkGate = 2.4, mhPerDblGate = 4.8
  const baseMH = style
    ? sections / style.sectionsPerMH + inputs.walkGates * mhPerWalkGate + inputs.dblGates * mhPerDblGate
    : 0
  const adjustedMH = baseMH + (inputs.adjLaborHrs || 0)
  const laborCost = adjustedMH * manHourRate

  // Tear out
  const tearOutCost = inputs.tearOutSections * cfg.pricing.tearOutFence
    + inputs.tearOutGates * cfg.pricing.tearOutGate

  const totalCOGS = materialCost + laborCost + tearOutCost

  let quotePrice = 0
  switch (bundle.pricingMethod) {
    case 'price_per_foot': {
      const perFoot = (bundle.pricePerFootOverride ?? 0) / 100
      quotePrice = totalFootage * perFoot
      break
    }
    case 'markup_percent': {
      // already applied to materials above; remaining price uses style/bundle margin
      const margin = bundle.marginOverride ?? style?.margin ?? 0.64
      quotePrice = margin > 0 ? totalCOGS / margin : totalCOGS
      break
    }
    case 'calculated':
    default: {
      const margin = bundle.marginOverride ?? style?.margin ?? 0.64
      quotePrice = margin > 0 ? totalCOGS / margin : totalCOGS
    }
  }

  // Price adjustment
  quotePrice = quotePrice * (1 + (inputs.priceAdjust || 0))

  const commissionPct = inputs.hasSalesman ? cfg.pricing.commissionSalesman : cfg.pricing.commissionNonSalesman
  const commission = quotePrice * (commissionPct || 0)
  const netProfit = quotePrice - totalCOGS - commission
  const marginPercent = quotePrice > 0 ? netProfit / quotePrice : 0
  const pricePerFoot = totalFootage > 0 ? quotePrice / totalFootage : 0

  // Snapshots for presentation
  const inclusionSnapshot: BundleInclusion[] = bundle.inclusions.map(i => ({ ...i }))
  const addonSnapshot: BundleAddon[] = bundle.addons.map(a => ({ ...a }))

  return {
    quoteId: inputs.quoteId,
    bundleId: bundle.id,
    tierLabel: bundle.tierLabel || bundle.tier,
    fenceStyleId: inputs.fenceStyleId || bundle.fenceStyleId,
    sectionCount: Math.round(sections),
    gateCount: inputs.walkGates + inputs.dblGates,
    footage: totalFootage,
    materialCostCents: Math.round(materialCost * 100),
    laborCostCents: Math.round(laborCost * 100),
    overheadCents: 0,
    commissionCents: Math.round(commission * 100),
    quotePriceCents: Math.round(quotePrice * 100),
    marginPercent,
    netProfitCents: Math.round(netProfit * 100),
    pricePerFootCents: Math.round(pricePerFoot * 100),
    isRecommended: bundle.isRecommended,
    presentationOrder: inputs.presentationOrder,
    status: 'draft',
    notes: '',
    inclusionSnapshot,
    addonSnapshot,
    badgeLabel: bundle.highlightBadge || '',
  }
}
