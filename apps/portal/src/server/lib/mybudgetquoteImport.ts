/**
 * The MyBudgetQuote import (Jonathan's file of the old online quote tool's
 * requests, Oct 23, 2026). scripts/mybudgetquote-import.ts runs it; this file
 * decides everything, so the plan the script prints is exactly what --apply
 * writes. Jonathan's rules:
 *
 *  1. Plan first (writes nothing). Apply writes in ONE transaction, under one
 *     ImportBatch (lib/customerImport.ts), so Undo import takes it all back.
 *  2. A row goes to a customer on file ONLY on the same phone (last 10
 *     digits) or the same email (any capitals), never on a name. Nothing on
 *     that customer is overwritten: the import adds its pinned history note,
 *     its row (old tool ids) and its tag. A row matching two different
 *     customers on file is not imported: listed, nothing guessed.
 *     A customer on file with an open pipeline card (a column not marked
 *     finished in Settings > Pipeline Stages), a sold quote or any job (sold
 *     or paid) gets no new card. Nor one with a card already in the column
 *     the row would go to (two cards in one column is a duplicate).
 *  3. A new row makes a customer. A card only where make_card = yes:
 *     every First Contact row, and every No Answer row whose old tool status
 *     is not Dropoff. In the column of pipeline_stage, dated latest_date,
 *     with order_in_stage kept (1 on top, newest). Older dropoffs (No Answer
 *     + Dropoff) become customers only, tagged "MyBudgetQuote dropoff".
 *  4. Nothing is sent and nothing starts: the import writes straight to the
 *     database, never through the routes that record automation events
 *     (lib/automations/hooks.ts), start follow up steps (lib/followUps.ts
 *     onCardMoves), look for possible matches (lib/intake.ts), post
 *     notifications, sync the calendar or invite to the portal. Its cards
 *     carry importBatchId/importStage, so time automations and the "first
 *     follow up" button leave them alone while they stay in that column
 *     (lib/importCards.ts). No texting consent is set (it stays "unknown").
 *  5. Per row: a pinned "MyBudgetQuote history" note with every field, the
 *     same fields in CustomerImportRow.data (estimates in cents), and the tag
 *     "MyBudgetQuote import" (built in and hidden, like Imported).
 *  6. Lead source by LEAD_SOURCE_MAP; anything not mapped stays as its own
 *     source (Settings > Lead Sources lists it to Add or Merge). source_other
 *     stays in the note and the data, never the lead source.
 *  7. Flags show in the note and on the customer page. A row flagged "old
 *     tool status Sold" that matches nobody on file: customer made, NO card,
 *     listed.
 *  8. New customers in the file with the same email and the same street
 *     (Anthony Gonzalez and "Ant G", 1 Walnut Drive) are both made and get a
 *     possible match (lib/customerMerge.ts), newer one pointing at the older.
 */

import crypto from 'crypto'
import { loadPipelineStages } from './pipelineStages.js'
import { loadOptionList } from './optionLists.js'
import { optionFor } from './optionListModel.js'
import { lockDoc, writeDoc } from './deletion.js'
import { roleStageId } from './pipelineStageModel.js'
import { addTagTx, emptyRecords, lockImport, type BatchRecords } from './customerImport.js'

type Db = any

export const SOURCE = 'mybudgetquote'
export const TAG_IMPORT = 'MyBudgetQuote import'
export const TAG_DROPOFF = 'MyBudgetQuote dropoff'
export const NOTE_AUTHOR = 'MyBudgetQuote import'
export const NOTE_TITLE = 'MyBudgetQuote history'

/** MyBudgetQuote's lead source -> the lead source EZ Biz customers already use (Settings > Lead Sources ids). Not listed: kept as its own. */
export const LEAD_SOURCE_MAP: Record<string, string> = {
  'Search Engine (Google, Bing)': 'website/google',
  'Facebook': 'Facebook',
  'Friend or Family': 'Referral',
  'Other': 'Other',
}

export const COLUMNS = ['pipeline_stage', 'order_in_stage', 'latest_date', 'first_name', 'last_name', 'phone', 'email', 'address', 'city', 'state', 'zip', 'latitude', 'longitude', 'first_request_date', 'request_count', 'low_estimate', 'high_estimate', 'estimate_date', 'old_tool_status', 'furthest_step', 'finished_quote', 'lead_source', 'source_other', 'best_time_to_contact', 'customer_notes', 'has_attachments', 'old_tool_ids', 'flags'] as const

// ── Reading the file ─────────────────────────────────────────────────────────

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') quoted = false; else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (ch !== '\r') cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const head = (rows.shift() ?? []).map(h => h.trim())
  return rows.filter(r => r.some(c => c.trim())).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])))
}

export interface MbqRow {
  line: number
  key: string
  stage: string
  order: number
  latest: string
  first: string; last: string; phone: string; email: string
  address: string; city: string; state: string; zip: string
  latitude: string; longitude: string
  firstRequest: string; requestCount: number
  lowCents: number | null; highCents: number | null; estimateDate: string
  status: string; furthestStep: string; finishedQuote: string
  leadSource: string; sourceOther: string; bestTime: string; customerNotes: string; hasAttachments: string
  oldToolIds: string[]
  flags: string[]
  raw: Record<string, string>
}

/** Whole dollars in the file ("9493") -> cents. */
const cents = (s: string): number | null => { const t = s.replace(/[$,\s]/g, ''); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? Math.round(n * 100) : null }

export function readRows(text: string): MbqRow[] {
  const recs = parseCsv(text)
  if (recs.length) {
    const missing = COLUMNS.filter(c => !(c in recs[0]))
    if (missing.length) throw new Error(`The file is missing columns: ${missing.join(', ')}`)
  }
  return recs.map((r, i) => ({
    line: i + 2,
    key: r.old_tool_ids.split(';').map(x => x.trim()).filter(Boolean).join(';'),
    stage: r.pipeline_stage, order: Number(r.order_in_stage) || 0, latest: r.latest_date,
    first: r.first_name, last: r.last_name, phone: r.phone, email: r.email.trim().toLowerCase(),
    address: r.address, city: r.city, state: r.state, zip: r.zip, latitude: r.latitude, longitude: r.longitude,
    firstRequest: r.first_request_date, requestCount: Number(r.request_count) || 0,
    lowCents: cents(r.low_estimate), highCents: cents(r.high_estimate), estimateDate: r.estimate_date,
    status: r.old_tool_status, furthestStep: r.furthest_step, finishedQuote: r.finished_quote,
    leadSource: r.lead_source, sourceOther: r.source_other, bestTime: r.best_time_to_contact,
    customerNotes: r.customer_notes, hasAttachments: r.has_attachments,
    oldToolIds: r.old_tool_ids.split(';').map(x => x.trim()).filter(Boolean),
    flags: r.flags.split(';').map(x => x.trim()).filter(Boolean),
    raw: r,
  }))
}

// ── Small rules ──────────────────────────────────────────────────────────────

export const digits10 = (s: string | null | undefined) => { const d = String(s || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
export const fmtPhone = (s: string) => { const d = digits10(s); return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : s.trim() }
export const money = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })
const street = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Jonathan's rule (confirmed Oct 23): every row in the first column (the stage with the "first" role, First Contact), and every other row not a Dropoff. */
export const makeCardRule = (r: Pick<MbqRow, 'stage' | 'status'>, firstStage: string) => r.stage === firstStage || r.status !== 'Dropoff'
export const isSold = (r: Pick<MbqRow, 'flags' | 'status'>) => r.status === 'Sold' || r.flags.some(f => /old tool status sold/i.test(f))

export function fullAddress(r: Pick<MbqRow, 'address' | 'city' | 'state' | 'zip'>): string {
  const tail = [r.city, [r.state, r.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [r.address, tail].filter(Boolean).join(', ')
}

/** "2026-10-19 10:30" on a Florida clock -> the moment (UTC). */
export function floridaToUtc(local: string): Date {
  const [d, t] = local.trim().split(/[ T]/)
  const guess = new Date(`${d}T${(t || '12:00').slice(0, 5)}:00Z`)
  const shown = new Date(guess.toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' UTC')
  return new Date(guess.getTime() + (guess.getTime() - shown.getTime()))
}

/** The lead source a row gets, by the company's own list. */
export function mapLeadSource(word: string, known: Set<string>): { to: string; mapped: boolean } {
  const t = LEAD_SOURCE_MAP[word]
  if (t && known.has(t)) return { to: t, mapped: true }
  return { to: word, mapped: false }
}

export function estimateLine(r: MbqRow): string {
  if (r.lowCents == null && r.highCents == null) return 'Old online estimate: none (the quote was not finished)'
  const range = r.lowCents != null && r.highCents != null && r.lowCents !== r.highCents ? `${money(r.lowCents)} to ${money(r.highCents)}` : money((r.lowCents ?? r.highCents)!)
  return `Old online estimate ${range}${r.estimateDate ? ` (${r.estimateDate})` : ''}`
}

// ── The plan ─────────────────────────────────────────────────────────────────

export interface OnFile { id: string; firstName: string; lastName: string; phone: string | null; email: string | null; serviceAddress: string | null; archivedAt: Date | null; tags: unknown }

export interface Decision {
  row: MbqRow
  kind: 'new' | 'matched' | 'skip'
  skipWhy?: string
  contactId?: string
  onFile?: OnFile
  matchedBy?: string
  /** For a row matching two or more on file */
  candidates?: Array<{ c: OnFile; by: string }>
  /** why: the sentence in the note; key: the short reason the counts group by */
  card: { make: boolean; stage: string; why: string; key: string; id?: string }
  leadSource: string
  tags: string[]
  noteId?: string
  importRowId?: string
  noteBody?: string
}

export interface MbqPlan {
  accountId: string
  batchId: string
  file: string
  /** The stage with the "first" role (Settings > Pipeline Stages) */
  firstStage: string
  rows: MbqRow[]
  decisions: Decision[]
  sourceMap: Array<{ from: string; to: string; mapped: boolean; rows: number }>
  sourceOther: Array<{ text: string; rows: number }>
  pairs: Array<{ contact: Decision; match: Decision; reason: string; id: string }>
  sameEmailOther: Array<{ email: string; rows: Decision[] }>
  cards: any[]
  counts: {
    rows: number; newCustomers: number; matchedRows: number; matchedCustomers: number
    cardsByStage: Record<string, number>; newWithoutCard: number; newWithoutCardWhy: Record<string, number>
    matchedWithoutCardWhy: Record<string, number>; skipped: Record<string, number>; flags: Record<string, number>
    possibleMatches: number
  }
}

const nameOf = (x: { firstName?: string | null; lastName?: string | null }) => `${x.firstName ?? ''} ${x.lastName ?? ''}`.trim()

export function noteBody(d: Decision): string {
  const r = d.row
  const lines = [
    `${NOTE_TITLE} (the old online quote tool)`,
    estimateLine(r),
    `Status in the old tool: ${r.status || 'none'}. Furthest step: ${r.furthestStep || 'none'}. Finished the quote: ${r.finishedQuote || 'unknown'}.`,
    `Requests: ${r.requestCount || 1}${r.firstRequest ? `, first ${r.firstRequest}` : ''}${r.latest ? `, latest ${r.latest}` : ''}.`,
    `Lead source there: ${r.leadSource || 'none'}${r.sourceOther ? `. They wrote: "${r.sourceOther}"` : ''}.`,
    r.bestTime ? `Best time to contact: ${r.bestTime}.` : '',
    r.customerNotes ? `Their notes: ${r.customerNotes}` : '',
    `Attachments in the old tool: ${r.hasAttachments || 'no'}${r.hasAttachments === 'yes' ? ' (still in the old tool, not copied)' : ''}.`,
    `Old tool ids: ${r.oldToolIds.join(', ') || 'none'}.`,
    r.flags.length ? `Flags: ${r.flags.join('; ')}.` : '',
  ]
  if (d.kind === 'matched' && d.onFile) {
    lines.push(`As the old tool had them: ${[`${r.first} ${r.last}`.trim(), r.phone ? fmtPhone(r.phone) : '', r.email, fullAddress(r)].filter(Boolean).join(', ')}.`)
    lines.push(`Matched to this customer by ${d.matchedBy}. Nothing on the customer was changed.`)
  }
  lines.push(d.card.make ? `Pipeline card: ${d.card.stage} (dated ${r.latest.slice(0, 10)}).` : `Pipeline card: none, ${d.card.why}.`)
  return lines.filter(Boolean).join('\n')
}

/**
 * Work out everything. Reads only. In --apply this runs again inside the
 * writing transaction (after the import's lock), so it sees exactly what is
 * there at that moment.
 */
export async function planMbq(db: Db, accountId: string, rows: MbqRow[], file: string, newId: () => string = () => crypto.randomUUID()): Promise<MbqPlan> {
  const batchId = newId()
  const { stages } = await loadPipelineStages(accountId, db)
  const stageDef = new Map(stages.map(s => [s.id, s]))
  const firstStage = roleStageId(stages, 'first') ?? ''
  const place = new Map(stages.map((s, i) => [s.id, i]))
  for (const st of new Set(rows.map(r => r.stage))) if (!stageDef.has(st)) throw new Error(`The file's column "${st}" is not a pipeline stage here (Settings > Pipeline Stages).`)
  const leadOptions = (await loadOptionList(accountId, 'leadSources', db)).options
  const known = new Set(Object.values(LEAD_SOURCE_MAP).map(w => optionFor(leadOptions, w)?.id).filter((x): x is string => !!x))

  // Rows already imported (and not undone) are skipped: running twice makes nothing new.
  const done = await db.customerImportRow.findMany({ where: { accountId, source: SOURCE, undoneAt: null }, select: { sourceKey: true } })
  const imported = new Set<string>(done.map((r: any) => r.sourceKey))

  // Customers on file: not deleted, not merged away (archived ones count: the same person).
  const onFile: OnFile[] = await db.crmContact.findMany({
    where: { accountId, deletedAt: null, mergedIntoId: null },
    select: { id: true, firstName: true, lastName: true, phone: true, email: true, serviceAddress: true, archivedAt: true, tags: true },
  })
  const byPhone = new Map<string, OnFile[]>(), byEmail = new Map<string, OnFile[]>()
  const push = (m: Map<string, OnFile[]>, k: string, c: OnFile) => { if (k) m.set(k, [...(m.get(k) ?? []), c]) }
  for (const c of onFile) { push(byPhone, digits10(c.phone), c); push(byEmail, (c.email || '').trim().toLowerCase(), c) }

  // What customers on file already have: board cards, sold quotes, jobs.
  const pipe = await db.pipelineState.findUnique({ where: { accountId }, select: { leads: true } })
  if (!pipe) throw new Error('This company has no pipeline yet. Open the Sales Pipeline once, then run again.')
  const leads = ((pipe.leads as any[]) ?? []).filter(l => l?.id)
  const cardsOf = new Map<string, any[]>()
  for (const l of leads) if (l.customerId) cardsOf.set(l.customerId, [...(cardsOf.get(l.customerId) ?? []), l])
  const sold = new Set<string>((await db.savedQuote.findMany({ where: { accountId, deletedAt: null, status: 'SOLD', crmContactId: { not: null } }, select: { crmContactId: true } })).map((q: any) => q.crmContactId))
  const jobs = new Map<string, any[]>()
  for (const j of await db.savedJob.findMany({ where: { accountId, deletedAt: null, crmContactId: { not: null } }, select: { crmContactId: true, status: true, paymentStatus: true } })) jobs.set(j.crmContactId, [...(jobs.get(j.crmContactId) ?? []), j])

  const decisions: Decision[] = []
  const cardFor = new Map<string, string>()   // customer on file -> the row that took its one new card
  // Board order of the columns, then the file's order inside each.
  const ordered = [...rows].sort((a, b) => (place.get(a.stage) ?? 0) - (place.get(b.stage) ?? 0) || a.order - b.order)
  for (const r of ordered) {
    const base = { row: r, leadSource: '', tags: [] as string[], card: { make: false, stage: r.stage, why: '', key: '' } }
    if (!r.key) { decisions.push({ ...base, kind: 'skip', skipWhy: 'no old tool id (nothing to know it by on a second run)' }); continue }
    if (imported.has(r.key)) { decisions.push({ ...base, kind: 'skip', skipWhy: 'already imported' }); continue }
    const hits = new Map<string, { c: OnFile; by: Set<string> }>()
    for (const c of byPhone.get(digits10(r.phone)) ?? []) hits.set(c.id, { c, by: new Set(['phone']) })
    for (const c of r.email ? byEmail.get(r.email) ?? [] : []) { const h = hits.get(c.id); if (h) h.by.add('email'); else hits.set(c.id, { c, by: new Set(['email']) }) }
    const how = (s: Set<string>) => (s.size > 1 ? 'phone and email' : [...s][0])
    if (hits.size > 1) {
      decisions.push({ ...base, kind: 'skip', skipWhy: 'matches two or more customers on file (not guessed)', candidates: [...hits.values()].map(h => ({ c: h.c, by: how(h.by) })) })
      continue
    }
    const src = mapLeadSource(r.leadSource, known).to
    if (hits.size === 1) {
      const { c, by } = [...hits.values()][0]
      const d: Decision = { ...base, kind: 'matched', contactId: c.id, onFile: c, matchedBy: how(by), leadSource: src, tags: [TAG_IMPORT] }
      const open = (cardsOf.get(c.id) ?? []).find(l => !stageDef.get(l.stage)?.finished)
      const same = (cardsOf.get(c.id) ?? []).find(l => l.stage === r.stage)
      const js = jobs.get(c.id) ?? []
      const paid = js.find(j => j.paymentStatus === 'paid' || j.status === 'paid')
      const no = (key: string, why: string) => { d.card.key = key; d.card.why = why }
      if (!makeCardRule(r, firstStage)) no('older dropoff (make_card = no)', 'an older dropoff (make_card = no)')
      else if (open) no('already has an open card', `they already have an open card (${open.stage})`)
      else if (paid) no('has a paid job', 'they have a paid job')
      else if (js.length) no('has a sold job', 'they have a sold job')
      else if (sold.has(c.id)) no('has a sold quote', 'they have a sold quote')
      else if (same) no(`already has a card in that column`, `they already have a card in ${r.stage}`)
      else if (c.archivedAt) no('customer is archived', 'the customer is archived')
      else if (cardFor.has(c.id)) no('an earlier row in the file makes their card', `this import already makes their card (row with old tool ids ${cardFor.get(c.id)})`)
      else { d.card.make = true; d.card.why = 'made'; d.card.key = 'made'; cardFor.set(c.id, r.key) }
      decisions.push(d)
      continue
    }
    const d: Decision = { ...base, kind: 'new', contactId: newId(), leadSource: src, tags: [TAG_IMPORT] }
    if (!makeCardRule(r, firstStage)) { d.card.key = 'older dropoff (make_card = no)'; d.card.why = 'an older dropoff (make_card = no), tagged MyBudgetQuote dropoff'; d.tags.push(TAG_DROPOFF) }
    else if (isSold(r)) { d.card.key = 'Sold in the old tool, not matched (listed)'; d.card.why = 'Sold in the old tool and not matched to a customer on file (listed for Jonathan)' }
    else { d.card.make = true; d.card.why = 'made'; d.card.key = 'made' }
    decisions.push(d)
  }

  // Ids, notes and cards (in the file's order inside each column).
  const cards: any[] = []
  for (const d of decisions) {
    if (d.kind === 'skip') continue
    d.noteId = newId(); d.importRowId = newId()
    if (d.card.make) {
      d.card.id = newId()
      const r = d.row, c = d.onFile
      const day = r.latest.slice(0, 10)
      cards.push({
        id: d.card.id, customerId: d.contactId,
        firstName: c ? c.firstName : r.first, lastName: c ? c.lastName : r.last,
        phone: c ? c.phone || '' : r.phone ? fmtPhone(r.phone) : '', email: c ? c.email || '' : r.email,
        address: c ? c.serviceAddress || '' : fullAddress(r),
        leadSource: d.leadSource, leadTemp: 0, fenceType: '', sections: 0, quotePrice: 0, crew: '', scheduledDate: '',
        jobValue: 0, paymentStatus: '', balanceDue: 0, assignedRep: '',
        notes: `MyBudgetQuote: ${r.status || 'request'}. ${estimateLine(r)}.`,
        stage: r.stage, createdAt: day, lastMoved: day,
        importedFrom: 'MyBudgetQuote', importBatchId: batchId, importStage: r.stage,
      })
    }
    d.noteBody = noteBody(d)
  }

  // Same email and same street, both new: one person most likely (Anthony Gonzalez / Ant G).
  const fresh = decisions.filter(d => d.kind === 'new')
  const groups = new Map<string, Decision[]>()
  for (const d of fresh) if (d.row.email && d.row.address) { const k = `${d.row.email}|${street(d.row.address)}`; groups.set(k, [...(groups.get(k) ?? []), d]) }
  const pairs: MbqPlan['pairs'] = []
  for (const g of groups.values()) {
    if (g.length < 2) continue
    const [newest, ...older] = [...g].sort((a, b) => b.row.latest.localeCompare(a.row.latest))
    for (const o of older) pairs.push({ contact: newest, match: o, reason: digits10(newest.row.phone) && digits10(newest.row.phone) === digits10(o.row.phone) ? 'email and phone' : 'email', id: newId() })
  }
  const paired = new Set(pairs.flatMap(p => [p.contact, p.match]))
  const byEmailNew = new Map<string, Decision[]>()
  for (const d of fresh) if (d.row.email) byEmailNew.set(d.row.email, [...(byEmailNew.get(d.row.email) ?? []), d])
  const sameEmailOther = [...byEmailNew].filter(([, ds]) => ds.length > 1 && ds.some(d => !paired.has(d))).map(([email, ds]) => ({ email, rows: ds }))

  // Counts.
  const inc = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1 }
  const cardsByStage: Record<string, number> = {}, newWithoutCardWhy: Record<string, number> = {}, matchedWithoutCardWhy: Record<string, number> = {}, skipped: Record<string, number> = {}, flags: Record<string, number> = {}
  for (const d of decisions) {
    for (const f of d.row.flags) inc(flags, f.replace(/^\d+ different/, 'N different'))
    if (d.kind === 'skip') { inc(skipped, d.skipWhy!); continue }
    if (d.card.make) inc(cardsByStage, d.card.stage)
    else inc(d.kind === 'new' ? newWithoutCardWhy : matchedWithoutCardWhy, d.card.key)
  }
  const srcCount = new Map<string, number>(), otherCount = new Map<string, number>()
  for (const r of rows) { srcCount.set(r.leadSource, (srcCount.get(r.leadSource) ?? 0) + 1); if (r.sourceOther) otherCount.set(r.sourceOther, (otherCount.get(r.sourceOther) ?? 0) + 1) }
  const matched = decisions.filter(d => d.kind === 'matched')
  return {
    accountId, batchId, file, firstStage, rows, decisions, cards, pairs, sameEmailOther,
    sourceMap: [...srcCount].sort((a, b) => b[1] - a[1]).map(([from, n]) => ({ from, ...mapLeadSource(from, known), rows: n })),
    sourceOther: [...otherCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([text, n]) => ({ text, rows: n })),
    counts: {
      rows: rows.length, newCustomers: fresh.length, matchedRows: matched.length, matchedCustomers: new Set(matched.map(d => d.contactId)).size,
      cardsByStage, newWithoutCard: fresh.filter(d => !d.card.make).length, newWithoutCardWhy, matchedWithoutCardWhy, skipped, flags,
      possibleMatches: pairs.length,
    },
  }
}

// ── Writing ──────────────────────────────────────────────────────────────────

export interface ApplyResult { batchId: string | null; plan: MbqPlan; wrote: { contacts: number; notes: number; cards: number; tagged: number; possibleMatches: number; rows: number } }

/**
 * Write the plan in one transaction, under one ImportBatch. Plans again
 * inside it (after the import's lock), so a second run, or one racing this,
 * makes nothing new. Nothing is written when there is nothing to do.
 */
export async function applyMbq(prisma: Db, accountId: string, rows: MbqRow[], file: string, who: string, newId?: () => string): Promise<ApplyResult> {
  return prisma.$transaction(async (tx: Db) => {
    await lockImport(tx, accountId, SOURCE)
    const plan = await planMbq(tx, accountId, rows, file, newId)
    const todo = plan.decisions.filter(d => d.kind !== 'skip')
    const wrote = { contacts: 0, notes: 0, cards: 0, tagged: 0, possibleMatches: 0, rows: 0 }
    if (!todo.length) return { batchId: null, plan, wrote }
    const at = new Date()
    const rec: BatchRecords = emptyRecords()
    const chunk = async <T>(items: T[], write: (c: T[]) => Promise<unknown>) => { for (let i = 0; i < items.length; i += 500) await write(items.slice(i, i + 500)) }

    // Customers it makes.
    const fresh = todo.filter(d => d.kind === 'new')
    const firstStage = (d: Decision) => (d.card.make ? d.card.stage : null)
    await chunk(fresh, c => tx.crmContact.createMany({ data: c.map(d => {
      const r = d.row
      return {
        id: d.contactId, accountId, firstName: r.first || 'Unknown', lastName: r.last,
        email: r.email || null, phone: r.phone ? fmtPhone(r.phone) : null,
        serviceAddress: fullAddress(r) || null, city: r.city || null, state: r.state || null, zip: r.zip || null,
        leadSource: d.leadSource || null, tags: d.tags, jobStatus: firstStage(d),
        createdAt: floridaToUtc(`${r.firstRequest || r.latest.slice(0, 10)} 12:00`),
      }
    }) }))
    rec.contacts = fresh.map(d => d.contactId!)
    wrote.contacts = fresh.length

    // Its tag on customers on file (once each), nothing else on them.
    const tagged = new Set<string>()
    for (const d of todo.filter(x => x.kind === 'matched')) {
      if (tagged.has(d.contactId!)) continue
      tagged.add(d.contactId!)
      const t = await addTagTx(tx, accountId, d.contactId!, TAG_IMPORT, at)
      if (t) rec.tagged.push(t)
    }
    wrote.tagged = rec.tagged.length

    // One pinned history note per row.
    await chunk(todo, c => tx.crmContactNote.createMany({ data: c.map(d => ({
      id: d.noteId, crmContactId: d.contactId, accountId, body: d.noteBody, isPinned: true, createdBy: NOTE_AUTHOR,
      createdAt: d.row.latest ? floridaToUtc(d.row.latest) : at,
    })) }))
    rec.notes = fresh.map(d => d.noteId!)
    rec.notesOnFile = todo.filter(d => d.kind === 'matched').map(d => d.noteId!)
    wrote.notes = todo.length

    // The rows themselves: every field, money in cents; the key for a second run.
    await chunk(todo, c => tx.customerImportRow.createMany({ data: c.map(d => ({
      id: d.importRowId, accountId, batchId: plan.batchId, crmContactId: d.contactId, source: SOURCE, sourceKey: d.row.key,
      matched: d.kind === 'matched', matchedBy: d.matchedBy ?? null, cardId: d.card.id ?? null, createdAt: at,
      data: {
        ...d.row.raw,
        lowEstimateCents: d.row.lowCents, highEstimateCents: d.row.highCents,
        flagList: d.row.flags, oldToolIdList: d.row.oldToolIds,
        makeCard: makeCardRule(d.row, plan.firstStage), card: d.card.make ? d.card.stage : null, cardWhy: d.card.why,
        leadSourceMapped: d.leadSource,
      },
    })) }))
    wrote.rows = todo.length

    // Possible matches between the new ones (newer points at the older).
    if (plan.pairs.length) {
      await tx.customerPossibleMatch.createMany({ data: plan.pairs.map(p => ({ id: p.id, accountId, contactId: p.contact.contactId, matchId: p.match.contactId, reason: p.reason, createdAt: at })) })
      rec.possibleMatches = plan.pairs.map(p => p.id)
      wrote.possibleMatches = plan.pairs.length
    }

    // Cards: after the board's cards, in the file's order (ties on a date keep it).
    if (plan.cards.length) {
      const pipe = await lockDoc(tx, 'pipeline', accountId)
      await writeDoc(tx, 'pipeline', accountId, { leads: [...((pipe?.leads as any[]) ?? []), ...plan.cards] })
      rec.cards = plan.cards.map(c => c.id)
      wrote.cards = plan.cards.length
    }

    await tx.importBatch.create({ data: {
      id: plan.batchId, accountId, source: SOURCE, createdAt: at, createdBy: who, fileName: file,
      label: `MyBudgetQuote import, ${todo.length.toLocaleString('en-US')} rows (${fresh.length.toLocaleString('en-US')} new customers)`,
      counts: JSON.parse(JSON.stringify({ ...plan.counts, wrote })), records: JSON.parse(JSON.stringify(rec)),
    } })
    return { batchId: plan.batchId, plan, wrote }
  }, { timeout: 600_000, maxWait: 60_000 })
}
