/**
 * Stage rules: a card or job cannot be moved into a stage until its
 * requirements are met (Pending Start needs the permit approved; Job Complete
 * needs the final walkthrough signed). The server checks every pipeline and
 * job save; a refused move is answered 409 STAGE_BLOCKED with what is missing
 * for each card, so the app can put the card back and say why.
 */

import type { Response } from 'express'
import prisma from '../prisma.js'
import { REQUIREMENT_LABEL, type Board, type Requirement } from './types.js'
import { jobForCard, opsStageOfJob, OPS_STAGE_LABEL } from './context.js'
import { walkthroughApi, WALKTHROUGH_MISSING } from './walkthroughAdapter.js'

export interface Missing { type: Requirement; label: string; detail: string }
export interface Blocked { id: string; name: string; board: Board; from: string; to: string; missing: Missing[] }

const PERMIT_OK = new Set(['approved', 'inspection_scheduled', 'passed', 'not_needed'])
const PERMIT_WORDS: Record<string, string> = { not_needed: 'Not needed', needed: 'Needed', applied: 'Applied', approved: 'Approved', inspection_scheduled: 'Inspection scheduled', passed: 'Passed' }

async function enabledRules(accountId: string, board: Board) {
  const rows = await prisma.stageRule.findMany({ where: { accountId, board, enabled: true } })
  return new Map(rows.map(r => [r.stage, ((r.requirements as any[]) ?? []).map(x => x?.type as Requirement).filter(Boolean)]))
}

/** What is still missing for a job (and its card) to enter a stage with these requirements. */
export async function missingFor(accountId: string, reqs: Requirement[], job: any | null, card: any | null): Promise<Missing[]> {
  const out: Missing[] = []
  const add = (type: Requirement, detail: string) => out.push({ type, label: REQUIREMENT_LABEL[type], detail })
  for (const type of reqs) {
    switch (type) {
      case 'permit_approved': {
        if (!job) { add(type, 'There is no job for this card yet, so there is no permit to check.'); break }
        const p = await prisma.permit.findUnique({ where: { jobId: job.id } })
        if (!p) add(type, 'The permit status is not set. Open the job in Operations and fill in the Permit panel.')
        else if (!PERMIT_OK.has(p.status)) add(type, `The permit is ${PERMIT_WORDS[p.status] ?? p.status}; it must be Approved (or marked Not needed).`)
        break
      }
      case 'walkthrough_signed': {
        if (!job) { add(type, 'There is no job for this card yet, so there is no walkthrough.'); break }
        const api = await walkthroughApi()
        if (!api) { add(type, WALKTHROUGH_MISSING); break }
        let signed = false
        try { signed = await api.isWalkthroughSigned(accountId, job.id) } catch (err) { add(type, `The walkthrough could not be checked: ${String((err as Error)?.message || err).slice(0, 120)}`); break }
        if (!signed) add(type, 'The final walkthrough has not been signed by the customer yet.')
        break
      }
      case 'has_install_date':
        if (!job?.scheduledDate) add(type, 'No install date is set on the job.')
        break
      case 'has_price': {
        const cents = Math.round(Number(job?.contractValue || card?.jobValue || card?.quotePrice || 0) * 100)
        if (!(cents > 0)) add(type, 'No price is set.')
        break
      }
      case 'has_email':
        if (!String(card?.email || job?.customerEmail || '').includes('@')) add(type, 'The customer has no email address on file.')
        break
      case 'materials_ordered':
        if (!job || !['ordered', 'received', 'loaded'].includes(job.materialsStatus)) add(type, 'Materials have not been marked ordered on the job.')
        break
      case 'paid_in_full':
        if (!job || !(job.paymentStatus === 'paid' || (job.contractValue > 0 && job.amountPaid >= job.contractValue))) add(type, 'The job is not paid in full.')
        break
    }
  }
  return out
}

const cardName = (l: any) => `${l?.firstName ?? ''} ${l?.lastName ?? ''}`.trim() || 'This card'

/** Cards whose stage changes between two copies of the board and whose new stage has requirements not met. */
export async function checkPipelineMoves(accountId: string, before: any[], after: any[]): Promise<Blocked[]> {
  const was = new Map(before.filter(Boolean).map(l => [l.id, l.stage]))
  const moved = after.filter(l => l?.id && l.stage && was.get(l.id) !== l.stage)
  if (!moved.length) return []
  const rules = await enabledRules(accountId, 'sales')
  if (!rules.size) return []
  const blocked: Blocked[] = []
  for (const l of moved) {
    const reqs = rules.get(l.stage)
    if (!reqs?.length) continue
    const job = await jobForCard(accountId, l)
    const missing = await missingFor(accountId, reqs, job, l)
    if (missing.length) blocked.push({ id: l.id, name: cardName(l), board: 'sales', from: String(was.get(l.id) ?? ''), to: l.stage, missing })
  }
  return blocked
}

/** A job save that moves it into an Operations stage with requirements not met. */
export async function checkJobMove(accountId: string, before: any, after: any): Promise<Blocked | null> {
  const from = opsStageOfJob(before)
  const to = opsStageOfJob(after)
  if (from === to) return null
  const rules = await enabledRules(accountId, 'ops')
  const reqs = rules.get(to)
  if (!reqs?.length) return null
  const missing = await missingFor(accountId, reqs, after, null)
  if (!missing.length) return null
  return { id: before.id, name: before.customerName || 'This job', board: 'ops', from: OPS_STAGE_LABEL[from] ?? from, to: OPS_STAGE_LABEL[to] ?? to, missing }
}

/** The answer for a refused move: the app puts the card back and shows what is missing. */
export function refuseBlocked(res: Response, blocked: Blocked[], current?: { data: unknown; version: number }) {
  const first = blocked[0]
  const what = first.missing.map(m => m.label.toLowerCase()).join(', ')
  res.status(409).json({
    success: false,
    code: 'STAGE_BLOCKED',
    error: `${first.name} cannot move to ${first.to} yet. Missing: ${what}.`,
    blocked,
    ...(current ? { data: current.data, version: current.version } : {}),
  })
}
