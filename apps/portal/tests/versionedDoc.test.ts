/**
 * Two tabs saving the same whole record: neither change is lost.
 * The "server" here does exactly what the routes do: accept a save only when
 * it was built on the current version.
 */
import { describe, test, expect } from 'vitest'
import { createVersionedDoc, type SaveResult } from '../../web/src/versionedDoc'

type Pipeline = { leads: Array<{ id: string; firstName: string; stage: string; quotePrice: number }>; stages: string[] }
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v))

function makeServer(initial: Pipeline) {
  let data = copy(initial), version = 1, saves = 0, refused = 0
  return {
    read: () => ({ data: copy(data), version }),
    async save(state: Pipeline, baseVersion: number): Promise<SaveResult<Pipeline>> {
      if (baseVersion !== version) { refused++; return { status: 'stale', server: copy(data), version } }
      data = copy(state); version++; saves++
      return { status: 'saved', version }
    },
    stats: () => ({ saves, refused }),
  }
}

function makeTab(server: ReturnType<typeof makeServer>) {
  let local: Pipeline = { leads: [], stages: [] }
  const merges: string[][] = []
  const doc = createVersionedDoc<Pipeline>({
    get: () => local,
    apply: next => { local = next },
    save: (s, v) => server.save(s, v),
    onMerged: ({ problems }) => merges.push(problems),
  })
  const first = server.read(); local = first.data; doc.loaded(first.data, first.version)
  return {
    doc, merges,
    state: () => local,
    change: (fn: (p: Pipeline) => void) => { const next = copy(local); fn(next); local = next },
  }
}

const start: Pipeline = {
  leads: [
    { id: 'a', firstName: 'Christa', stage: 'First Contact', quotePrice: 0 },
    { id: 'b', firstName: 'Shawn', stage: 'Signed Contract', quotePrice: 7327.49 },
    { id: 'c', firstName: 'Damian', stage: 'Signed Contract', quotePrice: 14109.96 },
  ],
  stages: ['First Contact', 'Estimating', 'Signed Contract', 'Paid & Closed'],
}

describe('two tabs, one record', () => {
  test('A saves, then B saves a different change without reloading: both survive', async () => {
    const server = makeServer(start)
    const A = makeTab(server), B = makeTab(server)

    A.change(p => { p.leads[1].quotePrice = 7109.03; p.leads[2].stage = 'Paid & Closed'; p.leads.push({ id: 'd', firstName: 'Ryan', stage: 'Signed Contract', quotePrice: 8532.51 }) })
    expect(await A.doc.push()).toBe(true)

    B.change(p => { p.leads[0].stage = 'Estimating' })          // B still holds the old copy
    expect(await B.doc.push()).toBe(true)

    const final = server.read().data
    expect(final.leads.map(l => l.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(final.leads[0].stage).toBe('Estimating')              // B's change
    expect(final.leads[1].quotePrice).toBe(7109.03)              // A's changes
    expect(final.leads[2].stage).toBe('Paid & Closed')
    expect(server.stats()).toEqual({ saves: 2, refused: 1 })
    expect(B.state()).toEqual(final)                             // B now shows A's changes too
    expect(B.merges).toEqual([[]])                               // merged once, nothing lost
  })

  test('the old behaviour (B overwrites A) cannot happen', async () => {
    const server = makeServer(start)
    const A = makeTab(server), B = makeTab(server)
    A.change(p => { p.leads.push({ id: 'd', firstName: 'Ryan', stage: 'Signed Contract', quotePrice: 8532.51 }) })
    await A.doc.push()
    B.change(p => { p.leads[0].stage = 'Estimating' })
    await B.doc.push()
    expect(server.read().data.leads.some(l => l.id === 'd')).toBe(true)
  })

  test('back and forth: each tab keeps saving on top of the other', async () => {
    const server = makeServer(start)
    const A = makeTab(server), B = makeTab(server)
    A.change(p => { p.leads[0].stage = 'Estimating' }); await A.doc.push()
    B.change(p => { p.leads[1].quotePrice = 1 }); await B.doc.push()
    A.change(p => { p.leads[2].quotePrice = 2 }); await A.doc.push()
    B.change(p => { p.stages.push('Warranty') }); await B.doc.push()
    expect(server.read().data).toEqual({
      leads: [
        { id: 'a', firstName: 'Christa', stage: 'Estimating', quotePrice: 0 },
        { id: 'b', firstName: 'Shawn', stage: 'Signed Contract', quotePrice: 1 },
        { id: 'c', firstName: 'Damian', stage: 'Signed Contract', quotePrice: 2 },
      ],
      stages: ['First Contact', 'Estimating', 'Signed Contract', 'Paid & Closed', 'Warranty'],
    })
  })

  test('an edit to a card the other tab deleted is reported plainly', async () => {
    const server = makeServer(start)
    const A = makeTab(server), B = makeTab(server)
    A.change(p => { p.leads = p.leads.filter(l => l.id !== 'a') }); await A.doc.push()
    B.change(p => { p.leads[0].stage = 'Estimating' })
    expect(await B.doc.push()).toBe(true)
    expect(server.read().data.leads.map(l => l.id)).toEqual(['b', 'c'])
    expect(B.merges[0][0]).toContain('deleted on another device')
  })

  test('nothing changed locally sends nothing', async () => {
    const server = makeServer(start)
    const A = makeTab(server)
    expect(await A.doc.push()).toBe(true)
    expect(server.stats().saves).toBe(0)
  })

  test('a save that cannot reach the server reports failure and keeps the change', async () => {
    let local = copy(start)
    const doc = createVersionedDoc<Pipeline>({ get: () => local, apply: n => { local = n }, save: async () => ({ status: 'failed' }) })
    doc.loaded(copy(start), 1)
    local.leads[0].stage = 'Estimating'
    expect(await doc.push()).toBe(false)
    expect(local.leads[0].stage).toBe('Estimating')
  })

  test('an edit made while a save is in flight is sent in the next round', async () => {
    const server = makeServer(start)
    let local = server.read().data
    const doc = createVersionedDoc<Pipeline>({
      get: () => local, apply: n => { local = n },
      save: async (s, v) => { const r = await server.save(s, v); if (server.stats().saves === 1) { local = copy(local); local.leads[1].quotePrice = 99 } return r },
    })
    doc.loaded(local, 1)
    local = copy(local); local.leads[0].stage = 'Estimating'
    expect(await doc.push()).toBe(true)
    expect(server.read().data.leads[1].quotePrice).toBe(99)
    expect(server.stats().saves).toBe(2)
  })
})
