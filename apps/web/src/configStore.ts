// ── Types ─────────────────────────────────────────────────────────────────────

export interface FenceStyle {
  id: string
  name: string
  category: 'Vinyl' | 'Chainlink' | 'Commercial' | 'Aluminum' | 'Other'
  margin: number
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
}

export interface PricingConfig {
  manHourRate: number
  commissionSalesman: number
  commissionNonSalesman: number
  tearOutFence: number
  tearOutGate: number
}

export interface MarginThresholds {
  good: number
  warning: number
}

export interface CompanyInfo {
  name: string
  phone: string
  email: string
  address: string
  city: string
  state: string
  zip: string
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
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_FENCE_STYLES: FenceStyle[] = [
  // ── Auto-mix umbrella styles (Milestone B) — optimizer picks 6'/8' per run ──
  { id: 'auto-wv-nd', name: "WV-Auto ND Privacy",  category: 'Vinyl', margin: 0.64, sectionsPerMH: 1.2, panelWidth: 6, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true, autoRailMix: true, installMethod: 'no-dig',  colorFamily: 'white' },
  { id: 'auto-wv-ds', name: "WV-Auto DS Privacy",  category: 'Vinyl', margin: 0.64, sectionsPerMH: 0.8, panelWidth: 6, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true, autoRailMix: true, installMethod: 'dig-set', colorFamily: 'white' },
  // ── Locked-width styles ──
  { id: '1',  name: "WV-ND 6'x6' Privacy",    category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.2,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '2',  name: "WV-ND 6'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.2,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '3',  name: "WV-ND 8'x6' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.8,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '4',  name: "WV-ND 8'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.8,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '5',  name: "WV-ND Bell 4'x6'",        category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.25, panelWidth: 4,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '6',  name: "WV-DS 6'x6' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.8,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '7',  name: "WV-DS 6'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.8,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '8',  name: "WV-DS 8'x6' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.7,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '9',  name: "WV-DS 8'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.7,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '10', name: "TV-ND 6'x6' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.2,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '11', name: "TV-ND 6'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.5,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '12', name: "TV-DS 6'x6' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.1,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '13', name: "TV-DS 6'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.1,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '14', name: "CL - 4' Galv",            category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '15', name: "CL - 5' Galv",            category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '16', name: "CL - 6' Galv",            category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '17', name: "CL - 4' Black",           category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '18', name: "CL - 5' Black",           category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '19', name: "CL - 6' Black",           category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '20', name: "CL - Com 6'",             category: 'Commercial', margin: 0.56, sectionsPerMH: 1.0,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '21', name: "CL - Com 6'+1'",          category: 'Commercial', margin: 0.56, sectionsPerMH: 1.0,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '22', name: "CL - Com 6'+1' Black",    category: 'Commercial', margin: 0.56, sectionsPerMH: 1.0,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '23', name: "Alum - ND - Emily - 48",  category: 'Aluminum',   margin: 0.64, sectionsPerMH: 1.5,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '24', name: "Alum - DS - Emily - 48",  category: 'Aluminum',   margin: 0.62, sectionsPerMH: 1.2,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '25', name: "Alum - DS - Ind Abigail", category: 'Aluminum',   margin: 0.58, sectionsPerMH: 1.2,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '26', name: "Durafence",               category: 'Other',      margin: 0.64, sectionsPerMH: 1.0,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
]

const DEFAULT_CONFIG: AppConfig = {
  company: {
    name: 'EZBiz',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: 'FL',
    zip: '',
  },
  pricing: {
    manHourRate: 22,
    commissionSalesman: 0.10,
    commissionNonSalesman: 0,
    tearOutFence: 9.50,
    tearOutGate: 27.00,
  },
  margins: {
    // GM thresholds: Magic Number = 1 - overhead% - profit% ≈ 0.654 → GM target ≈ 0.346
    // style.margin (0.64) is per-style magic number; GM = 1 - style.margin
    good: 0.34,
    warning: 0.27,
  },
  fenceStyles: DEFAULT_FENCE_STYLES,
  leadSources: [
    'Google', 'Facebook', 'Instagram', 'Yard Sign', 'Referral',
    'Door Hanger', 'Repeat Customer', 'Nextdoor', 'Other',
  ],
  customerTags: [
    'Residential', 'Commercial', 'HOA', 'Multi-Family',
    'Agricultural', 'Industrial', 'VIP', 'Warranty',
  ],
  pipelineStages: [
    'First Contact', 'Appointment', 'Estimating', 'Pending Signature',
    'Signed Contract', 'Job Prep', 'Pending Start', 'Jobs In Progress',
    'Job Complete', 'Pending Payment', 'Paid & Closed',
    'Lost Sale', 'No Answer',
  ],
  railOptimizer: {
    enabled: true,
    shortRunCutoffFt: 6,
    costPreferenceThreshold: 0.02,
    showDetailsInBuilder: true,
    allowOverrides: true,
  },
}

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

import { getBusinessField, setBusinessField } from './businessStateStore'

const LEGACY_KEY = 'fencepro_config'

function mirrorToLocalStorage(cfg: AppConfig): void {
  try { localStorage.setItem(LEGACY_KEY, JSON.stringify(cfg)) } catch {}
}

export function getConfig(): AppConfig {
  const saved = getBusinessField('config') as Partial<AppConfig>
  const merged: AppConfig = (!saved || Object.keys(saved).length === 0)
    ? DEFAULT_CONFIG
    : { ...DEFAULT_CONFIG, ...saved }
  // Keep the inline-reader mirror fresh on every read; cheap, idempotent,
  // and avoids stale defaults during the brief window after auth hydrates.
  mirrorToLocalStorage(merged)
  return merged
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
