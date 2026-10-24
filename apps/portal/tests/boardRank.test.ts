/**
 * Manual order on the sales pipeline: a drop saves only the dropped card's new position.
 */
import { describe, test, expect } from 'vitest'
import { byManualOrder, ranksForDrop, RANK_STEP, type RankedCard } from '../../web/src/boardRank'

const S = 'No Answer'
const placed = (id: string, rank: number): RankedCard => ({ id, stage: S, boardOrder: { stage: S, rank } })
const fresh = (id: string, createdAt: string): RankedCard => ({ id, stage: S, createdAt })

/** Apply the saved numbers and read the stage back in manual order. */
function orderAfter(others: RankedCard[], moved: RankedCard, at: number): { ids: string[]; changed: string[] } {
  const ranks = ranksForDrop(others, moved.id, at)
  const all = [...others, moved].map(l => ranks.has(l.id) ? { ...l, boardOrder: { stage: S, rank: ranks.get(l.id)! } } : l)
  return { ids: all.sort(byManualOrder).map(l => l.id), changed: [...ranks.keys()] }
}

describe('ranksForDrop', () => {
  // A long column like live No Answer: 1,100 placed cards.
  const long = Array.from({ length: 1100 }, (_, i) => placed(`c${i}`, i))
  const mover = fresh('m', '2026-10-01')

  test('a drop in the middle of a long column changes only the dropped card', () => {
    const r = orderAfter(long, mover, 500)
    expect(r.changed).toEqual(['m'])
    expect(r.ids.indexOf('m')).toBe(500)
    expect(r.ids[499]).toBe('c499'); expect(r.ids[501]).toBe('c500')
  })

  test('top and bottom of the column are single card saves too', () => {
    expect(orderAfter(long, mover, 0)).toMatchObject({ changed: ['m'] })
    expect(orderAfter(long, mover, 0).ids[0]).toBe('m')
    const end = orderAfter(long, mover, 1100)
    expect(end.changed).toEqual(['m']); expect(end.ids[1100]).toBe('m')
  })

  test('an empty column', () => {
    expect(orderAfter([], mover, 0)).toEqual({ ids: ['m'], changed: ['m'] })
  })

  test('cards with no number yet: those above the drop get numbers once, the rest stay as they are', () => {
    const others = [fresh('n1', '2026-10-20'), fresh('n2', '2026-10-19'), fresh('n3', '2026-10-18'), placed('p1', 0), placed('p2', 1)]
    const r = orderAfter(others, mover, 1)
    expect(r.ids).toEqual(['n1', 'm', 'n2', 'n3', 'p1', 'p2'])
    expect(r.changed.sort()).toEqual(['m', 'n1', 'n2', 'n3'])
    // Dropped right under the cards with no number: only the card.
    const r2 = orderAfter(others, mover, 3)
    expect(r2.changed).toEqual(['m']); expect(r2.ids).toEqual(['n1', 'n2', 'n3', 'm', 'p1', 'p2'])
  })

  test('a column where nobody has placed a card yet', () => {
    const others = [fresh('n1', '2026-10-20'), fresh('n2', '2026-10-19')]
    expect(orderAfter(others, mover, 2).ids).toEqual(['n1', 'n2', 'm'])
    expect(orderAfter(others, mover, 0).ids).toEqual(['m', 'n1', 'n2'])
  })

  test('the first placed card having a zero or negative number still works', () => {
    const others = [fresh('n1', '2026-10-20'), placed('p1', -RANK_STEP * 3), placed('p2', 0)]
    expect(orderAfter(others, mover, 0).ids).toEqual(['m', 'n1', 'p1', 'p2'])
  })

  test('many drops into the same gap keep the order; when the numbers get too close the stage is numbered again', () => {
    let cards: RankedCard[] = [placed('a', 0), placed('b', 1)]
    let renumbered = 0
    for (let i = 0; i < 80; i++) {
      const id = `x${i}`
      const others = cards.slice().sort(byManualOrder)
      const at = others.findIndex(l => l.id === 'b')        // always just above b
      const ranks = ranksForDrop(others, id, at)
      if (ranks.size > 1) renumbered++
      cards = [...cards, fresh(id, '')].map(l => ranks.has(l.id) ? { ...l, boardOrder: { stage: S, rank: ranks.get(l.id)! } } : l)
      const ids = cards.slice().sort(byManualOrder).map(l => l.id)
      expect(ids[ids.length - 2]).toBe(id)
      expect(ids[ids.length - 1]).toBe('b')
      expect(ids[0]).toBe('a')
    }
    expect(renumbered).toBeGreaterThan(0)
    expect(renumbered).toBeLessThan(5)
  })
})
