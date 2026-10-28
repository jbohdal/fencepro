/**
 * Stage moves and materials changes in the job's history (the job window's
 * Job history, lib/changeOrderHistory.ts jobTimeline), read from the audit
 * table every job save already writes (CrmAuditLog, entity SavedJob):
 *
 *   "Moved from Awaiting Locates to Permit Pending" · Jane Smith
 *   "Moved from Permit Pending to Ready to Pull automatically" 811 locate is clear to dig. (811 locate saved, Jane Smith)
 *   "Materials: Not ordered yet → Ordered" · Jane Smith
 *
 * Review Oct 28 2026 (audit #47): who moved the job, or changed its
 * materials, showed nowhere on the job's page. A move the job made by itself
 * also leaves an 'ops.auto_move' note (lib/waitingStageMove.ts); the two are
 * one line here, the note giving the reason. Stage names and materials words
 * only, never a price.
 */

import { stageById, type OpsStageDef } from './opsStageModel.js'

type Json = any

export interface HistoryItem { at: string; kind: string; title: string; detail: string; by: string }

/** One CrmAuditLog row of the job (create or update), with its maker's name when known. */
export interface JobAuditRow { createdAt: Date; userEmail: string | null; userName?: string | null; action: string; oldValues: Json; newValues: Json }

/** An 'ops.auto_move' ActivityLog note: "Moved to X by itself: reason." */
export interface AutoMoveNote { createdAt: Date; body: string; to: string | null }

export const MATERIALS_WORDS: Record<string, string> = { not_ordered: 'Not ordered yet', ordered: 'Ordered', received: 'Received', loaded: 'Loaded on the truck' }

/** A system save and its note are the same move when this close together (one transaction, then the audit write). */
const SAME_MOVE_MS = 30_000

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const isSystem = (r: JobAuditRow) => !r.userEmail || r.userEmail === 'system'

/** "Sales Order, jane@x.com" → "Sales Order, Jane Smith" when the address is a user's. */
function namedBy(by: string, nameOf: (email: string) => string | null): string {
  return by.replace(/[^\s,]+@[^\s,]+/g, e => nameOf(e) ?? e)
}

/**
 * The stage move and materials lines, oldest row first in, newest first out.
 * `notesUsed` gets the index of each auto move note folded into a line here
 * (the caller leaves those out). A row that sent no stage (an older partial
 * write) is compared with the stage the rows before it left the job in.
 */
export function moveHistoryItems(stages: OpsStageDef[], rows: JobAuditRow[], notes: AutoMoveNote[] = [], nameOf: (email: string) => string | null = () => null, notesUsed: Set<number> = new Set()): HistoryItem[] {
  const name = (id: string) => stageById(stages, id)?.name ?? id
  const out: HistoryItem[] = []
  let stage = ''
  let materials = ''
  for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const nv = (r.newValues ?? {}) as Json
    const ov = (r.oldValues ?? {}) as Json
    const at = r.createdAt.toISOString()
    const by = isSystem(r) ? '' : (r.userName || r.userEmail || '')
    if (r.action === 'create') {
      if (str(nv.opsStage)) { stage = nv.opsStage; out.push({ at, kind: 'stage', title: `Job made in ${name(stage)}`, detail: '', by }) }
      if (str(nv.materialsStatus)) materials = nv.materialsStatus
      continue
    }
    if (r.action !== 'update') continue
    // One save's lines: the stage line above its materials line once turned newest first.
    const lines: HistoryItem[] = []
    // Why and who, for a save the server made by itself (lib/waitingStageMove.ts, materialsFromOrders.ts, jobTruth.ts).
    const why = str(nv.why)
    const sysBy = str(nv.by) ? namedBy(str(nv.by), nameOf) : ''
    const to = str(nv.opsStage)
    if (to) {
      const from = str(ov.opsStage) || stage
      if (from && from !== to) {
        if (isSystem(r)) {
          const n = notes.findIndex((x, i) => !notesUsed.has(i) && x.to === to && Math.abs(x.createdAt.getTime() - r.createdAt.getTime()) <= SAME_MOVE_MS)
          let reason = why
          if (n >= 0) { notesUsed.add(n); reason = notes[n].body.replace(/^.*? by itself: /, '') || why }
          const detail = [reason && !/[.!?]$/.test(reason) ? `${reason}.` : reason, sysBy ? `(${sysBy})` : ''].filter(Boolean).join(' ')
          lines.push({ at, kind: 'stage', title: `Moved from ${name(from)} to ${name(to)} automatically`, detail, by: '' })
        } else lines.push({ at, kind: 'stage', title: `Moved from ${name(from)} to ${name(to)}`, detail: '', by })
      }
      stage = to
    }
    const mTo = str(nv.materialsStatus)
    if (mTo) {
      const mFrom = str(ov.materialsStatus) || materials
      if (mFrom && mFrom !== mTo) {
        const words = `Materials: ${MATERIALS_WORDS[mFrom] ?? mFrom} → ${MATERIALS_WORDS[mTo] ?? mTo}`
        if (isSystem(r)) lines.push({ at, kind: 'materials', title: `${words} automatically`, detail: sysBy ? `(${sysBy})` : '', by: '' })
        else lines.push({ at, kind: 'materials', title: words, detail: '', by })
      }
      materials = mTo
    }
    out.push(...lines.reverse())
  }
  return out.reverse()
}
