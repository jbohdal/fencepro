/**
 * Sales pipeline store — in memory copy backed by /api/pipeline.
 *
 * Every change (a new card, a stage move, an edit) becomes "what changed"
 * (pipelineDelta) and goes through the outbox: kept on the phone until the
 * server confirms it, sent in order, and sent again after no signal. Each send
 * says which version of the pipeline it was built on; if another device saved
 * first, the newest copy is taken, this phone's waiting changes are put back
 * on top of it, and the change goes again.
 *
 * A new customer's card is not sent here: it travels with the customer in one
 * save (customerStore), so the two are saved together or not at all.
 *
 * UI prefs like collapsed stages, view mode, sort and analytics-open stay in
 * localStorage in SalesPipelineBoard: per browser preferences, not company data.
 */

import { getAccessToken } from './crmAuth'
import { applyPipelineDelta, diffPipeline, type PipelineDelta } from './pipelineDelta'
import { registerKind, enqueue, pendingFor, allOps, type Op } from './outbox'
import { sendJson } from './syncHttp'
import { notifyStageBlocked, type BlockedMove } from './stageBlocked'

const EVT = 'fencepro:pipeline:updated'

type PipelineDoc = { leads: any[]; stages: any[] }
let cache: PipelineDoc = { leads: [], stages: [] }
/** What the server has, plus every change already handed to the outbox. */
let base: PipelineDoc = { leads: [], stages: [] }
let version = 0
let initPromise: Promise<void> | null = null
let hydrated = false
let timer: ReturnType<typeof setTimeout> | null = null

const clone = (d: PipelineDoc): PipelineDoc => JSON.parse(JSON.stringify(d))
const pick = (d: any): PipelineDoc => ({ leads: Array.isArray(d?.leads) ? d.leads : [], stages: Array.isArray(d?.stages) ? d.stages : [] })
function emit() { try { window.dispatchEvent(new CustomEvent(EVT)) } catch { /* no window */ } }

/** The server's copy with this phone's waiting changes on top. */
function withPending(server: PipelineDoc): PipelineDoc {
  let doc = clone(server)
  for (const op of allOps()) {
    if (op.kind === 'customer.create' && op.payload?.lead && !doc.leads.some(l => l?.id === op.payload.lead.id)) {
      doc = { ...doc, leads: [op.payload.lead, ...doc.leads] }
    }
    if (op.kind === 'pipeline.delta') doc = applyPipelineDelta(doc, op.payload as PipelineDelta)
  }
  return doc
}

export function initPipeline(): Promise<void> {
  if (hydrated) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    if (!getAccessToken()) return
    const r = await sendJson('GET', '/api/pipeline')
    if (!r.result.ok || !r.json?.data) return
    version = typeof r.json.data.version === 'number' ? r.json.data.version : 0
    cache = withPending(pick(r.json.data))
    base = clone(cache)
    hydrated = true
    emit()
  })().finally(() => { if (!hydrated) initPromise = null })
  return initPromise
}

/** True once the pipeline has loaded from the server. */
export function isPipelineHydrated(): boolean { return hydrated }

export function getPipeline(): { leads: any[]; stages: any[] } {
  return cache
}

/** Show a change on screen now and hand it to the outbox. */
export function savePipeline(leads: any[], stages: any[]): void {
  cache = { leads, stages }
  emit()
  if (timer) clearTimeout(timer)
  timer = setTimeout(queueChanges, 120)
}

function describe(d: PipelineDelta): string {
  const name = (l: any) => `${l?.firstName ?? ''} ${l?.lastName ?? ''}`.trim() || 'a card'
  const moved = d.upsert.map(u => {
    const was = base.leads.find(l => l?.id === u.lead.id)
    return was && was.stage !== u.lead.stage ? `${name(u.lead)} moved to ${u.lead.stage}` : was ? `${name(u.lead)} changed` : `${name(u.lead)} added`
  })
  const parts = [...moved, ...(d.remove.length ? [`${d.remove.length} card${d.remove.length === 1 ? '' : 's'} removed`] : []), ...(d.stages ? ['stages changed'] : [])]
  return `Pipeline: ${parts.slice(0, 3).join(', ')}${parts.length > 3 ? ` and ${parts.length - 3} more` : ''}`
}

function queueChanges() {
  timer = null
  if (!hydrated) { timer = setTimeout(queueChanges, 500); return }
  let delta = diffPipeline(base, cache)
  // Only reordered, or cards without ids: say it as every card plus the stage list.
  if (!delta) delta = { upsert: cache.leads.filter(l => l?.id).map(lead => ({ lead })), remove: base.leads.filter(l => l?.id && !cache.leads.some(c => c?.id === l.id)).map(l => l.id), stages: cache.stages }
  if (!delta.upsert.length && !delta.remove.length && !delta.stages) return
  // A card for a customer that is still on its way waits for that customer.
  const waitFor = new Set<string>()
  for (const u of delta.upsert) {
    const cid = u.lead?.customerId
    if (cid && pendingFor(`customer:${cid}`).some(o => o.kind === 'customer.create')) waitFor.add(`customer:${cid}`)
  }
  const label = describe(delta)
  base = clone(cache)
  void enqueue({ key: 'pipeline', kind: 'pipeline.delta', payload: delta, label, after: [...waitFor], coalesce: false })
}

/**
 * A new customer's card, shown now. It is sent with the customer (one save),
 * so it is added here without a change of its own. Returns the card it sits in
 * front of, for the server to put it in the same place.
 */
export function addCardWithCustomer(lead: any): string | null {
  const before = cache.leads[0]?.id ?? null
  cache = { ...cache, leads: [lead, ...cache.leads] }
  base = { ...base, leads: [JSON.parse(JSON.stringify(lead)), ...base.leads] }
  emit()
  return before
}

/** The server saved a new customer's card: its pipeline is now at `v`. */
export function pipelineSavedElsewhere(v: number | null | undefined) {
  if (typeof v !== 'number') return
  // Only this phone's card went in since the version known here: carry on from there.
  if (v === version + 1) version = v
}

registerKind<PipelineDelta>('pipeline.delta', {
  what: () => 'This pipeline change',
  send: async (op: Op<PipelineDelta>) => {
    await initPipeline()
    if (!hydrated) return { ok: false, status: 0, error: 'not loaded' }
    const r = await sendJson('PATCH', '/api/pipeline', { ...op.payload, baseVersion: version })
    if (r.result.ok) {
      if (typeof r.json?.version === 'number') version = r.json.version
      return r.result
    }
    if (r.status === 409 && r.json?.code === 'STAGE_BLOCKED' && r.json?.data) {
      // A stage rule refused the move: the card goes back where the server has it, the rest of this change goes again, and the screen says what is missing.
      const blocked = (r.json.blocked ?? []) as BlockedMove[]
      const server = pick(r.json.data)
      const ids = new Set(blocked.map(b => b.id))
      op.payload.upsert = op.payload.upsert.flatMap(u => {
        if (!ids.has(u.lead?.id)) return [u]
        const was = server.leads.find(l => l?.id === u.lead.id)
        return was ? [{ ...u, lead: { ...u.lead, stage: was.stage, lastMoved: was.lastMoved } }] : []
      })
      version = typeof r.json.version === 'number' ? r.json.version : version
      cache = withPending(server)
      base = clone(cache)
      emit()
      notifyStageBlocked(blocked)
      return { ok: false, status: 409, retryNow: true }
    }
    if (r.status === 409 && r.json?.code === 'STALE_VERSION') {
      // Another device saved first: take theirs, put this phone's waiting changes back on top, go again.
      version = typeof r.json.version === 'number' ? r.json.version : version
      cache = withPending(pick(r.json.data))
      base = clone(cache)
      emit()
      return { ok: false, status: 409, retryNow: true }
    }
    return r.result
  },
  apply: () => { /* put back by withPending when the pipeline loads */ },
})

export const PIPELINE_UPDATED_EVENT = EVT

/** Read the board again (the server moves cards on its own: a customer accepting online). This phone's waiting changes stay on top. */
export async function refreshPipeline(): Promise<void> {
  if (!hydrated || timer) return
  // Only the version is compared first: an unchanged board costs almost nothing to check.
  const r = await sendJson('GET', `/api/pipeline?version=${version}`)
  if (!r.result.ok || r.json?.unchanged || !r.json?.data || timer) return
  if (typeof r.json.data.version === 'number' && r.json.data.version === version) return
  version = typeof r.json.data.version === 'number' ? r.json.data.version : version
  cache = withPending(pick(r.json.data))
  base = clone(cache)
  emit()
}
