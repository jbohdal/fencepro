/**
 * The rules that keep one copy of everything made by itself, without a
 * database: lists keep one entry per id, a job's checklist one item per
 * milestone, one kit set in use per style, and a job's default checklist has
 * the same ids every time it is made (the web app uses the same formula).
 */

import { describe, test, expect } from 'vitest'
import { oneById, requestIdOf } from '../src/server/lib/once.js'
import { DEFAULT_MILESTONES, defaultChecklist, milestoneId, milestoneLabels, normalizeBusinessField, oneActiveKitPerStyle, oneChecklistPerJob } from '../src/server/lib/seeds.js'

describe('one entry per id', () => {
  test('a repeated id keeps one entry, the later one in the first one\'s place', () => {
    const out = oneById([{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'a', v: 2 }])
    expect(out).toEqual([{ id: 'a', v: 2 }, { id: 'b', v: 1 }])
  })
  test('nothing repeated: the same list back; entries without an id are kept', () => {
    const list = [{ id: 'a' }, { name: 'no id' }, 'plain']
    expect(oneById(list)).toBe(list)
  })
  test('business state lists are kept one per id; other fields untouched', () => {
    expect(normalizeBusinessField('payments', [{ id: 'p1', amountCents: 500 }, { id: 'p1', amountCents: 500 }])).toEqual([{ id: 'p1', amountCents: 500 }])
    expect(normalizeBusinessField('config', { a: 1 })).toEqual({ a: 1 })
  })
})

describe('a job\'s checklist', () => {
  test('made twice: the same ids, one per milestone', () => {
    const a = defaultChecklist('job-1', DEFAULT_MILESTONES, 'x')
    const b = defaultChecklist('job-1', DEFAULT_MILESTONES, 'x')
    expect(a).toEqual(b)
    expect(a.map(i => i.id)).toContain(milestoneId('job-1', 'Locate Complete'))
    expect(new Set(a.map(i => i.id)).size).toBe(DEFAULT_MILESTONES.length)
  })
  test('the ids are the formula the web app uses', () => {
    expect(milestoneId('abc', 'Permit Approved')).toBe('m:abc:permit-approved')
  })
  test('a milestone listed twice in Settings is one item', () => {
    expect(defaultChecklist('j', ['Locate Complete', 'locate complete', 'Job Started'])).toHaveLength(2)
    expect(milestoneLabels([])).toEqual(DEFAULT_MILESTONES)
  })
  test('two phones\' lists with different ids collapse by milestone, done if either was', () => {
    const phoneA = defaultChecklist('j', ['Locate Complete', 'Job Started']).map(i => ({ ...i, id: `a-${i.sortOrder}` }))
    const phoneB = defaultChecklist('j', ['Locate Complete', 'Job Started']).map(i => ({ ...i, id: `b-${i.sortOrder}`, isComplete: i.label === 'Job Started' }))
    const out = oneChecklistPerJob({ j: [...phoneA, ...phoneB] }) as Record<string, any[]>
    expect(out.j).toHaveLength(2)
    expect(out.j.find(i => i.label === 'Job Started')!.isComplete).toBe(true)
  })
})

describe('material kits', () => {
  test('two sets in use for one style: the second is archived, not lost', () => {
    const out = oneActiveKitPerStyle([
      { id: 'k1', styleName: 'WV-ND 6x8 Privacy' },
      { id: 'k2', styleName: 'WV-ND 6x8 Privacy' },
      { id: 'k3', styleName: 'WV-ND 6x8 Privacy', archived: true },
      { id: 'k4', styleName: null },
    ])
    expect(out.filter((k: any) => k.styleName === 'WV-ND 6x8 Privacy' && !k.archived).map(k => k.id)).toEqual(['k1'])
    expect(out).toHaveLength(4)
  })
  test('the same set sent twice is one set', () => {
    expect(oneActiveKitPerStyle([{ id: 'k1', styleName: 'A' }, { id: 'k1', styleName: 'A' }])).toHaveLength(1)
  })
})

test('a request id is taken only when it is a plain id', () => {
  expect(requestIdOf({ body: { clientId: 'abcdef12-3456' } })).toBe('abcdef12-3456')
  expect(requestIdOf({ body: { id: 'short' } })).toBeUndefined()
  expect(requestIdOf({ body: { clientId: 'bad id with spaces' } })).toBeUndefined()
  expect(requestIdOf({})).toBeUndefined()
})
