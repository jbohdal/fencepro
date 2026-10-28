/**
 * Real green prices for the parts priced from Black (lib/greenRealPrices.ts,
 * Jonathan Oct 27 2026), and the "From Black" follow rule and quote warning
 * (web/src/priceAge.ts followBorrowedPrices, borrowedPartsOnQuote).
 *
 * The documents here are the printed numbers of Stephens 06-251707 (Oct 26
 * 2026: no tax printed, $125 freight, $25 fuel) and 06-120125 (Jul 13 2023:
 * 7% tax $102.05 printed, $100 freight, $15 fuel, as the reader reads it since
 * Oct 28: tests/stephensLayouts.test.ts), cut to the lines that matter plus one
 * line for the rest, so their totals are the printed ones. The last test reads
 * 06-120125 from its words (tests/fixtures/stephens) the whole way.
 */

import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { greenRuleFor, docLanded, greenLinesOf, planGreenRealPrices, type Doc } from '../src/server/lib/greenRealPrices'
import { FROM_BLACK_WORDS } from '../src/server/lib/greenChainLink'
import { followBorrowedPrices, borrowedPartsOnQuote, borrowedPrice, priceAgeLabel, stampPriceChanges } from '../../web/src/priceAge'

const line = (description: string, qty: number, unit: string, priceHc: number, totalCents: number) => ({ description, qty, unit, unitPriceHc: priceHc, totalCents })

const from = (part: string, cents: number) => ({ part, cents, on: '2026-10-27', words: FROM_BLACK_WORDS })
const ITEMS = () => [
  { id: 'g45', name: `Chainlink, Green, Gate, 1-3/8", 4' x 5' (.065)`, unitCost: 133.69, category: 'Chainlink Green', madeFor: 'chain:finish:green', priceImported: true, priceFrom: from(`Chainlink, Black, Gate, 1-3/8", 4' x 5' (.065)`, 13369) },
  { id: 'g46', name: `Chainlink, Green, Gate, 1-3/8", 4' x 6' (.065)`, unitCost: 143.42, category: 'Chainlink Green', madeFor: 'chain:finish:green', priceImported: true, priceFrom: from(`Chainlink, Black, Gate, 1-3/8", 4' x 6' (.065)`, 14342) },
  { id: 'g44', name: `Chainlink, Green, Gate, 1-3/8", 4' x 4' (.055)`, unitCost: 213.63, category: 'Chainlink Green', madeFor: 'chain:finish:green', priceUpdatedAt: '2026-10-26', priceImported: false },
  { id: 'gfk', name: 'Green, Fork, PS, 2-1/2"', unitCost: 1.98, category: 'Chainlink Green', madeFor: 'chain:finish:green', priceImported: true, priceFrom: from('Black, Fork, PS, 2-1/2"', 198) },
  { id: 'gb2', name: 'Green, Bolt, 3/8" x 2" w/ Nut', unitCost: 0.41, category: 'Chainlink Green', madeFor: 'chain:finish:green', priceImported: true, priceFrom: from('Black, Bolt, 3/8" x 2" w/ Nut', 41) },
  { id: 'gb3', name: 'Green, Bolt, 3/8" x 3" w/ Nut', unitCost: 0.53, category: 'Chainlink Green', madeFor: 'chain:finish:green', priceImported: true, priceFrom: from('Black, Bolt, 3/8" x 3" w/ Nut', 53) },
  { id: 'gdl', name: `DS, Pipe, Green, Line Post, 1-5/8" 0.055 wall, 4' Chain Link`, unitCost: 11.74, category: 'Chainlink Green', madeFor: 'chain:finish:green', priceImported: true, priceFrom: from(`DS, Pipe, Blk, Line Post, 1-5/8" 0.055 wall, 4' Chain Link`, 1174) },
  { id: 'gdt', name: `DS, Pipe, Green, Terminal Post, 2-1/2" 0.055 wall, 4' Chain Link`, unitCost: 16.94, category: 'Chainlink Green', madeFor: 'chain:finish:green', priceImported: true, priceFrom: from(`DS, Pipe, Blk, Terminal Post, 2-1/2" 0.055 wall, 4' Chain Link`, 1694) },
  { id: 'bb2', name: 'Black, Bolt, 3/8" x 2" w/ Nut', unitCost: 0.41, category: 'Chainlink Black' },
  { id: 'gbolt', name: 'G, Bolt, 3/8" x 2" w/ Nut', unitCost: 0.34, category: 'Chainlink' },
  { id: 'bdl', name: `DS, Pipe, Blk, Line Post, 1-5/8" 0.055 wall, 4' Chain Link`, unitCost: 11.74, category: 'Chainlink Black' },
]

// 06-251707 as printed (Oct 26 2026): items $1,688.93, freight $125, fuel $25, no tax line, total $1,838.93.
const D251707 = (): Doc => ({
  number: '06-251707', date: '2026-10-26', files: ['06-251707.pdf'], subtotalCents: 168893, taxCents: 0, taxFound: false, freightCents: 12500, fees: [{ label: 'Fuel Charge', cents: 2500 }], totalCents: 183893,
  lines: [
    line(`GRN RES SNG GATE 4'Wx4' 1-3/8"SP055 NO SCR`, 1, 'EA', 1863800, 18638),
    line('BOLT/NUT 5/16x1-1/4in', 100, 'EA', 1574, 1574),
    line('BOLT/NUT 3/8x2in', 2, 'EA', 3484, 70),
    line('BOLT/NUT 3/8x3in', 2, 'EA', 2872, 57),
    line('the other 18 lines', 1, 'EA', 14855400, 148554),
  ],
})
// 06-120125 as the reader reads it (Jul 13 2023): fuel $15 a fee, freight $100, 7.0% tax $102.05.
const D120125 = (): Doc => ({
  number: '06-120125', date: '2023-07-13', files: ['06-120125.pdf'], subtotalCents: 134288, taxCents: 10205, taxFound: true, freightCents: 10000, fees: [{ label: 'Fuel Charge', cents: 1500 }], totalCents: 155993,
  lines: [
    line('GRN RES SNG GATE 5Wx4 SP055 9gaEXT NO SCR', 1, 'EA', 1723000, 17230),
    line('GRN PLY DROP FORK 2-1/2in', 1, 'EA', 31958, 320),
    line(`GRN PLY 1-5/8" x 7' x PP055`, 15, 'PC', 139730, 20960),
    line('BOLT/NUT 3/8x2in', 2, 'EA', 2850, 57),
    line(`GRN PLY 1-3/8" x 21' x PP055 SW x 8pc`, 168, 'FT', 15895, 26704),
    line('the other 16 lines', 1, 'EA', 690170, 69017),
  ],
})

describe('which green part a printed line is', () => {
  test('the rules, and nothing beyond them', () => {
    const items = ITEMS()
    const rule = (doc: string, d: string) => { const r = greenRuleFor(doc, d, items); return r && ('rule' in r ? r.rule.part : `none: ${r.none}`) }
    // 06-251707's words; a rail with another stick count is the same rail.
    expect(rule('06-251707', `GRN RES SNG GATE 4'Wx4' 1-3/8"SP055 NO SCR`)).toBe(`Chainlink, Green, Gate, 1-3/8", 4' x 4' (.055)`)
    expect(rule('06-120125', `GRN PLY 1-3/8" x 21' x PP055 SW x 8pc`)).toBe(`Pipe, Green, 1-3/8" x 10'6" (.055)`)
    // A gate of any width, 4 ft tall: the green leaf of that width in Inventory; none for one not there or not 4 ft tall.
    expect(rule('06-120125', 'GRN RES SNG GATE 5Wx4 SP055 9gaEXT NO SCR')).toBe(`Chainlink, Green, Gate, 1-3/8", 4' x 5' (.065)`)
    expect(rule('x', `GRN RES SNG GATE 6'Wx4' 1-3/8"SP055 NO SCR`)).toBe(`Chainlink, Green, Gate, 1-3/8", 4' x 6' (.065)`)
    expect(rule('x', `GRN RES SNG GATE 10'Wx4' 1-3/8"SP055 NO SCR`)).toMatch(/^none: no green 4 ft tall gate 10 ft wide/)
    expect(rule('x', `GRN RES SNG GATE 4'Wx5' 1-3/8"SP055 NO SCR`)).toMatch(/^none: a 5 ft tall gate/)
    expect(rule('06-120125', 'GRN PLY DROP FORK 2-1/2in')).toBe('Green, Fork, PS, 2-1/2"')
    // Dig set pipe by Jonathan's rule: 6 ft long is the 4 ft post; 7 ft long is 5 ft tall (no Green part).
    expect(rule('x', `GRN PLY 1-5/8" x 6' x PP055`)).toBe(`DS, Pipe, Green, Line Post, 1-5/8" 0.055 wall, 4' Chain Link`)
    expect(rule('x', `GRN PLY 2-1/2" x 6' x PP055`)).toBe(`DS, Pipe, Green, Terminal Post, 2-1/2" 0.055 wall, 4' Chain Link`)
    expect(rule('06-120125', `GRN PLY 1-5/8" x 7' x PP055`)).toMatch(/^none: 7 ft long = the 5 ft tall dig set post/)
    // Plain bolts: the green bolt only on 06-251707 (Jonathan's word); on any other document not green at all.
    expect(rule('06-251707', 'BOLT/NUT 3/8x2in')).toBe('Green, Bolt, 3/8" x 2" w/ Nut')
    expect(rule('06-120125', 'BOLT/NUT 3/8x2in')).toBeNull()
    expect(rule('06-243934', 'BOLT/NUT 3/8x2in')).toBeNull()
    // Black and galvanized lines are not green; a green line with no part says so.
    expect(rule('x', 'BLK PLY DROP FORK 2-1/2in')).toBeNull()
    expect(rule('x', "RES SNG GATE 5'Wx4' 1-3/8\".055 NO SCR")).toBeNull()
    expect(rule('x', 'can GRN PLY SPRAY PAINT')).toMatch(/^none: no Green chain link part/)
    // The gate's printed frame (.055) and the part's name (.065) differ: said.
    const g = greenRuleFor('06-120125', 'GRN RES SNG GATE 5Wx4 SP055 9gaEXT NO SCR', items) as any
    expect(g.rule.note).toMatch(/printed frame \.055, the part's name says \.065/)
  })
})

describe('landed price each', () => {
  test('06-251707: freight spread, 7.22% estimated tax, fuel left out', () => {
    const L = docLanded(D251707(), 722)
    expect(L.ok).toBe(true)
    expect(L.fuelCents).toBe(2500)
    expect(L.estBp).toBe(722)
    expect(L.spreadCents).toBe(12500)
    const p = greenLinesOf([D251707()], ITEMS(), 722)
    const each = (d: string) => p.find(x => x.description === d)!.landedEachCents
    // The same as the app worked out for these lines (landed $18.05, $0.80, $0.65; the gate $213.63).
    expect(p.find(x => x.description === 'BOLT/NUT 5/16x1-1/4in')!.landedCents).toBe(1805)
    expect(each('BOLT/NUT 5/16x1-1/4in')).toBe(18)
    expect(each('BOLT/NUT 3/8x2in')).toBe(40)
    expect(each('BOLT/NUT 3/8x3in')).toBe(33)
    expect(each(`GRN RES SNG GATE 4'Wx4' 1-3/8"SP055 NO SCR`)).toBe(21363)
  })

  test('06-120125: printed tax and freight spread, fuel left out', () => {
    const L = docLanded(D120125(), 722)
    expect(L.ok).toBe(true)
    expect([L.estBp, L.fuelCents, L.spreadCents]).toEqual([null, 1500, 10205 + 10000])
    const p = greenLinesOf([D120125()], ITEMS(), 722)
    // Printed tax and freight spread over $1,342.88 of items: × 1.15046.
    expect(p.find(x => /GATE 5Wx4/.test(x.description))!.landedEachCents).toBe(19822)
    expect(p.find(x => /FORK 2-1\/2/.test(x.description))!.landedEachCents).toBe(368)
  })

  test('a document that does not add up as read is not used for a price', () => {
    const bad = { ...D120125(), totalCents: 155994 }
    expect(docLanded(bad, 722).ok).toBe(false)
    expect(greenLinesOf([bad], ITEMS(), 722).every(p => p.landedEachCents == null)).toBe(true)
  })
})

describe('the plan', () => {
  const plan = () => planGreenRealPrices([D120125(), D251707()], ITEMS(), 722, borrowedPrice)

  test('each part from Black takes the newest printed price; parts with no green price stay from Black', () => {
    const p = plan()
    expect(p.set.map(s => [s.part, s.beforeCents, s.afterCents, s.source.doc])).toEqual([
      [`Chainlink, Green, Gate, 1-3/8", 4' x 5' (.065)`, 13369, 19822, '06-120125'],
      ['Green, Bolt, 3/8" x 2" w/ Nut', 41, 40, '06-251707'],
      ['Green, Bolt, 3/8" x 3" w/ Nut', 53, 33, '06-251707'],
      ['Green, Fork, PS, 2-1/2"', 198, 368, '06-120125'],
    ])
    expect(p.stillFromBlack.map(s => [s.part, s.cents])).toEqual([
      [`Chainlink, Green, Gate, 1-3/8", 4' x 6' (.065)`, 14342],
      [`DS, Pipe, Green, Line Post, 1-5/8" 0.055 wall, 4' Chain Link`, 1174],
      [`DS, Pipe, Green, Terminal Post, 2-1/2" 0.055 wall, 4' Chain Link`, 1694],
    ])
    // The 7 ft pipe that is not the 4 ft post is said next to it.
    expect(p.stillFromBlack[1].seen.map(x => x.description)).toEqual([`GRN PLY 1-5/8" x 7' x PP055`])
    // A part with a price of its own is never changed (shown with the newest printed price).
    expect(p.kept.map(k => [k.part, k.cents, k.newest?.doc])).toEqual([[`Chainlink, Green, Gate, 1-3/8", 4' x 4' (.055)`, 21363, '06-251707']])
  })

  test('the newest document wins; an older one is listed, not used', () => {
    const newer: Doc = { ...D251707(), number: '06-260001', date: '2026-11-02', lines: [line('GRN PLY DROP FORK 2-1/2in', 1, 'EA', 40000, 400), line('rest', 1, 'EA', 16849300, 168493)] }
    const p = planGreenRealPrices([D120125(), D251707(), newer], ITEMS(), 722, borrowedPrice)
    const fork = p.set.find(s => s.part === 'Green, Fork, PS, 2-1/2"')!
    expect(fork.source.doc).toBe('06-260001')
    expect(fork.older.map(o => o.doc)).toEqual(['06-120125'])
  })

  test('once priced, run again: nothing to set', () => {
    const p = plan()
    const items = ITEMS().map(i => { const s = p.set.find(x => x.itemId === i.id); return s ? { ...i, unitCost: s.afterCents / 100, priceUpdatedAt: s.source.date, priceImported: false } : i })
    const again = planGreenRealPrices([D120125(), D251707()], items, 722, borrowedPrice)
    expect(again.set).toEqual([])
    expect(again.stillFromBlack).toHaveLength(3)
  })
})

describe('a part priced from Black follows Black until its own price is entered', () => {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')

  test('Black changes → the green part follows, its mark moves with it', () => {
    const items = ITEMS().map(i => (i.id === 'bdl' ? { ...i, unitCost: 12.5 } : i))
    const out = followBorrowedPrices(items, '2026-10-28')
    expect(out.followed).toEqual([{ id: 'gdl', part: `DS, Pipe, Green, Line Post, 1-5/8" 0.055 wall, 4' Chain Link`, from: `DS, Pipe, Blk, Line Post, 1-5/8" 0.055 wall, 4' Chain Link`, wasCents: 1174, nowCents: 1250 }])
    const g = out.items.find(i => i.id === 'gdl')!
    expect(g.unitCost).toBe(12.5)
    expect(borrowedPrice(g)).toEqual({ ...from(`DS, Pipe, Blk, Line Post, 1-5/8" 0.055 wall, 4' Chain Link`, 1250), on: '2026-10-28' })
    // Still borrowed, so it follows the next change too; nothing else moved; the input is not changed.
    expect(out.items.filter(i => JSON.stringify(i) !== JSON.stringify(items.find(x => x.id === i.id))).map(i => i.id)).toEqual(['gdl'])
    expect(items.find(i => i.id === 'gdl')!.unitCost).toBe(11.74)
    expect(followBorrowedPrices(out.items, '2026-10-29').followed).toEqual([])
    // Nothing to follow: the same array back.
    expect(followBorrowedPrices(ITEMS(), '2026-10-28').followed).toEqual([])
  })

  test('a typed green price (Inventory dates it) or a vendor document ends it; a Black part with no price is not followed', () => {
    const before = new Map(ITEMS().map(i => [i.id, i.unitCost]))
    // Typed in Inventory: the save stamps today's date, so it is a real price.
    const typed = stampPriceChanges(ITEMS().map(i => (i.id === 'gdl' ? { ...i, unitCost: 13.1 } : i)), before, '2026-10-28')
    expect(borrowedPrice(typed.find(i => i.id === 'gdl')!)).toBeNull()
    const moved = followBorrowedPrices(typed.map(i => (i.id === 'bdl' ? { ...i, unitCost: 15 } : i)), '2026-10-28')
    expect(moved.items.find(i => i.id === 'gdl')!.unitCost).toBe(13.1)
    // A vendor document: its date, not imported.
    const doc = ITEMS().map(i => (i.id === 'gb2' ? { ...i, unitCost: 0.4, priceUpdatedAt: '2026-10-26', priceImported: false } : i))
    expect(followBorrowedPrices(doc.map(i => (i.id === 'bb2' ? { ...i, unitCost: 0.6 } : i)), '2026-10-28').items.find(i => i.id === 'gb2')!.unitCost).toBe(0.4)
    // The black part's price taken away: the green part keeps what it has.
    expect(followBorrowedPrices(ITEMS().map(i => (i.id === 'bdl' ? { ...i, unitCost: 0 } : i)), '2026-10-28').followed).toEqual([])
    // Inventory says so.
    expect(priceAgeLabel(ITEMS().find(i => i.id === 'gdl')!)).toBe(`${FROM_BLACK_WORDS}: follows DS, Pipe, Blk, Line Post, 1-5/8" 0.055 wall, 4' Chain Link`)
  })

  test('the quote lists the parts on it still priced from Black, each once', () => {
    const parts = [`DS, Pipe, Green, Line Post, 1-5/8" 0.055 wall, 4' Chain Link`, `Chainlink, Green, Gate, 1-3/8", 4' x 4' (.055)`, `DS, Pipe, Green, Line Post, 1-5/8" 0.055 wall, 4' Chain Link`, 'Black, Bolt, 3/8" x 2" w/ Nut', 'Not in Inventory']
    expect(borrowedPartsOnQuote(parts, ITEMS(), norm).map(x => [x.item.id, x.from.cents])).toEqual([['gdl', 1174]])
    // A No dig green yard after the apply (no dig set posts, its bolts priced): no warning.
    const priced = ITEMS().map(i => (i.id === 'gb2' ? { ...i, unitCost: 0.4, priceUpdatedAt: '2026-10-26', priceImported: false } : i))
    expect(borrowedPartsOnQuote(['Green, Bolt, 3/8" x 2" w/ Nut', `Chainlink, Green, Gate, 1-3/8", 4' x 4' (.055)`], priced, norm)).toEqual([])
  })
})

describe('06-120125 read from its words by the reader, start to finish', () => {
  test('the gate $198.22 and the fork $3.68, with no correction', async () => {
    const { wordsToRows } = await import('../src/server/lib/invoiceReader')
    const { parseInvoice } = await import('../src/server/lib/invoiceParse')
    const text = fs.readFileSync(path.join(__dirname, 'fixtures/stephens/06-120125.words.txt'), 'utf8').split('\n')
    const size = text.find(l => l.startsWith('# page '))!.split(' ')
    const words = text.filter(l => l && !l.startsWith('# ')).map(l => { const [t, x, y, w, h] = l.split('\t'); return { t, x: +x, y: +y, w: +w, h: +h, c: 1 } })
    const p = parseInvoice([{ page: 1, rows: wordsToRows(words, 1, Number(size[2]) / Number(size[3])) }])
    const doc: Doc = {
      number: p.invoiceNumber, date: p.invoiceDate, files: ['06-120125.pdf'], subtotalCents: p.subtotalCents, taxCents: p.taxCents, taxFound: p.taxFound,
      freightCents: p.freightCents, fees: p.fees.map(f => ({ label: f.label, cents: f.cents })), totalCents: p.totalCents, lines: p.lines,
    }
    const plan = planGreenRealPrices([doc], ITEMS(), 722, borrowedPrice)
    const after = (part: string) => plan.set.find(s => s.part === part)?.afterCents
    expect(after(`Chainlink, Green, Gate, 1-3/8", 4' x 5' (.065)`)).toBe(19822)
    expect(after('Green, Fork, PS, 2-1/2"')).toBe(368)
  })
})
