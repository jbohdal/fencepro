/**
 * A customer's pull sheets, for the Pullsheets tab on the customer page
 * (routes/pull-sheets.ts). Read from the customer's own quotes and jobs by the
 * customer's id (crmContactId), never by name:
 *
 *   a quote      its pull sheet as saved (Draft, Sent, Lost), or as signed
 *                (Signed: accepted on the customer's link; Sold: marked Sold
 *                in the app) when it has no job yet;
 *   a job        the pull sheet frozen at signing (the quoted cost saved when
 *                it was signed, lib/jobCosting.ts; else the option the
 *                customer chose; else the signed quote's own), a note when an
 *                approved change order changed the work, and the Final
 *                takeoff beside it once the crew or office sent it;
 *   linked by hand  an entry of the old side list (BusinessState.pullSheets)
 *                whose quote is not one of the above, so nothing disappears.
 *
 * Newest first. Unit costs and totals are in every entry here; the route takes
 * them out for a login that sees prices only (lib/costRedact.ts hidesCosts).
 * Integer cents.
 */

import prisma from './prisma.js'
import { plainStyleName } from './estimates.js'
import { toCents, qty } from './jobCostingMath.js'
import { quotedCostFor, actualFor, linesOf as takeoffLinesOf } from './jobCosting.js'
import { linesOf as coLinesOf } from './changeOrders.js'

export type PullSheetStatus = 'Draft' | 'Sent' | 'Signed' | 'Sold' | 'Lost' | 'Linked by hand'

export interface PullSheetLine {
  item: string
  qty: number
  /** Money only, not a part to pull or order (a job lot piece price, wood's material). */
  moneyOnly?: boolean
  unitCostCents?: number
  totalCostCents?: number
}

export interface TakeoffLineOut {
  item: string
  plannedQty: number
  usedQty: number
  shopReturnQty: number
  vendorReturnQty: number
  extra: boolean
  note: string
  unitCostCents?: number
  totalCostCents?: number
}

export interface PullSheetEntry {
  /** q_<quote id>, j_<job id> or h_<old list id>. */
  id: string
  kind: 'quote' | 'job' | 'hand'
  quoteId: string | null
  jobId: string | null
  style: string
  footageFt: number
  sections: number
  status: PullSheetStatus
  archived: boolean
  /** YYYY-MM-DD: signed for a signed quote or a job, else the quote's date. */
  date: string
  /** Where the lines come from, in words. */
  source: string
  lines: PullSheetLine[]
  totalCostCents?: number
  /** Approved change orders that changed the work after signing. */
  changeNote: string | null
  finalTakeoff: null | {
    status: 'submitted' | 'approved'
    installDate: string
    submittedBy: string | null
    approvedBy: string | null
    lines: TakeoffLineOut[]
    /** Owner and office: the actual material cost (frozen when approved; a preview until then). */
    materialCostCents?: number
    costFrozen?: boolean
  }
  /** The crew's install packet link that is on now (jobs only). */
  packetToken: string | null
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '')
const words = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : 0)
const footageOf = (runs: unknown) => Math.round((Array.isArray(runs) ? runs : []).reduce((s: number, r: any) => s + Math.max(0, num(typeof r === 'object' && r ? r.ft : r)), 0))

/** A saved pull sheet (the quote builder's LineItem[]: dollars) as lines in cents. */
export function linesFromSheet(sheet: unknown): PullSheetLine[] {
  return (Array.isArray(sheet) ? sheet : [])
    .filter((l: any) => l && typeof l.item === 'string' && l.item.trim())
    .map((l: any) => {
      const n = qty(l.qty)
      const unit = toCents(l.unitCost)
      return {
        item: String(l.item), qty: n, ...(l.moneyOnly || l.jobLotPiece ? { moneyOnly: true } : {}),
        unitCostCents: unit, totalCostCents: typeof l.total === 'number' ? toCents(l.total) : Math.round(n * unit),
      }
    })
}

const sumCost = (lines: Array<{ totalCostCents?: number }>) => lines.reduce((s, l) => s + (l.totalCostCents ?? 0), 0)

function statusOfQuote(q: { status: string; acceptedAt: Date | null; soldAt: Date | null }): PullSheetStatus {
  if (q.status === 'SOLD') return q.acceptedAt ? 'Signed' : 'Sold'
  if (q.status === 'SENT') return 'Sent'
  if (q.status === 'LOST') return 'Lost'
  return 'Draft'
}

/** "Change order #2 (approved October 21, 2026): +20 ft, +1 walk gate." for each approved change order on the quote. */
export function changeNoteOf(rows: Array<{ number: number; approvedAt: Date | null; reason: string; scope: unknown; lines: unknown }>): string | null {
  if (!rows.length) return null
  const parts = rows.map(r => {
    const s = (r.scope && typeof r.scope === 'object' ? r.scope : null) as Record<string, unknown> | null
    const bits: string[] = []
    const signed = (n: number, one: string, many = `${one}s`) => `${n > 0 ? '+' : '−'}${Math.abs(n)} ${Math.abs(n) === 1 ? one : many}`
    if (s) {
      if (num(s.footageFt)) bits.push(signed(Math.round(num(s.footageFt)), 'ft', 'ft'))
      if (num(s.sections)) bits.push(signed(num(s.sections), 'section'))
      if (num(s.walkGates)) bits.push(signed(num(s.walkGates), 'walk gate'))
      if (num(s.dblGates)) bits.push(signed(num(s.dblGates), 'double gate'))
      if (s.toStyle && s.toStyle !== s.fromStyle) bits.push(`style changed to ${String(s.toStyle)}`)
    }
    const what = bits.length ? bits.join(', ') : (r.reason || coLinesOf(r).map(l => l.description).filter(Boolean).join(', ') || 'see the change order')
    return `Change order #${r.number}${r.approvedAt ? ` (approved ${words(day(r.approvedAt))})` : ''}: ${what}.`
  })
  return `${parts.join(' ')} This pull sheet is as signed and does not include ${rows.length === 1 ? 'that change' : 'those changes'}.`
}

/**
 * Every pull sheet of the customer `contactId` in company `accountId`, newest first, with costs.
 * Null when the customer is not one of the company's.
 */
export async function customerPullSheets(accountId: string, contactId: string): Promise<PullSheetEntry[] | null> {
  if (!contactId) return null
  const contact = await prisma.crmContact.findFirst({ where: { id: contactId, accountId, deletedAt: null }, select: { id: true } })
  if (!contact) return null
  const quotes = await prisma.savedQuote.findMany({
    where: { accountId, crmContactId: contactId, deletedAt: null },
    select: {
      id: true, fenceStyle: true, runs: true, sections: true, status: true, date: true, createdAt: true, acceptedAt: true, soldAt: true,
      pullSheet: true, proposal: true, chosenOption: true, archivedAt: true,
    },
  })
  const quoteIds = quotes.map(q => q.id)
  const jobs = await prisma.savedJob.findMany({
    where: { accountId, deletedAt: null, OR: [{ crmContactId: contactId }, ...(quoteIds.length ? [{ quoteId: { in: quoteIds } }] : [])] },
    select: { id: true, quoteId: true, fenceStyle: true, totalFeet: true, sections: true, createdAt: true, archivedAt: true },
  })
  const jobIds = jobs.map(j => j.id)
  const [cos, takeoffs, packets, biz] = await Promise.all([
    quoteIds.length ? prisma.changeOrder.findMany({ where: { accountId, quoteId: { in: quoteIds }, status: 'approved', deletedAt: null }, orderBy: { number: 'asc' } }) : [],
    jobIds.length ? prisma.jobTakeoff.findMany({ where: { accountId, jobId: { in: jobIds }, status: { in: ['submitted', 'approved'] } } }) : [],
    jobIds.length ? prisma.installPacket.findMany({ where: { accountId, jobId: { in: jobIds }, disabledAt: null }, select: { jobId: true, token: true } }) : [],
    prisma.businessState.findUnique({ where: { accountId }, select: { pullSheets: true } }),
  ])
  const styleNames = new Map<string, string>()
  const plain = async (code: string) => {
    if (!styleNames.has(code)) styleNames.set(code, await plainStyleName(code))
    return styleNames.get(code)!
  }
  const quoteById = new Map(quotes.map(q => [q.id, q]))
  const jobByQuote = new Map(jobs.filter(j => j.quoteId).map(j => [j.quoteId!, j]))
  const out: PullSheetEntry[] = []

  // ── Quotes with no job ──
  for (const q of quotes) {
    if (jobByQuote.has(q.id)) continue
    const lines = linesFromSheet(q.pullSheet)
    const status = statusOfQuote(q)
    const signed = status === 'Signed' || status === 'Sold'
    out.push({
      id: `q_${q.id}`, kind: 'quote', quoteId: q.id, jobId: null, style: await plain(q.fenceStyle), footageFt: footageOf(q.runs), sections: q.sections,
      status, archived: !!q.archivedAt, date: (signed ? day(q.acceptedAt ?? q.soldAt) : '') || q.date || day(q.createdAt),
      source: signed ? 'As signed' : 'As saved on the quote', lines, totalCostCents: sumCost(lines),
      changeNote: signed ? changeNoteOf(cos.filter(c => c.quoteId === q.id)) : null, finalTakeoff: null, packetToken: null,
    })
  }

  // ── Jobs: the pull sheet frozen at signing, and the Final takeoff ──
  for (const j of jobs) {
    const q = j.quoteId ? quoteById.get(j.quoteId) ?? null : null
    const quoted = j.quoteId ? await quotedCostFor(accountId, j.quoteId) : null
    let lines: PullSheetLine[]
    let source: string
    const sheet = linesFromSheet(q?.pullSheet)
    if (quoted && quoted.lines.length) {
      // The quoted cost's key is the line's place on the quote's pull sheet (q0, q1, ...).
      const sheetLine = (key: string) => sheet[Number(key.replace(/^q/, ''))]
      lines = quoted.lines.map(l => ({ item: l.part, qty: l.qty, ...(sheetLine(l.key)?.moneyOnly ? { moneyOnly: true } : {}), unitCostCents: l.unitCostCents, totalCostCents: l.totalCostCents }))
      source = `Frozen at signing (${words(quoted.signedAt)})`
    } else {
      const p = q?.proposal as any
      const opt = q?.acceptedAt && p && Array.isArray(p.options) && typeof q.chosenOption === 'number' ? p.options[q.chosenOption] : null
      const fromOption = Array.isArray(opt?.snapshot?.pullSheet) ? linesFromSheet(opt.snapshot.pullSheet) : null
      if (fromOption && fromOption.length) { lines = fromOption; source = 'As signed: the option the customer chose' }
      else { lines = sheet; source = q ? 'As signed on the quote' : 'No quote on this job' }
    }
    const t = takeoffs.find(x => x.jobId === j.id) ?? null
    let finalTakeoff: PullSheetEntry['finalTakeoff'] = null
    if (t) {
      const actual = await actualFor(accountId, t, quoted).catch(() => null)
      const costOf = new Map((actual?.lines ?? []).map(l => [l.lineId, l]))
      finalTakeoff = {
        status: t.status as 'submitted' | 'approved', installDate: t.installDate, submittedBy: t.submittedBy, approvedBy: t.approvedBy,
        lines: takeoffLinesOf(t).map(l => {
          const c = costOf.get(l.id)
          return {
            item: l.part, plannedQty: qty(l.plannedQty), usedQty: qty(l.usedQty), shopReturnQty: qty(l.shopReturnQty), vendorReturnQty: qty(l.vendorReturnQty),
            extra: !!l.extra, note: l.note || '', ...(c ? { unitCostCents: c.unitCostCents, totalCostCents: c.totalCostCents } : {}),
          }
        }),
        ...(actual ? { materialCostCents: actual.materialCents, costFrozen: actual.frozen } : {}),
      }
    }
    const status: PullSheetStatus = q ? (q.acceptedAt ? 'Signed' : 'Sold') : 'Sold'
    out.push({
      id: `j_${j.id}`, kind: 'job', quoteId: j.quoteId, jobId: j.id, style: await plain(q?.fenceStyle || j.fenceStyle),
      footageFt: q ? footageOf(q.runs) : j.totalFeet, sections: q?.sections || j.sections,
      status, archived: !!(j.archivedAt || q?.archivedAt), date: (quoted ? quoted.signedAt.slice(0, 10) : '') || day(q?.acceptedAt ?? q?.soldAt) || day(j.createdAt),
      source, lines, totalCostCents: sumCost(lines),
      changeNote: j.quoteId ? changeNoteOf(cos.filter(c => c.quoteId === j.quoteId)) : null,
      finalTakeoff, packetToken: packets.find(p => p.jobId === j.id)?.token ?? null,
    })
  }

  // ── The old side list: entries whose quote is not above ──
  const old = Array.isArray(biz?.pullSheets) ? (biz!.pullSheets as any[]) : []
  for (const h of old) {
    if (!h || h.customerId !== contactId || (h.quoteId && quoteById.has(h.quoteId))) continue
    const lines = linesFromSheet(h.versionSnapshot)
    const name = String(h.quoteName || '').split(' — ')[0]
    out.push({
      id: `h_${String(h.id)}`, kind: 'hand', quoteId: h.quoteId ? String(h.quoteId) : null, jobId: h.jobId ? String(h.jobId) : null,
      style: await plain(name), footageFt: 0, sections: 0, status: 'Linked by hand', archived: false,
      date: String(h.linkedAt || '').slice(0, 10), source: `Linked by hand${h.versionNumber ? `, version ${h.versionNumber}` : ''}`,
      lines, totalCostCents: sumCost(lines), changeNote: null, finalTakeoff: null, packetToken: null,
    })
  }

  return out.sort((a, b) => b.date.localeCompare(a.date))
}

/** The same entries with every cost taken out (a Salesman's or Installer's phone): quantities only, no money only lines. */
export function quantitiesOnly(entries: PullSheetEntry[]): PullSheetEntry[] {
  return entries.map(e => ({
    ...e,
    totalCostCents: undefined,
    lines: e.lines.filter(l => !l.moneyOnly).map(l => ({ item: l.item, qty: l.qty })),
    finalTakeoff: e.finalTakeoff ? {
      status: e.finalTakeoff.status, installDate: e.finalTakeoff.installDate, submittedBy: e.finalTakeoff.submittedBy, approvedBy: e.finalTakeoff.approvedBy,
      lines: e.finalTakeoff.lines.map(l => ({ item: l.item, plannedQty: l.plannedQty, usedQty: l.usedQty, shopReturnQty: l.shopReturnQty, vendorReturnQty: l.vendorReturnQty, extra: l.extra, note: l.note })),
    } : null,
  })).map(e => { delete (e as any).totalCostCents; return e })
}
