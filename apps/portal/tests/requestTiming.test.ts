import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import http from 'http'
import { pathShape, recordTiming, requestTiming, resetTiming, timingSummary, timingSummaryLine } from '../src/server/lib/requestTiming.js'

describe('request timing', () => {
  beforeEach(() => resetTiming())

  it('takes ids and the query out of the path', () => {
    expect(pathShape('/api/crm-contacts/3f2a1b4c-1111-4222-8333-444455556666/notes?x=1')).toBe('/api/crm-contacts/:id/notes')
    expect(pathShape('/api/saved-quotes/12345')).toBe('/api/saved-quotes/:id')
    expect(pathShape('/api/pipeline/cards/cmabc123def456ghi789jkl/archive')).toBe('/api/pipeline/cards/:id/archive')
    expect(pathShape('/api/pipeline/column/No%20Answer')).toBe('/api/pipeline/column/No%20Answer')
    expect(pathShape('/api/follow-ups/board')).toBe('/api/follow-ups/board')
  })

  it('logs a request over a second, once, and not a quick one', () => {
    const lines: string[] = []
    recordTiming('GET', '/api/pipeline?version=3', 200, 40, l => lines.push(l))
    recordTiming('GET', '/api/crm-contacts/3f2a1b4c-1111-4222-8333-444455556666', 200, 1250.4, l => lines.push(l))
    expect(lines).toEqual(['[slow] GET /api/crm-contacts/:id 200 1250ms'])
  })

  it('counts per kind: average, slowest, slow count; slowest kind first', () => {
    const quiet = () => {}
    recordTiming('GET', '/api/a', 200, 100, quiet)
    recordTiming('GET', '/api/a', 200, 300, quiet)
    recordTiming('GET', '/api/b/42', 200, 1500, quiet)
    recordTiming('GET', '/api/b/43', 500, 500, quiet)
    const { rows, slowMs } = timingSummary()
    expect(slowMs).toBe(1000)
    expect(rows[0]).toMatchObject({ key: 'GET /api/b/:id', count: 2, avgMs: 1000, maxMs: 1500, slow: 1 })
    expect(rows[1]).toMatchObject({ key: 'GET /api/a', count: 2, avgMs: 200, maxMs: 300, slow: 0 })
    expect(timingSummaryLine()).toMatch(/^\[timing\] slowest since .*GET \/api\/b\/:id avg 1000ms max 1500ms n=2 slow=1 \| GET \/api\/a avg 200ms/)
  })

  it('times real requests through the middleware', async () => {
    const app = express()
    app.use(requestTiming)
    app.get('/api/x/:id', (_req, res) => { res.json({ ok: true }) })
    const server = http.createServer(app)
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const { port } = server.address() as any
    try {
      for (const id of ['1', '2', '3']) await (await fetch(`http://127.0.0.1:${port}/api/x/${id}?q=1`)).json()
      await new Promise(r => setTimeout(r, 20))
      const row = timingSummary().rows.find(r => r.key === 'GET /api/x/:id')
      expect(row?.count).toBe(3)
      expect(row!.avgMs).toBeGreaterThanOrEqual(0)
    } finally { server.close() }
  })
})
