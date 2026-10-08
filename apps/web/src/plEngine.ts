/**
 * P&L Calculation Engine
 *
 * Combines four data sources into a Profit & Loss statement:
 *   1. AR invoices (revenue)
 *   2. Vendor bills (COGS + operating expenses, by category)
 *   3. Job costing records (direct labor)
 *   4. Manual P&L entries (depreciation, owner salary, etc.)
 */

import { getInvoices } from './billingStore'
import { getBills } from './vendorStore'
import { getPlEntries } from './financeStore'
import type { PlManualEntry } from './financeStore'
import type { VendorBillCategory } from './vendorStore'
import { cloudStorage } from './cloudStorage'
import { getConfig } from './configStore'

export interface PlLine {
  key: string
  label: string
  amount: number  // cents
  indent?: number
  bold?: boolean
  isTotal?: boolean
  isSection?: boolean
  color?: 'positive' | 'negative' | 'neutral'
}

export interface PlPeriod {
  year: number
  month: number  // 1-12
  label: string  // "Jan 2026"
}

export interface PlStatement {
  period: { from: Date; to: Date; label: string }
  revenue: {
    fenceInstallation: number
    otherRevenue: number
    total: number
  }
  cogs: {
    materials: number
    directLabor: number
    subcontractors: number
    equipment: number
    total: number
  }
  grossProfit: number
  grossMargin: number
  opex: {
    overhead: number
    utilities: number
    insurance: number
    other: number
    total: number
  }
  ebitda: number
  ebitdaMargin: number
  depreciation: number
  amortization: number
  interest: number
  tax: number
  ebit: number
  ebt: number
  netIncome: number
}

function inPeriod(date: Date, from: Date, to: Date): boolean {
  const t = date.getTime()
  return t >= from.getTime() && t <= to.getTime()
}

function sumBillsByCategory(from: Date, to: Date, categories: VendorBillCategory[]): number {
  const bills = getBills().filter(b => b.status !== 'void' && b.status !== 'draft')
  let total = 0
  for (const b of bills) {
    if (!categories.includes(b.category)) continue
    const d = new Date(b.billDate)
    if (inPeriod(d, from, to)) total += b.totalCents
  }
  return total
}

function sumManualByCategory(from: Date, to: Date, categories: PlManualEntry['category'][]): number {
  const entries = getPlEntries()
  let total = 0
  for (const e of entries) {
    if (!categories.includes(e.category)) continue
    const d = new Date(e.periodYear, e.periodMonth - 1, 15)
    if (inPeriod(d, from, to)) total += e.amountCents
  }
  return total
}

function sumJobCostingLabor(from: Date, to: Date): number {
  // Job costing records are written by JobCostingTab under fencepro_jobcosting:
  //   { quoteId, completionDate, actualLaborHrs, crew: [{ name, hours, rate }], ... }
  // (This used to read a different key, fencepro_job_costing, and different
  // field names, so the P&L never saw any job costing labor.)
  try {
    const raw = cloudStorage.getItem('fencepro_jobcosting')
    if (!raw) return 0
    const records: Array<{
      completionDate?: string; dateISO?: string; date?: string
      actualLaborHrs?: number; crew?: Array<{ hours?: number; rate?: number }>
      laborCents?: number; labor?: number
    }> = JSON.parse(raw)
    const hourlyRate = getConfig().pricing?.manHourRate ?? 22
    let total = 0
    for (const r of records) {
      const dateStr = r.completionDate || r.dateISO || r.date
      if (!dateStr) continue
      const d = new Date(dateStr)
      if (!inPeriod(d, from, to)) continue
      if (typeof r.laborCents === 'number') { total += r.laborCents; continue }
      if (typeof r.labor === 'number') { total += Math.round(r.labor * 100); continue }
      // Same rule as the Job Costing screen: crew lines if there are any,
      // otherwise actual hours at the man hour rate.
      const crewDollars = Array.isArray(r.crew)
        ? r.crew.reduce((sum, c) => sum + (Number(c.hours) || 0) * (Number(c.rate) || 0), 0)
        : 0
      const dollars = crewDollars > 0 ? crewDollars : (Number(r.actualLaborHrs) || 0) * hourlyRate
      total += Math.round(dollars * 100)
    }
    return total
  } catch { return 0 }
}

function sumInvoiceRevenue(from: Date, to: Date): number {
  const invoices = getInvoices().filter(i =>
    i.status === 'paid' || i.status === 'partially_paid'
  )
  let total = 0
  for (const inv of invoices) {
    const d = new Date(inv.issuedDate || inv.createdAt)
    if (inPeriod(d, from, to)) {
      // Recognize revenue as paid portion for mixed-status invoices
      total += inv.status === 'paid' ? inv.totalCents : inv.amountPaidCents
    }
  }
  return total
}

export function calculatePl(from: Date, to: Date, label: string): PlStatement {
  // Revenue
  const fenceInstallation = sumInvoiceRevenue(from, to)
  const otherRevenue = sumManualByCategory(from, to, ['revenue'])
  const totalRevenue = fenceInstallation + otherRevenue

  // COGS
  const materials = sumBillsByCategory(from, to, ['materials'])
  const laborBills = sumBillsByCategory(from, to, ['labor'])
  const directLabor = laborBills + sumJobCostingLabor(from, to)
  const subcontractors = sumBillsByCategory(from, to, ['subcontractor'])
  const equipment = sumBillsByCategory(from, to, ['equipment'])
  const totalCogs = materials + directLabor + subcontractors + equipment

  const grossProfit = totalRevenue - totalCogs
  const grossMargin = totalRevenue > 0 ? grossProfit / totalRevenue : 0

  // OpEx
  const overhead = sumBillsByCategory(from, to, ['overhead'])
  const utilities = sumBillsByCategory(from, to, ['utilities'])
  const insurance = sumBillsByCategory(from, to, ['insurance'])
  const otherBills = sumBillsByCategory(from, to, ['other'])
  const manualOpex = sumManualByCategory(from, to, ['operating_expense'])
  const otherOpex = otherBills + manualOpex
  const totalOpex = overhead + utilities + insurance + otherOpex

  const ebitda = grossProfit - totalOpex
  const ebitdaMargin = totalRevenue > 0 ? ebitda / totalRevenue : 0

  const depreciation = sumManualByCategory(from, to, ['depreciation'])
  const amortization = sumManualByCategory(from, to, ['amortization'])
  const interest = sumManualByCategory(from, to, ['interest'])
  const tax = sumManualByCategory(from, to, ['tax'])

  const ebit = ebitda - depreciation - amortization
  const ebt = ebit - interest
  const netIncome = ebt - tax

  return {
    period: { from, to, label },
    revenue: { fenceInstallation, otherRevenue, total: totalRevenue },
    cogs: { materials, directLabor, subcontractors, equipment, total: totalCogs },
    grossProfit,
    grossMargin,
    opex: { overhead, utilities, insurance, other: otherOpex, total: totalOpex },
    ebitda,
    ebitdaMargin,
    depreciation,
    amortization,
    interest,
    tax,
    ebit,
    ebt,
    netIncome,
  }
}

/** Calculate P&L for each of the trailing N months. */
export function calculateMonthlyPl(endYear: number, endMonth: number, monthsBack: number): PlStatement[] {
  const out: PlStatement[] = []
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  for (let i = monthsBack - 1; i >= 0; i--) {
    // Compute target year/month by walking back from (endYear, endMonth 1-12)
    let y = endYear, m = endMonth - i
    while (m <= 0) { m += 12; y-- }
    const from = new Date(y, m - 1, 1, 0, 0, 0)
    const to = new Date(y, m, 0, 23, 59, 59)
    out.push(calculatePl(from, to, `${MONTHS[m - 1]} ${y}`))
  }
  return out
}

// ── Period helpers ──

export interface PeriodRange {
  from: Date
  to: Date
  label: string
}

export function periodMTD(): PeriodRange {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  const to = now
  return { from, to, label: `Month-to-Date (${now.toLocaleString('default', { month: 'short', year: 'numeric' })})` }
}

export function periodQTD(): PeriodRange {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3)
  const from = new Date(now.getFullYear(), q * 3, 1)
  return { from, to: now, label: `Q${q + 1} ${now.getFullYear()} QTD` }
}

export function periodYTD(): PeriodRange {
  const now = new Date()
  return { from: new Date(now.getFullYear(), 0, 1), to: now, label: `YTD ${now.getFullYear()}` }
}

export function periodLast12(): PeriodRange {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - 11, 1)
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  return { from, to, label: 'Last 12 Months' }
}

export function periodCustom(fromStr: string, toStr: string): PeriodRange {
  const from = new Date(fromStr + 'T00:00:00')
  const to = new Date(toStr + 'T23:59:59')
  return { from, to, label: `${fromStr} to ${toStr}` }
}
