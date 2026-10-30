/**
 * A Salesman's save that carries an entry not hers to send (reviewer, Oct 30 2026): the server used to refuse the
 * whole save (404); the phone kept it in its outbox and sent it again every few seconds, even after a reload, and
 * every later save of hers was merged into it and never reached the server. Now:
 *   - the server leaves that entry out and saves the rest (lib/salesScopeRecords.ts, `leftOut`);
 *   - a new entry for a quote she wrote or a customer she entered is taken (her pull sheet for a quote she just
 *     wrote for another Salesman's new customer);
 *   - the phone takes the server's copy as saved, so the entry leaves its copy and is never sent again, and her
 *     later saves go through (web versionedDoc.ts).
 * Without a database.
 */
import { describe, test, expect } from 'vitest'
import { buildSalesScope } from '../src/server/lib/salesScope.js'
import { mergeListWithKeys, mergeByKeyWithKeys, salesBusinessPatch, salesBusinessView, addableOutside } from '../src/server/lib/salesScopeRecords.js'
import { createVersionedDoc, type SaveResult } from '../../web/src/versionedDoc'

const me = 'u-christa'
const scope = buildSalesScope({
  userId: me, accountId: 'acc', names: ['Christa Feagin', 'Christa'],
  contacts: [
    { id: 'c-mine', ownerId: me, salesRep: 'Christa Feagin' },
    { id: 'c-tia', ownerId: me, salesRep: 'Christa Feagin' },
    // Sam's new customer, entered by Christa on her quote's Save (the Salesman choice).
    { id: 'c-for-sam', ownerId: me, salesRep: 'Sam Other' },
    { id: 'c-owner', ownerId: 'u-owner', salesRep: 'Jonathan Bohdal' },
  ],
  quotes: [
    { id: 'q-mine', ownerId: me, salesRep: 'Christa Feagin', crmContactId: 'c-mine' },
    { id: 'q-tia', ownerId: me, salesRep: 'Christa Feagin', crmContactId: 'c-tia' },
    { id: 'q-for-sam', ownerId: me, salesRep: 'Sam Other', crmContactId: 'c-for-sam' },
    { id: 'q-owner', ownerId: 'u-owner', salesRep: 'Jonathan Bohdal', crmContactId: 'c-owner' },
  ],
  jobs: [{ id: 'j-owner', quoteId: 'q-owner', crmContactId: 'c-owner', salesRep: 'Jonathan Bohdal' }],
  cards: [], appointments: [],
})
const had = (keys: string[]) => ({ sure: new Set(keys), seen: new Set(keys) })
const ps = (id: string, customerId: string, quoteId: string, extra: Record<string, unknown> = {}) => ({ id, customerId, quoteId, versionNumber: 1, ...extra })

describe('the server: an entry not hers to send is left out, the rest is saved', () => {
  test('a new entry for someone else\'s customer is left out; her own change goes through', () => {
    const stored = [ps('ps-owner', 'c-owner', 'q-owner'), ps('ps-mine', 'c-mine', 'q-mine')]
    const sent = [ps('ps-sneak', 'c-owner', 'q-owner'), ps('ps-mine', 'c-mine', 'q-mine', { versionNumber: 2 })]
    const m = mergeListWithKeys(scope, stored, sent, { had: had(['id:ps-mine']) })
    expect(m.leftOut).toBe(1)
    expect(m.value).toEqual([ps('ps-owner', 'c-owner', 'q-owner'), ps('ps-mine', 'c-mine', 'q-mine', { versionNumber: 2 })])
  })

  test('a change to an entry she does not see is left out and the stored one stays, even one she held before (scope shrank)', () => {
    const stored = [ps('ps-owner', 'c-owner', 'q-owner'), ps('ps-mine', 'c-mine', 'q-mine')]
    // The phone sends the owner's entry changed, and leaves its own out (a removal it may make).
    const m = mergeListWithKeys(scope, stored, [ps('ps-owner', 'c-owner', 'q-owner', { notes: 'x' })], { had: had(['id:ps-owner', 'id:ps-mine']) })
    expect(m.value).toEqual([ps('ps-owner', 'c-owner', 'q-owner')])
    // Her own entry pointed at someone else's customer: left out, her stored one is not removed.
    const m2 = mergeListWithKeys(scope, stored, [ps('ps-mine', 'c-owner', 'q-owner')], { had: had(['id:ps-mine']) })
    expect(m2.leftOut).toBe(1)
    expect(m2.value).toEqual(stored)
  })

  test('a NEW entry for the quote she just wrote for Sam\'s new customer is taken (written, never read back)', () => {
    expect(addableOutside(scope, ps('ps-for-sam', 'c-for-sam', 'q-for-sam'))).toBe(true)
    expect(addableOutside(scope, ps('x', 'c-owner', 'q-for-sam'))).toBe(false)
    expect(addableOutside(scope, ps('x', 'c-for-sam', 'q-owner'))).toBe(false)
    expect(addableOutside(scope, { id: 'x', jobId: 'j-owner', quoteId: 'q-for-sam' })).toBe(false)
    const m = mergeListWithKeys(scope, [], [ps('ps-for-sam', 'c-for-sam', 'q-for-sam')], {})
    expect([m.leftOut, (m.value as any[]).map(e => e.id)]).toEqual([0, ['ps-for-sam']])
    // ...and she does not read it back, nor change it later.
    expect(salesBusinessView(scope, { pullSheets: m.value }).pullSheets).toEqual([])
    const later = mergeListWithKeys(scope, m.value, [ps('ps-for-sam', 'c-for-sam', 'q-for-sam', { notes: 'changed' })], {})
    expect(later.value).toEqual(m.value)
  })

  test('a job checklist of someone else\'s job is left out, not a refusal', () => {
    const m = mergeByKeyWithKeys(scope, {}, { 'j-owner': [{ id: 'm1' }] })
    expect([m.leftOut, m.value]).toEqual([1, {}])
  })

  test('the whole business patch: the pull sheet for Sam\'s quote, a sneak entry and Tia\'s pull sheet, at once', () => {
    const saved = { pullSheets: [ps('ps-owner', 'c-owner', 'q-owner')], pendingOrders: [] }
    const r = salesBusinessPatch(scope, saved, {
      pullSheets: [ps('ps-for-sam', 'c-for-sam', 'q-for-sam'), ps('ps-tia', 'c-tia', 'q-tia')],
      pendingOrders: [{ id: 'so-sneak', customerId: 'c-owner', quoteId: 'q-owner' }],
    }, { sure: new Map(), seen: new Map() })
    expect(r.leftOut).toBe(1)
    expect((r.patch.pullSheets as any[]).map(e => e.id).sort()).toEqual(['ps-for-sam', 'ps-owner', 'ps-tia'])
    expect(r.patch.pendingOrders).toEqual([])
  })
})

describe('the phone: a save with an entry left out does not stick, and her later saves go through', () => {
  type Doc = { pullSheets: Array<{ id: string; customerId: string }> }
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v))
  function server(initial: Doc) {
    let data = copy(initial), version = 1, calls = 0
    const allowed = (e: { customerId: string }) => e.customerId !== 'c-owner'
    return {
      data: () => data, calls: () => calls,
      async save(state: Doc, v: number): Promise<SaveResult<Doc>> {
        calls++
        if (v !== version) return { status: 'stale', server: copy(data), version }
        const keep = state.pullSheets.filter(allowed)
        const leftOut = state.pullSheets.length - keep.length
        data = { pullSheets: keep }; version++
        return leftOut ? { status: 'saved', version, server: copy(data), leftOut } : { status: 'saved', version }
      },
    }
  }

  test('the stuck entry leaves the phone\'s copy after one save; Tia\'s pull sheet, saved after, reaches the server', async () => {
    const srv = server({ pullSheets: [{ id: 'ps-mine', customerId: 'c-mine' }] })
    // The phone holds, from before, a pull sheet it may not send (as the stuck outbox copy held it).
    let local: Doc = { pullSheets: [{ id: 'ps-stuck', customerId: 'c-owner' }, { id: 'ps-mine', customerId: 'c-mine' }] }
    const told: number[] = []
    const doc = createVersionedDoc<Doc>({ get: () => local, apply: n => { local = n }, save: (s, v) => srv.save(s, v), onLeftOut: n => told.push(n) })
    doc.loaded({ pullSheets: [{ id: 'ps-mine', customerId: 'c-mine' }] }, 1)
    expect(await doc.push()).toBe(true)
    expect(told).toEqual([1])
    expect(local.pullSheets.map(e => e.id)).toEqual(['ps-mine'])
    // Her own new customer Tia's pull sheet, made after.
    local = { pullSheets: [{ id: 'ps-tia', customerId: 'c-tia' }, ...local.pullSheets] }
    expect(await doc.push()).toBe(true)
    expect(srv.data().pullSheets.map(e => e.id)).toEqual(['ps-tia', 'ps-mine'])
    // Nothing left to send: no more calls.
    const n = srv.calls()
    expect(await doc.push()).toBe(true)
    expect(srv.calls()).toBe(n)
  })
})
