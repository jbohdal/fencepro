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

export interface AppConfig {
  company: CompanyInfo
  pricing: PricingConfig
  margins: MarginThresholds
  fenceStyles: FenceStyle[]
  leadSources: string[]
  customerTags: string[]
  pipelineStages: string[]
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_FENCE_STYLES: FenceStyle[] = [
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
    name: 'FencePro',
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
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'fencepro_config'

export function getConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    const saved = JSON.parse(raw)
    return { ...DEFAULT_CONFIG, ...saved }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(config: AppConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export function resetConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function getDefaultConfig(): AppConfig {
  return DEFAULT_CONFIG
}
