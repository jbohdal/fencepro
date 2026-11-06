/**
 * The office site plan's routes on the dev database (DEV_DB=1; refuses any
 * other): who may open and change a plan, the plan's shape checked, a save
 * from an older revision refused (409 with the plan as it is now), Done
 * refused while a flag is open and, once answered, the quote's
 * layout.planDone set and nothing else on the quote changed; the survey
 * upload; the permit sheet PDF; the crew's installer sheet (posts numbered,
 * never a "$"); the customer's finished plan only after signing.
 */

import 'dotenv/config'
import crypto from 'crypto'
import fs from 'fs'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { planFromYard, fromFeet, toFeet } from '../../web/src/sitePlanData'
import { walkToYard, type WalkList } from '../../web/src/walkList'
import { deriveLayout } from '../../web/src/yardLayout'
import { makePng } from './fixtures/png'
import { pdfText } from './pdfText'
import PDFDocument from 'pdfkit'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('the office site plan (dev database)', { timeout: 120_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { sitePlanRoutes, parcelRoutes } = await import('../src/server/routes/sitePlans.js')
  const { packetPublic } = await import('../src/server/routes/installPacket.js')
  const { customerPlanSvg, planDir } = await import('../src/server/lib/sitePlans.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `sp-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', base = '', jobId = '', otherJobId = '', quoteId = '', packetToken = ''
  let server: ReturnType<express.Express['listen']>
  const users: Record<string, { id: string; token: string }> = {}

  let k = 0
  const step = (feet: number, what: any, extra: any = {}) => ({ id: `${tag}${k++}`, feetIn: feet * 12, what, ...extra })
  const walk: WalkList = { v: 1, lines: [{ id: 'a', steps: [step(13, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step(13, 'corner', { turn: 'right' }), step(120, 'corner', { turn: 'right' }), step(150, 'corner', { turn: 'right' }), step(120, 'end')] }] }
  const yard = walkToYard(walk)
  const runSections = deriveLayout(yard).runs.filter(r => r.ft > 0).map(r => Math.ceil(r.ft / 8))
  const layout = { yard, runSections, walk }
  const AT = { lat: 29.07, lng: -82.21 }
  const fresh = () => JSON.parse(JSON.stringify(planFromYard(yard, AT, walk)))

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    for (const [key, role, first] of [['owner', 'super_admin', 'Owen'], ['office', 'office_staff', 'Olive'], ['sales', 'sales_rep', 'Sally'], ['sales2', 'sales_rep', 'Sam'], ['crew', 'field_crew', 'Carl']] as const) {
      const email = `${tag}-${key}@example.invalid`
      const u = await prisma.crmUser.create({ data: { email, firstName: first, lastName: tag, role, crmAccountId: accountId, passwordHash: 'x' } as any })
      users[key] = { id: u.id, token: jwt.sign({ sub: u.id, email, role, crmAccountId: accountId }, secret, { expiresIn: '10m' }) }
    }
    const q = await prisma.savedQuote.create({ data: {
      accountId, customerName: `Pat ${tag}`, customerAddress: '10501 SW 54th Ct, Ocala, FL 34476', salesRep: `Sally ${tag}`,
      fenceStyle: 'WV-6-Privacy', runs: [30, 120, 150, 120], layout: layout as any, pullSheet: [{ item: 'Post', qty: 10, unitCost: 25, total: 250 }],
      sections: 54, finalPrice: 9876.5, status: 'SOLD', soldAt: new Date(), walkGates: 1,
    } as any })
    quoteId = q.id
    jobId = (await prisma.savedJob.create({ data: { accountId, quoteId, customerName: `Pat ${tag}`, customerAddress: '10501 SW 54th Ct, Ocala, FL 34476', salesRep: `Sally ${tag}`, fenceStyle: 'WV-6-Privacy', contractValue: 9876.5 } as any })).id
    otherJobId = (await prisma.savedJob.create({ data: { accountId, customerName: `Other ${tag}`, salesRep: 'Someone Else' } as any })).id
    packetToken = crypto.randomBytes(18).toString('base64url')
    await prisma.installPacket.create({ data: { accountId, jobId, token: packetToken, snapshot: { companyName: 'Getter Done Fence', walkRows: ['Back: 30 ft, a 4 ft gate'], notes: 'Gate code 1234' } as any } })
    const app = express(); app.use(express.json({ limit: '10mb' }))
    app.use('/api/site-plans', sitePlanRoutes); app.use('/api/parcels', parcelRoutes); app.use('/p/i', packetPublic)
    server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const plans = await prisma.sitePlan.findMany({ where: { accountId }, select: { id: true } })
    await prisma.sitePlanRevision.deleteMany({ where: { planId: { in: plans.map(p => p.id) } } })
    await prisma.sitePlan.deleteMany({ where: { accountId } })
    for (const j of [jobId, otherJobId]) if (j) fs.rmSync(planDir(accountId, j), { recursive: true, force: true })
    await prisma.installPacket.deleteMany({ where: { accountId } })
    await prisma.changeOrder.deleteMany({ where: { accountId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  const call = async (who: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${users[who].token}`, ...(body !== undefined && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) })
    const type = r.headers.get('content-type') || ''
    return { status: r.status, json: type.includes('json') ? await r.json() : null, buf: type.includes('json') ? null : Buffer.from(await r.arrayBuffer()) }
  }

  test('who may open it: the office edits; the Salesman reads her own job only; the Installer is refused', async () => {
    const office = await call('office', 'GET', `/api/site-plans/${jobId}`)
    expect(office.status).toBe(200)
    expect(office.json.data).toEqual(expect.objectContaining({ plan: null, revision: 0, doneAt: null, revisions: [], canEdit: true, settings: { tolFt: 3, tolPct: 3, setbackFt: 0 } }))
    expect(office.json.data.job).toEqual(expect.objectContaining({ id: jobId, quoteId, address: '10501 SW 54th Ct, Ocala, FL 34476', customerName: `Pat ${tag}` }))
    expect(office.json.data.quote).toEqual(expect.objectContaining({ id: quoteId, status: 'SOLD', signed: true }))
    expect(office.json.data.quote.layout.runSections).toEqual(runSections)
    expect((await call('owner', 'GET', `/api/site-plans/${jobId}`)).json.data.canEdit).toBe(true)
    const sales = await call('sales', 'GET', `/api/site-plans/${jobId}`)
    expect(sales.status).toBe(200)
    expect(sales.json.data.canEdit).toBe(false)
    expect((await call('sales', 'GET', `/api/site-plans/${otherJobId}`)).status).toBe(404)
    expect((await call('sales2', 'GET', `/api/site-plans/${jobId}`)).status).toBe(404)
    expect((await call('crew', 'GET', `/api/site-plans/${jobId}`)).status).toBe(403)
    expect((await call('sales', 'PUT', `/api/site-plans/${jobId}`, { plan: fresh(), baseRevision: 0 })).status).toBe(403)
    expect((await call('sales', 'GET', `/api/parcels?lat=29.07&lng=-82.21`)).status).toBe(403)
    expect((await call('office', 'GET', `/api/parcels?lat=999&lng=-82.21`)).status).toBe(400)
  })

  test('the plan\'s shape is checked; a save from an older revision is refused with the plan as it is now', async () => {
    const bad = fresh(); bad.posts[0].lat = 200
    expect((await call('office', 'PUT', `/api/site-plans/${jobId}`, { plan: bad, baseRevision: 0 })).status).toBe(400)
    const dangling = fresh(); dangling.sides[0].a = 'nope'
    const d = await call('office', 'PUT', `/api/site-plans/${jobId}`, { plan: dangling, baseRevision: 0 })
    expect(d.status).toBe(400)
    expect(d.json.error).toMatch(/post that is not in the plan/)
    const foreign = fresh(); foreign.survey = { url: 'https://evil.example/x.png', w: 10, h: 10, p1: { px: { x: 0, y: 0 }, at: AT }, p2: { px: { x: 5, y: 5 }, at: AT }, ft: 10, opacity: 0.5 }
    expect((await call('office', 'PUT', `/api/site-plans/${jobId}`, { plan: foreign, baseRevision: 0 })).status).toBe(400)
    const extra = { ...fresh(), price: 100 }
    expect((await call('office', 'PUT', `/api/site-plans/${jobId}`, { plan: extra, baseRevision: 0 })).status).toBe(400)

    const first = await call('office', 'PUT', `/api/site-plans/${jobId}`, { plan: fresh(), baseRevision: 0, note: 'From the walk list' })
    expect(first.status).toBe(200)
    expect(first.json.data.revision).toBe(1)
    const stale = await call('owner', 'PUT', `/api/site-plans/${jobId}`, { plan: fresh(), baseRevision: 0 })
    expect(stale.status).toBe(409)
    expect(stale.json.error).toMatch(/saved this plan/)
    expect(stale.json.current.revision).toBe(1)
    expect(stale.json.current.revisions).toEqual([expect.objectContaining({ revision: 1, by: `Olive ${tag}`, note: 'From the walk list' })])
  })

  test('Done: refused while a flag is open; answered, the quote\'s layout.planDone is set and nothing else on the quote changes', async () => {
    const before = await prisma.savedQuote.findUniqueOrThrow({ where: { id: quoteId } })
    const cur = (await call('office', 'GET', `/api/site-plans/${jobId}`)).json.data
    const plan = cur.plan
    // The back side (150 ft) dragged 12.5 ft short.
    const s = plan.sides[2], a = plan.posts.find((p: any) => p.id === s.a), b = plan.posts.find((p: any) => p.id === s.b)
    const v = toFeet(a, b)
    Object.assign(b, fromFeet(a, { x: v.x * (137.5 / 150), y: v.y * (137.5 / 150) }))
    const saved = await call('office', 'PUT', `/api/site-plans/${jobId}`, { plan, baseRevision: cur.revision })
    expect(saved.status).toBe(200)
    const refused = await call('office', 'POST', `/api/site-plans/${jobId}/done`, { revision: saved.json.data.revision })
    expect(refused.status).toBe(409)
    expect(refused.json.error).toBe('Answer every flag first.')
    expect(refused.json.open).toEqual([expect.stringMatching(/Side 3: quoted 150 ft, drawn 137.5 ft/)])
    expect((await call('office', 'POST', `/api/site-plans/${jobId}/done`, { revision: 0 })).status).toBe(409)

    plan.answers[`len:${s.id}`] = { kind: 'keep', note: 'Wheel checked', by: 'Olive', at: '2026-11-06' }
    const answered = await call('office', 'PUT', `/api/site-plans/${jobId}`, { plan, baseRevision: saved.json.data.revision })
    const done = await call('office', 'POST', `/api/site-plans/${jobId}/done`, { revision: answered.json.data.revision })
    expect(done.status).toBe(200)
    const after = await prisma.savedQuote.findUniqueOrThrow({ where: { id: quoteId } })
    expect((after.layout as any).planDone).toBe(true)
    const { planDone: _p, ...restAfter } = after.layout as any
    expect(restAfter).toEqual(before.layout)
    for (const f of ['finalPrice', 'runs', 'pullSheet', 'sections', 'status', 'fenceStyle', 'proposal', 'pricing', 'materialCost', 'laborCost', 'gmPct'] as const) expect(after[f], f).toEqual(before[f])

    // Saved again after done: still done, a new revision.
    const again = await call('office', 'PUT', `/api/site-plans/${jobId}`, { plan: { ...plan, notes: 'Dogs in the yard. Mark the sprinkler heads.' }, baseRevision: answered.json.data.revision })
    const g = (await call('office', 'GET', `/api/site-plans/${jobId}`)).json.data
    expect(g.revision).toBe(again.json.data.revision)
    expect(g.doneAt).not.toBeNull()
    expect(g.doneBy).toBe(`Olive ${tag}`)
    expect(g.revisions.map((r: any) => r.revision)).toEqual([4, 3, 2, 1])
  })

  test('the survey: a picture uploaded is served to the office and the Salesman, and only its own address is taken on the plan', async () => {
    const png = makePng(120, 80)
    const up = await call('office', 'POST', `/api/site-plans/${jobId}/survey`, png, { 'Content-Type': 'image/png' })
    expect(up.status).toBe(200)
    expect(up.json.data).toEqual({ url: expect.stringMatching(new RegExp(`^/api/site-plans/${jobId}/survey/[0-9a-f-]{36}\\.png$`)), w: 120, h: 80 })
    expect((await call('sales', 'GET', up.json.data.url)).buf?.equals(png)).toBe(true)
    expect((await call('crew', 'GET', up.json.data.url)).status).toBe(403)
    expect((await call('office', 'POST', `/api/site-plans/${jobId}/survey`, Buffer.from('hello'), { 'Content-Type': 'text/plain' })).status).toBe(415)
    // A PDF survey: its first page made into a picture, 3000 px on its long side (macOS sips).
    const doc = new PDFDocument({ size: 'LETTER' }); const parts: Buffer[] = []
    doc.on('data', (c: Buffer) => parts.push(c)); const ended = new Promise(r => doc.on('end', r))
    doc.fontSize(20).text('Boundary survey, lot 12'); doc.rect(100, 200, 400, 300).stroke(); doc.end(); await ended
    const fromPdf = await call('office', 'POST', `/api/site-plans/${jobId}/survey`, Buffer.concat(parts), { 'Content-Type': 'application/pdf' })
    expect(fromPdf.status).toBe(200)
    expect(fromPdf.json.data).toEqual({ url: expect.stringMatching(/\.png$/), w: expect.any(Number), h: 3000 })
    expect((await call('office', 'POST', `/api/site-plans/${jobId}/survey`, Buffer.from('not a pdf at all'), { 'Content-Type': 'application/pdf' })).status).toBe(400)
    const cur = (await call('office', 'GET', `/api/site-plans/${jobId}`)).json.data
    const plan = { ...cur.plan, survey: { url: up.json.data.url, w: 120, h: 80, p1: { px: { x: 0, y: 0 }, at: AT }, p2: { px: { x: 100, y: 0 }, at: fromFeet(AT, { x: 50, y: 0 }) }, ft: 50, opacity: 0.5 } }
    expect((await call('office', 'PUT', `/api/site-plans/${jobId}`, { plan, baseRevision: cur.revision })).status).toBe(200)
    // Another job's survey address is refused.
    const other = { ...plan, survey: { ...plan.survey, url: plan.survey.url.replace(jobId, otherJobId) } }
    expect((await call('office', 'PUT', `/api/site-plans/${jobId}`, { plan: other, baseRevision: cur.revision + 1 })).status).toBe(400)
  })

  test('the permit sheet: a PDF kept with the job, its title block read back', async () => {
    const made = await call('office', 'POST', `/api/site-plans/${jobId}/permit-sheet`, { size: 'letter', aerial: false })
    expect(made.status).toBe(200)
    expect(made.json.data.url).toBe(`/api/site-plans/${jobId}/permit-sheet.pdf`)
    const pdf = await call('sales', 'GET', made.json.data.url)
    expect(pdf.status).toBe(200)
    const text = pdfText(pdf.buf!)
    for (const w of ['Fence site plan', `Pat ${tag}`, '10501 SW 54th Ct, Ocala, FL 34476', 'SW 54th Ct', `Olive ${tag}`, 'Approximate property lines from county records, not a survey.', 'linear ft']) expect(text, w).toContain(w)
    expect(text).toMatch(/REVISION 5/)
    expect(text).not.toContain('$')
    expect((await call('crew', 'GET', made.json.data.url)).status).toBe(403)
    expect((await prisma.sitePlan.findUnique({ where: { jobId } }))?.permitPdfPath).toMatch(/permit-sheet-r5-\d+\.pdf$/)
  })

  test('the crew\'s installer sheet: posts numbered and typed, "Start here", gates, notes; no price; the walk list replaced once done', async () => {
    const html = await (await fetch(`${base}/p/i/${packetToken}`)).text()
    expect(html).toContain('Site plan (installer sheet)')
    expect(html).toContain('>Start here<')
    expect(html).toMatch(/<text[^>]*>1<\/text>/)
    expect(html).toMatch(/<ol class="postlist" data-site-posts><li value="1">End<\/li>/)
    expect(html).toContain('4 ft single gate')
    expect(html).toContain('Dogs in the yard. Mark the sprinkler heads.')
    expect(html).toContain('data-site-locate')
    expect(html).not.toContain('$')
    expect(html).not.toContain('data-packet-walk')
    expect(html).not.toContain('Site plan not finished yet')
    // Each side's line posts as the quote counted (8 ft sections): the 120 ft back, 15 sections 8 ft apart.
    expect(html).toContain('120 ft: 15 sections, posts 8 ft apart')

    // Reopened: both, the plan marked not finished; "Site plan needed" back on the quote.
    expect((await call('office', 'DELETE', `/api/site-plans/${jobId}/done`)).status).toBe(200)
    expect(((await prisma.savedQuote.findUniqueOrThrow({ where: { id: quoteId } })).layout as any).planDone).toBe(false)
    const open = await (await fetch(`${base}/p/i/${packetToken}`)).text()
    expect(open).toContain('Site plan not finished yet')
    expect(open).toContain('data-packet-walk')
  })

  test('the customer sees the finished plan only once the quote is signed and the plan is done', async () => {
    const q = await prisma.savedQuote.findUniqueOrThrow({ where: { id: quoteId } })
    expect(await customerPlanSvg(q)).toBe('')
    const cur = (await call('office', 'GET', `/api/site-plans/${jobId}`)).json.data
    expect((await call('office', 'POST', `/api/site-plans/${jobId}/done`, { revision: cur.revision })).status).toBe(200)
    const svg = await customerPlanSvg(q)
    expect(svg).toMatch(/^<svg xmlns/)
    expect(svg).not.toContain('Start here')
    expect(await customerPlanSvg({ ...q, status: 'SENT', soldAt: null, acceptedAt: null })).toBe('')
  })

  test('the newest revision first; a 409 carries who saved it last; an older tab\'s origin.source is taken and dropped', async () => {
    const cur = (await call('office', 'GET', `/api/site-plans/${jobId}`)).json.data
    const withSource = { ...cur.plan, origin: { ...cur.plan.origin, source: 'address' } }
    const saved = await call('owner', 'PUT', `/api/site-plans/${jobId}`, { plan: withSource, baseRevision: cur.revision, note: 'Owner looked it over' })
    expect(saved.status).toBe(200)
    const row = await prisma.sitePlan.findUniqueOrThrow({ where: { jobId } })
    expect((row.data as any).origin).toEqual({ lat: cur.plan.origin.lat, lng: cur.plan.origin.lng })
    const stale = await call('office', 'PUT', `/api/site-plans/${jobId}`, { plan: cur.plan, baseRevision: cur.revision })
    expect(stale.status).toBe(409)
    expect(stale.json.current.revisions[0]).toEqual(expect.objectContaining({ revision: saved.json.data.revision, by: `Owen ${tag}`, note: 'Owner looked it over' }))
    const revs = stale.json.current.revisions.map((r: any) => r.revision)
    expect(revs).toEqual([...revs].sort((a: number, b: number) => b - a))
  })

  test('a change order drawn on the plan waits: never on the crew\'s sheet or the done check; approved, it goes on (a revision says so); voided, it comes off', async () => {
    const { reconcilePlanChanges } = await import('../src/server/lib/sitePlans.js')
    const { editChangeOrder } = await import('../src/server/lib/changeOrders.js')
    const co1 = await prisma.changeOrder.create({ data: { accountId, quoteId, number: 1, status: 'sent', reason: 'Add a gate', lines: [], totalCents: 45000, createdBy: 'Olive' } as any })
    const co2 = await prisma.changeOrder.create({ data: { accountId, quoteId, number: 2, status: 'sent', reason: 'Longer back', lines: [], totalCents: 30000, createdBy: 'Olive' } as any })
    const cur = (await call('office', 'GET', `/api/site-plans/${jobId}`)).json.data
    const back = cur.plan.sides[2]
    const pending = [
      { id: 'pc1', coId: co1.id, coNumber: 1, kind: 'gate', sideId: back.id, gate: { id: 'gnew', atFt: 40, widthFt: 5, type: 'walk', swing: 'in', hinge: 'left' }, by: 'Olive', at: '2026-11-06' },
      { id: 'pc2', coId: co2.id, coNumber: 2, kind: 'longer', sideId: cur.plan.sides[1].id, newFt: 130, by: 'Olive', at: '2026-11-06' },
    ]
    // A pending entry for a change order not on this job is refused.
    expect((await call('office', 'PUT', `/api/site-plans/${jobId}`, { plan: { ...cur.plan, pending: [{ ...pending[0], coId: 'nope' }] }, baseRevision: cur.revision })).status).toBe(400)
    const saved = await call('office', 'PUT', `/api/site-plans/${jobId}`, { plan: { ...cur.plan, pending }, baseRevision: cur.revision })
    expect(saved.status).toBe(200)
    // The crew's sheet and the done check: the plan as sold, no 5 ft gate.
    const html = await (await fetch(`${base}/p/i/${packetToken}`)).text()
    expect(html).not.toContain('5 ft single gate')
    const done = await call('office', 'POST', `/api/site-plans/${jobId}/done`, { revision: saved.json.data.revision })
    expect(done.status).toBe(200)

    // CO-1 approved: the gate goes on the plan as a new revision.
    await prisma.changeOrder.update({ where: { id: co1.id }, data: { status: 'approved', approvedAt: new Date(), approvedBy: 'Olive Office' } })
    expect(await reconcilePlanChanges(accountId, quoteId)).toBe(1)
    let g = (await call('office', 'GET', `/api/site-plans/${jobId}`)).json.data
    expect(g.revisions[0]).toEqual(expect.objectContaining({ by: 'Olive Office', note: `Change order CO-1: added a 5 ft single gate on ${back.name}` }))
    expect(g.plan.sides[2].gates.map((x: any) => x.widthFt)).toContain(5)
    expect(g.plan.pending.map((p: any) => p.id)).toEqual(['pc2'])
    const html2 = await (await fetch(`${base}/p/i/${packetToken}`)).text()
    expect(html2).toContain('5 ft single gate')

    // CO-2 voided through the change order's own save: its longer side comes off the plan.
    await editChangeOrder(accountId, co2.id, co2.version, { status: 'void' }, 'Olive')
    g = (await call('office', 'GET', `/api/site-plans/${jobId}`)).json.data
    expect(g.plan.pending).toBeUndefined()
    expect(g.revisions[0].note).toBe('Change order CO-2: voided, its change taken off the plan')
    expect(g.plan.sides[1].quotedFt).toBe(120)
  })

  test('only the latest permit sheet file is kept', async () => {
    const first = await prisma.sitePlan.findUniqueOrThrow({ where: { jobId } })
    expect((await call('office', 'POST', `/api/site-plans/${jobId}/permit-sheet`, { size: 'letter', aerial: false })).status).toBe(200)
    const now = await prisma.sitePlan.findUniqueOrThrow({ where: { jobId } })
    expect(now.permitPdfPath).not.toBe(first.permitPdfPath)
    expect(fs.existsSync(now.permitPdfPath!)).toBe(true)
    expect(fs.existsSync(first.permitPdfPath!)).toBe(false)
  })
})
