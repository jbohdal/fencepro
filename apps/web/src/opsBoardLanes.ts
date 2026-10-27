/**
 * Which column a job is in on the Operations board, and the styles filter
 * (audit Oct 26 2026: jobs in Awaiting Locates or Permit Pending sat in
 * "Unscheduled 12" while the Awaiting Locates column read 0, and the styles
 * filter listed every old import code: AG, WVSDS, wvnd, galvcl...).
 *
 * A job is in its stage's column. Only a job whose stage says it has an
 * install date (Scheduled, In Progress, Punch List: the scheduled and in
 * progress phases) but has none, or a job whose stage is not in the list, is
 * in Unscheduled. The waiting stages (Awaiting Locates, Permit Pending, Need
 * Drawing, Materials Ordered, Ready to Pull), the side lanes (On Hold...) and
 * the finished ones never need a date to show in their own column.
 */

import { phaseOf, type OpsStageDef } from './opsStageModel'

export const UNSCHEDULED_LANE = '__unscheduled__'

export function laneOf(stages: OpsStageDef[], job: { opsStage: string; scheduledDate?: string | null }): string {
  const phase = phaseOf(stages, job.opsStage)
  if (!phase) return UNSCHEDULED_LANE
  if (!job.scheduledDate && (phase === 'scheduled' || phase === 'in_progress')) return UNSCHEDULED_LANE
  return job.opsStage
}

/**
 * A style's plain name for the filter: a bare import code with one plain meaning ("CL" on about 20 imported jobs,
 * review Oct 27 2026) in words, else the catalog's plain name (`plain`).
 */
const IMPORT_CODE_WORDS: Record<string, string> = { cl: 'Chain link' }
export function filterStyleName(code: string, plain: (code: string) => string): string {
  return IMPORT_CODE_WORDS[code.trim().toLowerCase()] ?? plain(code)
}

/** The styles to filter by: the plain names of the styles on the jobs shown, once each, A to Z. */
export function styleChoices(fenceTypes: Array<string | null | undefined>, plain: (code: string) => string): string[] {
  const set = new Set<string>()
  for (const t of fenceTypes) { const name = t ? plain(t).trim() : ''; if (name) set.add(name) }
  return [...set].sort((a, b) => a.localeCompare(b))
}
