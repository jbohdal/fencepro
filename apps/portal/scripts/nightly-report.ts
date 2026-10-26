/**
 * Writes the nightly check's report from what the night left in its folder
 * (deploy/mac/nightly-check.sh runs it, before and after the night agent):
 *
 *   npx tsx scripts/nightly-report.ts --night ~/Downloads/ezbiz-nightly/2026-10-26
 *
 * Reads in that folder:
 *   facts.tsv          lines the check wrote as it went (tab separated):
 *                        started <iso> | finished <iso> | commit <words> | dry 1
 *                        refresh done|skipped|failed <words> | safety <words> | problem <words>
 *                        suite <name> ran|not <words> | outbox <count> | feedback-source <words>
 *                        agent ran|not <exit code or -> <why>
 *   walkthrough.json   nightly-walkthrough.mjs RESULTS
 *   iphone.log         iphone-safari.mjs output (PASS / FAIL lines)
 *   feedback.jsonl     scripts/feedback-report.ts --status new --json (live, read only), or
 *   feedback-error.txt why it could not be read
 *   agent-summary.md   what the night agent wrote for Jonathan
 *   agent-command.txt  the command it was (or would be) run with
 * and the previous night's results.json in the folder next to it.
 *
 * Writes report.md (the first lines are the morning summary) and
 * results.json, copies each new feedback's screenshot into feedback/, and
 * prints one line: NEW_FAILURES=<n> FRESH_FEEDBACK=<n>. No database, no
 * settings: it only reads files.
 */

import fs from 'fs'
import path from 'path'
import { compareNights, renderReport, previousNight, feedbackLine, parseCheckLines, type NightInput, type StepResult, type SuiteRun, type FeedbackLine } from '../src/server/lib/nightlyReport.js'

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined }
const night = path.resolve(arg('--night') || '')
if (!arg('--night') || !fs.existsSync(night)) { console.error('Usage: nightly-report.ts --night <the night\'s folder>'); process.exit(2) }
const root = path.dirname(night)
const date = path.basename(night)
const read = (f: string) => { try { return fs.readFileSync(path.join(night, f), 'utf8') } catch { return '' } }

// ── facts.tsv ──
const facts = read('facts.tsv').split('\n').filter(Boolean).map(l => l.split('\t'))
const fact = (k: string) => facts.filter(f => f[0] === k)
const last = (k: string) => fact(k).pop()
const startedAt = last('started')?.[1] || new Date().toISOString()
const finishedAt = last('finished')?.[1] || new Date().toISOString()
const refreshFact = last('refresh')
const suiteFacts = new Map(fact('suite').map(f => [f[1], { ran: f[2] === 'ran', words: f.slice(3).join(' ') }]))
const agentFact = last('agent')

// ── Steps ──
const steps: StepResult[] = []
const walk = (() => { try { return JSON.parse(read('walkthrough.json') || 'null') } catch { return null } })()
for (const s of walk?.steps ?? []) {
  steps.push({ suite: 'walkthrough', job: s.job, step: s.step, role: s.role, device: s.device, status: s.status, ms: s.ms, detail: s.detail ?? '', screenshot: s.screenshot ?? null })
}
const iphoneLog = read('iphone.log')
if (iphoneLog) steps.push(...parseCheckLines(iphoneLog, 'iphone', 'owner and Salesman', 'iPhone Simulator (Safari)'))

const suites: SuiteRun[] = [
  { name: 'walkthrough', label: 'The 3 job walkthrough (vinyl no dig, chain link dig set with change orders, walk-in repair)', ...(suiteFacts.get('walkthrough') ?? { ran: !!walk, words: '' }) },
  { name: 'iphone', label: 'iPhone (real Safari in the iOS Simulator, every area)', ...(suiteFacts.get('iphone') ?? { ran: !!iphoneLog, words: '' }) },
]
// A suite that ran but left no steps (it crashed before printing any) is a failure, not silence.
for (const s of suites) if (s.ran && !steps.some(x => x.suite === s.name)) steps.push({ suite: s.name, job: s.name, step: 'The run printed no results', role: 'system', device: '', status: 'fail', ms: 0, detail: s.words || 'see its log in this folder', screenshot: null })

// ── The previous night ──
const nights = fs.readdirSync(root).filter(n => fs.existsSync(path.join(root, n, 'results.json')))
const prevName = previousNight(nights, date)
const prev = prevName ? (() => { try { return JSON.parse(fs.readFileSync(path.join(root, prevName, 'results.json'), 'utf8')) } catch { return null } })() : null
const cmp = compareNights(prev ? { date: prevName!, steps: prev.steps ?? [] } : null, steps)

// ── Feedback (live, read only, already fetched) ──
const feedbackError = read('feedback-error.txt').trim() || null
let fresh: FeedbackLine[] = []
let olderNew = 0
if (!feedbackError) {
  const rows = read('feedback.jsonl').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) as Record<string, unknown>[]
  // New since the previous check started (or the last 24 hours on the first night).
  const since = prev?.startedAt ? Date.parse(prev.startedAt) : Date.parse(startedAt) - 86_400_000
  const shots = path.join(night, 'feedback')
  for (const r of rows) {
    const at = Date.parse(String(r.createdAt))
    if (!(at >= since)) { olderNew++; continue }
    let copy: string | null = null
    const src = typeof r.screenshotPath === 'string' ? r.screenshotPath : null
    if (src && fs.existsSync(src)) {
      fs.mkdirSync(shots, { recursive: true })
      copy = path.join(shots, `${String(r.id).replace(/[^A-Za-z0-9_-]/g, '_')}.jpg`)
      fs.copyFileSync(src, copy)
    }
    fresh.push(feedbackLine(r, copy))
  }
  fresh = fresh.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

const input: NightInput = {
  date, startedAt, finishedAt,
  commit: last('commit')?.slice(1).join(' ') || 'unknown',
  dryRun: !!last('dry'),
  refresh: { done: refreshFact?.[1] === 'done', words: refreshFact?.slice(2).join(' ') || 'not refreshed' },
  safety: fact('safety').map(f => f.slice(1).join(' ')),
  suites, steps,
  feedback: { source: last('feedback-source')?.slice(1).join(' ') || 'live (read only)', fresh, olderNew, error: feedbackError },
  outboxHeld: Number(last('outbox')?.[1] || 0) || 0,
  agent: agentFact ? {
    ran: agentFact[1] === 'ran', exitCode: agentFact[2] && agentFact[2] !== '-' ? Number(agentFact[2]) : null, why: agentFact.slice(3).join(' '),
    command: read('agent-command.txt').trim(), summary: read('agent-summary.md'),
  } : null,
  problems: fact('problem').map(f => f.slice(1).join(' ')),
}

fs.writeFileSync(path.join(night, 'report.md'), renderReport(input, cmp))
fs.writeFileSync(path.join(night, 'results.json'), JSON.stringify({
  date, startedAt, finishedAt, commit: input.commit, dryRun: input.dryRun, refresh: input.refresh, safety: input.safety, problems: input.problems,
  previousNight: cmp.previousDate,
  counts: { passed: steps.filter(s => s.status === 'pass').length, failed: steps.filter(s => s.status === 'fail').length, skipped: steps.filter(s => s.status === 'skip').length },
  newFailures: cmp.newFailures.map(s => `${s.suite}|${s.job}|${s.step}`), stillFailing: cmp.stillFailing.map(s => `${s.suite}|${s.job}|${s.step}`), fixed: cmp.fixed.map(s => `${s.suite}|${s.job}|${s.step}`),
  steps,
  feedback: { source: input.feedback.source, error: feedbackError, fresh, olderNew },
  outboxHeld: input.outboxHeld,
  agent: input.agent,
}, null, 2))
console.log(`NEW_FAILURES=${cmp.newFailures.length} FRESH_FEEDBACK=${fresh.length} FAILED=${steps.filter(s => s.status === 'fail').length}`)
