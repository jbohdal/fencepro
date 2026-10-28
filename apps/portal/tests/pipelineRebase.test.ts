/**
 * A pipeline change waiting on the phone, put on top of a newer server board
 * (apps/web/src/pipelineRebase.ts): read again before it is sent (the server
 * moved a card itself, or another phone saved first), it keeps the server's
 * changes to its cards and puts only this phone's on top (fix/save-conflicts,
 * Oct 27 2026).
 */

import { describe, test, expect } from 'vitest'
import { cardsBefore, rebaseDelta, wireDelta, type QueuedDelta } from '../../web/src/pipelineRebase.js'
import { applyPipelineDelta, diffPipeline } from '../../web/src/pipelineDelta.js'

const card = (id: string, more: Record<string, unknown> = {}) => ({ id, firstName: 'Ann', lastName: 'Test', stage: 'Signed Contract', notes: '', ...more })

describe('a waiting pipeline change on a newer board', () => {
  test('the server moved the card (the install), this phone changed its note: both are kept', () => {
    const base = { leads: [card('a'), card('b', { stage: 'First Contact' })], stages: [] }
    const mine = { leads: [card('a', { notes: 'Gate on the left' }), card('b', { stage: 'First Contact' })], stages: [] }
    const delta = diffPipeline(base, mine)!
    const p: QueuedDelta = { ...delta, was: cardsBefore(base, delta) }
    const server = { leads: [card('a', { stage: 'Pending Start', jobId: 'j1' }), card('b', { stage: 'First Contact' })], stages: [] }
    rebaseDelta(p, server)
    const after = applyPipelineDelta(server, wireDelta(p))
    expect(after.leads[0]).toEqual(card('a', { stage: 'Pending Start', jobId: 'j1', notes: 'Gate on the left' }))
    // Read again a second time with nothing new: the same.
    rebaseDelta(p, server)
    expect(applyPipelineDelta(server, wireDelta(p)).leads[0]).toEqual(after.leads[0])
  })

  test('both changed the stage: this phone\'s move is the later action', () => {
    const base = { leads: [card('a', { stage: 'Estimating' })], stages: [] }
    const mine = { leads: [card('a', { stage: 'Pending Signature' })], stages: [] }
    const delta = diffPipeline(base, mine)!
    const p: QueuedDelta = { ...delta, was: cardsBefore(base, delta) }
    rebaseDelta(p, { leads: [card('a', { stage: 'Appointment', nextVisit: 'Tue' })], stages: [] })
    expect(p.upsert[0].lead).toEqual(card('a', { stage: 'Pending Signature', nextVisit: 'Tue' }))
  })

  test('a new card, a change from before this fix (no `was`), and the server unchanged are left as they are', () => {
    const base = { leads: [card('a')], stages: [] }
    const mine = { leads: [card('n', { stage: 'First Contact' }), card('a')], stages: [] }
    const delta = diffPipeline(base, mine)!
    const p: QueuedDelta = { ...delta, was: cardsBefore(base, delta) }
    expect(p.was).toEqual({})
    const before = JSON.stringify(p)
    rebaseDelta(p, { leads: [card('a', { stage: 'Job Prep' })], stages: [] })
    expect(JSON.stringify(p)).toBe(before)
    const old: QueuedDelta = { upsert: [{ lead: card('a', { notes: 'x' }) }], remove: [] }
    rebaseDelta(old, { leads: [card('a', { stage: 'Job Prep' })], stages: [] })
    expect(old.upsert[0].lead).toEqual(card('a', { notes: 'x' }))
  })

  test('`was` stays on the phone: what is sent has only the change', () => {
    const p: QueuedDelta = { upsert: [{ lead: card('a') }], remove: ['z'], was: { a: card('a', { notes: 'old' }) } }
    expect(wireDelta(p)).toEqual({ upsert: [{ lead: card('a') }], remove: ['z'] })
    expect(p.was).toBeDefined()
  })
})
