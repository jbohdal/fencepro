/**
 * A repair's or a fence move's work in words, for the server and the web app
 * (web/src/moveRepair.ts re-exports these). No imports: plain data and pure
 * functions, so the server (the walkthrough, the customer's page) and the app
 * say the same thing.
 */

export type RepairItemKey = 'resetPost' | 'replacePost' | 'repairSection' | 'replaceSection' | 'rehangGate' | 'replaceGate' | 'haulDebris'
export const REPAIR_ITEMS: RepairItemKey[] = ['resetPost', 'replacePost', 'repairSection', 'replaceSection', 'rehangGate', 'replaceGate', 'haulDebris']

export const REPAIR_LABEL: Record<RepairItemKey, string> = {
  resetPost: 'Reset a leaning post',
  replacePost: 'Replace a post',
  repairSection: 'Repair a section',
  replaceSection: 'Replace a whole section',
  rehangGate: 'Rehang a gate with new hardware',
  replaceGate: 'Replace a gate',
  haulDebris: 'Haul away debris (per section)',
}

/** The parts of a quote's saved work (SavedQuote.work) these read. */
export interface WorkWordsInput {
  type?: string
  repair?: { items?: Partial<Record<RepairItemKey, number>>; gateKind?: 'walk' | 'double' } | null
  crew?: string[]
  description?: string
}

/**
 * The job page's Scope of Work for a repair or a move: what the crew does, in
 * the quote's own words (SavedWork.crew), instead of a new fence's footage and
 * sections (a repair job showed "0 ft, 0 sections"; Oct 24, 2026 walkthrough).
 * null for a new fence.
 */
export function workScope(work: Pick<WorkWordsInput, 'type' | 'crew' | 'description'> | null | undefined): { title: string; items: string[] } | null {
  if (!work || (work.type !== 'repair' && work.type !== 'move')) return null
  const items = (Array.isArray(work.crew) ? work.crew : []).map(s => String(s).trim()).filter(Boolean)
  return { title: work.type === 'repair' ? 'Repair' : 'Fence move', items: items.length ? items : [String(work.description || '').trim() || 'As described on the quote.'] }
}

/**
 * What a repair or a move is, in a line: the repair items with how many
 * ("Repair: 2 × Replace a post · 1 × Rehang a gate with new hardware"), else
 * the crew's steps. For the quote window and the installer's card, where a
 * repair read "0 ft total, 0 sections" (round 2, Oct 26 2026). null for a new
 * fence.
 */
export function workSummary(work: WorkWordsInput | null | undefined): string | null {
  if (!work || (work.type !== 'repair' && work.type !== 'move')) return null
  if (work.type === 'repair') {
    const items = work.repair?.items ?? {}
    const gate = work.repair?.gateKind === 'double' ? ' (double gate)' : ''
    const parts = REPAIR_ITEMS.filter(k => (items[k] ?? 0) > 0).map(k => `${items[k]} × ${REPAIR_LABEL[k]}${/Gate$/.test(k) ? gate : ''}`)
    if (parts.length) return `Repair: ${parts.join(' · ')}`
  }
  const s = workScope({ type: work.type as 'repair' | 'move', crew: work.crew ?? [], description: work.description ?? '' })
  return s ? `${s.title}: ${s.items.join(' · ')}` : null
}
