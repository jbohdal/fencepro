/**
 * The outbox: nothing entered is lost or fails silently. Changes are kept
 * until the server confirms them, sent in order, retried after no signal,
 * marked "Couldn't save" when refused, and still there after the app closes.
 */

import { describe, test, expect, beforeEach } from 'vitest'
import {
  _resetForTests, startOutbox, registerKind, enqueue, allOps, statusOf, retry, kick, whenSaved, refusalReason,
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

  test('a Salesman\'s save of a record the owner moved away (404 MOVED): never sent again, told in those words, the next change goes', async () => {
    let refused = ''
    registerKind('quote.update', { send: op => srv.send(op), refused: (_op, m) => { refused = m } })
    srv.answer(op => (op.kind === 'quote.update' ? { ok: false, status: 404, code: 'MOVED', error: 'The owner moved this to Sam. It is off your list now.' } : { ok: true }))
    await startOutbox('u1', { storage: store })
    await enqueue({ key: 'quote:q1', kind: 'quote.update', payload: { id: 'q1', notes: 'x' }, label: 'Cleo, quote changes' })
    await enqueue({ key: 'customer:a', kind: 'customer.update', payload: { name: 'Mina' }, label: 'Mina' })
    await settle()
    expect(srv.got.filter(o => o.kind === 'quote.update')).toHaveLength(1)
    expect(refused).toBe('The owner moved this to Sam. It is off your list now.')
    expect(store.map.size).toBe(0)
    expect(srv.got.map(o => o.kind)).toEqual(['quote.update', 'customer.update'])
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

  // Review Oct 28 2026: an install booked on a Friday was refused by the server in plain words, but the phone
  // said "The server did not accept this appointment" and kept it as "Couldn't save" (red count, ghost entries).
  const FRIDAY = 'Installs go on crew days (Monday to Thursday). Fri, Oct 30 is not one. Pick a crew day, or book it on the Schedule with "The crew works weekends on this job" ticked.'

  test('refusalReason: a 4xx with the server\'s sentence is a refusal; no signal, sign in, busy and conflicts are not', () => {
    expect(refusalReason({ ok: false, status: 400, error: FRIDAY, code: 'NOT_A_CREW_DAY' })).toBe(FRIDAY)
    expect(refusalReason({ ok: false, status: 404, error: 'That job is not there any more (archived or deleted). Reload and try again.' })).toMatch(/^That job/)
    expect(refusalReason({ ok: false, status: 403, error: 'Your role cannot change the schedule.' })).toMatch(/^Your role/)
    expect(refusalReason({ ok: false, status: 422, error: 'Pick a day.' })).toBe('Pick a day.')
    // Kept as they are now: sent again, or "Couldn't save" with Try again.
    expect(refusalReason({ ok: false, status: 0, error: 'Failed to fetch' })).toBeNull()
    expect(refusalReason({ ok: false, status: 401, error: 'Not authenticated' })).toBeNull()
    expect(refusalReason({ ok: false, status: 408, error: 'Timed out' })).toBeNull()
    expect(refusalReason({ ok: false, status: 409, error: 'Changed on another device' })).toBeNull()
    expect(refusalReason({ ok: false, status: 429, error: 'Slow down' })).toBeNull()
    expect(refusalReason({ ok: false, status: 500, error: 'Could not book the appointment' })).toBeNull()
    expect(refusalReason({ ok: false, status: 503 })).toBeNull()
    expect(refusalReason({ ok: false, status: 400 })).toBeNull()
    expect(refusalReason({ ok: false, status: 400, error: '  ' })).toBeNull()
    // A booking for a customer not on the server yet goes once the customer does.
    expect(refusalReason({ ok: false, status: 400, code: 'CUSTOMER_NOT_SAVED', error: 'That customer is not saved on the server yet. It will be booked once the customer is.' })).toBeNull()
    expect(refusalReason({ ok: true })).toBeNull()
  })

  test('refused with a reason, for a kind that shows it: off the phone at once, never sent again, the reason handed back', async () => {
    const told: string[] = []
    registerKind('appointment.create', { send: op => srv.send(op), refusedWithReason: (_op, why) => { told.push(why) } })
    srv.answer(() => ({ ok: false, status: 400, error: FRIDAY, code: 'NOT_A_CREW_DAY' }))
    await startOutbox('u1', { storage: store })
    await enqueue({ key: 'appointment:x', kind: 'appointment.create', payload: { day: '2026-10-30' }, label: 'Dave, install booked' })
    await settle()
    expect(told).toEqual([FRIDAY])
    expect(statusOf(['appointment:x']).status).toBe('saved')
    expect(allOps()).toEqual([])
    expect(store.map.size).toBe(0)
    expect(srv.got).toHaveLength(1)
    await retry(); await settle()
    expect(srv.got).toHaveLength(1)
  })

  test('the same kind with no signal or a busy server: kept and sent again, as before', async () => {
    const told: string[] = []
    registerKind('appointment.create', { send: op => srv.send(op), refusedWithReason: (_op, why) => { told.push(why) } })
    srv.answer(() => ({ ok: false, status: 0, error: 'Failed to fetch' }))
    await startOutbox('u1', { storage: store })
    await enqueue({ key: 'appointment:y', kind: 'appointment.create', payload: {}, label: 'Dave, install booked' })
    await settle()
    expect(statusOf(['appointment:y']).status).toBe('waiting')
    expect(store.map.size).toBe(1)
    srv.answer(() => ({ ok: false, status: 503, error: 'Service Unavailable' }))
    await retry(); await settle()
    expect(statusOf(['appointment:y']).status).toBe('waiting')
    expect(store.map.size).toBe(1)
    srv.answer(() => ({ ok: true }))
    await retry(); await settle()
    expect(statusOf(['appointment:y']).status).toBe('saved')
    expect(told).toEqual([])
  })

  test('a kind that does not show reasons keeps the old way: "Couldn\'t save", kept for Try again', async () => {
    srv.answer(() => ({ ok: false, status: 400, error: FRIDAY }))
    await startOutbox('u1', { storage: store })
    await enqueue({ key: 'customer:z', kind: 'customer.create', payload: {}, label: 'Zed' })
    await settle()
    expect(statusOf(['customer:z']).status).toBe('failed')
    expect(store.map.size).toBe(1)
  })
})
