/**
 * The permit sheet: the office site plan as one landscape page for the county
 * (letter, or 11 x 17), drawn to a stated scale (1 in = 20 ft and so on, at
 * full size), with a title block (the company from Settings → Company, the
 * customer, the job address and street, parcel ID, date, the plan's revision
 * and who drew it), the fence (its plain name and total feet as built), every
 * side and gate dimensioned, the house, the property line and the neighbors',
 * a legend, a scale bar and a north arrow, and "Approximate property lines
 * from county records, not a survey." The aerial photo goes under the plan
 * only when asked: USGS NAIP (public domain, so it may be kept in a saved
 * PDF; Esri's terms allow no storing), through the same tile cache as every
 * map (routes/aerialTiles.ts).
 */

import { pdfDocument } from './pdfText.js'
import { drawSvg } from './automations/permits.js'
import { phoneText } from './receiptPdf.js'
import { tileAt, tileBounds, inArea, MAX_Z, NAIP_CREDIT } from './aerialTiles.js'
import type { SiteModule, SitePlanData, LatLng } from './sitePlans.js'

export interface SheetInput {
  size: 'letter' | 'tabloid'
  plan: SitePlanData
  revision: number
  drawnBy: string
  /** YYYY-MM-DD or words, as the sheet shows it. */
  date: string
  company: { name: string; address: string; phone: string }
  customerName: string
  address: string
  county: string
  parcelId: string
  fenceText: string
  /** NAIP tiles under the plan; null: no aerial. */
  aerial: ((z: number, x: number, y: number) => Promise<Buffer>) | null
}

/** "1234 SE 3rd Ave, Ocala, FL 34471" → "SE 3rd Ave". */
export function streetOf(address: string): string {
  const line = String(address || '').split(',')[0].trim()
  return line.replace(/^\d+[A-Za-z]?(?:-\d+)?\s+/, '').trim()
}

const ENGINEER_SCALES = [10, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 1000]

/** The smallest round scale (feet per inch) at which the plan fits the box. */
export function sheetScale(span: { x: number; y: number }, boxIn: { w: number; h: number }): number {
  return ENGINEER_SCALES.find(f => span.x / f <= boxIn.w && span.y / f <= boxIn.h) ?? 1000
}

/** The sheet as a PDF, with any note about what could not be put on it (the aerial photo). */
export async function renderPermitSheet(m: SiteModule, p: SheetInput): Promise<{ pdf: Buffer; note: string }> {
  const big = p.size === 'tabloid'
  const doc = pdfDocument({ size: big ? 'TABLOID' : 'LETTER', layout: 'landscape', margin: 24, info: { Title: `Site plan - ${p.customerName}`, Author: p.company.name } })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject) })

  const W = doc.page.width, H = doc.page.height, M = 24
  // A white page (some viewers show an unpainted page dark).
  doc.rect(0, 0, W, H).fill('#ffffff')
  const tbW = big ? 270 : 200
  const box = { x: M, y: M, w: W - 2 * M - tbW - 12, h: H - 2 * M }
  const fs = big ? 9 : 7.5
  const pad = fs * 5, bottom = fs * 3.2 + fs * 2.6

  // To a round scale that fits (1 in = 72 pt).
  const e = m.planExtent(p.plan)
  const ftPerIn = sheetScale({ x: e.maxX - e.minX, y: e.maxY - e.minY }, { w: (box.w - 2 * pad) / 72, h: (box.h - 2 * pad - bottom) / 72 })
  const scale = 72 / ftPerIn
  let note = ''

  // The aerial photo under the plan, faded so the lines read.
  if (p.aerial) {
    try { await drawAerial(doc, m, p, box, scale, fs) } catch (err) {
      note = `The aerial photo could not be loaded (${String((err as Error).message).slice(0, 80)}), so the sheet was made without it.`
    }
  }
  const svg = m.sitePlanSvg(p.plan, { width: box.w, height: box.h, scale, fontSize: fs, neighbors: true, propertyLine: true, legend: true, background: !p.aerial || !!note, sideNames: true })
  // Kept inside its box: a neighbor's lot reaches past the plan's edge (a browser clips an SVG by itself; the PDF does not).
  doc.save()
  doc.rect(box.x, box.y, box.w, box.h).clip()
  drawSvg(doc, svg, box)
  doc.restore()
  doc.rect(box.x, box.y, box.w, box.h).lineWidth(1).strokeColor('#111827').stroke()

  // ── Title block ──
  const x = W - M - tbW, w = tbW
  let y = M
  doc.rect(x, M, w, H - 2 * M).lineWidth(1).strokeColor('#111827').stroke()
  const inner = x + 8, iw = w - 16
  const line = (label: string, value: string, opts: { bold?: boolean } = {}) => {
    if (!value) return
    doc.font('Helvetica-Bold').fontSize(fs).fillColor('#6B7280').text(label.toUpperCase(), inner, y, { width: iw })
    y = doc.y + 1
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs + 1.5).fillColor('#111827').text(value, inner, y, { width: iw })
    y = doc.y + 5
  }
  const rule = () => { doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.6).strokeColor('#9CA3AF').stroke(); y += 6 }
  y += 8
  doc.font('Helvetica-Bold').fontSize(fs + 6).fillColor('#111827').text(p.company.name || 'Getter Done Fence', inner, y, { width: iw })
  y = doc.y + 2
  doc.font('Helvetica').fontSize(fs + 0.5).fillColor('#374151')
  if (p.company.address) { doc.text(p.company.address, inner, y, { width: iw }); y = doc.y + 1 }
  if (p.company.phone) { doc.text(phoneText(p.company.phone), inner, y, { width: iw }); y = doc.y + 1 }
  y += 6; rule()
  doc.font('Helvetica-Bold').fontSize(fs + 4).fillColor('#111827').text('Fence site plan', inner, y, { width: iw }); y = doc.y + 6
  line('Owner', p.customerName, { bold: true })
  line('Job address', p.address)
  line('Street', streetOf(p.address))
  line('County', p.county ? `${p.county} County` : '')
  line('Parcel ID', p.parcelId || 'Not found: see the Property Appraiser')
  rule()
  const total = p.plan.sides.reduce((t: number, s: any) => t + (m.builtFt(p.plan, s) || 0), 0)
  const gates: Array<{ widthFt: number; type: string }> = p.plan.sides.flatMap((s: any) => s.gates)
  line('Fence', p.fenceText || 'Fence')
  line('Total fence', `${m.feetLabel(total).replace(' ft', '')} linear ft`, { bold: true })
  line('Gates', gates.length ? gates.map(g => `${m.feetLabel(g.widthFt)} ${g.type === 'double' ? 'double' : 'single'}`).join(', ') : 'None')
  rule()
  line('Scale', `1 in = ${ftPerIn} ft (printed at full size)`)
  line('Date', p.date)
  line('Revision', String(p.revision))
  line('Drawn by', p.drawnBy)
  rule()
  doc.font('Helvetica-Bold').fontSize(fs + 0.5).fillColor('#991B1B').text('Approximate property lines from county records, not a survey.', inner, y, { width: iw })
  y = doc.y + 4
  // A side whose wheel number was kept is labeled with its quoted feet and a * (lib/sitePlans.ts; sitePlanSvg).
  const kept = p.plan.sides.some((s: any) => s.quotedFt != null && p.plan.answers?.[`len:${s.id}`]?.kind === 'keep')
  if (kept) { doc.font('Helvetica-Bold').fontSize(fs + 0.5).fillColor('#111827').text('* Measured on site with a wheel; drawn to the map.', inner, y, { width: iw }); y = doc.y + 4 }
  const credits = [p.plan.parcel?.source ? `Property lines: ${p.plan.parcel.source}.` : 'No property line was found for this lot.', p.aerial && !note ? `Aerial photo: ${NAIP_CREDIT}.` : '', note].filter(Boolean)
  doc.font('Helvetica').fontSize(fs).fillColor('#6B7280').text(credits.join(' '), inner, y, { width: iw })
  doc.end()
  return { pdf: await done, note }
}

/** NAIP tiles under the plan's box, clipped to it. */
async function drawAerial(doc: PDFKit.PDFDocument, m: SiteModule, p: SheetInput, box: { x: number; y: number; w: number; h: number }, scale: number, fs: number) {
  const f = m.planFrame(p.plan, box.w, box.h, { scale, pad: fs * 5, bottom: fs * 3.2 + fs * 2.6 })
  // The map spot at each corner of the box: back from the frame (north up, `scale` points per foot).
  const o = p.plan.origin as LatLng
  const o0 = f.at(o)
  const ftPerDegLat = 364_000, ftPerDegLng = 364_000 * Math.cos((o.lat * Math.PI) / 180)
  const spot = (px: number, py: number) => ({ lat: o.lat - (py - o0.y) / scale / ftPerDegLat, lng: o.lng + (px - o0.x) / scale / ftPerDegLng })
  const nw = spot(0, 0), se = spot(box.w, box.h)
  // About two photo pixels per point, at most 36 tiles.
  const mPerPx = (z: number) => (156_543.03 * Math.cos((o.lat * Math.PI) / 180)) / 2 ** z
  let z = MAX_Z
  while (z > 15 && mPerPx(z) / 0.3048 < 1 / (scale * 2)) z -= 1
  const span = (zz: number) => { const a = tileAt(nw.lat, nw.lng, zz), b = tileAt(se.lat, se.lng, zz); return { a, b, n: (b.x - a.x + 1) * (b.y - a.y + 1) } }
  while (z > 15 && span(z).n > 36) z -= 1
  const { a, b } = span(z)
  const jobs: Array<Promise<{ x: number; y: number; img: Buffer }>> = []
  for (let tx = a.x; tx <= b.x; tx++) for (let ty = a.y; ty <= b.y; ty++) {
    if (!inArea(z, tx, ty)) throw new Error('outside the area the photos cover')
    jobs.push(p.aerial!(z, tx, ty).then(img => ({ x: tx, y: ty, img })))
  }
  const tiles = await withTimeout(Promise.all(jobs), 120_000)
  doc.save()
  doc.rect(box.x, box.y, box.w, box.h).clip()
  for (const t of tiles) {
    const bd = tileBounds(z, t.x, t.y)
    const p0 = f.at({ lat: bd.north, lng: bd.west }), p1 = f.at({ lat: bd.south, lng: bd.east })
    doc.image(t.img, box.x + p0.x, box.y + p0.y, { width: p1.x - p0.x + 0.3, height: p1.y - p0.y + 0.3 })
  }
  doc.rect(box.x, box.y, box.w, box.h).fillOpacity(0.28).fill('#ffffff').fillOpacity(1)
  doc.restore()
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`the photo service took over ${Math.round(ms / 1000)} seconds`)), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}
