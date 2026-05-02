/**
 * Per-run section-count helper (server mirror of apps/web/src/sectionCount.ts).
 *
 * Each physical run starts and ends with a post — partial panels can't be
 * shared between runs. Sections are counted per run with `Math.ceil` and
 * summed. Never divide total footage by panel width.
 */

export interface RunInput {
  footage: number
}

export interface SectionCountResult {
  perRun: number[]
  total: number
}

export function sectionsForRun(footage: number, panelLength: number): number {
  if (!Number.isFinite(footage) || footage <= 0) return 0
  if (!Number.isFinite(panelLength) || panelLength <= 0) return 0
  return footage % panelLength === 0 ? footage / panelLength : Math.ceil(footage / panelLength)
}

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

export function calculateLinePostsPerRun(perRunSections: ReadonlyArray<number>): number[] {
  return perRunSections.map(n => Math.max(0, n - 1))
}

export function totalLinePosts(perRunSections: ReadonlyArray<number>): number {
  return calculateLinePostsPerRun(perRunSections).reduce((s, n) => s + n, 0)
}
