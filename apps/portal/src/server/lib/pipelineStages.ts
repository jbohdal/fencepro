/**
 * Sales Pipeline stages on the server: the company's one list (Settings >
 * Pipeline Stages), where it is kept, and the only ways it changes.
 *
 * Kept in AccountKeyValue under 'fencepro_pipeline_stages' (one row per
 * company, versioned like every other setting there). The rules for reading
 * it are in pipelineStageModel.ts, the same file the web app uses. Only
 * /api/pipeline-stages writes it (routes/pipeline-stages.ts); the general
 * /api/kv refuses this key, and the pipeline's own old stage list
 * (PipelineState.stages) and Settings' old plain list (config.pipelineStages)
 * are no longer read.
 *
 *   - Saving the list: every stage keeps its id; a stage can only disappear
 *     when nothing uses it.
 *   - Deleting a stage that cards, automations or a stage rule use: they move
 *     to the stage picked, with its follow up steps and the cards' follow up
 *     dates, and the stage goes, in one transaction. No automation fires and
 *     no follow up date changes: the cards did not move on purpose.
 *   - Once per company (ensurePipelineStageListAll, at start up): the start
 *     list, whose ids are the 13 old names, so no card or record changes.
 */

import prisma from './prisma.js'
import { lockAccountState } from './lockState.js'
import {
  cleanStages, normalizeStages, stagesProblem, stageById, stageIdsInSalesRule, stagesFromOldLists,
  START_PIPELINE_STAGES, ADDED_STAGE_ID, REQUIRED_ROLES, ROLE_LABEL, type PipelineStageDef,
} from './pipelineStageModel.js'
import { swapStageInRule } from './opsStageModel.js'

export const PIPELINE_STAGES_KEY = 'fencepro_pipeline_stages'
export const PIPELINE_STAGES_MIGRATION_KEY = 'migration:pipeline-stages-one-list-2026-10'

type Db = any

/** The saved value is a stage list of this shape. */
export function isPipelineStageList(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0 && v.every((x: any) => x && typeof x.id === 'string' && typeof x.group === 'string' && Array.isArray(x.roles))
}

export interface StageList { stages: PipelineStageDef[]; version: number }

/** The company's list. Before its one-time step has run: the start list (what the board always showed). */
export async function loadPipelineStages(accountId: string, db: Db = prisma): Promise<StageList> {
  const row = await db.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: PIPELINE_STAGES_KEY } } })
  if (row && isPipelineStageList(row.value)) return { stages: normalizeStages(row.value), version: row.version }
  return { stages: START_PIPELINE_STAGES.map(s => ({ ...s, roles: [...s.roles] })), version: row?.version ?? 0 }
}

export interface StageUsage {
  stageId: string
  cards: Array<{ id: string; name: string; archived: boolean }>
  rules: Array<{ id: string; name: string }>
  stageRules: Array<{ id: string; requirements: string[] }>
  /** Follow up steps set for the stage (Settings > Follow ups). */
  steps: number
  /** Cards' follow up dates kept for the stage. */
  followUps: number
}

const cardName = (l: any) => `${l?.firstName ?? ''} ${l?.lastName ?? ''}`.trim() || '(no name)'

/** What uses a stage: cards in it (archived ones too), sales automations, its stage rule, follow up steps and dates. */
export async function stageUsage(accountId: string, id: string, db: Db = prisma): Promise<StageUsage> {
  const p = await db.pipelineState.findUnique({ where: { accountId }, select: { leads: true, archivedLeads: true } })
  const rules = await db.automationRule.findMany({ where: { accountId, board: 'sales' }, select: { id: true, name: true, board: true, trigger: true, conditions: true, steps: true } })
  const sr = await db.stageRule.findMany({ where: { accountId, board: 'sales', stage: id } })
  const fs = await db.followUpSettings.findUnique({ where: { accountId } })
  const followUps = await db.cardFollowUp.count({ where: { accountId, stage: id } })
  const steps = ((fs?.steps as any) ?? {})[id]
  return {
    stageId: id,
    cards: [
      ...((p?.leads as any[]) ?? []).filter(l => l?.stage === id).map(l => ({ id: String(l.id), name: cardName(l), archived: false })),
      ...((p?.archivedLeads as any[]) ?? []).filter(l => l?.stage === id).map(l => ({ id: String(l.id), name: cardName(l), archived: true })),
    ],
    rules: rules.filter((r: any) => stageIdsInSalesRule(r).includes(id)).map((r: any) => ({ id: r.id, name: r.name })),
    stageRules: sr.map((r: any) => ({ id: r.id, requirements: ((r.requirements as any[]) ?? []).map(x => String(x?.type ?? '')) })),
    steps: Array.isArray(steps) ? steps.length : 0,
    followUps,
  }
}
const inUse = (u: StageUsage) => u.cards.length > 0 || u.rules.length > 0 || u.stageRules.length > 0

export interface Moved { cards: number; rules: number; stageRules: number; steps: number; followUps: number }

export type ChangeAnswer =
  | { ok: true; list: StageList; moved?: Moved }
  | { ok: false; status: number; code: string; error: string; list?: StageList; inUse?: StageUsage }

async function lockList(tx: Db, accountId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'pipeline-stages:' + accountId}))`
}

async function writeList(tx: Db, accountId: string, stages: PipelineStageDef[], userId: string | null): Promise<StageList> {
  const where = { accountId_key: { accountId, key: PIPELINE_STAGES_KEY } }
  const value = cleanStages(stages) as any
  const row = await tx.accountKeyValue.upsert({
    where,
    create: { accountId, key: PIPELINE_STAGES_KEY, value, updatedBy: userId },
    update: { value, updatedBy: userId, version: { increment: 1 } },
  })
  return { stages: normalizeStages(row.value), version: row.version }
}

/** Save the whole list (rename, recolor, reorder, group, roles, hide, follow up, chance, add). */
export async function savePipelineStages(accountId: string, raw: unknown, baseVersion: number, userId: string | null): Promise<ChangeAnswer> {
  return prisma.$transaction(async tx => {
    await lockList(tx, accountId)
    const cur = await loadPipelineStages(accountId, tx)
    if (cur.version !== baseVersion) return { ok: false, status: 409, code: 'STALE', error: 'Someone else saved the stages first. Their list is on screen now; make your change again.', list: cur }
    const next = cleanStages(raw)
    const problem = stagesProblem(next)
    if (problem) return { ok: false, status: 400, code: 'INVALID', error: problem, list: cur }
    const known = new Set(cur.stages.map(s => s.id))
    const bad = next.find(s => !known.has(s.id) && !ADDED_STAGE_ID.test(s.id))
    if (bad) return { ok: false, status: 400, code: 'INVALID', error: `"${bad.name}" has an id the server did not make for a new stage; add it with Add stage.`, list: cur }
    for (const gone of cur.stages.filter(s => !next.some(n => n.id === s.id))) {
      const u = await stageUsage(accountId, gone.id, tx)
      if (inUse(u)) return { ok: false, status: 409, code: 'STAGE_IN_USE', error: `"${gone.name}" is in use. Delete it with its Delete button to choose where its cards and automations go.`, list: cur, inUse: u }
    }
    return { ok: true, list: await writeList(tx, accountId, next, userId) }
  }, { timeout: 20_000 })
}

/**
 * Delete a stage. While anything uses it the answer is 409 with what does,
 * unless `moveTo` names the stage they go to: then the cards (archived ones
 * too) move there, the automations and the stage rule point at it, its
 * follow up steps go with it (unless the stage picked has its own) and the
 * cards' follow up dates are kept under it, and the stage is deleted, all in
 * one transaction. No automation fires: nobody moved the cards.
 */
export async function deletePipelineStage(accountId: string, id: string, moveTo: string | null, baseVersion: number, userId: string | null): Promise<ChangeAnswer> {
  return prisma.$transaction(async tx => {
    await lockList(tx, accountId)
    const cur = await loadPipelineStages(accountId, tx)
    if (cur.version !== baseVersion) return { ok: false, status: 409, code: 'STALE', error: 'Someone else saved the stages first. Their list is on screen now; try again.', list: cur }
    const stage = stageById(cur.stages, id)
    if (!stage) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'That stage is not in the list any more.', list: cur }
    const role = stage.roles.find(r => (REQUIRED_ROLES as string[]).includes(r))
    if (role) return { ok: false, status: 400, code: 'INVALID', error: `"${stage.name}" is the "${ROLE_LABEL[role]}" stage. Give that to another stage and save, then delete it.`, list: cur }
    const rest = cur.stages.filter(s => s.id !== id)
    const problem = stagesProblem(rest)
    if (problem) return { ok: false, status: 400, code: 'INVALID', error: problem, list: cur }
    const u = await stageUsage(accountId, id, tx)
    const moved: Moved = { cards: 0, rules: 0, stageRules: 0, steps: 0, followUps: 0 }
    if (inUse(u) && !moveTo) return { ok: false, status: 409, code: 'STAGE_IN_USE', error: `"${stage.name}" is in use. Pick the stage its cards and automations move to.`, list: cur, inUse: u }
    if (moveTo && !stageById(rest, moveTo)) return { ok: false, status: 400, code: 'INVALID', error: 'Pick a stage that stays in the list.', list: cur }
    if (moveTo) {
      // Cards, on the board and archived: the stage only. Their days in the stage and follow ups stay as they were.
      if (u.cards.length) {
        await tx.$queryRaw`SELECT 1 FROM "PipelineState" WHERE "accountId" = ${accountId} FOR UPDATE`
        const p = await tx.pipelineState.findUnique({ where: { accountId } })
        const swap = (list: any[]) => list.map(l => (l?.stage === id ? (moved.cards++, { ...l, stage: moveTo }) : l))
        const leads = swap((p?.leads as any[]) ?? [])
        const archivedLeads = swap((p?.archivedLeads as any[]) ?? [])
        await tx.pipelineState.update({ where: { accountId }, data: { leads, archivedLeads, version: { increment: 1 } } })
      }
      // Automations: every place the rule names the stage.
      for (const r of u.rules) {
        const row = await tx.automationRule.findUnique({ where: { id: r.id } })
        if (!row) continue
        const sw = swapStageInRule(row as any, id, moveTo)
        await tx.automationRule.update({ where: { id: r.id }, data: { trigger: sw.trigger as any, conditions: sw.conditions as any, steps: sw.steps as any } })
        moved.rules++
      }
      // Its stage rule: to the stage picked, unless that one has its own (then this one goes).
      for (const s of u.stageRules) {
        const has = await tx.stageRule.findFirst({ where: { accountId, board: 'sales', stage: moveTo } })
        if (has) await tx.stageRule.delete({ where: { id: s.id } })
        else await tx.stageRule.update({ where: { id: s.id }, data: { stage: moveTo } })
        moved.stageRules++
      }
      // Cards' follow ups: same dates, same step, under the stage picked.
      moved.followUps = (await tx.cardFollowUp.updateMany({ where: { accountId, stage: id }, data: { stage: moveTo } })).count
    }
    // Its follow up steps: to the stage picked when that one has none; otherwise they go with the stage.
    const fs = await tx.followUpSettings.findUnique({ where: { accountId } })
    const steps = { ...(((fs?.steps as any) ?? {}) as Record<string, unknown>) }
    if (fs && id in steps) {
      if (moveTo && Array.isArray(steps[id]) && (steps[id] as unknown[]).length && !(Array.isArray(steps[moveTo]) && (steps[moveTo] as unknown[]).length)) { steps[moveTo] = steps[id]; moved.steps = (steps[id] as unknown[]).length }
      delete steps[id]
      await tx.followUpSettings.update({ where: { accountId }, data: { steps: steps as any, version: { increment: 1 } } })
    }
    return { ok: true, list: await writeList(tx, accountId, rest, userId), moved }
  }, { timeout: 30_000 })
}

/** What the one-time step would write for a company, read only. */
export async function planPipelineStageList(accountId: string, db: Db = prisma) {
  const row = await db.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: PIPELINE_STAGES_KEY } } })
  if (row && isPipelineStageList(row.value)) return { write: false as const, stages: normalizeStages(row.value), added: [], hiddenStart: [], fromCards: [], shownFrom: 'saved list', oldBoardList: null, oldSettingsList: null }
  const p = await db.pipelineState.findUnique({ where: { accountId } })
  const b = await db.businessState.findUnique({ where: { accountId } })
  const settingsList = Array.isArray((b?.config as any)?.pipelineStages) ? (b!.config as any).pipelineStages : null
  const boardList = Array.isArray(p?.stages) ? (p!.stages as unknown[]) : null
  // What the board showed: Settings' list when it had one, else the pipeline's own, else the start list.
  const shown = settingsList?.length ? settingsList : boardList?.length ? boardList : null
  const words = new Set<string>()
  for (const l of [...(((p?.leads as any[]) ?? [])), ...(((p?.archivedLeads as any[]) ?? []))]) if (typeof l?.stage === 'string' && l.stage) words.add(l.stage)
  const made = stagesFromOldLists(shown, words)
  return { write: true as const, ...made, shownFrom: settingsList?.length ? 'Settings > Pipeline Stages' : boardList?.length ? 'the board' : 'the start list', oldBoardList: boardList, oldSettingsList: settingsList }
}

export interface PipelineStageListStep { wrote: boolean; added: string[]; hiddenStart: string[]; fromCards: string[] }

/**
 * Once per company, ever (AccountKeyValue PIPELINE_STAGES_MIGRATION_KEY): the
 * one list, made from the start list and what the board showed. No card,
 * follow up, stage rule or automation is touched: the ids are the old names.
 */
export async function ensurePipelineStageList(accountId: string): Promise<PipelineStageListStep | null> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'pipeline-stages-once:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: PIPELINE_STAGES_MIGRATION_KEY } } })
    if (done) return null
    await lockAccountState(tx, accountId)
    await lockList(tx, accountId)
    const plan = await planPipelineStageList(accountId, tx)
    const out: PipelineStageListStep = { wrote: plan.write, added: plan.added, hiddenStart: plan.hiddenStart, fromCards: plan.fromCards }
    if (plan.write) await writeList(tx, accountId, plan.stages, null)
    await tx.accountKeyValue.create({ data: { accountId, key: PIPELINE_STAGES_MIGRATION_KEY, value: { at: new Date().toISOString(), ...out, shownFrom: plan.shownFrom, oldBoardList: plan.oldBoardList, oldSettingsList: plan.oldSettingsList } as any } })
    return out
  }, { timeout: 20_000 })
}

/** At server start: every company with saved settings. */
export async function ensurePipelineStageListAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const out = await ensurePipelineStageList(r.accountId)
      if (out?.wrote) console.log(`[pipeline stages] ${r.accountId}: one stage list made${out.added.length ? `; kept from the old lists: ${out.added.join(', ')}` : ''}${out.hiddenStart.length ? `; hidden (not on the board before): ${out.hiddenStart.join(', ')}` : ''}${out.fromCards.length ? `; hidden, found only on cards: ${out.fromCards.join(', ')}` : ''}`)
    } catch (err) { console.error('[pipeline stages] one-time list failed:', err) }
  }
}
