/**
 * Who may do what (lib/permissions), without a database:
 *   - the role table, and the app's copy of it (web/src/permissions) is the same;
 *   - business state keys, the pipeline board, inventory and account documents;
 *   - the app's outbox: a change refused for the login's role is not sent
 *     again, leaves the phone, says why, and the screen goes back;
 *   - a whole record save refused for the role puts the server's copy back.
 */

import { describe, test, expect, beforeEach } from 'vitest'
import {
  can, isFullRole, REFUSAL, businessPatchRefusal, pipelineChangeRefusal, inventoryChangeRefusal, kvChangeRefusal, sameJson,
  type Action,
} from '../src/server/lib/permissions'
import { roleCan, REFUSAL as WEB_REFUSAL, type Action as WebAction } from '../../web/src/permissions'
import { _resetForTests, startOutbox, registerKind, enqueue, allOps, type Op, type OutboxStorage } from '../../web/src/outbox'
import { createVersionedDoc } from '../../web/src/versionedDoc'

const ROLES = ['super_admin', 'admin', 'manager', 'office_staff', 'sales_rep', 'field_crew', 'customer', '', 'nobody']
const ACTIONS = Object.keys(REFUSAL) as Action[]

describe('the role table', () => {
  test('the app shows exactly what the server allows', () => {
    expect(Object.keys(WEB_REFUSAL).sort()).toEqual([...ACTIONS].sort())
    for (const role of ROLES) for (const a of ACTIONS) expect(roleCan(role, a as WebAction)).toBe(can(role, a))
    for (const a of ACTIONS) expect(WEB_REFUSAL[a as WebAction]).toBe(REFUSAL[a])
  })

  test('owner and admin: everything; manager: all but users, system, deleting (Archive instead), the lists (pipeline stages, lead sources, tags) and billing amounts', () => {
    for (const a of ACTIONS) { expect(can('super_admin', a)).toBe(true); expect(can('admin', a)).toBe(true) }
    for (const a of ACTIONS) expect(can('manager', a)).toBe(!['users.manage', 'system', 'records.delete', 'lists.change', 'billing.amounts'].includes(a))
  })

  test('salesman: quotes and recording payments among the guarded actions, no costs; crew: none; office: operations, costs and warranty decisions', () => {
    expect(ACTIONS.filter(a => can('sales_rep', a)).sort()).toEqual(['payments.record', 'quotes.change', 'records.archive'])
    expect(ACTIONS.filter(a => can('field_crew', a))).toEqual([])
    expect(ACTIONS.filter(a => can('office_staff', a)).sort()).toEqual(['billing.change', 'costs.view', 'inventory.stock', 'invoices.manage', 'ops.delete', 'packets.change', 'payments.record', 'permits.change', 'quotes.change', 'records.archive', 'schedule.change', 'service.decide'])
    for (const r of ['sales_rep', 'field_crew', 'office_staff']) {
      for (const a of ['settings.change', 'lists.change', 'prices.change', 'users.manage', 'records.delete', 'automations.change', 'system'] as Action[]) expect(can(r, a)).toBe(false)
    }
    expect(can(undefined, 'quotes.change')).toBe(false)
    expect(isFullRole('manager')).toBe(true)
    expect(isFullRole('office_staff')).toBe(false)
  })

  test('every refusal is one plain sentence that says who to ask', () => {
    for (const a of ACTIONS) expect(REFUSAL[a]).toMatch(/^[A-Z][^{}<>_]*\.( Ask Jonathan\.)?$/)
  })
})

describe('business state keys', () => {
  const saved = { config: { fenceStyles: [{ name: 'A' }], voice: { onFor: ['u2'] } }, invoices: [], pullSheets: [], jobChecklists: {}, budget: {} }
  test('settings, billing and the books are refused for a salesman; an unchanged key is not a change', () => {
    expect(businessPatchRefusal('sales_rep', 'u1', saved, { config: { fenceStyles: [{ name: 'B' }], voice: { onFor: ['u2'] } } })).toBe('settings.change')
    expect(businessPatchRefusal('sales_rep', 'u1', saved, { invoices: [{ id: 'i' }] })).toBe('billing.change')
    expect(businessPatchRefusal('sales_rep', 'u1', saved, { budget: { y: 1 } })).toBe('finance.change')
    expect(businessPatchRefusal('sales_rep', 'u1', saved, { config: saved.config, pullSheets: [{ id: 'p' }], jobChecklists: { j: [] } })).toBeNull()
    expect(businessPatchRefusal('field_crew', 'u1', saved, { pullSheets: [{ id: 'p' }] })).toBe('quotes.change')
    expect(businessPatchRefusal('field_crew', 'u1', saved, { jobChecklists: { j: [{ done: true }] } })).toBeNull()
    expect(businessPatchRefusal('office_staff', 'u1', saved, { invoices: [{ id: 'i' }], pullSheets: [{ id: 'p' }] })).toBeNull()
    expect(businessPatchRefusal('office_staff', 'u1', saved, { emailTemplates: { a: 1 } })).toBe('settings.change')
    expect(businessPatchRefusal('manager', 'u1', saved, { config: {}, budget: { y: 2 } })).toBeNull()
    expect(businessPatchRefusal('sales_rep', 'u1', saved, { someNewKey: 1 })).toBe('settings.change')
  })
  test('voice on or off for themselves is the one config change a limited role makes', () => {
    expect(businessPatchRefusal('sales_rep', 'u1', saved, { config: { ...saved.config, voice: { onFor: ['u2', 'u1'] } } })).toBeNull()
    expect(businessPatchRefusal('sales_rep', 'u2', saved, { config: { ...saved.config, voice: { onFor: [] } } })).toBeNull()
    expect(businessPatchRefusal('sales_rep', 'u1', saved, { config: { ...saved.config, voice: { onFor: [] } } })).toBe('settings.change')
    expect(businessPatchRefusal('sales_rep', 'u1', saved, { config: { ...saved.config, voice: { onFor: ['u2', 'u1'], lang: 'es' } } })).toBe('settings.change')
    expect(businessPatchRefusal('sales_rep', null, saved, { config: { ...saved.config, voice: { onFor: ['u2', 'u1'] } } })).toBe('settings.change')
  })
})

describe('pipeline board', () => {
  test('adding and moving are fine; removing a card is not (the stages are Settings > Pipeline Stages, not the board)', () => {
    expect(pipelineChangeRefusal('sales_rep', { removed: [] })).toBeNull()
    expect(pipelineChangeRefusal('sales_rep', { removed: ['a'] })).toBe('records.delete')
    expect(pipelineChangeRefusal('manager', { removed: ['a'] })).toBe('records.delete')
    expect(pipelineChangeRefusal('admin', { removed: ['a'] })).toBeNull()
  })
  test('the lists (pipeline stages, lead sources, tags) are owner and admin only, and /api/kv never writes them', () => {
    for (const r of ['manager', 'office_staff', 'sales_rep', 'field_crew']) expect(can(r, 'lists.change')).toBe(false)
    expect(can('super_admin', 'lists.change') && can('admin', 'lists.change')).toBe(true)
    for (const key of ['fencepro_pipeline_stages', 'fencepro_lead_sources', 'fencepro_customer_tags']) {
      expect(kvChangeRefusal('manager', key, [], [{ id: 'x' }])).toBe('lists.change')
      expect(kvChangeRefusal('sales_rep', key, [], [{ id: 'x' }])).toBe('lists.change')
    }
  })
})

describe('inventory', () => {
  const inv = { items: [{ id: 'i1', name: 'Post', unitCost: 10, qtyOnHand: 5, reservedQty: 0 }], bundles: [], locations: [], stockLevels: [], transactions: [], kits: [{ id: 'k' }] }
  const next = (o: any) => ({ ...inv, ...o })
  test('salesman: only stock set aside for a sale', () => {
    expect(inventoryChangeRefusal('sales_rep', inv, next({ items: [{ ...inv.items[0], reservedQty: 3 }] }))).toBeNull()
    expect(inventoryChangeRefusal('sales_rep', inv, next({ items: [{ ...inv.items[0], unitCost: 9 }] }))).toBe('prices.change')
    expect(inventoryChangeRefusal('sales_rep', inv, next({ items: [{ ...inv.items[0], qtyOnHand: 9 }] }))).toBe('inventory.stock')
    // Removing a catalog item is a delete (Settings > Deleted Records): owner and admin only.
    expect(inventoryChangeRefusal('sales_rep', inv, next({ items: [] }))).toBe('records.delete')
    expect(inventoryChangeRefusal('sales_rep', inv, next({ kits: [] }))).toBe('prices.change')
    // A phone on an older build sends no kits: not a change.
    expect(inventoryChangeRefusal('sales_rep', inv, next({ kits: undefined }))).toBeNull()
    expect(inventoryChangeRefusal('sales_rep', inv, next({ transactions: [{ id: 't' }] }))).toBe('inventory.stock')
  })
  test('office: stock yes, prices and catalog no; manager: anything', () => {
    expect(inventoryChangeRefusal('office_staff', inv, next({ items: [{ ...inv.items[0], qtyOnHand: 9, reorderPoint: 2 }], transactions: [{ id: 't' }] }))).toBeNull()
    expect(inventoryChangeRefusal('office_staff', inv, next({ items: [{ ...inv.items[0], priceUpdatedAt: '2026-10-18' }] }))).toBe('prices.change')
    expect(inventoryChangeRefusal('office_staff', inv, next({ items: [...inv.items, { id: 'i2', name: 'New', unitCost: 1 }] }))).toBe('prices.change')
    expect(inventoryChangeRefusal('manager', inv, next({ items: [...inv.items, { id: 'i2', name: 'New', unitCost: 1 }], kits: [] }))).toBeNull()
    expect(inventoryChangeRefusal('manager', inv, next({ items: [], kits: [] }))).toBe('records.delete')
    expect(inventoryChangeRefusal('admin', inv, next({ items: [], kits: [] }))).toBeNull()
  })
})

describe('account documents', () => {
  test('settings and price lists refused; removing files is for the office and up; working lists save', () => {
    expect(kvChangeRefusal('sales_rep', 'fencepro_ops_stages', [], [{ id: 'x' }])).toBe('settings.change')
    expect(kvChangeRefusal('sales_rep', 'fencepro_inv_suppliers', [], [{ id: 'x' }])).toBe('prices.change')
    expect(kvChangeRefusal('sales_rep', 'fencepro_files', [{ id: 'f1' }], [])).toBe('ops.delete')
    expect(kvChangeRefusal('office_staff', 'fencepro_files', [{ id: 'f1' }], [])).toBeNull()
    expect(kvChangeRefusal('sales_rep', 'fencepro_files', [{ id: 'f1' }], [{ id: 'f1' }, { id: 'f2' }])).toBeNull()
    expect(kvChangeRefusal('sales_rep', 'fencepro_customer_activity', [], [{ id: 'a' }])).toBeNull()
    expect(kvChangeRefusal('sales_rep', 'fencepro_siteplans', [{ id: 'p' }], null)).toBe('records.delete')
    expect(kvChangeRefusal('sales_rep', 'fencepro_ops_stages', [{ id: 'x' }], [{ id: 'x' }])).toBeNull()
  })
  test('sameJson ignores key order, treats undefined and null alike', () => {
    expect(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true)
    expect(sameJson({ a: undefined }, {})).toBe(true)
    expect(sameJson([1, 2], [2, 1])).toBe(false)
  })
})

describe('the app, when a change is refused for the role', () => {
  function phoneStorage(): OutboxStorage & { map: Map<string, Op> } {
    const map = new Map<string, Op>()
    return { map, all: async () => [...map.values()], put: async o => { map.set(o.id, JSON.parse(JSON.stringify(o))) }, remove: async id => { map.delete(id) } }
  }
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5)) }
  beforeEach(() => _resetForTests())

  test('a 403 NOT_ALLOWED is sent once, leaves the phone, and the screen is put back', async () => {
    const store = phoneStorage()
    let sent = 0
    const refused: string[] = []
    registerKind('customer.archive', {
      send: async () => { sent++; return { ok: false, status: 403, code: 'NOT_ALLOWED', error: 'Your role cannot delete records. Ask Jonathan.' } },
      refused: (_op, message) => { refused.push(message) },
    })
    await startOutbox('u1', { storage: store })
    await enqueue({ key: 'customer:a', kind: 'customer.archive', payload: { id: 'a' }, label: 'Dave removed' })
    await settle()
    expect(sent).toBe(1)
    expect(allOps()).toHaveLength(0)
    expect(store.map.size).toBe(0)
    expect(refused).toEqual(['Your role cannot delete records. Ask Jonathan.'])
  })

  test('any other 403 is kept as "Couldn\'t save", as before', async () => {
    const store = phoneStorage()
    registerKind('customer.update', { send: async () => ({ ok: false, status: 403, error: 'Your login is not linked to a company.' }) })
    await startOutbox('u1', { storage: store })
    await enqueue({ key: 'customer:a', kind: 'customer.update', payload: {}, label: 'Dave' })
    await settle()
    expect(allOps()).toHaveLength(1)
    expect(allOps()[0].state).toBe('failed')
    expect(allOps()[0].error).toBe('Your login is not linked to a company.')
  })

  test('a whole record save refused for the role takes the server copy back and says why', async () => {
    let local: any = { config: { price: 2 } }
    const server = { config: { price: 1 } }
    const doc = createVersionedDoc<any>({
      get: () => local, apply: next => { local = next },
      save: async () => ({ status: 'refused', message: 'Your role cannot change settings. Ask Jonathan.', server, version: 7 }),
    })
    doc.loaded({ config: { price: 1 } }, 6)
    const r = await doc.push()
    expect(r).toEqual({ refused: 'Your role cannot change settings. Ask Jonathan.' })
    expect(local).toEqual(server)
    expect(doc.version()).toBe(7)
    expect(await doc.push()).toBe(true)
  })
})
