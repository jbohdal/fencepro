/**
 * The turned aerial photo in the saved drawing: the proposal and crew packet
 * pages keep it (a JPEG inside the drawing, nothing from outside), and the
 * permit PDF draws it under the plan with the turned north arrow.
 */

import { describe, test, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from '../../web/node_modules/react-dom/server'
import PDFDocument from 'pdfkit'
import SitePlan from '../../web/src/SitePlan'
import { layoutForShape, deriveLayout } from '../../web/src/yardLayout'
import { photoBackdrop, withPhotoView } from '../../web/src/sitePlanPhoto'
import { drawSvg } from '../src/server/lib/automations/permits'
import { safeSvg } from '../src/server/routes/proposal'

// A real 8x8 JPEG.
const JPEG = '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAACKADAAQAAAABAAAACAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgACAAIAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMABgYGBgYGCgYGCg4KCgoOEg4ODg4SFxISEhISFxwXFxcXFxccHBwcHBwcHCIiIiIiIicnJycnLCwsLCwsLCwsLP/bAEMBBwcHCwoLEwoKEy4fGh8uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLv/dAAQAAf/aAAwDAQACEQMRAD8AkaIqyTI4G5gZYn4Axkbl7jj1qx51r/0z/wC+j/jVe7/1kn/XP+prDrn3L2P/2Q=='

function turnedPlan(rot: number) {
  const l = layoutForShape('backyard')
  ;[30, 120, 143, 120, 30].forEach((n, i) => { l.sides[i].lengthIn = n * 12 })
  const y = withPhotoView({ ...l, plan: { aerial: { lat: 29.19, lng: -82.14, halfM: 60, address: 'x', shown: true } } }, { rotDeg: rot })
  const aerial = { ...photoBackdrop(y)!, href: `data:image/jpeg;base64,${JPEG}`, baked: true }
  return renderToStaticMarkup(createElement(SitePlan, { layout: y, result: deriveLayout(y), aerial }))
}

describe('the turned photo on the proposal, crew packet and PDF', () => {
  test('the pages keep a drawing with the photo inside it; outside pictures and scripts are still refused', () => {
    const svg = turnedPlan(-20)
    expect(safeSvg(svg)).toBe(svg)
    expect(safeSvg(svg.replace(`data:image/jpeg;base64,${JPEG}`, 'https://example.com/x.jpg'))).toBe('')
    expect(safeSvg(svg.replace(`data:image/jpeg;base64,${JPEG}`, 'data:image/svg+xml;base64,PHN2Zz4='))).toBe('')
    expect(safeSvg(svg.replace(`data:image/jpeg;base64,${JPEG}`, 'data:image/jpeg;base64,AAA" onload="x'))).toBe('')
    expect(safeSvg('<svg><image href="javascript:alert(1)"/></svg>')).toBe('')
  })

  test('the PDF draws the photo, then the plan and the north arrow on it', async () => {
    const svg = turnedPlan(-20)
    const doc = new PDFDocument({ size: 'LETTER', compress: false })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    const images: number[][] = []
    const realImage = doc.image.bind(doc)
    ;(doc as any).image = (src: any, x: number, y: number, o: any) => { images.push([x, y, o?.width, o?.height]); return realImage(src, x, y, o) }
    const texts: string[] = []
    const realText = doc.text.bind(doc)
    ;(doc as any).text = (str: string, ...rest: any[]) => { texts.push(str); return realText(str, ...rest) }
    drawSvg(doc, svg, { x: 50, y: 50, w: 500, h: 600 })
    doc.end()
    await new Promise(res => doc.on('end', res))
    // Drawn over the whole frame (800 drawing units).
    expect(images).toEqual([[0, 0, 800, 800]])
    expect(texts).toEqual(expect.arrayContaining(['N', `143' 0"`]))
    expect(Buffer.concat(chunks).toString('latin1')).toContain('/Subtype /Image')
  })
})
