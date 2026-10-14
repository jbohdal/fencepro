/**
 * The sales pipeline as "what changed" instead of the whole board.
 *
 * The pipeline is one server record holding every card. Sending all of it to
 * move one card gets heavy once there are thousands of cards, so a save sends
 * only the cards that were added, changed or removed since the server's copy.
 * The version check is unchanged: the server applies a change only to the
 * version it was built on (see versionedDoc).
 *
 * The server applies a change with its own copy of applyPipelineDelta
 * (apps/portal/src/server/lib/pipelineDelta.ts). Keep the two the same; a test
 * runs them side by side.
 */

import { deepEqual } from './merge3'

export interface PipelineDoc { leads: any[]; stages: any[] }

export interface PipelineDelta {
  /** Cards that are new or different. For a new card, `before` is the id of
   *  the card it sits in front of (null: at the end). */
  upsert: Array<{ lead: any; before?: string | null }>
  /** Ids of cards that are gone. */
  remove: string[]
  /** The stage list, only when it changed. */
  stages?: any[]
}

export function applyPipelineDelta(doc: PipelineDoc, delta: PipelineDelta): PipelineDoc {
  const gone = new Set(delta.remove)
  const leads = doc.leads.filter(l => !gone.has(l?.id))
  for (const { lead, before } of delta.upsert) {
    const at = leads.findIndex(l => l?.id === lead.id)
    if (at >= 0) { leads[at] = lead; continue }
    const next = before == null ? -1 : leads.findIndex(l => l?.id === before)
    if (next >= 0) leads.splice(next, 0, lead); else leads.push(lead)
  }
  return { leads, stages: delta.stages ?? doc.stages }
}

/**
 * What turns `base` into `next`, or null when that cannot be said card by
 * card (a card without an id, two cards with one id, or cards only reordered);
 * the caller then saves the whole pipeline as before.
 */
export function diffPipeline(base: PipelineDoc, next: PipelineDoc): PipelineDelta | null {
  const ids = (list: any[]) => {
    const seen = new Set<string>()
    for (const l of list) {
      if (!l || typeof l.id !== 'string' || !l.id || seen.has(l.id)) return null
      seen.add(l.id)
    }
    return seen
  }
  const baseIds = ids(base.leads), nextIds = ids(next.leads)
  if (!baseIds || !nextIds) return null
  const before = new Map<string, any>(base.leads.map(l => [l.id, l]))

  const delta: PipelineDelta = { upsert: [], remove: base.leads.filter(l => !nextIds.has(l.id)).map(l => l.id) }
  // Walking backwards, `following` is the nearest later card the server will
  // already have by the time this one is put in.
  let following: string | null = null
  for (let i = next.leads.length - 1; i >= 0; i--) {
    const lead = next.leads[i]
    if (!before.has(lead.id)) delta.upsert.unshift({ lead, before: following })
    else if (!deepEqual(before.get(lead.id), lead)) delta.upsert.unshift({ lead })
    following = lead.id
  }
  // New cards go in back to front, so each one's `before` is in place first.
  const fresh = delta.upsert.filter(u => 'before' in u).reverse()
  delta.upsert = [...delta.upsert.filter(u => !('before' in u)), ...fresh]
  if (!deepEqual(base.stages, next.stages)) delta.stages = next.stages

  return deepEqual(applyPipelineDelta(base, delta), next) ? delta : null
}
