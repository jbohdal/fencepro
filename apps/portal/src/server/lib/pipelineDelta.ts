/**
 * Apply "what changed" to the sales pipeline record.
 *
 * The browser sends only the cards that were added, changed or removed (see
 * apps/web/src/pipelineDelta.ts, which holds the matching copy of this
 * function; a test runs the two side by side).
 */

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
