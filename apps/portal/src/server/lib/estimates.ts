/**
 * Estimates for the website quote widget, the chat assistant, the phone agent
 * and /api/quotes: the quote builder's own math (apps/web/src/estimate.ts:
 * material kits, Inventory costs, labor, Target Margin) on the saved Settings,
 * Inventory and kits, so every price comes from the same place. Always
 * labeled an estimate; the real price is the one Jonathan quotes.
 *
 * The web code is bundled into the server build (dist/pricing/estimate.mjs,
 * see build:server); in development the source is loaded directly.
 */

import { fileURLToPath } from 'url'
import prisma from './prisma.js'
import { resolveIntakeAccountId } from './intake.js'

export interface EstimateJob {
  fenceStyle: string
  runs: number[]
  corners: number
  ends: number
  walkGates: number
  dblGates: number
  tearOutSections?: number
  tearOutGates?: number
  extraLaborHrs?: number
  priceAdjust?: number
  hasSalesman?: boolean
}

export interface Estimate {
  label: 'Estimate'
  style: { name: string; category: string }
  totalFootage: number
  sections: number
  materialCost: number
  laborCost: number
  tearOutCost: number
  totalCOGS: number
  basePrice: number
  commissionAmount: number
  price: number
  pricePerFoot: number
  grossMargin: number
  gmPct: number
  marginStatus: 'good' | 'warning' | 'danger'
  manHours: number
  pullSheet: Array<{ item: string; qty: number; unitCost: number; total: number }>
  notes: string[]
}

interface EstimateModule {
  estimate(data: unknown, job: EstimateJob): Estimate
  estimateStyles(config: unknown): Array<{ name: string; category: string }>
}

let loaded: Promise<EstimateModule> | null = null
function pricing(): Promise<EstimateModule> {
  if (!loaded) {
    const fromSource = fileURLToPath(import.meta.url).endsWith('.ts')
    const url = fromSource
      ? new URL('../../../../web/src/estimate.ts', import.meta.url)   // src/server/lib → apps/web/src
      : new URL('../../pricing/estimate.mjs', import.meta.url)        // dist/server/lib → dist/pricing
    loaded = import(url.href) as Promise<EstimateModule>
    loaded.catch(() => { loaded = null })
  }
  return loaded
}

// Settings, Inventory and kits, read again at most every few seconds so a
// price changed in the app reaches the next estimate.
let cache: { at: number; data: { config: unknown; inventory: unknown[]; kits: unknown[] } } | null = null
async function estimateData() {
  if (cache && Date.now() - cache.at < 5000) return cache.data
  const accountId = await resolveIntakeAccountId()
  if (!accountId) throw new Error('No company is set up on this server yet')
  const [business, inventory] = await Promise.all([
    prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }),
    prisma.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } }),
  ])
  const arr = (v: unknown) => (Array.isArray(v) ? v : [])
  const data = { config: business?.config ?? null, inventory: arr(inventory?.items), kits: arr(inventory?.kits) }
  cache = { at: Date.now(), data }
  return data
}

export async function estimateJob(job: EstimateJob): Promise<Estimate> {
  const [m, data] = await Promise.all([pricing(), estimateData()])
  return m.estimate(data, job)
}

/** The fence styles customers can ask about (the active ones in Settings). */
export async function estimateStyleList(): Promise<Array<{ name: string; category: string }>> {
  const [m, data] = await Promise.all([pricing(), estimateData()])
  return m.estimateStyles(data.config).map(s => ({ name: s.name, category: s.category }))
}

/** From just a style and footage: one run, 4 corners and 2 ends (a typical lot). */
export function quickEstimate(fenceStyle: string, linearFootage: number, walkGates = 1, dblGates = 0): Promise<Estimate> {
  return estimateJob({ fenceStyle, runs: [linearFootage], corners: 4, ends: 2, walkGates, dblGates })
}
