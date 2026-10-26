/**
 * The site plan shown as a picture (round 5 review): the in-person change
 * order signing sheet showed "The new layout" as a broken image because the
 * drawing had no xmlns, and a browser refuses an SVG picture without it. The
 * same drawing is the customer portal's /site-plans/<id>.svg picture.
 */

import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from '../../web/node_modules/react-dom/server'
import SitePlan from '../../web/src/SitePlan'
import { layoutForShape, deriveLayout } from '../../web/src/yardLayout'
import { svgWithNamespace, svgDataUrl, SVG_NS } from '../src/server/lib/planSvg'
import { safeSvg } from '../src/server/routes/proposal'
import { drawSvg } from '../src/server/lib/automations/permits'
import PDFDocument from 'pdfkit'

const rootTag = (svg: string) => svg.slice(0, svg.indexOf('>') + 1)
const nsCount = (svg: string) => (rootTag(svg).match(/\sxmlns=/g) ?? []).length

function plan() {
  const l = layoutForShape('backyard')
  return renderToStaticMarkup(createElement(SitePlan, { layout: l, result: deriveLayout(l) }))
}

// A drawing saved before this fix, as it sits on quotes and change orders in the database.
const OLD = '<svg viewBox="0 0 640 576" class="w-full h-auto" role="img" aria-label="Site plan" data-site-plan="true"><g><line x1="0" y1="0" x2="10" y2="10" stroke="#000"></line></g></svg>'

describe('the site plan as a picture carries the SVG namespace', () => {
  test('a new drawing is made with xmlns on its root', () => {
    const svg = plan()
    expect(rootTag(svg)).toContain(`xmlns="${SVG_NS}"`)
    expect(nsCount(svg)).toBe(1)
  })

  test('a drawing saved without it gets it once; one that has it is left alone; anything else is untouched', () => {
    const fixed = svgWithNamespace(OLD)
    expect(fixed.startsWith(`<svg xmlns="${SVG_NS}" viewBox="0 0 640 576"`)).toBe(true)
    expect(fixed.slice(fixed.indexOf('>'))).toBe(OLD.slice(OLD.indexOf('>')))
    expect(svgWithNamespace(fixed)).toBe(fixed)
    expect(svgWithNamespace('<svg><g/></svg>')).toBe(`<svg xmlns="${SVG_NS}"><g/></svg>`)
    expect(svgWithNamespace('<svgx a="1"></svgx>')).toBe('<svgx a="1"></svgx>')
    expect(svgWithNamespace('')).toBe('')
  })

  test('the signing sheet data URL decodes to a namespaced drawing', () => {
    const url = svgDataUrl(OLD)
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    const svg = decodeURIComponent(url.slice(url.indexOf(',') + 1))
    expect(nsCount(svg)).toBe(1)
  })

  test('every page and picture the server makes from a saved drawing has it (proposal, change order page, crew packet, portal picture)', () => {
    expect(nsCount(safeSvg(OLD))).toBe(1)
    expect(nsCount(safeSvg(plan()))).toBe(1)
    expect(safeSvg('<svg><script>x</script></svg>')).toBe('')
  })

  test('the permit PDF still draws a namespaced drawing', async () => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', c => chunks.push(c))
    const done = new Promise<Buffer>(r => doc.on('end', () => r(Buffer.concat(chunks))))
    drawSvg(doc, plan(), { x: 50, y: 50, w: 500, h: 400 })
    doc.end()
    expect((await done).length).toBeGreaterThan(1000)
  })

  test('the signing sheet uses the shared helper, not its own data URL', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../web/src/ChangeOrders.tsx'), 'utf8')
    expect(src).toContain('svgDataUrl(shown.planSvg)')
    expect(src).not.toMatch(/data:image\/svg\+xml/)
  })
})
