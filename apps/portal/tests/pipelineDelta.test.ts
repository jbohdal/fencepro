/**
 * Saving the pipeline card by card: the change the browser sends, applied by
 * the server, gives exactly the pipeline the browser holds, and stays small
 * however many cards there are.
 */
import { describe, test, expect } from 'vitest'
import { diffPipeline, applyPipelineDelta as applyInBrowser, type PipelineDoc } from '../../web/src/pipelineDelta'
import { applyPipelineDelta as applyOnServer } from '../src/server/lib/pipelineDelta'
import { createVersionedDoc, type SaveResult } from '../../web/src/versionedDoc'

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const card = (i: number, stage = 'Lost Sale') => ({
  id: `card-${i}`, customerId: `customer-${i}`, firstName: 'First' + i, lastName: 'Last' + i, phone: '(352) 555-0100',
  email: `person${i}@example.com`, address: `${i} Main St, Ocala, FL 34471`, stage, quotePrice: 0, jobValue: 0,
  notes: 'From JobNimbus: status Lost.', createdAt: '2023-01-01', lastMoved: '2023-01-01',
})
const big = (): PipelineDoc => ({ leads: Array.from({ length: 1800 }, (_, i) => card(i)), stages: ['First Contact', 'Appointment', 'Lost Sale'] })

/** Both copies of "apply" must agree, and land on what the browser holds. */
function roundTrip(base: PipelineDoc, next: PipelineDoc) {
  const delta = diffPipeline(base, next)
  expect(delta).not.toBeNull()
  expect(applyOnServer(copy(base), copy(delta!))).toEqual(next)
  expect(applyInBrowser(copy(base), copy(delta!))).toEqual(next)
  return delta!
}

describe('pipeline saved card by card', () => {
  test('moving one card sends that card only', () => {
    const base = big(), next = copy(base)
    next.leads[900] = { ...next.leads[900], stage: 'Appointment', lastMoved: '2026-10-13' }
    const delta = roundTrip(base, next)
    expect(delta.upsert.map(u => u.lead.id)).toEqual(['card-900'])
    expect(delta.remove).toEqual([])
    expect(delta.stages).toBeUndefined()
    expect(JSON.stringify(delta).length).toBeLessThan(1000)
    expect(JSON.stringify(next).length).toBeGreaterThan(400_000)
  })

  test('placing a card by hand sends only the cards whose position changed', () => {
    const base = big(), next = copy(base)
    for (const i of [3, 4, 5]) (next.leads[i] as any).boardOrder = { stage: 'Lost Sale', rank: i }
    expect(roundTrip(base, next).upsert).toHaveLength(3)
  })

  test('new cards keep their place: at the front, in the middle, at the end', () => {
    const base = big(), next = copy(base)
    next.leads.unshift(card(9001, 'First Contact'), card(9002, 'First Contact'))
    next.leads.splice(700, 0, card(9003))
    next.leads.push(card(9004))
    const delta = roundTrip(base, next)
    expect(delta.upsert).toHaveLength(4)
  })

  test('removing a card, changing a card and the stage list, all at once', () => {
    const base = big(), next = copy(base)
    next.leads.splice(10, 1)
    next.leads[20].notes = 'called back'
    next.stages = [...next.stages, 'No Answer']
    const delta = roundTrip(base, next)
    expect(delta.remove).toEqual(['card-10'])
    expect(delta.stages).toEqual(next.stages)
  })

  test('no change is an empty change', () => {
    const delta = roundTrip(big(), big())
    expect(delta).toEqual({ upsert: [], remove: [] })
  })

  test('what cannot be said card by card falls back to a whole save', () => {
    const base = big()
    const reordered = copy(base); reordered.leads.reverse()
    expect(diffPipeline(base, reordered)).toBeNull()
    const noId = copy(base); delete (noId.leads[5] as any).id
    expect(diffPipeline(base, noId)).toBeNull()
    const twin = copy(base); twin.leads[6].id = twin.leads[7].id
    expect(diffPipeline(base, twin)).toBeNull()
  })

  test('two tabs: the second is refused, merged and saved, still card by card', async () => {
    let data = big(), version = 1
    const sent: number[] = []
    const save = async (state: PipelineDoc, baseVersion: number, base: PipelineDoc): Promise<SaveResult<PipelineDoc>> => {
      const delta = diffPipeline(base, state)!
      sent.push(JSON.stringify(delta).length)
      if (baseVersion !== version) return { status: 'stale', server: copy(data), version }
      data = applyOnServer(data, copy(delta)); version++
      return { status: 'saved', version }
    }
    const tab = () => {
      let local = copy(data)
      const doc = createVersionedDoc<PipelineDoc>({ get: () => local, apply: n => { local = n }, save })
      doc.loaded(copy(data), version)
      return { doc, edit: (f: (d: PipelineDoc) => void) => f(local), read: () => local }
    }
    const a = tab(), b = tab()
    a.edit(d => { d.leads[1].stage = 'Appointment' })
    b.edit(d => { d.leads[2].stage = 'First Contact' })
    expect(await a.doc.push()).toBe(true)
    expect(await b.doc.push()).toBe(true)
    expect(data.leads[1].stage).toBe('Appointment')
    expect(data.leads[2].stage).toBe('First Contact')
    expect(b.read()).toEqual(data)
    expect(Math.max(...sent)).toBeLessThan(1000)
  })
})
