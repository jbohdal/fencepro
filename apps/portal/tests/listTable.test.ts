/**
 * Lists sent as one table (?shape=table, lib/listTable.ts) come back on the
 * phone as the very same rows (web/src/listTable.ts); fields the stores do not
 * keep are left out of the table; every JSON answer is no-store
 * (walkthrough round 2, item 2, Oct 26, 2026).
 */

import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { toTable, tableBody, listTables, LIST_ONLY_OMIT } from '../src/server/lib/listTable'
import { fromTable, untableBody, asTable } from '../../web/src/listTable'

const rows = [
  { id: 'a', name: 'Ann', tags: ['vip'], layout: { yard: { sides: [1, 2] } }, archivedAt: null, n: 0, ok: false },
  { id: 'b', name: '', tags: [], layout: null, archivedAt: '2026-10-01T00:00:00.000Z', n: 3.5, ok: true },
]

describe('a list as one table', () => {
  test('turns back into the same rows (nulls, empty words, zeros, nested values)', () => {
    const t = toTable(rows)!
    expect(t.cols).toEqual(['id', 'name', 'tags', 'layout', 'archivedAt', 'n', 'ok'])
    expect(t.missing).toBeUndefined()
    expect(fromTable(JSON.parse(JSON.stringify(t)))).toEqual(rows)
  })

  test('a field missing from a row stays missing (pipeline cards differ)', () => {
    const cards = [{ id: '1', stage: 'New' }, { id: '2', stage: 'Sold', quoteId: 'q' }, { id: '3', note: undefined, stage: 'Lost' }]
    const back = fromTable(JSON.parse(JSON.stringify(toTable(cards)))) as any[]
    expect(back).toEqual(JSON.parse(JSON.stringify(cards)))
    expect('quoteId' in back[0]).toBe(false)
    expect('quoteId' in back[1]).toBe(true)
    expect('note' in back[2]).toBe(false)
  })

  test('the pipeline\'s leads and a plain data list; anything else is left as is', () => {
    const pipe = { success: true, data: { version: 4, stages: [{ id: 's' }], leads: rows } }
    expect(untableBody(JSON.parse(JSON.stringify(tableBody(pipe))))).toEqual(JSON.parse(JSON.stringify(pipe)))
    const list = { success: true, data: rows, serverTime: 'x', partial: false }
    expect(untableBody(JSON.parse(JSON.stringify(tableBody(list))))).toEqual(JSON.parse(JSON.stringify(list)))
    const one = { success: true, data: rows[0] }
    expect(tableBody(one)).toBe(one)
    expect(tableBody({ success: true, data: [1, 2] }).data).toEqual([1, 2])
    // An older server's plain list reads as before.
    expect(untableBody(list)).toBe(list)
  })

  test('is much smaller than the plain list', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `id-${i}`, firstName: 'Pat', lastName: 'Doe', phone: '3525550142', email: '', serviceAddress: '12 Main St', notes: '', tags: [], createdAt: '2026-10-01T00:00:00.000Z' }))
    expect(JSON.stringify(toTable(many)).length).toBeLessThan(JSON.stringify(many).length * 0.6)
  })

  test('asTable adds the ask to a path with or without a query', () => {
    expect(asTable('/')).toBe('/?shape=table')
    expect(asTable('/api/saved-quotes?since=x')).toBe('/api/saved-quotes?since=x&shape=table')
  })
})

/** Runs the middleware the way Express does and returns what was sent and the headers. */
function run(url: string, body: any, opts: { method?: string; status?: number; cacheControl?: string } = {}) {
  const [p, q = ''] = url.split('?')
  const headers: Record<string, string> = {}
  let sent: any
  const res: any = {
    statusCode: opts.status ?? 200,
    get: (k: string) => headers[k.toLowerCase()],
    set: (k: string, v: string) => { headers[k.toLowerCase()] = v },
    json: (b: any) => { sent = b; return res },
  }
  if (opts.cacheControl) res.set('Cache-Control', opts.cacheControl)
  const req = { method: opts.method ?? 'GET', baseUrl: '/api', path: p.replace(/^\/api/, ''), query: Object.fromEntries(new URLSearchParams(q)) }
  listTables(req, res, () => {})
  res.json(body)
  return { sent, headers }
}

describe('the /api middleware', () => {
  const quotes = [{ id: 'q1', accountId: 'acc', ownerId: 'u', acceptedSignature: 'data:image/png;base64,AAAA', acceptedIp: '1.2.3.4', customerName: 'Ann', finalPrice: 100, proposal: { planSvg: '<svg/>' }, archivedAt: null, deletedAt: null }]

  test('a table only when asked, without the fields no screen reads from the list', () => {
    const { sent, headers } = run('/api/saved-quotes/?shape=table', { success: true, data: quotes })
    expect(sent.data.$table).toBe(1)
    expect(sent.data.cols).not.toContain('acceptedSignature')
    expect(sent.data.cols).not.toContain('accountId')
    expect(fromTable(sent.data)).toEqual([{ id: 'q1', customerName: 'Ann', finalPrice: 100, proposal: { planSvg: '<svg/>' }, archivedAt: null, deletedAt: null }])
    expect(headers['cache-control']).toBe('no-store')
    // Not asked: exactly as before.
    expect(run('/api/saved-quotes/', { success: true, data: quotes }).sent.data).toBe(quotes)
    // A refusal is sent as is.
    expect(run('/api/saved-quotes/?shape=table', { success: false, error: 'x' }, { status: 403 }).sent).toEqual({ success: false, error: 'x' })
    // Only a read.
    expect(run('/api/saved-quotes/?shape=table', { success: true, data: quotes }, { method: 'POST' }).sent.data).toBe(quotes)
  })

  test('a route\'s own Cache-Control is kept', () => {
    expect(run('/api/x', { ok: 1 }, { cacheControl: 'private, max-age=60' }).headers['cache-control']).toBe('private, max-age=60')
  })

  test('the fields left out are ones the phone\'s stores never read', () => {
    const web = path.resolve(__dirname, '../../web/src')
    const fromApiOf = (file: string) => {
      const src = fs.readFileSync(path.join(web, file), 'utf8')
      const start = src.indexOf('function fromApi(')
      return src.slice(start, src.indexOf('\n}\n', start))
    }
    const reads = (body: string) => new Set([...body.matchAll(/\br\.([A-Za-z]+)/g)].map(m => m[1]))
    const quoteReads = reads(fromApiOf('quoteStore.ts'))
    const contactReads = reads(fromApiOf('customerStore.ts'))
    expect(quoteReads.has('customerName')).toBe(true)
    expect(contactReads.has('firstName')).toBe(true)
    for (const f of LIST_ONLY_OMIT['/api/saved-quotes']) expect(quoteReads.has(f), `quoteStore reads ${f}`).toBe(false)
    for (const f of LIST_ONLY_OMIT['/api/crm-contacts']) expect(contactReads.has(f), `customerStore reads ${f}`).toBe(false)
  })
})
