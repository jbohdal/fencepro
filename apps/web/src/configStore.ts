import { withTargetMargins, typedOverheadPct } from './targetMargin'
import { DEFAULT_CONFIG, mergeSavedConfig } from './configDefaults'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FenceStyle {
  id: string
  name: string
  category: 'Vinyl' | 'Chainlink' | 'Commercial' | 'Aluminum' | 'Other'
  /** What price is divided into: 1 − Target Margin (0.56 for 44%). Worked out
   *  from Overhead % and this style's Target Profit % when the config is read;
   *  never typed. */
  margin: number
  /** Target Profit % for this style (14 means 14%). Target Margin = Overhead % + this. */
  targetProfitPct?: number
  sectionsPerMH: number
  panelWidth: number
  mhPerWalkGate: number
  mhPerDblGate: number
  isActive: boolean
  /** When true, the rail width (6ft vs 8ft) is decided per run by the
   *  smart-rail optimizer instead of being fixed by the style. The
   *  panelWidth field acts as a display fallback only. Currently only
   *  set for the WV-Auto ND / WV-Auto DS umbrella styles. */
  autoRailMix?: boolean
  /** Installation method — drives post / concrete / pipe selection. Used by
   *  the mixed-rail material calculator. 'no-dig' = steel pipe + donuts;
   *  'dig-set' = posts in concrete. */
  installMethod?: 'no-dig' | 'dig-set'
  /** Color family for the mixed-rail calculator. Used to pick the right
   *  picket / rail / u-trim SKUs (white vs tan). */
  colorFamily?: 'white' | 'tan'
  /** Subcontractor pay per foot or per section for this style. Blank falls
   *  back to the category rate, then the default rate in Settings → Pricing. */
  subRate?: number
  /** Customer price per foot for this style, used when a quote is priced
   *  per foot instead of from cost. */
  pricePerFoot?: number
}

export interface PricingConfig {
  manHourRate: number
  commissionSalesman: number
  commissionNonSalesman: number
  tearOutFence: number
  tearOutGate: number
  /** How install labor is costed by default. Each quote can switch. */
  laborMode: 'hourly' | 'subcontractor'
  /** What a subcontractor rate is paid on. */
  subUnit: 'foot' | 'section'
  /** Subcontractor pay per unit when the style and its category have none. */
  subRateDefault: number
  /** Subcontractor pay per unit by style category. */
  subRateByCategory: Record<string, number>
  subWalkGate: number
  subDblGate: number
  subTearOutSection: number
  subTearOutGate: number
  /** How the customer price is built by default. Each quote can switch. */
  priceMethod: 'cost_factor' | 'per_foot'
  /** 'included' takes commission out of the price; 'added' puts it on top. */
  commissionMode: 'included' | 'added'
  /** Men on a crew and hours in a crew day: turns man hours into crew time. */
  crewSize: number
  crewHoursPerDay: number
  /** Overhead % of revenue (30 means 30%), typed. One company number. */
  overheadPct?: number
  /** Use overhead from the budget instead: yearly overhead ÷ yearly installed revenue. */
  liveOverhead?: { on: boolean; basis: 'last12' | 'projection' }
  /** Live overhead as it was each month, for the "moved more than 3 points" warning. */
  overheadHistory?: Array<{ month: string; pct: number }>
  /** A quote warns when a part's Inventory price is older than this many months (default 6). */
  priceStaleMonths?: number
}

export interface MarginThresholds {
  good: number
  warning: number
}

export interface PortalBrandConfig {
  accentColor?: string
  supportEmail?: string
  supportPhone?: string
}

export interface CompanyInfo {
  name: string
  phone: string
  email: string
  address: string
  city: string
  state: string
  zip: string
  logoUrl?: string
  primaryColor?: string
  secondaryColor?: string
  legalName?: string
  supportEmail?: string
  supportPhone?: string
  portal?: PortalBrandConfig
}

export interface RailOptimizerConfig {
  /** Master switch for the smart-rail recommendation engine. */
  enabled: boolean
  /** Runs at or below this footage are forced to 6ft sections. Default 6. */
  shortRunCutoffFt: number
  /** When 8ft cost is within this fraction of 6ft cost, prefer 8ft for productivity. Default 0.02 (2%). */
  costPreferenceThreshold: number
  /** When true the per-run optimization table is rendered in the QuoteBuilder. Default true. */
  showDetailsInBuilder: boolean
  /** When true the estimator can manually override the optimizer per run. Default true. */
  allowOverrides: boolean
}

export interface AppConfig {
  company: CompanyInfo
  pricing: PricingConfig
  margins: MarginThresholds
  fenceStyles: FenceStyle[]
  leadSources: string[]
  customerTags: string[]
  pipelineStages: string[]
  railOptimizer?: RailOptimizerConfig
  /** Voice entry: read back, speaking speed, and who has the Voice switch on. See VoicePanel. */
  voice?: { readBack?: boolean; rate?: number; onFor?: string[] }
  /** Customer proposals: what's included, deposit, financing. See proposal.ts. */
  proposal?: ProposalSettings
  /** Appointment types' lengths, the team, and when slots are suggested. See appointmentLogic. */
  appointments?: Partial<AppointmentSettings>
  /** Photos and video kept smaller once a job has been Complete this long (server lib/mediaShrink.ts). */
  media?: { shrinkAfterDays?: number }
}

// Defaults live in configDefaults.ts (pure: the server's estimates use them too).

/** Always returns a populated optimizer config — falls back to defaults if missing. */
export function getRailOptimizerConfig(cfg: AppConfig = getConfig()): RailOptimizerConfig {
  return cfg.railOptimizer ?? DEFAULT_CONFIG.railOptimizer!
}

// ── Storage ───────────────────────────────────────────────────────────────────
//
// Backed by /api/business-state.config via businessStateStore. The legacy
// fencepro_config localStorage blob is migrated on first login post Phase 9.
//
// We also keep a read-only localStorage mirror at the same key. Many call
// sites across the codebase still inline `localStorage.getItem('fencepro_config')`
// to grab company info or fence styles synchronously; mirroring the cached
// config there means those inline reads keep returning fresh data without
// needing one-by-one updates. The canonical source of truth is the cloud
// blob; the mirror is updated on every save and on initBusinessState().

import type { ProposalSettings } from './proposal'
import { getBusinessField, setBusinessField } from './businessStateStore'
import { withDefaults, type AppointmentSettings } from './appointmentLogic'

/** Appointment settings with every default filled in. */
export function getAppointmentSettings(cfg: AppConfig = getConfig()): AppointmentSettings {
  return withDefaults(cfg.appointments)
}

const LEGACY_KEY = 'fencepro_config'

function mirrorToLocalStorage(cfg: AppConfig): void {
  try { localStorage.setItem(LEGACY_KEY, JSON.stringify(cfg)) } catch {}
}

/** Overhead % from the budget when switched on and the budget is filled in (set by targetMargin.ts). */
let liveOverheadPct: ((cfg: AppConfig) => number | null) | null = null
export function setLiveOverheadSource(fn: (cfg: AppConfig) => number | null) { liveOverheadPct = fn }

export { DEFAULT_OVERHEAD_PCT, targetMarginPct, parsePercent } from './targetMargin'

/** Overhead % in use: live from the budget when switched on and available, otherwise the typed one. */
export function overheadPctOf(cfg: AppConfig): number {
  const typed = typedOverheadPct(cfg)
  if (cfg.pricing.liveOverhead?.on && liveOverheadPct) {
    const live = liveOverheadPct(cfg)
    if (live != null && Number.isFinite(live)) return live
  }
  return typed
}

export function getConfig(): AppConfig {
  const saved = getBusinessField('config') as Partial<AppConfig>
  const merged = mergeSavedConfig(saved)
  const out = withTargetMargins(merged, overheadPctOf(merged))
  // Keep the inline-reader mirror fresh on every read; cheap, idempotent,
  // and avoids stale defaults during the brief window after auth hydrates.
  mirrorToLocalStorage(out)
  return out
}

export function saveConfig(config: AppConfig): void {
  setBusinessField('config', config)
  mirrorToLocalStorage(config)
}

export function resetConfig(): void {
  setBusinessField('config', {} as any)
  try { localStorage.removeItem(LEGACY_KEY) } catch {}
}

export function getDefaultConfig(): AppConfig {
  return DEFAULT_CONFIG
}
