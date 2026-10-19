/**
 * Settings defaults, and how a saved config is filled in from them. Pure (no
 * storage), so the server's estimates fill in a config the same way the app
 * does (configStore.getConfig).
 */

import type { AppConfig, FenceStyle } from './configStore'
import { catalogOf, resolveFenceStyles } from './fenceCatalog'

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_FENCE_STYLES: FenceStyle[] = [
  // ── Auto-mix umbrella styles (Milestone B) — optimizer picks 6'/8' per run ──
  { id: 'auto-wv-nd', name: "WV-Auto ND Privacy",  category: 'Vinyl', margin: 0.64, sectionsPerMH: 1.2, panelWidth: 6, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true, autoRailMix: true, installMethod: 'no-dig',  colorFamily: 'white' },
  { id: 'auto-wv-ds', name: "WV-Auto DS Privacy",  category: 'Vinyl', margin: 0.64, sectionsPerMH: 0.8, panelWidth: 6, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true, autoRailMix: true, installMethod: 'dig-set', colorFamily: 'white' },
  // ── Locked-width styles ──
  { id: '1',  name: "WV-ND 6'x6' Privacy",    category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.2,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '2',  name: "WV-ND 6'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.2,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '3',  name: "WV-ND 8'x6' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.8,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '4',  name: "WV-ND 8'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.8,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '5',  name: "WV-ND Bell 4'x6'",        category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.25, panelWidth: 4,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '6',  name: "WV-DS 6'x6' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.8,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '7',  name: "WV-DS 6'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.8,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '8',  name: "WV-DS 8'x6' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.7,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '9',  name: "WV-DS 8'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.7,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '10', name: "TV-ND 6'x6' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.2,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '11', name: "TV-ND 6'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.5,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '12', name: "TV-DS 6'x6' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.1,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
  { id: '13', name: "TV-DS 6'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.1,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
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

export const DEFAULT_CONFIG: AppConfig = {
  company: {
    name: 'Getter Done Fence',
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
    laborMode: 'hourly',
    subUnit: 'foot',
    subRateDefault: 0,
    subRateByCategory: {},
    subWalkGate: 0,
    subDblGate: 0,
    subTearOutSection: 0,
    subTearOutGate: 0,
    priceMethod: 'cost_factor',
    commissionMode: 'included',
    crewSize: 3,
    crewHoursPerDay: 10,
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

/** A saved config with every missing setting filled in from the defaults. */
export function mergeSavedConfig(saved: Partial<AppConfig> | null | undefined): AppConfig {
  const merged: AppConfig = !saved || Object.keys(saved).length === 0 ? DEFAULT_CONFIG : {
    ...DEFAULT_CONFIG,
    ...saved,
    // Pricing and margins merge field by field so a config saved before a
    // setting existed still gets that setting's default.
    pricing: { ...DEFAULT_CONFIG.pricing, ...(saved.pricing ?? {}) },
    margins: { ...DEFAULT_CONFIG.margins, ...(saved.margins ?? {}) },
  }
  // Each style's choices, plain name and what the choice tree says about it (fenceCatalog.ts).
  const fenceCatalog = catalogOf(merged)
  return { ...merged, fenceCatalog, fenceStyles: resolveFenceStyles(merged.fenceStyles ?? [], fenceCatalog) }
}
