/**
 * Per-run section-count helper.
 *
 * Each physical run of fence starts and ends with a post — you cannot share a
 * partial panel between runs. So sections are counted per run with `Math.ceil`
 * (rounding fractional panels up to the next whole panel) and summed.
 *
 * NEVER compute total sections by summing all runs first and dividing by the
 * panel width — that under-orders panels and posts on every multi-run job.
 */

export interface RunInput {
  /** Footage of this run in feet. */
  footage: number
}

export interface SectionCountResult {
  /** Section count for each run, in input order. Zero-footage runs return 0. */
  perRun: number[]
  /** Sum of perRun. */
  total: number
}

/** Sections needed for one run at the given panel width. */
export function sectionsForRun(footage: number, panelLength: number): number {
  if (!Number.isFinite(footage) || footage <= 0) return 0
  if (!Number.isFinite(panelLength) || panelLength <= 0) return 0
  return footage % panelLength === 0 ? footage / panelLength : Math.ceil(footage / panelLength)
}

/** Sections per run + total, given a uniform panel width. */
export function calculateSectionCount(
  runs: ReadonlyArray<RunInput | number>,
  panelLength: number,
): SectionCountResult {
  const perRun = runs.map(r => {
    const ft = typeof r === 'number' ? r : (r?.footage ?? 0)
    return sectionsForRun(ft, panelLength)
  })
  const total = perRun.reduce((sum, n) => sum + n, 0)
  return { perRun, total }
}

/** Line posts for each run. A run with 1 section has 0 line posts. */
export function calculateLinePostsPerRun(perRunSections: ReadonlyArray<number>): number[] {
  return perRunSections.map(n => Math.max(0, n - 1))
}

/** Sum of line posts across all runs. */
export function totalLinePosts(perRunSections: ReadonlyArray<number>): number {
  return calculateLinePostsPerRun(perRunSections).reduce((s, n) => s + n, 0)
}
