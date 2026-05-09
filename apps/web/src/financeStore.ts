/**
 * Finance Store — P&L manual entries + Balance Sheet entries.
 *
 * All amounts in cents (integer). Backed by /api/business-state.plEntries
 * and /api/business-state.balanceSheet via businessStateStore.
 */

import { getBusinessField, setBusinessField } from './businessStateStore'

const uid = () => Math.random().toString(36).slice(2, 10)

// ── P&L Manual Entries ──

export type PlCategory =
  | 'revenue'
  | 'cogs'
  | 'gross_profit'
  | 'operating_expense'
  | 'ebitda_adjustment'
  | 'depreciation'
  | 'amortization'
  | 'interest'
  | 'tax'
  | 'other'

export interface PlManualEntry {
  id: string
  periodMonth: number   // 1-12
  periodYear: number
  category: PlCategory
  label: string
  amountCents: number
  isRecurring: boolean
  notes: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export function getPlEntries(): PlManualEntry[] {
  return getBusinessField('plEntries') as PlManualEntry[]
}
function savePlEntries(e: PlManualEntry[]) { setBusinessField('plEntries', e) }

export function getPlEntriesForPeriod(year: number, month: number): PlManualEntry[] {
  return getPlEntries().filter(e => e.periodYear === year && e.periodMonth === month)
}

export function getPlEntriesForYear(year: number): PlManualEntry[] {
  return getPlEntries().filter(e => e.periodYear === year)
}

export function createPlEntry(data: Omit<PlManualEntry, 'id' | 'createdAt' | 'updatedAt'>): PlManualEntry {
  const e: PlManualEntry = { ...data, id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  const all = getPlEntries()
  all.unshift(e)
  savePlEntries(all)
  return e
}

export function updatePlEntry(id: string, updates: Partial<PlManualEntry>): PlManualEntry | null {
  const all = getPlEntries()
  const idx = all.findIndex(e => e.id === id)
  if (idx < 0) return null
  all[idx] = { ...all[idx], ...updates, updatedAt: new Date().toISOString() }
  savePlEntries(all)
  return all[idx]
}

export function deletePlEntry(id: string): void {
  savePlEntries(getPlEntries().filter(e => e.id !== id))
}

/**
 * Auto-generate recurring entries for a given month/year if missing.
 * Looks for entries marked isRecurring in earlier months and copies them forward.
 */
export function ensureRecurringForPeriod(year: number, month: number): void {
  const all = getPlEntries()
  const existing = new Set(all
    .filter(e => e.periodYear === year && e.periodMonth === month)
    .map(e => e.label))
  // Find most-recent recurring entries before this period
  const earlier = all.filter(e => e.isRecurring && (
    e.periodYear < year || (e.periodYear === year && e.periodMonth < month)
  ))
  const byLabel = new Map<string, PlManualEntry>()
  for (const e of earlier) {
    const prev = byLabel.get(e.label)
    if (!prev ||
        e.periodYear > prev.periodYear ||
        (e.periodYear === prev.periodYear && e.periodMonth > prev.periodMonth)) {
      byLabel.set(e.label, e)
    }
  }
  let added = false
  for (const [label, template] of byLabel) {
    if (existing.has(label)) continue
    all.push({
      ...template,
      id: uid(),
      periodYear: year,
      periodMonth: month,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    added = true
  }
  if (added) savePlEntries(all)
}

// ── Balance Sheet Entries ──

export type BalanceSheetCategory =
  | 'current_asset'
  | 'fixed_asset'
  | 'other_asset'
  | 'current_liability'
  | 'long_term_liability'
  | 'equity'

export interface BalanceSheetEntry {
  id: string
  category: BalanceSheetCategory
  label: string
  amountCents: number
  asOfDate: string        // YYYY-MM-DD
  notes: string
  createdAt: string
  updatedAt: string
}

export function getBsEntries(): BalanceSheetEntry[] {
  return getBusinessField('balanceSheet') as BalanceSheetEntry[]
}
function saveBsEntries(e: BalanceSheetEntry[]) { setBusinessField('balanceSheet', e) }

/** Most-recent entry per label, where asOfDate <= target date. */
export function getBsEntriesAsOf(asOfDate: string): BalanceSheetEntry[] {
  const all = getBsEntries().filter(e => e.asOfDate <= asOfDate)
  const byLabel = new Map<string, BalanceSheetEntry>()
  for (const e of all) {
    const prev = byLabel.get(e.label)
    if (!prev || e.asOfDate > prev.asOfDate) byLabel.set(e.label, e)
  }
  return Array.from(byLabel.values())
}

export function createBsEntry(data: Omit<BalanceSheetEntry, 'id' | 'createdAt' | 'updatedAt'>): BalanceSheetEntry {
  const e: BalanceSheetEntry = { ...data, id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  const all = getBsEntries()
  all.unshift(e)
  saveBsEntries(all)
  return e
}

export function updateBsEntry(id: string, updates: Partial<BalanceSheetEntry>): BalanceSheetEntry | null {
  const all = getBsEntries()
  const idx = all.findIndex(e => e.id === id)
  if (idx < 0) return null
  all[idx] = { ...all[idx], ...updates, updatedAt: new Date().toISOString() }
  saveBsEntries(all)
  return all[idx]
}

export function deleteBsEntry(id: string): void {
  saveBsEntries(getBsEntries().filter(e => e.id !== id))
}
