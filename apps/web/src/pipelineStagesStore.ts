/**
 * Sales Pipeline stages: the one list every screen reads (the board's columns,
 * names, colors and order, the card window, the customer page, pickers,
 * follow ups, appointments, pipeline value, automations). Kept on the server
 * (/api/pipeline-stages; the company's AccountKeyValue row
 * 'fencepro_pipeline_stages', version checked) and changed only from Settings >
 * Pipeline Stages. The rules for reading it are in pipelineStageModel.ts, the
 * same file the server uses.
 *
 * Read at sign in, again with the other lists (liveRefresh: when the app comes
 * back on screen and every minute), and right after a save, so a rename shows
 * on everyone's board without a reload.
 */
import { useEffect, useState } from 'react'
import { sendJson } from './syncHttp'
import {
  normalizeStages, START_PIPELINE_STAGES, stageById, stageNameOf, stageColorOf, roleStageId, hasRole, groupOf,
  isSoldStage, isDeadStage, isOpenStage, isFinishedStage, needsFollowUpStage, pickableStages, followUpStagesOf,
  type PipelineStageDef, type PipelineRole, type FollowUpStages,
} from './pipelineStageModel'

export type { PipelineStageDef } from './pipelineStageModel'

const EVT = 'fencepro:pipeline_stages:updated'
export const PIPELINE_STAGES_UPDATED_EVENT = EVT

let list: PipelineStageDef[] = START_PIPELINE_STAGES.map(s => ({ ...s, roles: [...s.roles] }))
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

export function initPipelineStages(): Promise<void> {
  if (loaded) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    const r = await sendJson('GET', '/api/pipeline-stages')
    if (r.result.ok) take(r.json?.data)
  })().finally(() => { if (!loaded) initPromise = null })
  return initPromise
}
export const isPipelineStagesLoaded = () => loaded

/** Read again (another device changed the list). Quiet when nothing changed. */
export async function refreshPipelineStages(): Promise<void> {
  const r = await sendJson('GET', '/api/pipeline-stages')
  if (r.result.ok) take(r.json?.data)
}

/** The whole list, sorted, hidden stages included. */
export function getPipelineStages(): PipelineStageDef[] { return list }
export function getPipelineStagesVersion(): number { return version }

/** The list, kept current on screen. */
export function usePipelineStages(): PipelineStageDef[] {
  const [s, setS] = useState<PipelineStageDef[]>(list)
  useEffect(() => {
    const h = () => setS(list)
    window.addEventListener(EVT, h)
    h()
    return () => window.removeEventListener(EVT, h)
  }, [])
  return s
}

// Shorthands bound to the current list.
export const stageInfo = (id: string | null | undefined) => stageById(list, id)
/** A stage's name (a word not in the list shows as it is). */
export const stageName = (id: string | null | undefined) => stageNameOf(list, id)
export const stageColor = (id: string | null | undefined) => stageColorOf(list, id)
/** The id of the stage that has a role ('' when none, which a valid list never lacks for first, signed and lost). */
export const roleId = (role: PipelineRole) => roleStageId(list, role) ?? ''
export const stageHasRole = (id: string | null | undefined, role: PipelineRole) => hasRole(list, id, role)
export const stageGroup = (id: string | null | undefined) => groupOf(list, id)
export const isSold = (id: string | null | undefined) => isSoldStage(list, id)
export const isDead = (id: string | null | undefined) => isDeadStage(list, id)
export const isOpen = (id: string | null | undefined) => isOpenStage(list, id)
export const isFinished = (id: string | null | undefined) => isFinishedStage(list, id)
export const mustHaveFollowUp = (id: string | null | undefined) => needsFollowUpStage(list, id)
/** The shown stages' ids in board order: what pickers offer. */
export const pickableIds = () => pickableStages(list).map(s => s.id)
export const followUpStages = (): FollowUpStages => followUpStagesOf(list)

export type SaveAnswer =
  | { ok: true }
  | { ok: false; error: string; inUse?: StageUsage; stale?: boolean }

/** Save the whole list. */
export async function savePipelineStages(next: PipelineStageDef[]): Promise<SaveAnswer> {
  const r = await sendJson('PUT', '/api/pipeline-stages', { stages: next, baseVersion: version })
  if (r.result.ok) { take(r.json?.data); return { ok: true } }
  const stale = r.status === 409 && r.json?.code === 'STALE' && !!r.json?.data
  if (stale) take(r.json.data)
  return { ok: false, error: r.json?.error || 'The stages could not be saved. Check the connection and try again.', inUse: r.json?.inUse, stale }
}

export interface StageUsage {
  stageId: string
  cards: Array<{ id: string; name: string; archived: boolean }>
  rules: Array<{ id: string; name: string }>
  stageRules: Array<{ id: string; requirements: string[] }>
  steps: number
  followUps: number
}
export interface Moved { cards: number; rules: number; stageRules: number; steps: number; followUps: number }

/** The cards, automations, stage rules and follow ups that use a stage. */
export async function getStageUsage(id: string): Promise<StageUsage | null> {
  const r = await sendJson('GET', `/api/pipeline-stages/${encodeURIComponent(id)}/usage`)
  return r.result.ok ? (r.json?.data as StageUsage) : null
}

/** Delete a stage; what uses it moves to `moveTo` first, in the same step. */
export async function deletePipelineStage(id: string, moveTo: string | null): Promise<SaveAnswer & { moved?: Moved }> {
  const r = await sendJson('POST', `/api/pipeline-stages/${encodeURIComponent(id)}/delete`, { moveTo, baseVersion: version })
  if (r.result.ok) { take(r.json?.data); return { ok: true, moved: r.json?.moved } }
  const stale = r.status === 409 && r.json?.code === 'STALE' && !!r.json?.data
  if (stale) take(r.json.data)
  return { ok: false, error: r.json?.error || 'The stage could not be deleted.', inUse: r.json?.inUse, stale }
}
