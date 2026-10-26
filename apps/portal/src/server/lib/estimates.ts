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
  /** Sections in each run, same order as the runs (for the site plan). */
  perRunSections: number[]
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
  /** Warranties per option (web/src/warranties.ts; the types are in lib/warranties.ts). */
  stampWarranties(config: unknown, proposal: unknown, savedProposal: unknown, frozen: boolean): unknown
  styleWarranty(config: unknown, styleName: string, kind?: 'move' | 'repair' | null): any
  defaultWarrantySettings(): any
  warrantySettingsOf(config: unknown): any
  signedOptionWarranty(q: unknown, settings?: unknown): any
  warrantyFromText(text: string, settings?: unknown): any
  warrantyPeriod(w: unknown, start: string | null | undefined): any
  serviceCoverage(w: unknown, start: string | null | undefined, day: string, override?: unknown): any
  isOneYearText(text: unknown): boolean
  isNoDigStyle(style: { name: string; material?: string; choices?: Record<string, string> } | null | undefined): boolean
  dayText(day: string): string
  /** A yard's runs and posts for a style, as the quote builder counts them (web/src/changeOrderYard.ts). */
  deriveYardRuns(config: unknown, yard: unknown, fenceStyle: string): { runs: number[]; corners: number; ends: number; walkGates: number; dblGates: number; linePosts?: number } | null
  estimate(data: unknown, job: EstimateJob, opts?: { preview?: boolean }): Estimate
  estimateStyles(config: unknown, data?: unknown): Array<StyleListItem>
  onHoldStyles(config: unknown): { styles: Array<{ name: string; category: string }>; phone: string }
  styleLabels(config: unknown, data?: unknown): Record<string, string>
  planWood(state: { fenceStyles: unknown[]; fenceCatalog?: unknown; items: unknown[]; kits: unknown[] }): { state: { fenceStyles: unknown[]; fenceCatalog?: unknown; items: unknown[]; kits: unknown[] }; styles: string[]; items: string[]; kits: string[]; catalog: boolean }
  planChainDigSet(state: { fenceStyles: unknown[]; fenceCatalog?: unknown; items: unknown[]; kits: unknown[] }): { state: { fenceStyles: unknown[]; fenceCatalog?: unknown; items: unknown[]; kits: unknown[] }; styles: string[]; items: string[]; kits: string[]; catalog: boolean; concrete: Array<{ kit: string; part: string; qty: number }> }
  planTanAutoDs(fenceStyles: unknown[]): { fenceStyles: unknown[]; added: string | null; copiedFrom: string | null; skipped?: string }
  planTallVinylParts(state: { fenceStyles: unknown[]; items: unknown[]; kits: unknown[] }): { items: unknown[]; added: string[] }
  planChainDigSetPipesAndTies(state:{ fenceStyles: unknown[]; items: unknown[]; kits: unknown[] }): { state: { fenceStyles: unknown[]; items: unknown[]; kits: unknown[] }; renamed: Array<{ from: string; to: string }>; kitLines: Array<{ kitSet: string; kit: string; part: string }>; ties: string[]; skipped: string[] }
}

/**
 * What a customer is told when they ask for a style that is not available for
 * quoting (commercial and industrial, on hold). Same text as the web app's
 * styleAvailability.ts NOT_QUOTABLE_MESSAGE.
 */
export const NOT_QUOTABLE_MESSAGE = 'Call us for commercial and industrial fencing'

/** The estimate refused a style that is not available for quoting. */
export function isNotQuotable(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'not_quotable'
}

let loaded: Promise<EstimateModule> | null = null
/** The web pricing code (bundled in the build, the source in development). */
export function pricingModule(): Promise<EstimateModule> { return pricing() }
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

/** The pricing code and the saved Settings, Inventory and kits it prices with (the website quote's drawn yards use it). */
export async function pricingWithData(): Promise<{ m: any; data: { config: unknown; inventory: unknown[]; kits: unknown[] } }> {
  const [m, data] = await Promise.all([pricing(), estimateData()])
  return { m, data }
}

export async function estimateJob(job: EstimateJob): Promise<Estimate> {
  const [m, data] = await Promise.all([pricing(), estimateData()])
  return m.estimate(data, job)
}

/** Styles turned on but not available for quoting, and the business phone to call instead. */
export async function estimateOnHold(): Promise<{ styles: Array<{ name: string; category: string }>; phone: string }> {
  const [m, data] = await Promise.all([pricing(), estimateData()])
  return m.onHoldStyles(data.config)
}

/** A style as the customer doors list it: its internal name (old code or generated), category and plain name; made in Settings, its choices. */
export interface StyleListItem {
  name: string
  category: string
  label?: string
  material?: string
  choices?: Record<string, string>
  madeFrom?: string
  panelWidth?: number
  autoRailMix?: boolean
}

/** The fence styles customers can ask about (turned on and available for quoting in Settings). */
export async function estimateStyleList(): Promise<StyleListItem[]> {
  const [m, data] = await Promise.all([pricing(), estimateData()])
  return m.estimateStyles(data.config, data).map(s => ({
    name: s.name, category: s.category, label: s.label || s.name,
    ...(s.madeFrom ? { material: s.material, choices: s.choices, madeFrom: s.madeFrom, panelWidth: s.panelWidth, autoRailMix: !!s.autoRailMix } : {}),
  }))
}

/**
 * The plain name of a style by its internal name ("WV-ND 6'x8' Privacy" →
 * "White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig"), from Settings. A
 * name that is not a style (old imported text) comes back as it is.
 */
export async function plainStyleName(name: string | null | undefined): Promise<string> {
  const n = String(name ?? '')
  if (!n) return ''
  try {
    const [m, data] = await Promise.all([pricing(), estimateData()])
    return m.styleLabels(data.config, data)[n] || n
  } catch { return n }
}

export interface WidgetStyle {
  id: string
  name: string
  colors: string[]
  panelWidth: number
  /** Which app style each height and color is priced as. */
  crm: Record<string, Record<string, string>>
}
export interface WidgetMaterial { material: string; label: string; styles: WidgetStyle[] }

/**
 * The website widget's material / style / height / color choices, built from
 * the app's active styles by what their names already say (WV / TV = white /
 * tan, ND / DS = no dig / dig set, 6'x8' = 6 tall, 8 wide, CL - 4' Galv = 4
 * ft galvanized chain link). Every choice is one app style, so the widget's
 * price is that style's estimate. Styles with no parts list (Durafence) and
 * the auto mix styles (the builder's 6 / 8 ft picker) are left out.
 */
export function widgetCatalog(styles: Array<StyleListItem>): WidgetMaterial[] {
  const groups = new Map<string, WidgetMaterial>()
  const add = (material: string, label: string, family: string, height: number, color: string, app: string, panelWidth: number) => {
    const g = groups.get(material) ?? { material, label, styles: [] }
    groups.set(material, g)
    const id = `${material}:${family}`
    let s = g.styles.find(x => x.id === id)
    if (!s) { s = { id, name: family, colors: [], panelWidth, crm: {} }; g.styles.push(s) }
    if (!s.colors.includes(color)) s.colors.push(color)
    const h = `${height}ft`
    s.crm[h] = { ...(s.crm[h] ?? {}), [color]: app }
  }
  // Colors added in Settings join their family, by their choices (the old codes say the same by name).
  const colorName = (label: string | undefined) => {
    const m = (label ?? '').match(/^(.+?) (Vinyl|Chain Link) /)
    return m ? m[1] : ''
  }
  for (const { name, madeFrom, material, choices, label, panelWidth, autoRailMix } of styles) {
    let m: RegExpMatchArray | null
    if (madeFrom && choices && !autoRailMix) {
      const color = colorName(label)
      if (material === 'vinyl' && choices.style === 'privacy' && color && /^\d+$/.test(choices.height ?? '')) {
        const w = Number(choices.width) || panelWidth || 6
        add('vinyl', 'Vinyl', `Privacy, ${w} ft sections, ${choices.install === 'nd' ? 'no dig' : 'set in concrete'}`, Number(choices.height), color, name, w)
      } else if (material === 'chain' && choices.grade === 'res' && color && /^\d+$/.test(choices.height ?? '')) {
        add(`chain-link-${choices.finish}`, `Chain Link (${color})`, 'Residential', Number(choices.height), color, name, 10)
      }
      continue
    }
    if ((m = name.match(/^(WV|TV)-(ND|DS) (\d)'x(\d)' Privacy$/))) {
      add('vinyl', 'Vinyl', `Privacy, ${m[4]} ft sections, ${m[2] === 'ND' ? 'no dig' : 'set in concrete'}`, Number(m[3]), m[1] === 'WV' ? 'White' : 'Tan', name, Number(m[4]))
    } else if ((m = name.match(/^(WV|TV)-(ND|DS) Bell (\d)'x(\d)'$/))) {
      add('vinyl', 'Vinyl', `Bell top, ${m[2] === 'ND' ? 'no dig' : 'set in concrete'}`, Number(m[3]), m[1] === 'WV' ? 'White' : 'Tan', name, Number(m[4]))
    } else if ((m = name.match(/^CL - (\d)' (Galv|Black)$/))) {
      add(m[2] === 'Galv' ? 'chain-link-galvanized' : 'chain-link-black', m[2] === 'Galv' ? 'Chain Link (Galvanized)' : 'Chain Link (Black)', 'Residential', Number(m[1]), m[2] === 'Galv' ? 'Galvanized' : 'Black', name, 10)
    } else if ((m = name.match(/^CL - Com (\d)'(\+1')?( Black)?$/))) {
      add('chain-link-commercial', 'Commercial Chain Link', m[2] ? 'Commercial, with barbed wire' : 'Commercial', Number(m[1]), m[3] ? 'Black' : 'Galvanized', name, 10)
    } else if ((m = name.match(/^Alum - (ND|DS) - Emily - 48$/))) {
      add('aluminum', 'Aluminum', `Emily, ${m[1] === 'ND' ? 'no dig' : 'set in concrete'}`, 4, 'Black', name, 6)
    } else if (/^Alum - DS - Ind Abigail$/.test(name)) {
      add('aluminum', 'Aluminum', 'Industrial Abigail, set in concrete', 6, 'Black', name, 8)
    }
  }
  return [...groups.values()]
}

/** From just a style and footage: one run, 4 corners and 2 ends (a typical lot). */
export function quickEstimate(fenceStyle: string, linearFootage: number, walkGates = 1, dblGates = 0): Promise<Estimate> {
  return estimateJob({ fenceStyle, runs: [linearFootage], corners: 4, ends: 2, walkGates, dblGates })
}
