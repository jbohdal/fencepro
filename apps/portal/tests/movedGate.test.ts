/**
 * The builder's Save window and a quote moved while the builder was open (review, Oct 30 2026: Save notes, Change
 * customer, New Customer, Save quote made a customer "Gina" with 0 quotes before the save found the quote was moved).
 * web movedGate.ts, used by QuoteBuilder.tsx: the window does not open, and no customer is made or picked.
 */
import { describe, test, expect } from 'vitest'
import { saveGate, gatedOnce, type StillMine } from '../../web/src/movedGate'

const answers = (map: Record<string, 'mine' | 'moved' | 'unknown'>) => {
  const asked: string[] = []
  const check: StillMine = async id => { asked.push(id); return map[id] ?? 'unknown' }
  return { asked, check }
}

describe('the Save window of a quote the owner moved while the builder was open', () => {
  test('the Salesman\'s moved quote: the window does not open and the New Customer save makes no customer', async () => {
    const srv = answers({ q1: 'moved' })
    const gate = saveGate({ isSalesman: true, quoteId: 'q1', check: srv.check })
    // Tapping Save notes / Update quote: the window would open only on true.
    expect(await gate()).toBe(false)
    // Already open (opened a moment before the move): its Save quote asks again; the customer is never made.
    let customersMade = 0
    const submit = gatedOnce(gate, () => { customersMade++ })
    expect(await submit()).toBe(false)
    expect(customersMade).toBe(0)
    expect(srv.asked).toEqual(['q1', 'q1'])
  })

  test('still hers, or no signal: the window opens and the save goes once, even tapped twice', async () => {
    for (const answer of ['mine', 'unknown'] as const) {
      const srv = answers({ q1: answer })
      const gate = saveGate({ isSalesman: true, quoteId: 'q1', check: srv.check })
      expect(await gate()).toBe(true)
      let made = 0
      const submit = gatedOnce(gate, () => { made++ })
      const [a, b] = await Promise.all([submit(), submit()])
      expect([a, b].filter(Boolean)).toHaveLength(1)
      expect(made).toBe(1)
    }
  })

  test('a new quote, or another login: nothing is asked', async () => {
    const srv = answers({})
    expect(await saveGate({ isSalesman: true, quoteId: null, check: srv.check })()).toBe(true)
    expect(await saveGate({ isSalesman: false, quoteId: 'q1', check: srv.check })()).toBe(true)
    expect(srv.asked).toEqual([])
  })
})
