/**
 * The permit packet PDF draws the site plan from the SVG the app saved with
 * the proposal: the piece labels, leader lines, gate swing arcs and hinge
 * squares all come through as PDF text and paths.
 */

import { describe, test, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from '../../web/node_modules/react-dom/server'
import PDFDocument from 'pdfkit'
import SitePlan from '../../web/src/SitePlan'
import { layoutForShape, deriveLayout } from '../../web/src/yardLayout'
import { drawSvg } from '../src/server/lib/automations/permits'

describe('permit packet PDF: the site plan with piece labels and gate swings', () => {
  test('every label is drawn as text, arcs and hinge squares as shapes', async () => {
    const l = layoutForShape('backyard')
    ;[30, 120, 150, 100, 40].forEach((n, i) => { l.sides[i].lengthIn = n * 12 })
    l.sides[4].gate = { type: 'double', widthIn: 168, position: 'middle', swing: 'out' }
    const r = deriveLayout(l)
    const svg = renderToStaticMarkup(createElement(SitePlan, { layout: l, result: r, runSections: r.runs.map(x => Math.ceil(x.inches / 96)) }))
    expect(svg).toContain('14&#x27; double gate')
    expect(svg).toContain('data-plan-hinge')
    expect((svg.match(/<text/g) ?? []).length).toBeGreaterThan(10)

    const doc = new PDFDocument({ size: 'LETTER', compress: false })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    const texts: string[] = []
    const realText = doc.text.bind(doc)
    ;(doc as any).text = (str: string, ...rest: any[]) => { texts.push(str); return realText(str, ...rest) }
    drawSvg(doc, svg, { x: 50, y: 50, w: 500, h: 600 })
    doc.end()
    await new Promise(res => doc.on('end', res))
    expect(texts).toEqual(expect.arrayContaining([`13'`, `14' double gate`, `40' 0"`, 'Right return · 4 sections']))
    expect(texts.filter(t => t === `13'`)).toHaveLength(2)
    expect(Buffer.concat(chunks).length).toBeGreaterThan(2000)
  })
})
