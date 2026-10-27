/**
 * The installer's service visits (audit Oct 26 2026: a covered warranty
 * visit booked with the installer for Tuesday never showed on his phone).
 * The rule on one appointment (no database), then against the dev database
 * (DEV_DB=1; refuses any other): his visits from today through 60 days, the
 * covered request's issue and no charge work order and its packet, never a price,
 * never another person's visit, a cancelled one or an install.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { isCrewVisit } from '../src/server/lib/crewVisits.js'

const me = { id: 'u-carl', name: 'Carl Crew' }
const at = (iso: string) => new Date(iso)
const base = { type: 'service', status: 'scheduled', startAt: at('2026-10-27T12:30:00Z'), assignedTo: 'Carl Crew', assignedToUserId: 'u-carl', archivedAt: null, deletedAt: null }

describe('which appointments are his visits', () => {
  const today = '2026-10-26'
  test('booked with him (by login, or by his full name on an older booking), today through 60 days', () => {
    expect(isCrewVisit(base, me, today)).toBe(true)
    expect(isCrewVisit({ ...base, assignedToUserId: null, assignedTo: ' carl  crew ' }, me, today)).toBe(true)
    expect(isCrewVisit({ ...base, type: 'warranty', startAt: at('2026-10-26T13:00:00Z') }, me, today)).toBe(true)
    expect(isCrewVisit({ ...base, startAt: at('2026-11-16T15:00:00Z') }, me, today)).toBe(true)
    // A repair 23 days out (review, Oct 27 2026), and the last day.
    expect(isCrewVisit({ ...base, startAt: at('2026-11-18T15:00:00Z') }, me, today)).toBe(true)
    expect(isCrewVisit({ ...base, startAt: at('2026-12-25T15:00:00Z') }, me, today)).toBe(true)
  })
  test('never someone else\'s, a first name alone, cancelled or done, an install, past, beyond 60 days or with no time', () => {
    expect(isCrewVisit({ ...base, assignedToUserId: 'u-other' }, me, today)).toBe(false)
    expect(isCrewVisit({ ...base, assignedToUserId: null, assignedTo: 'Carl' }, me, today)).toBe(false)
    for (const status of ['cancelled', 'completed', 'no_show']) expect(isCrewVisit({ ...base, status }, me, today)).toBe(false)
    expect(isCrewVisit({ ...base, type: 'install' }, me, today)).toBe(false)
    expect(isCrewVisit({ ...base, startAt: at('2026-10-25T15:00:00Z') }, me, today)).toBe(false)
    expect(isCrewVisit({ ...base, startAt: at('2026-12-26T15:00:00Z') }, me, today)).toBe(false)
    expect(isCrewVisit({ ...base, startAt: null }, me, today)).toBe(false)
    expect(isCrewVisit({ ...base, archivedAt: new Date() }, me, today)).toBe(false)
  })
})

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('the installer\'s My installs lists his service visits (dev database)', { timeout: 60_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { packetStaff } = await import('../src/server/routes/installPacket.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `cv-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', baseUrl = '', crewToken = '', crewId = ''
  let server: ReturnType<express.Express['listen']>

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const crew = await prisma.crmUser.create({ data: { email: `${tag}-crew@example.invalid`, firstName: 'Carl', lastName: tag, role: 'field_crew', crmAccountId: accountId, passwordHash: 'x' } as any })
    crewId = crew.id
    crewToken = jwt.sign({ sub: crew.id, email: crew.email, role: 'field_crew', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    const app = express(); app.use(express.json()); app.use('/api/install-packets', packetStaff)
    server = app.listen(0); baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    server?.close()
    if (!accountId) return
    await prisma.serviceTicket.deleteMany({ where: { accountId } })
    await prisma.installPacket.deleteMany({ where: { accountId } })
    await prisma.appointment.deleteMany({ where: { accountId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('the covered warranty visit booked with him shows with its issue, the no charge work order and the packet; nothing else and no price', async () => {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'Walker', lastName: tag, phone: '3525550111', serviceAddress: '110 SE Watula Ave, Ocala, FL 34471' } as any })
    const job = await prisma.savedJob.create({ data: { accountId, crmContactId: c.id, customerName: `Walker ${tag}`, status: 'paid', completedDate: '2026-10-01' } as any })
    const inTwoDays = new Date(Date.now() + 2 * 86_400_000)
    const mk = (data: Record<string, unknown>) => prisma.appointment.create({ data: { accountId, crmContactId: c.id, type: 'warranty', status: 'scheduled', startAt: inTwoDays, address: '110 SE Watula Ave, Ocala, FL 34471', assignedTo: `Carl ${tag}`, assignedToUserId: crewId, ...data } as any })
    const visit = await mk({ notes: 'Gate latch sticks. Quoted $350 if not covered. Bring a latch.' })
    await mk({ assignedTo: 'Someone Else', assignedToUserId: crypto.randomUUID() })
    await mk({ status: 'cancelled' })
    await mk({ type: 'install' })
    await mk({ startAt: new Date(Date.now() + 65 * 86_400_000) })
    await prisma.serviceTicket.create({ data: { accountId, jobId: job.id, crmContactId: c.id, issue: 'gate', notes: 'Latch does not catch.', stage: 'scheduled', decision: 'covered', warrantyName: 'Lifetime Craftsmanship Warranty', appointmentId: visit.id } as any })
    const pk = await prisma.installPacket.create({ data: { accountId, jobId: job.id, token: `pk${tag}${crypto.randomBytes(8).toString('hex')}`, snapshot: {} as any } })

    const r = await fetch(`${baseUrl}/api/install-packets/visits`, { headers: { Authorization: `Bearer ${crewToken}` } }).then(x => x.json()) as any
    expect(r.success).toBe(true)
    expect(r.data.map((v: any) => v.id)).toEqual([visit.id])
    const v = r.data[0]
    expect(v).toMatchObject({ customerName: `Walker ${tag}`, customerPhone: '3525550111', address: '110 SE Watula Ave, Ocala, FL 34471', packetToken: pk.token })
    expect(v.ticket).toMatchObject({ issue: expect.stringMatching(/gate/i), covered: true, warrantyName: 'Lifetime Craftsmanship Warranty', notes: 'Latch does not catch.' })
    expect(v.notes).toContain('Bring a latch.')
    expect(JSON.stringify(r.data)).not.toContain('350')
  })
})
