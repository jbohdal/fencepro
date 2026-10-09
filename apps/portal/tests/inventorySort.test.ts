/**
 * Item Catalog display order: grouped by category, A to Z inside each group.
 */
import { describe, test, expect } from 'vitest'
import { compareItemNames, groupCatalog, NEW_ITEMS_GROUP } from '../../web/src/inventorySort'

const sorted = (names: string[]) => [...names].sort(compareItemNames)

describe('compareItemNames', () => {
  test('leading asterisks do not decide the order', () => {
    expect(sorted(['Vinyl, Tan, Cap, Gate', '*Vinyl, Gate, Brace', '**Vinyl, Donut Pin', 'Alum, Cap, 3"']))
      .toEqual(['Alum, Cap, 3"', '**Vinyl, Donut Pin', '*Vinyl, Gate, Brace', 'Vinyl, Tan, Cap, Gate'])
  })

  test('sizes sort as numbers', () => {
    expect(sorted(["Ag, Tube Gate, Galv, 4' x 10' (6GG10)", "Ag, Tube Gate, Galv, 4' x 8' (6GG8)", "Ag, Tube Gate, Galv, 4' x 4' (6GG4)"]))
      .toEqual(["Ag, Tube Gate, Galv, 4' x 4' (6GG4)", "Ag, Tube Gate, Galv, 4' x 8' (6GG8)", "Ag, Tube Gate, Galv, 4' x 10' (6GG10)"])
  })

  test('case and double spaces are ignored', () => {
    expect(sorted(["Ag, Tube Gate, Galv, 4' x 18' (6GG18)", "Ag, Tube Gate, Galv,  4' x 16' (6GG16)", 'ag, gate, hardware']))
      .toEqual(['ag, gate, hardware', "Ag, Tube Gate, Galv,  4' x 16' (6GG16)", "Ag, Tube Gate, Galv, 4' x 18' (6GG18)"])
  })
})

describe('groupCatalog', () => {
  const order = ['Vinyl White', 'Chainlink Galv', 'Misc']
  const items = [
    { id: 'a', name: 'Yard Sign', category: 'Misc' },
    { id: 'b', name: 'G, Tension Bar, 60"', category: 'Chainlink Galv' },
    { id: 'c', name: '*Vinyl, White, Rail, 8\'', category: 'Vinyl White' },
    { id: 'd', name: 'G, Tension Bar, 48"', category: 'Chainlink Galv' },
    { id: 'e', name: 'Swag Bag', category: 'Misc' },
  ]
  const filed = new Map(items.map(i => [i.id, i.name]))

  test('groups follow the category order, items A to Z inside each', () => {
    const groups = groupCatalog(items, filed, order)
    expect(groups.map(g => g.key)).toEqual(['Vinyl White', 'Chainlink Galv', 'Misc'])
    expect(groups[1].items.map(i => i.id)).toEqual(['d', 'b'])
    expect(groups[2].items.map(i => i.id)).toEqual(['e', 'a'])
  })

  test('a category that is not in the order goes last', () => {
    const groups = groupCatalog([...items, { id: 'f', name: 'Thing', category: 'Wood' }], new Map([...filed, ['f', 'Thing']]), order)
    expect(groups.map(g => g.key)).toEqual(['Vinyl White', 'Chainlink Galv', 'Misc', 'Wood'])
  })

  test('an item added since the last save comes first', () => {
    const groups = groupCatalog([...items, { id: 'n', name: 'New Item', category: 'Misc' }], filed, order)
    expect(groups[0]).toEqual({ key: NEW_ITEMS_GROUP, items: [{ id: 'n', name: 'New Item', category: 'Misc' }] })
    expect(groups[3].items.map(i => i.id)).toEqual(['e', 'a'])
  })

  test('a row keeps its place while its name is being typed', () => {
    const typing = items.map(i => i.id === 'e' ? { ...i, name: 'Zebra' } : i)
    expect(groupCatalog(typing, filed, order)[2].items.map(i => i.id)).toEqual(['e', 'a'])
    // Once saved, the new name is filed.
    expect(groupCatalog(typing, new Map(typing.map(i => [i.id, i.name])), order)[2].items.map(i => i.id)).toEqual(['a', 'e'])
  })

  test('nothing is dropped or duplicated', () => {
    const ids = groupCatalog(items, filed, order).flatMap(g => g.items.map(i => i.id)).sort()
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})
