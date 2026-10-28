/**
 * Operations stages on the server: the company's one list (Settings >
 * Operations Stages), where it is kept, and the only ways it changes.
 *
 * Kept in AccountKeyValue under 'fencepro_ops_stages' (the key the old
 * Settings screen saved to; one row per company, versioned like every other
 * setting there). The rules for reading it are in opsStageModel.ts, the same
 * file the web app uses. Only /api/ops-stages writes it (routes/ops-stages.ts);
 * the general /api/kv refuses this key, so nothing can save a list here without
 * the checks below.
 *
 *   - Saving the list: every stage keeps its id; a stage can only disappear
 *     when nothing uses it.
 *   - Deleting a stage that jobs, automations or a stage rule use: they move
 *     to the stage picked, and the stage goes, in one transaction.
 *   - Once per company (ensureOpsStageListAll, at start up): the start list
 *     replaces what the old Settings screen saved, which nothing read. No job
 *     is changed: the start list's ids are the old board's keys.
 */

import prisma from './prisma.js'
import { lockAccountState } from './lockState.js'
import {
  cleanStages, normalizeStages, stagesProblem, stageOfJob, stageIdsInRule, swapStageInRule, fieldsForStage, stagesFromOldList, stageById,
  START_OPS_STAGES, ADDED_STAGE_ID, type OpsStageDef,
} from './opsStageModel.js'

export const OPS_STAGES_KEY = 'fencepro_ops_stages'
export const OPS_STAGES_MIGRATION_KEY = 'migration:ops-stages-one-list-2026-10'

type Db = any

/** The saved value is a stage list of the new shape (not the old Settings screen's). */
export function isStageList(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0 && v.every((x: any) => x && typeof x.id === 'string' && (x.lane === 'main' || x.lane === 'side') && typeof x.order === 'number')
}

export interface StageList { stages: OpsStageDef[]; version: number }

/** The company's list. Before its one-time step has run: the start list (what the board always showed). */
export async function loadOpsStages(accountId: string, db: Db = prisma): Promise<StageList> {
  const row = await db.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: OPS_STAGES_KEY } } })
  if (row && isStageList(row.value)) return { stages: normalizeStages(row.value), version: row.version }
  return { stages: START_OPS_STAGES.map(s => ({ ...s })), version: row?.version ?? 0 }
}

const JOB_FIELDS = { id: true, customerName: true, status: true, opsStage: true, materialsStatus: true, drawingComplete: true, locatesDate: true, completedDate: true, previousStatus: true, archivedAt: true } as const

export interface StageUsage {
  stageId: string
  jobs: Array<{ id: string; name: string; archived: boolean }>
  rules: Array<{ id: string; name: string }>
  stageRules: Array<{ id: string; requirements: string[] }>
}

/** What uses a stage: jobs in it (by the board's rule, removed jobs too), Operations automations, its stage rule. */
export async function stageUsage(accountId: string, stages: OpsStageDef[], id: string, db: Db = prisma): Promise<StageUsage> {
  const jobs = await db.savedJob.findMany({ where: { accountId, deletedAt: null }, select: JOB_FIELDS })
  const rules = await db.automationRule.findMany({ where: { accountId, board: 'ops' }, select: { id: true, name: true, board: true, trigger: true, conditions: true, steps: true } })
  const sr = await db.stageRule.findMany({ where: { accountId, board: 'ops', stage: id } })
  return {
    stageId: id,
    jobs: jobs.filter((j: any) => stageOfJob(stages, j) === id).map((j: any) => ({ id: j.id, name: j.customerName || '(no name)', archived: !!j.archivedAt })),
    rules: rules.filter((r: any) => stageIdsInRule(r).includes(id)).map((r: any) => ({ id: r.id, name: r.name })),
    stageRules: sr.map((r: any) => ({ id: r.id, requirements: ((r.requirements as any[]) ?? []).map(x => String(x?.type ?? '')) })),
  }
}
const inUse = (u: StageUsage) => u.jobs.length > 0 || u.rules.length > 0 || u.stageRules.length > 0

export type ChangeAnswer =
  | { ok: true; list: StageList; moved?: { jobs: number; rules: number; stageRules: number } }
  | { ok: false; status: number; code: string; error: string; list?: StageList; inUse?: StageUsage }

async function lockList(tx: Db, accountId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'ops-stages:' + accountId}))`
}

async function writeList(tx: Db, accountId: string, stages: OpsStageDef[], userId: string | null): Promise<StageList> {
  const where = { accountId_key: { accountId, key: OPS_STAGES_KEY } }
  const value = stages.map((s, i) => ({ ...s, order: i })) as any
  const row = await tx.accountKeyValue.upsert({
    where,
    create: { accountId, key: OPS_STAGES_KEY, value, updatedBy: userId },
    update: { value, updatedBy: userId, version: { increment: 1 } },
  })
  return { stages: normalizeStages(row.value), version: row.version }
}

/** Save the whole list (rename, recolor, reorder, add, hide, first, Complete, side lanes). */
export async function saveOpsStages(accountId: string, raw: unknown, baseVersion: number, userId: string | null): Promise<ChangeAnswer> {
  return prisma.$transaction(async tx => {
    await lockList(tx, accountId)
    const cur = await loadOpsStages(accountId, tx)
    if (cur.version !== baseVersion) return { ok: false, status: 409, code: 'STALE', error: 'Someone else saved the stages first. Their list is on screen now; make your change again.', list: cur }
    const next = cleanStages(raw)
    const problem = stagesProblem(next)
    if (problem) return { ok: false, status: 400, code: 'INVALID', error: problem, list: cur }
    const known = new Set(cur.stages.map(s => s.id))
    const bad = next.find(s => !known.has(s.id) && !ADDED_STAGE_ID.test(s.id))
    if (bad) return { ok: false, status: 400, code: 'INVALID', error: `"${bad.name}" has an id the server did not make for a new stage; add it with Add stage.`, list: cur }
    for (const gone of cur.stages.filter(s => !next.some(n => n.id === s.id))) {
      const u = await stageUsage(accountId, cur.stages, gone.id, tx)
      if (inUse(u)) return { ok: false, status: 409, code: 'STAGE_IN_USE', error: `"${gone.name}" is in use. Delete it with its Delete button to choose where its jobs and automations go.`, list: cur, inUse: u }
    }
    return { ok: true, list: await writeList(tx, accountId, next, userId) }
  }, { timeout: 20_000 })
}

/**
 * Delete a stage. While anything uses it the answer is 409 with what does,
 * unless `moveTo` names the stage they go to: then the jobs move there (with
 * the status that stage stands for), the automations and the stage rule point
 * at it, and the stage is deleted, all in one transaction.
 */
export async function deleteOpsStage(accountId: string, id: string, moveTo: string | null, baseVersion: number, userId: string | null, today: string): Promise<ChangeAnswer> {
  return prisma.$transaction(async tx => {
    await lockList(tx, accountId)
    const cur = await loadOpsStages(accountId, tx)
    if (cur.version !== baseVersion) return { ok: false, status: 409, code: 'STALE', error: 'Someone else saved the stages first. Their list is on screen now; try again.', list: cur }
    const stage = stageById(cur.stages, id)
    if (!stage) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'That stage is not in the list any more.', list: cur }
    const rest = cur.stages.filter(s => s.id !== id)
    if (stage.isFirst) return { ok: false, status: 400, code: 'INVALID', error: `"${stage.name}" is the first stage. Mark another stage First and save, then delete it.`, list: cur }
    if (stage.isComplete) return { ok: false, status: 400, code: 'INVALID', error: `"${stage.name}" is the Complete stage. Mark another stage Complete and save, then delete it.`, list: cur }
    const problem = stagesProblem(rest)
    if (problem) return { ok: false, status: 400, code: 'INVALID', error: problem, list: cur }
    const u = await stageUsage(accountId, cur.stages, id, tx)
    const moved = { jobs: 0, rules: 0, stageRules: 0 }
    if (inUse(u)) {
      if (!moveTo) return { ok: false, status: 409, code: 'STAGE_IN_USE', error: `"${stage.name}" is in use. Pick the stage its jobs and automations move to.`, list: cur, inUse: u }
      if (!stageById(rest, moveTo)) return { ok: false, status: 400, code: 'INVALID', error: 'Pick a stage that stays in the list.', list: cur }
      // Jobs: into the stage picked, with the status it stands for. Nothing else changes, as the delete box says: the
      // materials and drawing stay as recorded (review Oct 28 2026: "Move them to: Ready to Pull" marked materials Received).
      const ids = u.jobs.map(j => j.id)
      const jobs = await tx.savedJob.findMany({ where: { accountId, id: { in: ids }, deletedAt: null }, select: JOB_FIELDS })
      for (const j of jobs) {
        const fields = fieldsForStage(rest, moveTo, j as any, today, { stageOnly: true }) ?? { opsStage: moveTo }
        await tx.savedJob.update({ where: { id: j.id }, data: fields as any })
        moved.jobs++
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
        const has = await tx.stageRule.findFirst({ where: { accountId, board: 'ops', stage: moveTo } })
        if (has) await tx.stageRule.delete({ where: { id: s.id } })
        else await tx.stageRule.update({ where: { id: s.id }, data: { stage: moveTo } })
        moved.stageRules++
      }
    }
    return { ok: true, list: await writeList(tx, accountId, rest, userId), moved }
  }, { timeout: 30_000 })
}

export interface OpsStageListStep { wrote: boolean; kept: string[]; colors: string[]; replacedOld: boolean }

/**
 * Once per company, ever (AccountKeyValue OPS_STAGES_MIGRATION_KEY): the start
 * list becomes the company's list, made from what the old Settings screen
 * saved (stagesFromOldList: hand picked colors kept, a stage the start list
 * lacks kept under its old name). A list already of the new shape is left as
 * it is. No job, rule or stage rule is touched.
 */
export async function ensureOpsStageList(accountId: string): Promise<OpsStageListStep | null> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'ops-stages-once:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: OPS_STAGES_MIGRATION_KEY } } })
    if (done) return null
    await lockAccountState(tx, accountId)
    await lockList(tx, accountId)
    const row = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: OPS_STAGES_KEY } } })
    let out: OpsStageListStep = { wrote: false, kept: [], colors: [], replacedOld: !!row }
    if (!row || !isStageList(row.value)) {
      const made = stagesFromOldList(row?.value ?? null)
      await writeList(tx, accountId, made.stages, null)
      out = { wrote: true, kept: made.kept, colors: made.colors, replacedOld: !!row }
    }
    await tx.accountKeyValue.create({ data: { accountId, key: OPS_STAGES_MIGRATION_KEY, value: { at: new Date().toISOString(), ...out, oldList: row?.value ?? null } as any } })
    return out
  }, { timeout: 20_000 })
}

/** At server start: every company with saved settings. */
export async function ensureOpsStageListAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const out = await ensureOpsStageList(r.accountId)
      if (out?.wrote) console.log(`[ops stages] ${r.accountId}: one stage list made${out.kept.length ? `; kept from the old Settings list: ${out.kept.join(', ')}` : ''}${out.colors.length ? `; colors kept: ${out.colors.join(', ')}` : ''}`)
    } catch (err) { console.error('[ops stages] one-time list failed:', err) }
  }
}
