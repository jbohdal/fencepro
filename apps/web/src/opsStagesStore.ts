/**
 * Operations stages: the one list every screen reads (the board's columns and
 * order, the list view, filters, the job page, Advance, the phone views,
 * automations). Kept on the server (/api/ops-stages; the company's
 * AccountKeyValue row 'fencepro_ops_stages', version checked) and changed only
 * from Settings > Operations Stages. The rules for reading it are in
 * opsStageModel.ts, the same file the server uses.
 *
 * Read at sign in, again with the other lists (liveRefresh: when the app comes
 * back on screen and every minute), and right after a save, so a rename shows
 * on everyone's board without a reload.
 */
import { useEffect, useState } from 'react'
import { sendJson } from './syncHttp'
import {
  normalizeStages, START_OPS_STAGES, stageOfJob, stageById, phaseOf, nextStage, pickableStages, boardStages, sideStages,
  fieldsForStage, firstStage, completeStage, reconcileOpsStage, isDonePhase, sortedStages, advanceStageOf,
  type OpsStageDef, type OpsJobLike,
} from './opsStageModel'

export type { OpsStageDef } from './opsStageModel'

const EVT = 'fencepro:ops_stages:updated'
export const OPS_STAGES_UPDATED_EVENT = EVT

let list: OpsStageDef[] = START_OPS_STAGES.map(s => ({ ...s }))
let version = 0
let loaded = false
let initPromise: Promise<void> | null = null

function emit() { try { window.dispatchEvent(new CustomEvent(EVT)) } catch { /* not in a browser */ } }

function take(data: any): boolean {
  if (!data || !Array.isArray(data.stages)) return false
  const next = normalizeStages(data.stages)
  const v = Number(data.version) || 0
  const same = loaded && v === version && JSON.stringify(next) === JSON.stringify(list)
  list = next
  version = v
  loaded = true
  if (!same) emit()
  return true
}

export function initOpsStages(): Promise<void> {
  if (loaded) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    const r = await sendJson('GET', '/api/ops-stages')
    if (r.result.ok) take(r.json?.data)
  })().finally(() => { if (!loaded) initPromise = null })
  return initPromise
}
export const isOpsStagesLoaded = () => loaded

/** Read again (another device changed the list). Quiet when nothing changed. */
export async function refreshOpsStages(): Promise<void> {
  const r = await sendJson('GET', '/api/ops-stages')
  if (r.result.ok) take(r.json?.data)
}

/** The whole list, sorted, hidden stages included. */
export function getOpsStages(): OpsStageDef[] { return list }
export function getOpsStagesVersion(): number { return version }

/** The list, kept current on screen. */
export function useOpsStages(): OpsStageDef[] {
  const [s, setS] = useState<OpsStageDef[]>(list)
  useEffect(() => {
    const h = () => setS(list)
    window.addEventListener(EVT, h)
    h()
    return () => window.removeEventListener(EVT, h)
  }, [])
  return s
}

// Shorthands bound to the current list.
export const stageOf = (job: OpsJobLike) => stageOfJob(list, job)
export const stageInfo = (id: string | null | undefined) => stageById(list, id)
export const stageName = (id: string | null | undefined) => stageById(list, id)?.name ?? (id || '')
export const stageColor = (id: string | null | undefined) => stageById(list, id)?.color ?? '#9ca3af'
export const stagePhase = (id: string) => phaseOf(list, id)
export const nextOpsStage = (id: string) => nextStage(list, id)
/**
 * Advance from here: none from a done stage (Complete, Invoiced, Paid): a finished job is not pushed on by hand (Oct 25 2026: a paid, Complete job offered "Advance to Invoiced").
 * Permit Pending is passed over when the job's permit is not needed or issued (`permitOk`, jobTruthApi.permitOkOf).
 */
/** The stage Advance moves a job to: past Permit Pending when `permitOk`, past Need Drawing for a `repair` (opsStageModel.ts advanceStageOf). */
export const advanceStage = (id: string, permitOk = false, repair = false) => advanceStageOf(list, id, { permitOk, repair })
export const pickable = () => pickableStages(list)
/** Back from a closed stage: to one that is not done (or a hold), or to one before it on the board (the server's movesBack, routes/saved-jobs.ts). */
export function movesBack(from: string, to: string): boolean {
  if (!isDonePhase(phaseOf(list, to))) return true
  const order = sortedStages(list).map(s => s.id)
  return order.indexOf(to) < order.indexOf(from)
}
export const columns = () => boardStages(list)
export const sideLanes = () => sideStages(list)
export const stageFields = (id: string, job: OpsJobLike, today: string) => fieldsForStage(list, id, job, today)
export const getFirstOpsStage = () => firstStage(list)
export const getCompleteOpsStage = () => completeStage(list)
export const reconcileStage = (before: OpsJobLike | null, after: OpsJobLike) => reconcileOpsStage(list, before, after)

export type SaveAnswer =
  | { ok: true }
  | { ok: false; error: string; inUse?: StageUsage; stale?: boolean }

/** Save the whole list (rename, recolor, reorder, add, hide, first and Complete). */
export async function saveOpsStages(next: OpsStageDef[]): Promise<SaveAnswer> {
  const r = await sendJson('PUT', '/api/ops-stages', { stages: next.map((s, i) => ({ ...s, order: i })), baseVersion: version })
  if (r.result.ok) { take(r.json?.data); return { ok: true } }
  // Someone else saved first: their list is now on screen; this change was not saved.
  const stale = r.status === 409 && r.json?.code === 'STALE' && !!r.json?.data
  if (stale) take(r.json.data)
  return { ok: false, error: r.json?.error || 'The stages could not be saved. Check the connection and try again.', inUse: r.json?.inUse, stale }
}

export interface StageUsage {
  stageId: string
  jobs: Array<{ id: string; name: string; archived: boolean }>
  rules: Array<{ id: string; name: string }>
  stageRules: Array<{ id: string; requirements: string[] }>
}

/** The jobs, automations and stage rules that use a stage. */
export async function getStageUsage(id: string): Promise<StageUsage | null> {
  const r = await sendJson('GET', `/api/ops-stages/${encodeURIComponent(id)}/usage`)
  return r.result.ok ? (r.json?.data as StageUsage) : null
}

/** Delete a stage; what uses it moves to `moveTo` first, in the same step. */
export async function deleteOpsStage(id: string, moveTo: string | null): Promise<SaveAnswer & { moved?: { jobs: number; rules: number; stageRules: number } }> {
  const r = await sendJson('POST', `/api/ops-stages/${encodeURIComponent(id)}/delete`, { moveTo, baseVersion: version })
  if (r.result.ok) { take(r.json?.data); return { ok: true, moved: r.json?.moved } }
  const stale = r.status === 409 && r.json?.code === 'STALE' && !!r.json?.data
  if (stale) take(r.json.data)
  return { ok: false, error: r.json?.error || 'The stage could not be deleted.', inUse: r.json?.inUse, stale }
}
