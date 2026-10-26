/**
 * The words of scripts/feedback-report.ts (the daily feedback review), apart
 * from the database so they can be tested. No database, no settings.
 */

import { pathToFileURL } from 'url'
import { FEEDBACK_STATUS_LABEL, FEEDBACK_ROLE_LABEL, isFeedbackStatus, recordText, deviceText, type FeedbackStatusValue } from './feedbackModel.js'

export interface ReportArgs {
  status?: FeedbackStatusValue
  limit: number
  days?: number
  /** Only feedback sent at or after this moment. */
  since?: Date
  json: boolean
  /** Copy each screenshot here (as <id>.jpg) and point to the copy. */
  copyShots?: string
}

/** Reads the command line. Throws an Error with a plain sentence when it is wrong. */
export function parseReportArgs(argv: string[]): ReportArgs {
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  const status = arg('--status')
  if (status !== undefined && !isFeedbackStatus(status)) throw new Error('--status is new, seen (Looked at), done (Fixed) or needs_jonathan')
  const limit = Math.max(1, Math.min(1000, parseInt(arg('--limit') || '50', 10) || 50))
  const daysRaw = arg('--days')
  const days = daysRaw === undefined ? undefined : parseInt(daysRaw, 10)
  if (daysRaw !== undefined && !(Number.isFinite(days) && days! > 0)) throw new Error('--days is a whole number of days, 1 or more')
  const sinceRaw = arg('--since')
  let since: Date | undefined
  if (sinceRaw !== undefined) {
    // A plain date is the start of that day in Ocala (America/New_York).
    since = /^\d{4}-\d{2}-\d{2}$/.test(sinceRaw) ? startOfDayNewYork(sinceRaw) : new Date(sinceRaw)
    if (Number.isNaN(since.getTime())) throw new Error('--since is a date (2026-10-26) or a date and time (2026-10-26T19:15:00-04:00)')
  }
  const copyShots = arg('--copy-shots')
  if (argv.includes('--copy-shots') && !copyShots) throw new Error('--copy-shots needs a folder')
  return { status: status as FeedbackStatusValue | undefined, limit, days, since, json: argv.includes('--json'), copyShots }
}

/** Midnight at the start of `ymd` in New York, as a moment. */
export function startOfDayNewYork(ymd: string): Date {
  const noonUtc = new Date(`${ymd}T12:00:00Z`)
  const hourThere = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(noonUtc))
  const offsetHours = 12 - hourThere // 4 in summer time, 5 in winter
  return new Date(`${ymd}T${String(offsetHours).padStart(2, '0')}:00:00Z`)
}

/** The oldest moment to include: the later of --since and --days. */
export function sinceMoment(a: ReportArgs, now = new Date()): Date | undefined {
  const fromDays = a.days ? new Date(now.getTime() - a.days * 86_400_000) : undefined
  if (fromDays && a.since) return fromDays > a.since ? fromDays : a.since
  return fromDays ?? a.since
}

export interface ReportRow {
  id: string; createdAt: Date; status: string; userName: string; userId: string; role: string; path: string; screen: string
  userAgent: string; appFile: string; text: string; screenshotPath: string | null; errors: unknown; statusAt: Date | null; statusBy: string | null
  screenTitle?: string | null; recordType?: string | null; recordId?: string | null; recordName?: string | null; appVersion?: string | null
}

const when = (d: Date) => d.toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
export const statusWords = (s: string) => FEEDBACK_STATUS_LABEL[s as FeedbackStatusValue] ?? s
export const roleWords = (r: string) => FEEDBACK_ROLE_LABEL[r] ?? r

/** A link that opens the screenshot file (file://...), or a plain note. */
export function shotLink(file: string | null, exists: boolean): string {
  if (!file) return '(none)'
  return exists ? pathToFileURL(file).href : `${file}  (file missing)`
}

/** One feedback, as the text report prints it. `shot` is the screenshot file to point to (a copy, or the original). */
export function entryText(f: ReportRow, shot: { file: string | null; exists: boolean }): string {
  const errs = Array.isArray(f.errors) ? (f.errors as Array<{ at?: string; message?: string }>) : []
  const lines = [
    `── ${when(f.createdAt)}  [${statusWords(f.status).toUpperCase()}]  ${f.userName || f.userId} (${roleWords(f.role)})`,
    `   id:         ${f.id}`,
    `   note:       ${(f.text || '(no text)').split('\n').join(' / ')}`,
    `   screen:     ${f.screenTitle || '-'}`,
    `   record:     ${f.recordType ? `${recordText(f.recordType, f.recordName)} (${f.recordType} ${f.recordId})` : '-'}`,
    `   page:       ${f.path || '-'}`,
    `   device:     ${f.userAgent ? deviceText(f.userAgent) : '-'}, ${f.screen || '-'}`,
    `   app:        ${f.appVersion || f.appFile || '-'}`,
    `   screenshot: ${shotLink(shot.file, shot.exists)}`,
  ]
  if (f.statusBy) lines.push(`   marked ${statusWords(f.status)} by ${f.statusBy}${f.statusAt ? ` on ${when(f.statusAt)}` : ''}`)
  for (const e of errs) lines.push(`   app error:  ${e.at ?? ''} ${e.message ?? ''}`)
  return lines.join('\n') + '\n'
}

/** One feedback as a JSON line (no secrets: these are the Feedback row's own fields). */
export function entryJson(f: ReportRow, shot: { file: string | null; exists: boolean }): string {
  return JSON.stringify({
    ...f,
    statusWords: statusWords(f.status), roleWords: roleWords(f.role), device: f.userAgent ? deviceText(f.userAgent) : '',
    record: f.recordType ? recordText(f.recordType, f.recordName) : '',
    screenshotFile: shot.file, screenshotExists: shot.exists, screenshotUrl: shot.file && shot.exists ? pathToFileURL(shot.file).href : null,
  })
}
