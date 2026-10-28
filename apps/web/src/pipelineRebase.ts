/**
 * A pipeline change waiting on this phone, put on top of a newer server board.
 *
 * A change (pipelineDelta) carries whole cards. When the board is read again
 * before it is sent (the server moved a card itself, or another phone saved
 * first and the save came back 409), sending those cards as they are would put
 * back whatever the server changed on them meanwhile: a card the install moved
 * to Pending Start would go back to where this phone last saw it. So each
 * waiting change keeps the cards as they were before it (`was`, on the phone
 * only, never sent), and only the fields this phone changed are put on the
 * server's card (merge3: where both changed the same field, this phone's
 * change is the later action and wins).
 */

import { deepEqual, merge3 } from './merge3'
import type { PipelineDelta, PipelineDoc } from './pipelineDelta'

export type QueuedDelta = PipelineDelta & { was?: Record<string, any> }

/** Each changed card as it was before the change, by id (new cards have none). */
export function cardsBefore(base: PipelineDoc, delta: PipelineDelta): Record<string, any> {
  const was: Record<string, any> = {}
  for (const u of delta.upsert) {
    const before = base.leads.find(l => l?.id === u.lead?.id)
    if (before) was[u.lead.id] = JSON.parse(JSON.stringify(before))
  }
  return was
}

/** Put a waiting change on top of the server's board (in place); `was` becomes the server's cards. */
export function rebaseDelta(p: QueuedDelta, server: PipelineDoc): void {
  if (!p?.was) return
  const byId = new Map(server.leads.filter(l => l?.id).map(l => [l.id, l]))
  for (const u of p.upsert ?? []) {
    const id = u?.lead?.id
    if (!id || !(id in p.was)) continue
    const was = p.was[id], now = byId.get(id)
    if (!was || !now || deepEqual(was, now)) continue
    u.lead = merge3(was, u.lead, now).merged
    p.was[id] = JSON.parse(JSON.stringify(now))
  }
}

/** What is sent: the change without `was`. */
export function wireDelta(p: QueuedDelta): PipelineDelta {
  const out: QueuedDelta = { ...p }
  delete out.was
  return out
}
