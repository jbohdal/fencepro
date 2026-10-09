/**
 * Three way merge used when a whole record save is refused as out of date.
 */
import { describe, test, expect } from 'vitest'
import { merge3, deepEqual } from '../../web/src/merge3'

const lead = (id: string, over: Record<string, unknown> = {}) => ({ id, firstName: id.toUpperCase(), lastName: 'Test', stage: 'First Contact', quotePrice: 0, ...over })

describe('merge3', () => {
  test('changes to different records both survive (the pipeline case)', () => {
    const base = { leads: [lead('a'), lead('b'), lead('c')], stages: ['First Contact', 'Estimating'] }
    const mine = { ...base, leads: [lead('a', { stage: 'Estimating' }), lead('b'), lead('c')] }           // I moved A
    const theirs = { ...base, leads: [lead('a'), lead('b'), lead('c', { quotePrice: 7109.03 }), lead('d')] } // they repriced C and added D
    const { merged, problems } = merge3(base, mine, theirs)
    expect(problems).toEqual([])
    expect(merged.leads.map(l => l.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(merged.leads[0].stage).toBe('Estimating')
    expect(merged.leads[2].quotePrice).toBe(7109.03)
  })

  test('different fields of the same record both survive', () => {
    const base = { leads: [lead('a')] }
    const mine = { leads: [lead('a', { stage: 'Appointment' })] }
    const theirs = { leads: [lead('a', { quotePrice: 500 })] }
    expect(merge3(base, mine, theirs).merged.leads[0]).toMatchObject({ stage: 'Appointment', quotePrice: 500 })
  })

  test('the same field changed on both sides: mine goes on top', () => {
    const base = { leads: [lead('a')] }
    const { merged, problems } = merge3(base, { leads: [lead('a', { stage: 'Appointment' })] }, { leads: [lead('a', { stage: 'Lost Sale' })] })
    expect(merged.leads[0].stage).toBe('Appointment')
    expect(problems).toEqual([])
  })

  test('my new record and their new record are both kept, mine where I put it', () => {
    const base = { leads: [lead('a')] }
    const front = merge3(base, { leads: [lead('new'), lead('a')] }, { leads: [lead('a'), lead('z')] }).merged
    expect(front.leads.map(l => l.id)).toEqual(['new', 'a', 'z'])
    const back = merge3(base, { leads: [lead('a'), lead('new')] }, { leads: [lead('a'), lead('z')] }).merged
    expect(back.leads.map(l => l.id)).toEqual(['a', 'z', 'new'])
  })

  test('my delete and their delete both stick', () => {
    const base = { leads: [lead('a'), lead('b'), lead('c')] }
    const merged = merge3(base, { leads: [lead('b'), lead('c')] }, { leads: [lead('a'), lead('b')] }).merged
    expect(merged.leads.map(l => l.id)).toEqual(['b'])
  })

  test('an edit to a record the other side deleted is reported, not resurrected', () => {
    const base = { leads: [lead('a'), lead('b')] }
    const { merged, problems } = merge3(base, { leads: [lead('a', { stage: 'Appointment' }), lead('b')] }, { leads: [lead('b')] })
    expect(merged.leads.map(l => l.id)).toEqual(['b'])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('"A Test"')
    expect(problems[0]).toContain('deleted on another device')
  })

  test('plain lists merge by additions and removals', () => {
    const base = { stages: ['First Contact', 'Estimating', 'Lost Sale'] }
    const merged = merge3(base, { stages: ['First Contact', 'Estimating', 'Lost Sale', 'Warranty'] }, { stages: ['First Contact', 'Site Visit', 'Estimating'] }).merged
    expect(merged.stages).toEqual(['First Contact', 'Site Visit', 'Estimating', 'Warranty'])
  })

  test('objects keyed by id merge key by key (job checklists, settings)', () => {
    const base = { jobChecklists: { j1: [{ id: 'x', done: false }] }, settings: { a: 1, b: 2 } }
    const mine = { jobChecklists: { j1: [{ id: 'x', done: true }] }, settings: { a: 1, b: 3 } }
    const theirs = { jobChecklists: { j1: [{ id: 'x', done: false }], j2: [{ id: 'y', done: false }] }, settings: { a: 9, b: 2 } }
    const merged = merge3(base, mine, theirs).merged
    expect(merged.jobChecklists.j1[0].done).toBe(true)
    expect(merged.jobChecklists.j2).toBeDefined()
    expect(merged.settings).toEqual({ a: 9, b: 3 })
  })

  test('stock levels merge per item and location even without an id', () => {
    const s = (itemId: string, quantity: number) => ({ itemId, locationId: 'yard', quantity })
    const merged = merge3({ stockLevels: [s('a', 1), s('b', 1)] }, { stockLevels: [s('a', 5), s('b', 1)] }, { stockLevels: [s('a', 1), s('b', 9)] }).merged
    expect(merged.stockLevels).toEqual([s('a', 5), s('b', 9)])
  })

  test('inventory: a cost I edited and an item they added', () => {
    const item = (id: string, unitCost: number) => ({ id, name: id, unitCost, category: 'Misc' })
    const base = { items: [item('donut', 4.12), item('pipe', 34.99)] }
    const merged = merge3(base, { items: [item('donut', 4.5), item('pipe', 34.99)] }, { items: [item('donut', 4.12), item('pipe', 34.99), item('cap', 1.5)] }).merged
    expect(merged.items).toEqual([item('donut', 4.5), item('pipe', 34.99), item('cap', 1.5)])
  })

  test('nothing of mine changed: the result is exactly theirs', () => {
    const base = { leads: [lead('a')] }
    const theirs = { leads: [lead('a', { stage: 'Appointment' }), lead('b')] }
    expect(deepEqual(merge3(base, base, theirs).merged, theirs)).toBe(true)
  })

  test('a list that cannot be split item by item falls back to mine on top', () => {
    const merged = merge3({ runs: [10, 10] }, { runs: [10, 10, 5] }, { runs: [10, 10, 8] }).merged
    expect(merged.runs).toEqual([10, 10, 5])
  })

  test('a whole value replaced (cloud storage key) on one side only', () => {
    expect(merge3<unknown>(null, [{ id: 'f1' }], null).merged).toEqual([{ id: 'f1' }])
    expect(merge3<unknown>([{ id: 'f1' }], [{ id: 'f1' }], [{ id: 'f1' }, { id: 'f2' }]).merged).toEqual([{ id: 'f1' }, { id: 'f2' }])
  })
})
