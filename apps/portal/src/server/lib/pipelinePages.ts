/**
 * The sales pipeline a page at a time, read only.
 *
 * The board is still one record (PipelineState: every card in one list,
 * saved by versioned "what changed" sends, see routes/pipeline.ts). These
 * functions read that record and answer with what a screen needs without
 * sending every card:
 *
 *   boardPages   each column: how many cards, their total value, the first
 *                `per` cards in board order (and where the next page starts)
 *   columnPage   one column, from `offset`, `limit` cards
 *   findCard     one card by id, on the board or archived
 *   searchCards  cards whose name, phone or address matches, across all columns
 *
 * Board order is the board's "Manual order": cards nobody has placed by hand
 * first, newest on top, then the placed ones by their place (the same rule as
 * apps/web/src/SalesPipelineBoard.tsx byManualOrder). Column totals use the
 * same card values the app shows (lib/pipelineValue.ts: the customer's open
 * quote while selling, the sold one from Signed on, the card's own figure
 * otherwise), counted over every card in the column, whatever the search.
 */

import prisma from './prisma.js'
import { boardColumns, type PipelineStageDef } from './pipelineStageModel.js'
import { leadValue, type QuoteForValue, type JobForValue } from './pipelineValue.js'
import { loadPipelineStages } from './pipelineStages.js'

export interface Card {
  id: string
  stage: string
  customerId?: string
  firstName?: string
  lastName?: string
  phone?: string
  address?: string
  createdAt?: string
  boardOrder?: { stage: string; rank: number } | null
  quotePrice?: number
  jobValue?: number
  [k: string]: unknown
}

export interface ColumnPage {
  stage: string
  name: string
  color: string
  /** Cards in the column (all of them). */
  count: number
  /** Cards in the column that match the search (= count without one). */
  matching: number
  /** Value of every card in the column, in dollars. */
  total: number
  cards: Card[]
  /** Offset of the next page; null when this was the last. */
  next: number | null
}

const rankOf = (l: Card): number | null => (l.boardOrder && l.boardOrder.stage === l.stage ? l.boardOrder.rank : null)

/** Manual order: cards nobody has placed yet first, newest on top, then the placed ones. */
export function byBoardOrder(a: Card, b: Card): number {
  const ra = rankOf(a), rb = rankOf(b)
  if (ra === null && rb === null) return (b.createdAt || '').localeCompare(a.createdAt || '')
  if (ra === null) return -1
  if (rb === null) return 1
  return ra - rb
}

/** The board's search: name, phone or address (as the app's search box). */
export function matchesSearch(l: Card, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return `${l.firstName ?? ''} ${l.lastName ?? ''}`.toLowerCase().includes(s) ||
    String(l.phone ?? '').includes(s) ||
    String(l.address ?? '').toLowerCase().includes(s)
}

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), lo), hi) : dflt
}

function stageCards(leads: Card[], stage: string, q: string): Card[] {
  return leads.filter(l => l?.stage === stage && matchesSearch(l, q)).sort(byBoardOrder)
}

export function boardPages(leads: Card[], stages: PipelineStageDef[], quotes: QuoteForValue[], jobs: JobForValue[], opts: { per?: unknown; q?: unknown } = {}): ColumnPage[] {
  const per = clampInt(opts.per, 1, 500, 50)
  const q = typeof opts.q === 'string' ? opts.q : ''
  const list = leads.filter(l => l && typeof l.id === 'string')
  const totals = new Map<string, number>(), counts = new Map<string, number>()
  for (const l of list) {
    counts.set(l.stage, (counts.get(l.stage) ?? 0) + 1)
    totals.set(l.stage, (totals.get(l.stage) ?? 0) + leadValue(l as any, quotes, jobs, stages))
  }
  return boardColumns(stages, list.map(l => l.stage)).map(col => {
    const cards = stageCards(list, col.id, q)
    return {
      stage: col.id, name: col.name, color: col.color,
      count: counts.get(col.id) ?? 0, matching: cards.length,
      total: Math.round((totals.get(col.id) ?? 0) * 100) / 100,
      cards: cards.slice(0, per), next: cards.length > per ? per : null,
    }
  })
}

export function columnPage(leads: Card[], stage: string, opts: { offset?: unknown; limit?: unknown; q?: unknown } = {}): { stage: string; matching: number; cards: Card[]; next: number | null } {
  const offset = clampInt(opts.offset, 0, 1_000_000, 0)
  const limit = clampInt(opts.limit, 1, 500, 50)
  const cards = stageCards(leads.filter(l => l && typeof l.id === 'string'), stage, typeof opts.q === 'string' ? opts.q : '')
  const page = cards.slice(offset, offset + limit)
  return { stage, matching: cards.length, cards: page, next: offset + limit < cards.length ? offset + limit : null }
}

export function findCard(leads: Card[], archived: Card[], id: string): { card: Card; archived: boolean } | null {
  const on = leads.find(l => l?.id === id)
  if (on) return { card: on, archived: false }
  const off = archived.find(l => l?.id === id)
  return off ? { card: off, archived: true } : null
}

export function searchCards(leads: Card[], q: unknown, limit: unknown = 50): { matching: number; cards: Card[] } {
  const s = typeof q === 'string' ? q.trim() : ''
  if (!s) return { matching: 0, cards: [] }
  const hits = leads.filter(l => l && typeof l.id === 'string' && matchesSearch(l, s)).sort(byBoardOrder)
  return { matching: hits.length, cards: hits.slice(0, clampInt(limit, 1, 500, 50)) }
}

/** What the paged answers read: the board record, the stage list, and the quotes and jobs the values come from. */
export async function loadBoard(accountId: string) {
  const [state, { stages }] = await Promise.all([
    prisma.pipelineState.findUnique({ where: { accountId } }),
    loadPipelineStages(accountId),
  ])
  return {
    version: state?.version ?? 0,
    leads: ((state?.leads as unknown as Card[]) ?? []),
    archived: ((state as any)?.archivedLeads as Card[] | undefined) ?? [],
    stages,
  }
}

/** Active quotes and jobs (not archived, not deleted), in the shape the card values read. */
export async function loadValueInputs(accountId: string): Promise<{ quotes: QuoteForValue[]; jobs: JobForValue[] }> {
  const [quotes, jobs] = await Promise.all([
    prisma.savedQuote.findMany({ where: { accountId, archivedAt: null, deletedAt: null }, select: { id: true, crmContactId: true, status: true, date: true, finalPrice: true } }),
    prisma.savedJob.findMany({ where: { accountId, archivedAt: null, deletedAt: null }, select: { quoteId: true, completedDate: true, changeOrderTotal: true } }),
  ])
  return {
    quotes: quotes.map(q => ({ id: q.id, customerId: q.crmContactId ?? undefined, status: String(q.status), date: q.date || '', finalPrice: q.finalPrice ?? 0 })),
    jobs: jobs.map(j => ({ quoteId: j.quoteId ?? '', completedDate: j.completedDate ?? null, changeOrderTotal: j.changeOrderTotal ?? 0 })),
  }
}
