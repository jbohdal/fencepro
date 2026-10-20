/**
 * Crew working days (Settings: Monday to Thursday by default). Scheduling math
 * never lands a job on a day off: a start on a day off moves to the next
 * working day, and a job that takes N days starts the next job N working days
 * later. Dates are plain YYYY-MM-DD, read as calendar days (no time zone).
 */

const DEFAULT_WORK_DAYS = [1, 2, 3, 4]

function parse(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
const fmt = (d: Date) => d.toISOString().slice(0, 10)

function daysOf(workDays: number[] | undefined): Set<number> {
  const s = new Set((workDays ?? []).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))
  return s.size ? s : new Set(DEFAULT_WORK_DAYS)
}

/** The day itself if it is a working day, otherwise the next working day. */
export function onWorkDay(day: string, workDays?: number[]): string {
  const ok = daysOf(workDays)
  const d = parse(day)
  for (let i = 0; i < 7 && !ok.has(d.getUTCDay()); i++) d.setUTCDate(d.getUTCDate() + 1)
  return fmt(d)
}

/** `count` working days after `day` (0 = the day itself, moved onto a working day). */
export function addWorkDays(day: string, count: number, workDays?: number[]): string {
  const ok = daysOf(workDays)
  const d = parse(onWorkDay(day, workDays))
  let left = Math.max(0, Math.floor(count))
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (ok.has(d.getUTCDay())) left--
  }
  return fmt(d)
}
