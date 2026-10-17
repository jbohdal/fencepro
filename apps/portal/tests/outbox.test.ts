/**
 * The outbox: nothing entered is lost or fails silently. Changes are kept
 * until the server confirms them, sent in order, retried after no signal,
 * marked "Couldn't save" when refused, and still there after the app closes.
 */

import { describe, test, expect, beforeEach } from 'vitest'
import {
  _resetForTests, startOutbox, registerKind, enqueue, allOps, statusOf, retry, kick, whenSaved,
  type Op, type OutboxStorage, type SendResult,
} from '../../web/src/outbox'

/** The phone's storage, kept across "closing the app". */
function phoneStorage(): OutboxStorage & { map: Map<string, Op> } {
  const map = new Map<string, Op>()
  return { map, all: async () => [...map.values()].map(o => JSON.parse(JSON.stringify(o))), put: async o => { map.set(o.id, JSON.parse(JSON.stringify(o))) }, remove: async id => { map.delete(id) } }
}
const tick = () => new Promise(r => setTimeout(r, 5))
async function settle(n = 20) { for (let i = 0; i < n; i++) await tick() }

/** A pretend server: answers each send from a script, and records what it got. */
function server() {
  const got: Op[] = []
  let answer: (op: Op) => SendResult = () => ({ ok: true })
  return {
    got,
    answer: (f: (op: Op) => SendResult) => { answer = f },
    send: async (op: Op) => { got.push(op); return answer(op) },
  }
}

describe('outbox', () => {
  let store: ReturnType<typeof phoneStorage>
  let srv: ReturnType<typeof server>
  beforeEach(async () => {
    _resetForTests()
    store = phoneStorage()
    srv = server()
    for (const k of ['customer.create', 'customer.update', 'note.create']) registerKind(k, { send: op => srv.send(op) })
  })

  test('a change is on the phone before it is sent, and gone once the server confirms it', async () => {
    srv.answer(() => ({ ok: false, status: 0, error: 'Failed to fetch' }))
    await startOutbox('u1', { storage: store })
    await enqueue({ key: 'customer:a', kind: 'customer.create', payload: { name: 'Dave' }, label: 'Dave, new customer' })
    expect(store.map.size).toBe(1)
    await settle()
    expect(statusOf(['customer:a']).status).toBe('waiting')
    expect(statusOf(['customer:a']).error).toMatch(/^No signal right now/)
    srv.answer(() => ({ ok: true }))
    await retry()
    await settle()
    expect(statusOf(['customer:a']).status).toBe('saved')
    expect(store.map.size).toBe(0)
  })

  test('closing the app with no signal: the change is still there and is sent when it opens again', async () => {
    srv.answer(() => ({ ok: false, status: 0 }))
    await startOutbox('u1', { storage: store })
    await enqueue({ key: 'customer:a', kind: 'customer.create', payload: { name: 'Dave' }, label: 'Dave' })
    await settle()
    // The app is closed: everything in memory is gone, the phone's storage is not.
    _resetForTests()
    const srv2 = server()
    registerKind('customer.create', { send: op => srv2.send(op) })
    await startOutbox('u1', { storage: store })
    await settle()
    expect(srv2.got.map(o => o.payload.name)).toEqual(['Dave'])
    expect(store.map.size).toBe(0)
  })

  test('refused by the server: "Couldn\'t save" in plain words, kept, and Try again sends it', async () => {
    srv.answer(() => ({ ok: false, status: 400, error: 'String must contain at least 8 character(s)' }))
    await startOutbox('u1', { storage: store })
    await enqueue({ key: 'customer:a', kind: 'customer.create', payload: {}, label: 'Dave' })
    await settle()
    const st = statusOf(['customer:a'])
    expect(st.status).toBe('failed')
    expect(st.error).not.toMatch(/String must|character/)
    expect(store.map.size).toBe(1)
    srv.answer(() => ({ ok: true }))
    await retry()
    await settle()
    expect(statusOf(['customer:a']).status).toBe('saved')
  })

  test('changes to one record go in order; a note waits for its new customer', async () => {
    const order: string[] = []
    srv.answer(op => { order.push(`${op.kind}:${op.payload.n}`); return { ok: true } })
    await startOutbox('u1', { storage: store })
    srv.answer(op => { order.push(`${op.kind}:${op.payload.n}`); return op.kind === 'customer.create' && order.length === 1 ? { ok: false, status: 503 } : { ok: true } })
    await enqueue({ key: 'customer:a', kind: 'customer.create', payload: { n: 1 }, label: 'a' })
    await enqueue({ key: 'note:x', kind: 'note.create', payload: { n: 2 }, label: 'note', after: ['customer:a'] })
    await settle()
    // The customer's first try failed: the note did not go ahead of it.
    expect(order).toEqual(['customer.create:1'])
    await retry()
    await settle()
    expect(order).toEqual(['customer.create:1', 'customer.create:1', 'note.create:2'])
  })

  test('only the newest copy of an edit still waiting is sent', async () => {
    srv.answer(() => ({ ok: false, status: 0 }))
    await startOutbox('u1', { storage: store })
    await enqueue({ key: 'customer:a', kind: 'customer.update', payload: { phone: '1' }, label: 'a' })
    await enqueue({ key: 'customer:a', kind: 'customer.update', payload: { phone: '2' }, label: 'a' })
    await settle()
    expect(allOps().length).toBe(1)
    srv.answer(() => ({ ok: true }))
    srv.got.length = 0
    await retry(); await settle()
    expect(srv.got.map(o => o.payload.phone)).toEqual(['2'])
  })

  test('changes made under another login on this phone wait for that login', async () => {
    srv.answer(() => ({ ok: false, status: 0 }))
    await startOutbox('u1', { storage: store })
    await enqueue({ key: 'customer:a', kind: 'customer.create', payload: { by: 'u1' }, label: 'a' })
    await settle()
    _resetForTests()
    const srv2 = server()
    registerKind('customer.create', { send: op => srv2.send(op) })
    await startOutbox('u2', { storage: store })
    await settle()
    expect(srv2.got).toEqual([])
    expect(store.map.size).toBe(1)
  })

  test('whenSaved: true once confirmed, false while there is no signal', async () => {
    srv.answer(() => ({ ok: false, status: 0 }))
    await startOutbox('u1', { storage: store })
    await enqueue({ key: 'customer:a', kind: 'customer.create', payload: {}, label: 'a' })
    expect(await whenSaved('customer:a', 50)).toBe(false)
    srv.answer(() => ({ ok: true }))
    const p = whenSaved('customer:a', 2000)
    await retry(); kick()
    expect(await p).toBe(true)
  })
})
