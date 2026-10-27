/**
 * Final walkthrough against the dev database (DEV_DB=1; refuses any other).
 *
 * - The same start sent 3 times (one after another, and at once) is one walkthrough.
 * - Finishing is refused until every item is marked, the required photos are
 *   uploaded, the punch list is fixed and re-photographed, and both signatures are in.
 * - The homeowner's link runs out, can be turned off, and is read only once signed.
 * - walkthrough_signed, punch_list_cleared and walkthrough_completed are recorded once each.
 *
 * Removes what it made.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { AddressInfo } from 'net'
import { describe, test, expect, afterAll } from 'vitest'
import { makePng, pngDataUrl } from './fixtures/png'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('final walkthrough (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { walkthroughStaff, walkthroughPublic } = await import('../src/server/routes/walkthroughs.js')
  const { startWalkthrough, isWalkthroughSigned } = await import('../src/server/lib/walkthrough.js')
  const { mediaDir } = await import('../src/server/lib/media.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null } }, orderBy: { createdAt: 'asc' } }))!
  const accountId = user.crmAccountId!
  const token = jwt.sign({ sub: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '10m' })

  const app = express()
  app.use(express.json({ limit: '10mb' }))
  app.use('/api/walkthroughs', walkthroughStaff)
  app.use('/p/w', walkthroughPublic)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (method: string, p: string, body?: unknown, auth = true) => fetch(base + p, { method, headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => null) as any, text: '' }))
  const page = (p: string) => fetch(base + p).then(async r => ({ status: r.status, text: await r.text() }))

  // A customer and two jobs of our own.
  const contactId = crypto.randomUUID()
  const jobs: string[] = []
  const mediaIds: string[] = []
  await prisma.crmContact.create({ data: { id: contactId, accountId, firstName: 'E2E', lastName: 'Walkthrough Test', phone: '3525550197' } as any })
  const newJob = async () => {
    const j = await prisma.savedJob.create({ data: { accountId, crmContactId: contactId, customerName: 'E2E Walkthrough Test', customerAddress: '1 Test St, Ocala, FL', fenceStyle: "CL - 4' Galv", walkGates: 1, dblGates: 0, status: 'in_progress' } as any })
    jobs.push(j.id); return j.id
  }
  /** A photo as if the phone's upload finished: a real file and its MediaItem. */
  const uploaded = async (clientId: string) => {
    const id = crypto.randomUUID()
    const file = path.join(mediaDir(accountId), `${id}.png`)
    fs.writeFileSync(file, makePng(320, 240))
    await prisma.mediaItem.create({ data: { id, accountId, clientId, kind: 'photo', mime: 'image/png', path: file, bytes: 100, jobId: jobs[0], customerId: contactId, takenAt: new Date(), category: 'Completed', visibility: 'customer', status: 'ready' } })
    mediaIds.push(id)
  }

  afterAll(async () => {
    const ws = await prisma.walkthrough.findMany({ where: { jobId: { in: jobs } } })
    for (const w of ws) if (w.certificatePath) fs.rmSync(w.certificatePath, { force: true })
    const files = await prisma.portalFile.findMany({ where: { crmCustomerId: contactId } })
    await prisma.portalFile.deleteMany({ where: { crmCustomerId: contactId } })
    for (const f of files) fs.rmSync(path.resolve(process.env.UPLOAD_DIR || './uploads', f.fileKey), { force: true })
    await prisma.automationEvent.deleteMany({ where: { entityId: { in: jobs } } })
    await prisma.walkthroughPunchItem.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.walkthrough.deleteMany({ where: { jobId: { in: jobs } } })
    const media = await prisma.mediaItem.findMany({ where: { id: { in: mediaIds } } })
    for (const m of media) fs.rmSync(m.path, { force: true })
    await prisma.mediaItem.deleteMany({ where: { id: { in: mediaIds } } })
    await prisma.savedJob.deleteMany({ where: { id: { in: jobs } } })
    await prisma.crmContact.deleteMany({ where: { id: contactId } })
    server.close()
  })

  const jobA = await newJob()
  const wid = crypto.randomUUID()

  test('the same start sent 3 times, then 3 at once: one walkthrough', async () => {
    const body = { id: wid, jobId: jobA }
    const seq = [await call('POST', '/api/walkthroughs', body), await call('POST', '/api/walkthroughs', body), await call('POST', '/api/walkthroughs', body)]
    expect(seq.map(a => a.status)).toEqual([201, 200, 200])
    expect(seq.every(a => a.json.data.id === wid)).toBe(true)
    // A second phone starting the same job with its own id gets the same one.
    const other = await Promise.all([1, 2, 3].map(() => call('POST', '/api/walkthroughs', { id: crypto.randomUUID(), jobId: jobA })))
    expect(other.every(a => a.status === 200 && a.json.data.id === wid)).toBe(true)
    expect(await prisma.walkthrough.count({ where: { jobId: jobA } })).toBe(1)
    // Chain link style: chain link's checklist; 1 side (no layout), 1 gate, the wide shot.
    const w = seq[0].json.data
    expect(w.category).toBe('chain_link')
    expect(w.items).toHaveLength(10)
    expect(w.photos.map((s: any) => s.key)).toEqual(['side:1', 'gate:1', 'wide'])
    // For automations: the start step is idempotent too.
    expect(await startWalkthrough(accountId, jobA, 'Automation')).toEqual({ id: wid, created: false })
  })

  test('three at once on a fresh job: one walkthrough, no errors', async () => {
    const jobB = await newJob()
    const id = crypto.randomUUID()
    const r = await Promise.all([1, 2, 3].map(() => call('POST', '/api/walkthroughs', { id, jobId: jobB })))
    expect(r.every(a => a.status === 200 || a.status === 201), JSON.stringify(r.map(a => [a.status, a.json?.error]))).toBe(true)
    expect(r.filter(a => a.status === 201).length).toBe(1)
    expect(await prisma.walkthrough.count({ where: { jobId: jobB } })).toBe(1)
    const viaLib = await startWalkthrough(accountId, (await newJob()), 'Automation')
    expect(viaLib.created).toBe(true)
  })

  test('finishing is refused until photos, signatures and the punch list are done', async () => {
    const finish = () => call('POST', `/api/walkthroughs/${wid}/finish`)
    let r = await finish()
    expect(r.status).toBe(409)
    expect(r.json.data.missing).toEqual(expect.arrayContaining(['10 checklist items not marked', 'Photo needed: Side 1', "Homeowner's signature"]))

    // Every item: one Needs fixing (a punch item), sent twice (one punch item still).
    const items = (await call('GET', `/api/walkthroughs/${wid}`)).json.data.items
    const punchId = crypto.randomUUID()
    for (const i of items) {
      const fix = i.id === 'hardware'
      const body = { result: fix ? 'fix' : 'pass', note: fix ? 'Hinge loose on the walk gate' : '', photoClientId: null, punchId: fix ? punchId : null }
      r = await call('PUT', `/api/walkthroughs/${wid}/items/${i.id}`, body)
      expect(r.status).toBe(200)
      if (fix) r = await call('PUT', `/api/walkthroughs/${wid}/items/${i.id}`, body)
    }
    expect(r.json.data.punch).toHaveLength(1)
    expect(r.json.data.punch[0]).toMatchObject({ id: punchId, status: 'open', label: 'Hardware tight' })

    // Photos chosen on the phone but not uploaded yet: still refused.
    for (const k of ['side:1', 'gate:1', 'wide']) r = await call('PUT', `/api/walkthroughs/${wid}/photos/${encodeURIComponent(k)}`, { clientId: `wt-${k.replace(':', '')}-${wid.slice(0, 8)}` })
    r = await finish()
    expect(r.json.data.missing).toContain('Photo still uploading: Wide shot of the whole fence')
    for (const k of ['side1', 'gate1', 'wide']) await uploaded(`wt-${k}-${wid.slice(0, 8)}`)

    // Our representative signs (sent twice: one signature); role required.
    const bad = await call('PUT', `/api/walkthroughs/${wid}/signatures/rep`, { name: 'Jonathan', role: 'Boss', image: pngDataUrl() })
    expect(bad.status).toBe(400)
    const rep = { name: 'Jonathan Bohdal', role: 'Project coordinator', signedAt: new Date().toISOString(), image: pngDataUrl(), lat: 29.1873, lng: -82.1401, accuracyM: 10 }
    await call('PUT', `/api/walkthroughs/${wid}/signatures/rep`, rep)
    r = await call('PUT', `/api/walkthroughs/${wid}/signatures/rep`, rep)
    expect(r.json.data.repSig).toMatchObject({ name: 'Jonathan Bohdal', role: 'Project coordinator', via: 'device' })
    expect(await isWalkthroughSigned(accountId, jobA)).toBe(false)
    r = await finish()
    expect(r.status).toBe(409)
    expect(r.json.data.missing).toEqual(['1 punch list item to fix and re-photograph', "Homeowner's signature"])

    // The punch item fixed, with its new photo (sent twice).
    const fixPhoto = `wt-fix-${wid.slice(0, 8)}`
    await uploaded(fixPhoto)
    await call('PUT', `/api/walkthroughs/${wid}/punch/${punchId}`, { fixPhotoClientId: fixPhoto, fixNote: 'Tightened all hinge screws' })
    r = await call('PUT', `/api/walkthroughs/${wid}/punch/${punchId}`, { fixPhotoClientId: fixPhoto, fixNote: 'Tightened all hinge screws' })
    expect(r.json.data.punch[0].status).toBe('fixed')
    r = await finish()
    expect(r.json.data.missing).toEqual(["Homeowner's signature"])
    expect((await call('GET', `/api/walkthroughs/${wid}`)).json.data.status).toBe('open')
  })

  test('a retaken photo: the one it replaced is no longer the customer\'s, and the portal shows only the current one', async () => {
    const old = `wt-wide-${wid.slice(0, 8)}`
    const retake = `wt-wide2-${wid.slice(0, 8)}`
    await uploaded(retake)
    const r = await call('PUT', `/api/walkthroughs/${wid}/photos/wide`, { clientId: retake })
    expect(r.status).toBe(200)
    expect((await prisma.mediaItem.findUnique({ where: { clientId: old } }))!.visibility).toBe('internal')
    expect((await prisma.mediaItem.findUnique({ where: { clientId: retake } }))!.visibility).toBe('customer')
    // Photos taken before this fix (all still Customer): the portal leaves out every one a retake replaced.
    const { replacedWalkthroughPhotos } = await import('../src/server/lib/walkthrough.js')
    const caption = 'Final walkthrough: Wide shot of the whole fence'
    const out = await replacedWalkthroughPhotos([
      { clientId: old, jobId: jobA, caption }, { clientId: retake, jobId: jobA, caption },
      { clientId: `wt-side1-${wid.slice(0, 8)}`, jobId: jobA, caption: 'Final walkthrough: Side 1' },
      { clientId: 'not-a-walkthrough-photo', jobId: jobA, caption: 'Progress' },
    ])
    expect([...out]).toEqual([old])
  })

  test('the homeowner link: runs out, can be turned off, read only once signed', async () => {
    let l = await call('POST', `/api/walkthroughs/${wid}/link`)
    const t1 = l.json.data.token
    expect(new Date(l.json.data.expiresAt).getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000)
    expect((await call('POST', `/api/walkthroughs/${wid}/link`)).json.data.token).toBe(t1)
    let p = await page(`/p/w/${t1}`)
    expect(p.status).toBe(200)
    expect(p.text).toContain('Hardware tight')
    expect(p.text).toContain('id="sig"')
    expect(p.text).toMatch(/src="m\/[0-9a-f-]+\/original\?e=/)
    const sign = (t: string, name = 'Pat Homeowner') => call('POST', `/p/w/${t}/sign`, { name, signature: pngDataUrl(), lat: null, lng: null }, false)

    // Run out.
    await prisma.walkthrough.update({ where: { id: wid }, data: { shareExpiresAt: new Date(Date.now() - 1000) } })
    expect((await page(`/p/w/${t1}`)).status).toBe(410)
    expect((await sign(t1)).status).toBe(410)
    // A new link after it ran out; then turned off.
    l = await call('POST', `/api/walkthroughs/${wid}/link`)
    const t2 = l.json.data.token
    expect(t2).not.toBe(t1)
    expect((await page(`/p/w/${t1}`)).status).toBe(404)
    expect((await call('POST', `/api/walkthroughs/${wid}/link-off`)).status).toBe(200)
    p = await page(`/p/w/${t2}`)
    expect(p.status).toBe(410)
    expect(p.text).toContain('turned off')
    expect((await sign(t2)).status).toBe(410)

    // A fresh link; the homeowner signs (twice: the same signature stands), then it is read only.
    const t3 = (await call('POST', `/api/walkthroughs/${wid}/link?new=1`)).json.data.token
    const s1 = await sign(t3)
    expect(s1.status, JSON.stringify(s1.json)).toBe(200)
    expect((await sign(t3)).status).toBe(200)
    expect((await sign(t3, 'Someone Else')).status).toBe(409)
    p = await page(`/p/w/${t3}`)
    expect(p.text).toContain('This page is now read only')
    expect(p.text).not.toContain('id="sig"')
    expect(await isWalkthroughSigned(accountId, jobA)).toBe(true)
  })

  test('finished by the last signature: the certificate is saved to the job and the customer portal', async () => {
    const w = (await call('GET', `/api/walkthroughs/${wid}`)).json.data
    expect(w.status).toBe('completed')
    expect(w.homeownerSig).toMatchObject({ name: 'Pat Homeowner', role: 'Homeowner', via: 'link', lat: null })
    const pdf = await fetch(`${base}/api/walkthroughs/${wid}/certificate.pdf`, { headers: { Authorization: `Bearer ${token}` } })
    expect(pdf.status).toBe(200)
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-')
    const files = await prisma.portalFile.findMany({ where: { crmCustomerId: contactId, deletedAt: null } })
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ label: 'Certificate of Completion', mimeType: 'application/pdf', isVisibleToCustomer: true, source: 'system_generated' })
    expect(fs.existsSync(path.resolve(process.env.UPLOAD_DIR || './uploads', files[0].fileKey))).toBe(true)
    // Finished: read only; finishing again returns it (no second certificate).
    expect((await call('PUT', `/api/walkthroughs/${wid}/items/plumb`, { result: 'fix', note: 'late', photoClientId: null })).status).toBe(409)
    expect((await call('POST', `/api/walkthroughs/${wid}/finish`)).status).toBe(200)
    expect(await prisma.portalFile.count({ where: { crmCustomerId: contactId } })).toBe(1)
  })

  test('each event is recorded once', async () => {
    // Signatures and the fix sent again after the fact change nothing.
    const w = await prisma.walkthrough.findUnique({ where: { id: wid } })
    await call('PUT', `/api/walkthroughs/${wid}/signatures/rep`, (w!.repSig as any))
    await call('POST', `/api/walkthroughs/${wid}/finish`)
    const events = await prisma.automationEvent.findMany({ where: { accountId, entityId: jobA }, orderBy: { occurredAt: 'asc' } })
    const count = (type: string) => events.filter(e => e.type === type).length
    expect(count('walkthrough_signed')).toBe(1)
    expect(count('punch_list_cleared')).toBe(1)
    expect(count('walkthrough_completed')).toBe(1)
    expect(events.find(e => e.type === 'walkthrough_signed')).toMatchObject({ board: 'ops', entityKind: 'job', dedupeKey: `walkthrough:${wid}:signed` })
  })
}, 60_000)
