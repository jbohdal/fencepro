/**
 * What Budget > Job Costing fills in on a new entry (Jonathan, Nov 2 2026; the
 * rule is in docs/DECISIONS.md, "Job costing: real labor cost"). Integer cents.
 *
 * Sub job or crew job: nothing on the job says it outright, so in this order:
 * a subcontractor bill linked to the job; the takeoff says sub (or records "Sub
 * paid $"); the quote was priced with sub labor; the takeoff has crew hours; the
 * quote was priced hourly; last, Settings' labor mode (the same fallback as a
 * new takeoff, for old quotes that saved no labor mode).
 *
 * Labor: on a sub job the takeoff's "Sub paid $", else the sub bills linked to
 * the job, else the quote's labor $. The same payment can be in both, so the two
 * are never added; when they differ the screen says so. Crew job: the quote's
 * labor $.
 *
 * Material: the materials bills linked to the job (and a job lot invoice with no
 * bill), else its Sales Orders that are not cancelled, else the quote estimate.
 * A bill says nothing about which Sales Order it covers (it holds a job, never
 * an order), so the two are never added: bills win, and when they differ the
 * screen says the app cannot tell whether the bills cover the whole order.
 */

import prisma from './prisma.js'
import { toCents, usd, type PrefillAnswer, type JobCostPrefill } from './jobCostingMath.js'
import { laborOf } from './jobCosting.js'

export interface PrefillBill { billNumber: string; category: string; totalCents: number }
export interface PrefillOrder { status: string; totalCostCents: number }

export interface PrefillInput {
  quote: { laborCents: number; materialCents: number; laborMode: string | null }
  settingsLaborMode: string | null
  takeoff: { mode: 'sub' | 'crew'; subPaidCents: number | null; crewHours: number } | null
  /** Bills linked to the job, not void or draft. */
  bills: PrefillBill[]
  /** Job lot invoices linked to the job that have no bill. */
  invoices: Array<{ invoiceNumber: string; totalCents: number }>
  /** Sales Orders of the job, not cancelled. */
  orders: PrefillOrder[]
}

const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0)
const numbers = (rows: PrefillBill[]) => rows.map(b => b.billNumber || 'no number').join(', ')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function kindOf(i: PrefillInput): { sub: boolean; kindWhy: string } {
  if (i.bills.some(b => b.category === 'subcontractor')) return { sub: true, kindWhy: 'a subcontractor bill is linked to this job' }
  if (i.takeoff?.mode === 'sub' || i.takeoff?.subPaidCents != null) return { sub: true, kindWhy: 'the takeoff says subcontractor' }
  if (i.quote.laborMode === 'subcontractor') return { sub: true, kindWhy: 'the quote was priced with sub labor' }
  if (i.takeoff && i.takeoff.crewHours > 0) return { sub: false, kindWhy: 'the takeoff has crew hours' }
  if (i.quote.laborMode === 'hourly') return { sub: false, kindWhy: 'the quote was priced with crew hours' }
  return i.settingsLaborMode === 'subcontractor'
    ? { sub: true, kindWhy: 'this old quote saved no labor type, so Settings decides (subcontractor)' }
    : { sub: false, kindWhy: 'this old quote saved no labor type, so Settings decides (crew hours)' }
}

/** Pure: the prefill from what the job has. */
export function workOutPrefill(i: PrefillInput): PrefillAnswer {
  const { sub, kindWhy } = kindOf(i)

  // Labor.
  const fromQuote = { cents: i.quote.laborCents, source: 'quote' as const, words: "From the quote's labor $", note: '' }
  const laborBills = i.bills.filter(b => b.category === 'subcontractor' || b.category === 'labor')
  const billed = sum(laborBills, b => b.totalCents)
  const paid = i.takeoff?.subPaidCents ?? null
  let labor: PrefillAnswer['labor'] = fromQuote
  if (sub && paid != null) {
    const differ = laborBills.length > 0 && billed !== paid
    labor = { cents: paid, source: 'takeoff', words: 'From "Sub paid $" on the takeoff', note: differ ? `The sub ${laborBills.length === 1 ? 'bill' : 'bills'} on this job add up to ${usd(billed)}, not ${usd(paid)}. Only one is used, so check which is right.` : '' }
  } else if (sub && laborBills.length) {
    labor = { cents: billed, source: 'bills', words: `From ${plural(laborBills.length, 'sub bill')} on this job (${numbers(laborBills)})`, note: '' }
  } else if (!sub && laborBills.length) {
    labor = { ...fromQuote, note: `A labor bill for ${usd(billed)} is linked to this job and is not counted here.` }
  }

  // Material.
  const matBills = i.bills.filter(b => b.category === 'materials')
  const other = i.bills.filter(b => b.category === 'other' || b.category === 'equipment')
  const bought = sum(matBills, b => b.totalCents) + sum(i.invoices, v => v.totalCents)
  const ordered = sum(i.orders, o => o.totalCostCents)
  const docs = matBills.length + i.invoices.length
  const notes: string[] = []
  let material: PrefillAnswer['material']
  if (docs) {
    const names = [...matBills.map(b => b.billNumber || 'no number'), ...i.invoices.map(v => v.invoiceNumber || 'no number')].join(', ')
    if (i.orders.length && ordered !== bought) notes.push(`The Sales Order is ${usd(ordered)}. A bill does not say which order it covers, so the app cannot tell if these bills are all of it. Only the bills are counted, never both.`)
    material = { cents: bought, source: 'bills', words: `From ${plural(docs, 'vendor bill')} on this job (${names})`, note: '' }
  } else if (i.orders.length) {
    const open = i.orders.filter(o => o.status === 'pending').length
    material = {
      cents: ordered, source: 'sales_order',
      words: `From the Sales Order${i.orders.length === 1 ? '' : 's'} on this job${open === i.orders.length ? ' (not marked ordered yet)' : ''}. No vendor bill is linked, so these are the prices on the order, not billed prices.`,
      note: '',
    }
  } else {
    material = { cents: i.quote.materialCents, source: 'quote', words: 'From the quote estimate. No vendor bill or Sales Order on this job.', note: '' }
  }
  if (other.length) notes.push(`${plural(other.length, 'bill')} on this job filed as Other or Equipment ${other.length === 1 ? 'is' : 'are'} not counted (${usd(sum(other, b => b.totalCents))}).`)
  material.note = notes.join(' ')

  return { sub, kindWhy, labor, material }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const cents = (v: unknown) => Math.round(Number(v) || 0)

/** The prefill for a sold quote, with what the form shows beside it. Null: no such quote. */
export async function prefillFor(accountId: string, quoteId: string): Promise<JobCostPrefill | null> {
  const q = await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId, deletedAt: null } })
  if (!q) return null
  const job = await prisma.savedJob.findFirst({ where: { accountId, quoteId, deletedAt: null }, select: { id: true } })
  const [vs, biz, t, changes] = await Promise.all([
    prisma.vendorState.findUnique({ where: { accountId }, select: { bills: true } }),
    prisma.businessState.findUnique({ where: { accountId }, select: { config: true, pendingOrders: true } }),
    job ? prisma.jobTakeoff.findUnique({ where: { jobId: job.id } }) : null,
    prisma.changeOrder.findMany({ where: { accountId, quoteId, status: 'approved', deletedAt: null }, select: { totalCents: true } }),
  ])
  const jobId = job?.id ?? null
  const allBills = (Array.isArray(vs?.bills) ? vs!.bills : []) as any[]
  const onJob = jobId ? allBills.filter(b => b?.jobId === jobId) : []
  const bills = onJob.filter(b => b?.status !== 'void' && b?.status !== 'draft').map(b => ({ billNumber: str(b.billNumber), category: str(b.category), totalCents: cents(b.totalCents) }))
  const invoiceRows = jobId ? await prisma.vendorInvoice.findMany({ where: { accountId, jobId, status: { in: ['applied', 'needs_match'] } }, select: { id: true, billId: true, invoiceNumber: true, totalCents: true } }) : []
  // An invoice's bill is the same money: an invoice counts only when no bill was made for it (a voided bill is not one to bring back).
  const invoices = invoiceRows.filter(v => !allBills.some(b => b?.id === (v.billId || `vi-${v.id}`))).map(v => ({ invoiceNumber: v.invoiceNumber, totalCents: v.totalCents ?? 0 }))
  const orderRows = (Array.isArray(biz?.pendingOrders) ? biz!.pendingOrders : []) as any[]
  const orders = orderRows
    .filter(o => (jobId && o?.jobId === jobId) || (!o?.jobId && o?.quoteId === quoteId))
    .filter(o => o?.status !== 'cancelled')
    .map(o => ({ status: str(o.status), totalCostCents: cents(o.totalCostCents) }))
  const labor = t && t.accountId === accountId ? laborOf(t) : null
  const pricing = (q.pricing && typeof q.pricing === 'object' ? q.pricing : {}) as Record<string, unknown>
  const config = (biz?.config ?? {}) as any
  const answer = workOutPrefill({
    quote: { laborCents: toCents(q.laborCost), materialCents: toCents(q.materialCost), laborMode: typeof pricing.laborMode === 'string' ? pricing.laborMode : null },
    settingsLaborMode: typeof config?.pricing?.laborMode === 'string' ? config.pricing.laborMode : null,
    takeoff: labor ? { mode: labor.mode, subPaidCents: labor.subPaidCents ?? null, crewHours: labor.crew.reduce((s, c) => s + (Number(c.hours) || 0), 0) } : null,
    bills, invoices, orders,
  })
  return {
    quoteId, jobId, ...answer,
    tearOutCents: toCents(q.tearOutCost),
    changeOrders: { count: changes.length, priceCents: changes.reduce((s, c) => s + c.totalCents, 0) },
  }
}
