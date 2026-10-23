/**
 * How long the server takes to answer, per kind of request.
 *
 *   - Every request slower than SLOW_REQUEST_MS (default 1000 ms) is written
 *     to the log as one line:  [slow] GET /api/customers/:id 200 1234ms
 *   - Every request is counted (per method and path, ids and the query taken
 *     out): count, average, slowest, how many were slow. The numbers since the
 *     server started are at GET /api/request-timing (owner and admin), and once
 *     an hour the slowest kinds go to the log in one [timing] line.
 *
 * Nothing about who asked or what was asked for is kept: only the shape of
 * the path, the status and the time. In memory only, gone on restart.
 */

import type { NextFunction, Request, Response } from 'express'

export interface TimingRow {
  key: string
  count: number
  avgMs: number
  maxMs: number
  slow: number
  lastSlowAt: string | null
}

const SLOW_MS = (() => {
  const n = parseInt(process.env.SLOW_REQUEST_MS || '', 10)
  return Number.isFinite(n) && n > 0 ? n : 1000
})()

type Stat = { count: number; total: number; max: number; slow: number; lastSlowAt: number | null }
const stats = new Map<string, Stat>()
const since = Date.now()
/** Kinds kept at most (a flood of odd paths cannot grow memory without end). */
const MAX_KEYS = 2000

const ID_SEGMENT = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // uuid
  /^\d+$/,                                                            // number
  /^c[a-z0-9]{20,}$/,                                                 // cuid
  /^[A-Za-z0-9_-]{20,}$/,                                             // long token or id
]

/** The path with ids and the query taken out: /api/customers/3f2a.../notes?x=1 -> /api/customers/:id/notes */
export function pathShape(url: string): string {
  const path = url.split('?')[0].split('#')[0]
  return path.split('/').map(seg => {
    let s = seg
    try { s = decodeURIComponent(seg) } catch { /* keep it as sent */ }
    return ID_SEGMENT.some(re => re.test(s)) ? ':id' : seg
  }).join('/') || '/'
}

export function recordTiming(method: string, url: string, status: number, ms: number, log: (line: string) => void = console.warn): void {
  const shape = pathShape(url)
  const key = `${method} ${shape}`
  let s = stats.get(key)
  if (!s) {
    if (stats.size >= MAX_KEYS) return
    s = { count: 0, total: 0, max: 0, slow: 0, lastSlowAt: null }
    stats.set(key, s)
  }
  s.count += 1
  s.total += ms
  if (ms > s.max) s.max = ms
  if (ms >= SLOW_MS) {
    s.slow += 1
    s.lastSlowAt = Date.now()
    log(`[slow] ${method} ${shape} ${status} ${Math.round(ms)}ms`)
  }
}

/** The kinds of request, slowest on average first. */
export function timingSummary(limit = 50): { since: string; slowMs: number; rows: TimingRow[] } {
  const rows = [...stats].map(([key, s]) => ({
    key, count: s.count, avgMs: Math.round(s.total / s.count), maxMs: Math.round(s.max), slow: s.slow,
    lastSlowAt: s.lastSlowAt ? new Date(s.lastSlowAt).toISOString() : null,
  })).sort((a, b) => b.avgMs - a.avgMs || b.maxMs - a.maxMs)
  return { since: new Date(since).toISOString(), slowMs: SLOW_MS, rows: rows.slice(0, limit) }
}

/** One log line: the five slowest kinds on average (with their slowest and slow counts). */
export function timingSummaryLine(): string | null {
  const { rows } = timingSummary(5)
  if (!rows.length) return null
  return `[timing] slowest since ${new Date(since).toISOString().slice(0, 16)}: ` +
    rows.map(r => `${r.key} avg ${r.avgMs}ms max ${r.maxMs}ms n=${r.count}${r.slow ? ` slow=${r.slow}` : ''}`).join(' | ')
}

export function resetTiming(): void { stats.clear() }

/** The middleware: times every request from arrival to the last byte sent. */
export function requestTiming(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint()
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    recordTiming(req.method, req.originalUrl || req.url, res.statusCode, ms)
  })
  next()
}

let hourly: ReturnType<typeof setInterval> | null = null
/** The hourly [timing] line; does not keep the process alive. */
export function startTimingSummaryLog(everyMs = 60 * 60 * 1000): void {
  if (hourly) return
  hourly = setInterval(() => { const line = timingSummaryLine(); if (line) console.log(line) }, everyMs)
  hourly.unref?.()
}
