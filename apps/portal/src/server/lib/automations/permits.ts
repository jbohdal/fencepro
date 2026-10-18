/**
 * Permits: one Permit record per job, the county's online permit portal, the
 * parcel ID from the county parcel service, and the "Permit packet" PDF
 * (owner and property, parcel, the accepted contract, the site plan).
 *
 * Nothing is filed on a county website automatically: the packet and a task
 * with the portal link are made for Jonathan to file himself.
 */

import PDFDocument from 'pdfkit'
import prisma from '../prisma.js'
import { suggestCounty } from '../addressIndex.js'
import { countyOf, floridaDay } from './context.js'

export const PERMIT_STATUSES = ['not_needed', 'needed', 'applied', 'approved', 'inspection_scheduled', 'passed'] as const
export type PermitStatus = typeof PERMIT_STATUSES[number]
export const PERMIT_STATUS_LABEL: Record<PermitStatus, string> = {
  not_needed: 'Not needed', needed: 'Needed', applied: 'Applied', approved: 'Approved', inspection_scheduled: 'Inspection scheduled', passed: 'Passed',
}

/**
 * Online permit portals by county. Marion County's is "Civic Access" (Tyler
 * EnerGov), launched November 12, 2025: MarionFl.org/CivicAccess, and
 * permits.marionfl.org redirects to the self service site below (checked
 * Oct 18, 2026). Inside the City of Ocala, the city issues the permit.
 */
export const PERMIT_PORTALS: Record<string, { name: string; url: string; info: string; note: string }> = {
  Marion: {
    name: 'Marion County Civic Access',
    url: 'https://selfservice.marionfl.org/energov_prod/selfservice#/home',
    info: 'https://www.marionfl.org/CivicAccess',
    note: 'Unincorporated Marion County. Inside the City of Ocala the city issues fence permits instead. Building Safety: 352-438-2400.',
  },
}

export function portalFor(county: string | null | undefined) {
  return PERMIT_PORTALS[String(county || 'Marion')] ?? null
}

const PARCEL_SERVICE = 'https://gis.ocalafl.org/arcgis/rest/services/Public/Parcels/FeatureServer/0/query'

export interface ParcelInfo { parcel: string; owner: string; situs: string; acres: number | null }

/** The county's parcel for a street address (Marion only), or null. */
export async function lookupParcel(address: string, fetchFn: typeof fetch = fetch): Promise<ParcelInfo | null> {
  const line = address.split(',')[0]?.trim()
  if (!line) return null
  // The county's own spelling of the street (from the address list), else what was typed.
  const county = suggestCounty(address, 1)[0]?.line1 ?? line
  const situs = county.toUpperCase().replace(/\s+/g, ' ').replace(/'/g, "''")
  const tries = [`situs_1 = '${situs}'`, `situs_1 LIKE '${situs}%'`]
  for (const where of tries) {
    const qs = new URLSearchParams({ where, outFields: 'parcel,name,situs_1,acres', returnGeometry: 'false', resultRecordCount: '2', f: 'json' })
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 15_000)
    try {
      const r = await fetchFn(`${PARCEL_SERVICE}?${qs}`, { signal: ctl.signal })
      if (!r.ok) throw new Error(`the county parcel service answered ${r.status}`)
      const j: any = await r.json()
      if (j?.error) throw new Error(`the county parcel service said: ${j.error.message || 'error'}`)
      const f = j?.features?.[0]?.attributes
      if (f?.parcel) return { parcel: String(f.parcel).trim(), owner: String(f.name || '').trim(), situs: String(f.situs_1 || '').trim(), acres: typeof f.acres === 'number' ? f.acres : null }
    } finally { clearTimeout(t) }
  }
  return null
}

/** The job's permit, made (status Needed, county from the address) when it has none yet. */
export async function ensurePermit(accountId: string, jobId: string, by = 'automation') {
  const existing = await prisma.permit.findUnique({ where: { jobId } })
  if (existing) return existing
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId } })
  if (!job) throw new Error('The job is not there any more.')
  try {
    return await prisma.permit.create({ data: { accountId, jobId, status: 'needed', county: countyOf(job.customerAddress) || 'Marion', updatedBy: by } })
  } catch {
    return (await prisma.permit.findUnique({ where: { jobId } }))!
  }
}

// ── The packet ───────────────────────────────────────────────────────────────

interface PacketInput {
  company: string
  job: any
  permit: any
  quote: any | null
  parcel: ParcelInfo | null
}

export async function packetInputFor(accountId: string, jobId: string, opts: { lookup?: boolean } = {}): Promise<PacketInput> {
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId } })
  if (!job) throw new Error('The job is not there any more.')
  // Read only: a job with no permit record yet is shown as Needed (the record is made when the permit is saved or the step runs).
  const permit: any = (await prisma.permit.findUnique({ where: { jobId } })) ?? { id: null, status: 'needed', county: countyOf(job.customerAddress) || 'Marion', parcelId: '', permitNumber: '' }
  const quote = job.quoteId ? await prisma.savedQuote.findFirst({ where: { id: job.quoteId, accountId } }) : null
  let parcel: ParcelInfo | null = null
  if (opts.lookup !== false && (permit.county || 'Marion') === 'Marion') {
    try { parcel = await lookupParcel(job.customerAddress) } catch (err) { console.warn('[permits] parcel lookup failed:', (err as Error).message) }
    if (parcel && permit.id && !permit.parcelId) await prisma.permit.update({ where: { id: permit.id }, data: { parcelId: parcel.parcel } }).catch(() => {})
  }
  const account = await prisma.crmAccount.findUnique({ where: { id: accountId } }).catch(() => null) as any
  return { company: account?.name || 'Getter Done Fence', job, permit: { ...permit, parcelId: permit.parcelId || parcel?.parcel || '' }, quote, parcel }
}

const money = (dollars: number) => '$' + Math.round(dollars || 0).toLocaleString('en-US')

/** The permit packet as a PDF. */
export function renderPacket(p: PacketInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50, info: { Title: `Permit packet - ${p.job.customerName}`, Author: p.company } })
    const chunks: Buffer[] = []
    doc.on('data', c => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const W = doc.page.width - 100
    const heading = (t: string) => { doc.moveDown(0.6).font('Helvetica-Bold').fontSize(13).fillColor('#111827').text(t); doc.moveTo(50, doc.y + 2).lineTo(50 + W, doc.y + 2).strokeColor('#e5e7eb').stroke(); doc.moveDown(0.4) }
    const row = (k: string, v: string) => { doc.font('Helvetica-Bold').fontSize(10).fillColor('#374151').text(`${k}: `, { continued: true }).font('Helvetica').fillColor('#111827').text(v || '-') }

    doc.font('Helvetica-Bold').fontSize(20).fillColor('#111827').text('Fence permit packet')
    doc.font('Helvetica').fontSize(10).fillColor('#6b7280').text(`${p.company} · prepared ${floridaDay(new Date())}`)

    heading('Owner and property')
    row('Owner', p.job.customerName)
    row('Property address', p.job.customerAddress)
    row('Phone', p.job.customerPhone)
    row('Email', p.job.customerEmail)
    row('County', p.permit.county || 'Marion')
    row('Parcel ID', p.permit.parcelId || (p.parcel?.parcel ?? 'not found: look it up on the Property Appraiser site'))
    if (p.parcel?.owner) row('Owner of record (county)', p.parcel.owner)
    if (p.parcel?.acres != null) row('Lot size', `${p.parcel.acres} acres`)

    heading('Contract')
    const q = p.quote
    const opt = q?.proposal && q.chosenOption != null ? (q.proposal as any)?.options?.[q.chosenOption] : null
    const runs: number[] = Array.isArray(q?.runs) ? (q.runs as unknown[]).map(Number).filter(Number.isFinite) : []
    row('Fence', opt?.fenceStyle || opt?.label || p.job.fenceStyle)
    row('Length', `${p.job.totalFeet || Math.round(runs.reduce((a, b) => a + b, 0))} ft in ${p.job.sections} sections`)
    row('Gates', `${p.job.walkGates} walk, ${p.job.dblGates} double`)
    row('Contract price', money(p.job.contractValue || q?.finalPrice || 0))
    if (q?.acceptedAt) row('Accepted', `${floridaDay(new Date(q.acceptedAt))}${q.acceptedBy ? ` by ${q.acceptedBy}` : ''}`)
    else row('Sold', p.job.createdAt ? floridaDay(new Date(p.job.createdAt)) : '')
    if (runs.length) row('Runs (ft)', runs.join(', '))
    row('Permit status', PERMIT_STATUS_LABEL[p.permit.status as PermitStatus] ?? p.permit.status)
    if (p.permit.permitNumber) row('Permit number', p.permit.permitNumber)
    const portal = portalFor(p.permit.county)
    if (portal) { doc.moveDown(0.3).font('Helvetica').fontSize(9).fillColor('#6b7280').text(`File online: ${portal.name}, ${portal.url}. ${portal.note}`, { width: W }) }

    heading('Site plan')
    const svg = String((q?.proposal as any)?.planSvg || '')
    if (svg) {
      const top = doc.y
      const room = doc.page.height - 60 - top
      const box = { x: 50, y: top, w: W, h: Math.max(room, 200) }
      if (room < 200) { doc.addPage(); box.y = 50; box.h = doc.page.height - 110 }
      drawSvg(doc, svg, box)
    } else {
      doc.font('Helvetica').fontSize(10).fillColor('#6b7280').text('No site plan was drawn for this job\'s quote. Draw one in the quote (Layout) and make the packet again.', { width: W })
    }
    doc.end()
  })
}

// ── A small SVG renderer for the app's site plans ────────────────────────────
// The plans use only g, line, rect, circle, polygon, path and text, so this
// draws those directly with pdfkit (no extra library).

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z_:][\w:.-]*)="([^"]*)"/g)) out[m[1]] = m[2]
  return out
}

function color(c: string | undefined): string | null {
  if (!c || c === 'none' || c === 'transparent' || c.startsWith('url(')) return null
  if (c === 'currentColor') return '#111827'
  return c
}

export function drawSvg(doc: PDFKit.PDFDocument, svg: string, box: { x: number; y: number; w: number; h: number }) {
  const root = svg.match(/<svg\b[^>]*>/)?.[0] ?? ''
  const vb = (attrs(root).viewBox || '0 0 640 480').split(/[\s,]+/).map(Number)
  const [vx, vy, vw, vh] = vb.length === 4 && vb.every(Number.isFinite) ? vb : [0, 0, 640, 480]
  const s = Math.min(box.w / vw, box.h / vh)
  doc.save()
  doc.rect(box.x, box.y, vw * s, vh * s).strokeColor('#e5e7eb').lineWidth(0.5).stroke()
  doc.translate(box.x - vx * s, box.y - vy * s).scale(s)
  const stack: Array<Record<string, string>> = [{}]
  const re = /<(\/?)([a-zA-Z]+)\b([^>]*?)(\/?)>|([^<]+)/g
  let pendingText: { a: Record<string, string> } | null = null
  for (const m of svg.matchAll(re)) {
    const [, close, name, rest, selfClose, text] = m
    if (text !== undefined) {
      if (pendingText && text.trim()) {
        const a = pendingText.a
        const size = Number(a['font-size'] || 12)
        doc.font(/bold|[6-9]00/.test(a['font-weight'] || '') ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color(a.fill) ?? '#111827').fillOpacity(Number(a.opacity ?? 1))
        const str = text.trim().replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        const w = doc.widthOfString(str)
        const anchor = a['text-anchor']
        const x = Number(a.x || 0) - (anchor === 'middle' ? w / 2 : anchor === 'end' ? w : 0)
        doc.text(str, x, Number(a.y || 0) - size * 0.8, { lineBreak: false })
        doc.fillOpacity(1)
      }
      continue
    }
    if (close) { if (name === 'g') stack.pop(); if (name === 'text') pendingText = null; continue }
    const own = attrs(rest)
    const a = { ...stack[stack.length - 1], ...own }
    delete (a as any).transform
    if (name === 'g') { if (!selfClose) stack.push({ ...stack[stack.length - 1], ...own }); continue }
    if (name === 'text') { pendingText = { a }; if (selfClose) pendingText = null; continue }
    const fill = color(a.fill ?? (name === 'line' ? 'none' : '#000'))
    const stroke = color(a.stroke)
    const lw = Number(a['stroke-width'] || 1)
    const op = Number(a.opacity ?? 1)
    const n = (k: string) => { const v = Number(a[k] ?? 0); return Number.isFinite(v) ? v : 0 }
    switch (name) {
      case 'line': doc.moveTo(n('x1'), n('y1')).lineTo(n('x2'), n('y2')); break
      case 'rect': doc.rect(n('x'), n('y'), n('width'), n('height')); break
      case 'circle': doc.circle(n('cx'), n('cy'), n('r')); break
      case 'polygon': case 'polyline': {
        const pts = (a.points || '').trim().split(/[\s,]+/).map(Number)
        if (pts.length < 4 || pts.some(v => !Number.isFinite(v))) continue
        doc.moveTo(pts[0], pts[1])
        for (let i = 2; i + 1 < pts.length; i += 2) doc.lineTo(pts[i], pts[i + 1])
        if (name === 'polygon') doc.closePath()
        break
      }
      case 'path': if (!a.d) continue; doc.path(a.d); break
      default: continue
    }
    doc.lineWidth(lw).fillOpacity(Number(a['fill-opacity'] ?? op)).strokeOpacity(Number(a['stroke-opacity'] ?? op))
    if (a['stroke-dasharray']) { const d = a['stroke-dasharray'].split(/[\s,]+/).map(Number).filter(n => n > 0); if (d.length) doc.dash(d[0], { space: d[1] ?? d[0] }) } else doc.undash()
    if (fill && stroke && name !== 'line') doc.fillAndStroke(fill, stroke)
    else if (fill && name !== 'line') doc.fill(fill)
    else if (stroke) doc.stroke(stroke)
    doc.undash().fillOpacity(1).strokeOpacity(1)
  }
  doc.restore()
}
