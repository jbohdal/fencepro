/**
 * The nightly check's report (deploy/mac/nightly-check.sh, scripts/nightly-report.ts):
 * what passed and failed tonight, what changed since the previous night (new
 * failures first), the new feedback, and what the night agent did. Plain
 * words; the first lines are the morning summary. No database, no settings.
 */

export type StepStatus = 'pass' | 'fail' | 'skip'

export interface StepResult {
  /** walkthrough | iphone | setup */
  suite: string
  job: string
  step: string
  role: string
  device: string
  status: StepStatus
  ms: number
  detail: string
  screenshot: string | null
}

export interface FeedbackLine {
  id: string
  createdAt: string
  userName: string
  role: string
  text: string
  status: string
  screenTitle: string
  record: string
  path: string
  device: string
  appVersion: string
  /** The copy of its screenshot in tonight's folder, or null. */
  screenshotFile: string | null
}

export interface SuiteRun { name: string; label: string; ran: boolean; words: string }

export interface AgentRun {
  ran: boolean
  /** Why it did or did not run, in words. */
  why: string
  command: string
  exitCode: number | null
  /** What the agent wrote for Jonathan (its summary file), or ''. */
  summary: string
}

export interface NightInput {
  date: string
  startedAt: string
  finishedAt: string
  /** The branch and commit tested: "finalize abc1234 subject". */
  commit: string
  dryRun: boolean
  refresh: { done: boolean; words: string }
  safety: string[]
  suites: SuiteRun[]
  steps: StepResult[]
  feedback: { source: string; fresh: FeedbackLine[]; olderNew: number; error: string | null }
  outboxHeld: number
  agent: AgentRun | null
  problems: string[]
}

export interface Comparison {
  /** Failed tonight, passed the previous night (or no previous night). */
  newFailures: StepResult[]
  /** Failed tonight and the previous night. */
  stillFailing: StepResult[]
  /** Passed tonight, failed the previous night. */
  fixed: StepResult[]
  /** The previous night's date, or null when there is none. */
  previousDate: string | null
}

export const stepKey = (s: Pick<StepResult, 'suite' | 'job' | 'step'>) => `${s.suite}|${s.job}|${s.step}`

/** Tonight against the previous night. Skipped steps are neither (an earlier step of their job failed). */
export function compareNights(previous: { date: string; steps: StepResult[] } | null, now: StepResult[]): Comparison {
  const before = new Map((previous?.steps ?? []).map(s => [stepKey(s), s.status]))
  const newFailures: StepResult[] = [], stillFailing: StepResult[] = [], fixed: StepResult[] = []
  for (const s of now) {
    const was = before.get(stepKey(s))
    if (s.status === 'fail') {
      if (previous && was === 'fail') stillFailing.push(s)
      else if (!previous || was === 'pass' || was === undefined) newFailures.push(s)
      else stillFailing.push(s) // skipped the previous night: not known to have worked
    } else if (s.status === 'pass' && was === 'fail') fixed.push(s)
  }
  return { newFailures, stillFailing, fixed, previousDate: previous?.date ?? null }
}

/**
 * PASS / FAIL lines a test prints ("PASS  name  -- detail") as steps. Lines
 * of other kinds are left out. The area before the first ":" is the job
 * ("fit: ..." -> fit) when there is one.
 */
export function parseCheckLines(log: string, suite: string, role = 'owner', device = ''): StepResult[] {
  const out: StepResult[] = []
  for (const raw of log.split('\n')) {
    const m = raw.match(/^(PASS|FAIL)\s{1,2}(.+?)(?:\s{2}--\s(.*))?$/)
    if (!m) continue
    const name = m[2].trim()
    const area = name.match(/^([a-z][\w-]{1,20}):\s/i)?.[1] ?? suite
    out.push({ suite, job: area, step: name, role, device, status: m[1] === 'PASS' ? 'pass' : 'fail', ms: 0, detail: (m[3] ?? '').trim().slice(0, 600), screenshot: null })
  }
  return out
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const secs = (ms: number) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`)
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const dayWords = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
const oneLine = (s: string, max = 300) => s.replace(/\s+/g, ' ').trim().slice(0, max)
const stepLine = (s: StepResult) => `**${s.suite === 'walkthrough' ? `Job ${s.job}` : s.suite === 'iphone' ? 'iPhone' : s.job}: ${s.step}** (${s.role}${s.device ? `, ${s.device}` : ''})${s.detail ? `: ${oneLine(s.detail)}` : ''}${s.screenshot ? ` [screenshot](${encodeURI(`file://${s.screenshot}`)})` : ''}`

/** The first lines of the report: what Jonathan reads in the morning. */
export function morningSummary(n: NightInput, c: Comparison): string[] {
  const counted = n.steps.filter(s => s.suite !== 'setup')
  const failed = counted.filter(s => s.status === 'fail').length
  const passed = counted.filter(s => s.status === 'pass').length
  const skipped = counted.filter(s => s.status === 'skip').length
  const lines: string[] = []
  if (n.problems.length) lines.push(`**The check could not run in full:** ${n.problems.map(p => oneLine(p, 200)).join('; ')}.`)
  if (!counted.length) lines.push('**No steps ran tonight.**')
  else if (!failed) lines.push(`**All ${passed} steps passed.**${c.fixed.length ? ` ${plural(c.fixed.length, 'step')} that failed last night now pass${c.fixed.length === 1 ? 'es' : ''}.` : ''}`)
  else {
    const parts = [`${passed} passed`, `${failed} failed`]
    if (skipped) parts.push(`${skipped} skipped after a failure`)
    lines.push(`**${c.newFailures.length ? `${plural(c.newFailures.length, 'NEW FAILURE')}` : 'No new failures'}** (${parts.join(', ')}${c.previousDate ? `; compared with ${c.previousDate}` : '; no earlier night to compare with'}).`)
  }
  if (n.agent?.ran && n.agent.summary.trim()) lines.push(...n.agent.summary.trim().split('\n').map(l => l.trimEnd()).filter(Boolean).slice(0, 12))
  else if (n.agent && !n.agent.ran && (c.newFailures.length || n.feedback.fresh.length)) lines.push(n.dryRun ? `Dry run: the night agent was not started (${n.agent.why}).` : `The night agent did not run: ${n.agent.why}. Needs Jonathan.`)
  const fb = n.feedback
  if (fb.error) lines.push(`Feedback could not be read: ${oneLine(fb.error, 200)}.`)
  else if (fb.fresh.length) lines.push(`${plural(fb.fresh.length, 'new feedback', 'new feedback')} since the last check${fb.olderNew ? ` (and ${fb.olderNew} older still marked New)` : ''}: see Feedback below.`)
  else lines.push(`No new feedback${fb.olderNew ? ` (${fb.olderNew} older still marked New)` : ''}.`)
  return lines
}

/** The whole report, Markdown. */
export function renderReport(n: NightInput, c: Comparison): string {
  const L: string[] = []
  L.push(`# EZ Biz nightly check: ${dayWords(n.date)}${n.dryRun ? ' (DRY RUN)' : ''}`)
  L.push('')
  L.push(...morningSummary(n, c).map(l => `${l}  `))
  L.push('')
  L.push(`Ran ${time(n.startedAt)} to ${time(n.finishedAt)} on the dev copy (ezbiz_dev), code: ${n.commit}. Nothing was sent to anyone and live was not changed.`)
  L.push('')

  L.push(`## New failures (worked ${c.previousDate ? `on ${c.previousDate}` : 'before'}, broken tonight)`)
  L.push('')
  if (c.newFailures.length) for (const s of c.newFailures) L.push(`- ${stepLine(s)}`)
  else L.push('None.')
  L.push('')
  if (c.stillFailing.length) {
    L.push('## Still failing (failed last night too)')
    L.push('')
    for (const s of c.stillFailing) L.push(`- ${stepLine(s)}`)
    L.push('')
  }
  if (c.fixed.length) {
    L.push('## Fixed since last night')
    L.push('')
    for (const s of c.fixed) L.push(`- ${s.suite === 'walkthrough' ? `Job ${s.job}` : s.suite === 'iphone' ? 'iPhone' : s.job}: ${s.step}`)
    L.push('')
  }

  if (n.agent) {
    L.push('## The night agent')
    L.push('')
    L.push(n.agent.ran ? `Ran (exit ${n.agent.exitCode ?? 'unknown'}). ${n.agent.why}` : `Did not run: ${n.agent.why}.`)
    if (n.agent.summary.trim()) { L.push(''); L.push(n.agent.summary.trim()) }
    L.push('')
    L.push('Command:')
    L.push('')
    L.push('```')
    L.push(n.agent.command)
    L.push('```')
    L.push('')
  }

  L.push('## Feedback')
  L.push('')
  L.push(`Read only from ${n.feedback.source}.`)
  L.push('')
  if (n.feedback.error) L.push(`Could not read it: ${n.feedback.error}`)
  else if (!n.feedback.fresh.length) L.push('No new feedback since the last check.')
  else {
    for (const f of n.feedback.fresh) {
      L.push(`- **${oneLine(f.text || '(no text)', 400)}**  `)
      L.push(`  ${f.userName || 'Someone'} (${f.role}), ${when(f.createdAt)}, ${f.device}${f.appVersion ? `, app ${f.appVersion}` : ''}  `)
      L.push(`  Screen: ${f.screenTitle || '-'}${f.record ? ` · ${f.record}` : ''} · page ${f.path || '-'}  `)
      L.push(`  ${f.screenshotFile ? `[screenshot](${encodeURI(`file://${f.screenshotFile}`)})` : 'no screenshot'} · id ${f.id} · ${f.status}`)
    }
  }
  if (n.feedback.olderNew) { L.push(''); L.push(`${plural(n.feedback.olderNew, 'older feedback', 'older feedback')} still marked New on the Feedback page (sent before the last check).`) }
  L.push('')

  for (const suite of n.suites) {
    const mine = n.steps.filter(s => s.suite === suite.name)
    L.push(`## ${suite.label}`)
    L.push('')
    if (!suite.ran) { L.push(`Not run: ${suite.words}`); L.push(''); continue }
    if (suite.words) { L.push(suite.words); L.push('') }
    const f = mine.filter(s => s.status === 'fail').length, p = mine.filter(s => s.status === 'pass').length, k = mine.filter(s => s.status === 'skip').length
    L.push(`${p} passed, ${f} failed${k ? `, ${k} skipped` : ''}.`)
    L.push('')
    L.push('| | Step | Who | Time | What happened |')
    L.push('|---|---|---|---|---|')
    for (const s of mine) {
      const mark = s.status === 'pass' ? 'PASS' : s.status === 'fail' ? '**FAIL**' : 'skip'
      const who = `${s.role}${s.device ? `, ${s.device}` : ''}`
      L.push(`| ${mark} | ${s.suite === 'walkthrough' ? `${s.job}: ` : ''}${s.step.replace(/\|/g, '/')} | ${who.replace(/\|/g, '/')} | ${s.ms ? secs(s.ms) : ''} | ${oneLine(s.detail, 240).replace(/\|/g, '/')}${s.screenshot ? ` [screenshot](${encodeURI(`file://${s.screenshot}`)})` : ''} |`)
    }
    L.push('')
  }

  L.push('## How it ran')
  L.push('')
  L.push(`- Practice data: ${n.refresh.words}`)
  for (const s of n.safety) L.push(`- ${s}`)
  L.push(`- Messages held by the outbound gate tonight (dev outbox, nothing sent): ${n.outboxHeld}`)
  L.push('')
  return L.join('\n')
}

/** The night folders to remove: all but the newest `keep` (folder names are YYYY-MM-DD). */
export function nightsToRemove(names: string[], keep = 30): string[] {
  const nights = names.filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort()
  return nights.slice(0, Math.max(0, nights.length - keep))
}

/** The newest night before `date` that has results, from folder names. */
export function previousNight(names: string[], date: string): string | null {
  const before = names.filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n) && n < date).sort()
  return before.length ? before[before.length - 1] : null
}

/** A feedback row from feedback-report.ts --json (an older or newer version of it) in the report's words. */
export function feedbackLine(row: Record<string, unknown>, screenshotFile: string | null): FeedbackLine {
  const str = (k: string) => (typeof row[k] === 'string' ? (row[k] as string) : '')
  const ua = str('userAgent')
  const device = str('device') || (/iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'a browser')
  const createdAt = typeof row.createdAt === 'string' ? row.createdAt : row.createdAt instanceof Date ? row.createdAt.toISOString() : ''
  return {
    id: str('id'), createdAt, userName: str('userName'), role: str('roleWords') || str('role'), text: str('text'), status: str('statusWords') || str('status'),
    screenTitle: str('screenTitle'), record: str('record') || (str('recordType') ? `${str('recordType')}${str('recordName') ? `: ${str('recordName')}` : ''}` : ''),
    path: str('path'), device: `${device}${str('screen') ? ` ${str('screen').split(' ')[0]}` : ''}`, appVersion: str('appVersion') || str('appFile'), screenshotFile,
  }
}
