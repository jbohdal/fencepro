/**
 * Bundle & Quote Options Store — Good / Better / Best.
 *
 * All amounts in cents (integer). Backed by /api/business-state (bundles +
 * quoteOptions sub-fields) via businessStateStore. The legacy
 * fencepro_bundles + fencepro_quote_options localStorage keys are migrated
 * on first login post Phase 8.
 */

import { getBusinessField, setBusinessField } from './businessStateStore'

const uid = () => Math.random().toString(36).slice(2, 10)

export type BundleTier = 'good' | 'better' | 'best' | 'custom'
export type PricingMethod = 'calculated' | 'price_per_foot' | 'markup_percent'

export interface BundleInclusion {
  id: string
  label: string
  description: string
  isFeatured: boolean
  sortOrder: number
}

export interface BundleAddon {
  id: string
  addonName: string
  addonPriceCents: number
  isIncludedByDefault: boolean
  sortOrder: number
}

export interface QuoteBundle {
  id: string
  name: string
  description: string
  tier: BundleTier
  tierLabel: string          // display label, e.g. "Good", "Better", "Best", or custom
  fenceStyleId: string
  groupName: string          // bundles with same groupName form a trio/duo
  pricingMethod: PricingMethod
  marginOverride?: number        // decimal; overrides style.margin
  laborRateOverride?: number     // $/hr
  pricePerFootOverride?: number  // cents per linear foot (used when pricingMethod=price_per_foot)
  materialMarkupPercent?: number // decimal; used when pricingMethod=markup_percent
  isActive: boolean
  sortOrder: number
  highlightBadge: string         // "Most Popular" etc.
  isRecommended: boolean
  inclusions: BundleInclusion[]
  addons: BundleAddon[]
  createdAt: string
  updatedAt: string
}

export function getBundles(): QuoteBundle[] {
  return getBusinessField('bundles') as QuoteBundle[]
}
function saveBundles(b: QuoteBundle[]) { setBusinessField('bundles', b) }

export function getBundleById(id: string): QuoteBundle | null {
  return getBundles().find(b => b.id === id) || null
}

export function getBundlesByGroup(groupName: string): QuoteBundle[] {
  const TIER_ORDER: Record<BundleTier, number> = { good: 0, better: 1, best: 2, custom: 3 }
  return getBundles()
    .filter(b => b.groupName === groupName && b.isActive)
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])
}

export function getBundleGroups(): { name: string; bundles: QuoteBundle[] }[] {
  const all = getBundles().filter(b => b.isActive)
  const byGroup = new Map<string, QuoteBundle[]>()
  for (const b of all) {
    const key = b.groupName || '(ungrouped)'
    if (!byGroup.has(key)) byGroup.set(key, [])
    byGroup.get(key)!.push(b)
  }
  const TIER_ORDER: Record<BundleTier, number> = { good: 0, better: 1, best: 2, custom: 3 }
  return Array.from(byGroup.entries())
    .map(([name, bundles]) => ({
      name,
      bundles: bundles.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function createBundle(data: Omit<QuoteBundle, 'id' | 'createdAt' | 'updatedAt'>): QuoteBundle {
  const b: QuoteBundle = { ...data, id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  const all = getBundles()
  all.push(b)
  saveBundles(all)
  return b
}

export function updateBundle(id: string, updates: Partial<QuoteBundle>): QuoteBundle | null {
  const all = getBundles()
  const idx = all.findIndex(b => b.id === id)
  if (idx < 0) return null
  all[idx] = { ...all[idx], ...updates, updatedAt: new Date().toISOString() }
  saveBundles(all)
  return all[idx]
}

export function deleteBundle(id: string): void {
  saveBundles(getBundles().filter(b => b.id !== id))
}

// ── Quote Options ──

export interface QuoteOption {
  id: string
  quoteId: string
  bundleId?: string
  tierLabel: string
  fenceStyleId: string
  sectionCount: number
  gateCount: number
  footage: number
  materialCostCents: number
  laborCostCents: number
  overheadCents: number
  commissionCents: number
  quotePriceCents: number
  marginPercent: number
  netProfitCents: number
  pricePerFootCents: number
  isRecommended: boolean
  presentationOrder: number
  status: 'draft' | 'presented' | 'accepted' | 'declined'
  acceptedAt?: string
  acceptedBy?: string
  shareToken?: string
  notes: string
  inclusionSnapshot: BundleInclusion[]
  addonSnapshot: BundleAddon[]
  badgeLabel: string
  createdAt: string
  updatedAt: string
}

export function getOptions(): QuoteOption[] {
  return getBusinessField('quoteOptions') as QuoteOption[]
}
function saveOptions(o: QuoteOption[]) { setBusinessField('quoteOptions', o) }

export function getOptionsForQuote(quoteId: string): QuoteOption[] {
  return getOptions().filter(o => o.quoteId === quoteId).sort((a, b) => a.presentationOrder - b.presentationOrder)
}

export function getOptionById(id: string): QuoteOption | null {
  return getOptions().find(o => o.id === id) || null
}

export function getOptionByShareToken(token: string): QuoteOption[] {
  const opt = getOptions().find(o => o.shareToken === token)
  if (!opt) return []
  return getOptionsForQuote(opt.quoteId)
}

export function createOption(data: Omit<QuoteOption, 'id' | 'createdAt' | 'updatedAt'>): QuoteOption {
  const o: QuoteOption = { ...data, id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  const all = getOptions()
  all.push(o)
  saveOptions(all)
  return o
}

export function updateOption(id: string, updates: Partial<QuoteOption>): QuoteOption | null {
  const all = getOptions()
  const idx = all.findIndex(o => o.id === id)
  if (idx < 0) return null
  all[idx] = { ...all[idx], ...updates, updatedAt: new Date().toISOString() }
  saveOptions(all)
  return all[idx]
}

export function deleteOption(id: string): void {
  saveOptions(getOptions().filter(o => o.id !== id))
}

/** Clear all options for a quote (called before regenerating). */
export function clearOptionsForQuote(quoteId: string): void {
  saveOptions(getOptions().filter(o => o.quoteId !== quoteId))
}

/** Generate or fetch a share token for a quote's options group. */
export function ensureShareTokenForQuote(quoteId: string): string {
  const opts = getOptionsForQuote(quoteId)
  if (opts.length === 0) return ''
  const existing = opts.find(o => o.shareToken)?.shareToken
  if (existing) return existing
  const token = uid() + uid() + uid()
  // Tag token on the first option; getOptionByShareToken fans out to all options of the same quote
  updateOption(opts[0].id, { shareToken: token })
  return token
}
