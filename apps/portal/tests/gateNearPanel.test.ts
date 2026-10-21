/**
 * A gate set "near the house / corner" sits one panel of the style in, the
 * same in the quote builder, the crew packet (web/src/installPacket.tsx) and
 * the saved quote's drawing (web/src/QuotePlan.tsx: quote document, quote
 * drawer, customer portal). All three read gateSlide.ts layoutPanelFt.
 */

import { describe, test, expect, beforeAll } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from '../../web/node_modules/react-dom/server'
import { deriveLayout, layoutForShape, formatFtIn, type YardLayout } from '../../web/src/yardLayout'
import { gateWhereText, layoutPanelFt } from '../../web/src/gateSlide'
import { sectionsForRun } from '../../web/src/sectionCount'

const ft = (n: number) => n * 12

// The crew packet's module loads the office sign in, which reads the page's
// address on import: a bare stand in for this node test (nothing is stored).
let buildPacketSnapshot: typeof import('../../web/src/installPacket').buildPacketSnapshot
let QuotePlan: typeof import('../../web/src/QuotePlan').default
let quotePlanWidth: typeof import('../../web/src/QuotePlan').quotePlanWidth
let layoutWidthFt: typeof import('../../web/src/widgetPricing').layoutWidthFt
beforeAll(async () => {
  const mem = new Map<string, string>()
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) }, removeItem: (k: string) => { mem.delete(k) }, clear: () => mem.clear(), key: () => null, length: 0 }
  ;(globalThis as any).window ??= { location: { hostname: 'test', protocol: 'http:', origin: 'http://test' }, addEventListener: () => {}, removeEventListener: () => {} }
  ;(globalThis as any).localStorage ??= store
  ;(globalThis as any).sessionStorage ??= store
  ;({ buildPacketSnapshot } = await import('../../web/src/installPacket'))
  ;({ default: QuotePlan, quotePlanWidth } = await import('../../web/src/QuotePlan'))
  ;({ layoutWidthFt } = await import('../../web/src/widgetPricing'))
})

// A gate "near the house / corner" sits one panel of the style in, in the
// builder, the crew packet and the saved quote's drawing alike (Jonathan,
// Oct 20, 2026): 6 ft on a 6 ft panel style, 8 ft on an 8 ft one. The builder
// already did; the packet and the drawing put it 8 ft in whatever the style.
describe('a gate near the house: one panel of the style in, in all three places', () => {
  const yardWith = (position: 'start' | 'end') => {
    const y = layoutForShape('backyard')
    y.sides.forEach((s, i) => { s.lengthIn = ft([40, 60, 48, 60, 20][i]) })
    y.sides[0].gate = { type: 'walk', widthIn: ft(4), position }
    return y
  }
  const savedQuote = (y: YardLayout, fenceStyle: string, nearIn: number) => {
    const r = deriveLayout(y, nearIn)
    return { id: 'q1', fenceStyle, runs: r.runs.map(x => x.ft), walkGates: r.walkGates, dblGates: r.dblGates, corners: r.corners, ends: r.ends, layout: { yard: y, runSections: r.runs.map(x => sectionsForRun(x.ft, nearIn / 12)) } } as any
  }

  test('a 6 ft panel style puts the gate 6 ft from the end: builder, crew packet, saved quote drawing', () => {
    const style = { name: "WV-ND 6'x6' Privacy", panelWidth: 6 }
    // The builder: the yard laid out at the style's panel width (QuoteBuilder, widget pricing).
    expect(layoutPanelFt(style)).toBe(6)
    expect(layoutWidthFt(style)).toBe(6)
    const y = yardWith('start')
    const built = deriveLayout(y, layoutPanelFt(style) * 12)
    expect(built.sides[0].gateAtIn).toBe(ft(6))
    expect(gateWhereText(y, 0, layoutPanelFt(style) * 12)).toBe('4 ft walk gate, 6 ft from the house, 30 ft to the Left side corner')
    const quote = savedQuote(y, style.name, ft(6))

    // The crew packet.
    const packet = buildPacketSnapshot({}, quote, [])
    expect(packet.gates).toEqual([expect.stringContaining('Left return: 4 ft walk gate, 6 ft from the house, 30 ft to the Left side corner;')])
    expect(packet.runs!.map(r => r.length)).toEqual(built.runs.map(r => formatFtIn(r.inches)))

    // The saved quote's drawing (quote document, quote drawer, customer portal).
    const html = renderToStaticMarkup(createElement(QuotePlan, { quote }))
    expect(html).toContain('Left return: 4 ft walk gate, 6 ft from the house, 30 ft to the Left side corner')
    expect(quotePlanWidth(y, quote).nearIn).toBe(ft(6))

    // Near the far end too, and an 8 ft panel style stays 8 ft in.
    const yEnd = yardWith('end')
    expect(renderToStaticMarkup(createElement(QuotePlan, { quote: savedQuote(yEnd, style.name, ft(6)) }))).toContain('30 ft from the house, 6 ft to the Left side corner')
    const wide = savedQuote(y, "WV-ND 6'x8' Privacy", ft(8))
    expect(renderToStaticMarkup(createElement(QuotePlan, { quote: wide }))).toContain('4 ft walk gate, 8 ft from the house, 28 ft to the Left side corner')
    expect(buildPacketSnapshot({}, wide, []).gates![0]).toContain('8 ft from the house')
  })

  test('the drawing always matches the runs the quote was priced on', () => {
    // Saved when the builder laid the yard out 8 ft in (the style's width changed since): drawn 8 ft in.
    const y = yardWith('start')
    const old = savedQuote(y, "WV-ND 6'x6' Privacy", ft(8))
    expect(quotePlanWidth(y, old).nearIn).toBe(ft(8))
    expect(renderToStaticMarkup(createElement(QuotePlan, { quote: old }))).toContain('8 ft from the house')
    // The auto mix lays out at 8 ft, as the builder (its 6 / 8 ft choice is made per run after the gate splits the side).
    expect(layoutPanelFt({ name: 'WV-Auto ND Privacy', autoRailMix: true, panelWidth: 6 })).toBe(8)
  })
})
