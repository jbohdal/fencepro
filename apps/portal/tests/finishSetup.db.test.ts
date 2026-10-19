/**
 * The Finish setup card's list (GET /api/system/setup), against the dev
 * database (DEV_DB=1 and ezbiz_dev only; vitest does not load this file
 * anywhere else). Everything runs on a company made for the test and removed
 * after it.
 *
 *   - Each item links to the screen (and filter) that does it; items that
 *     no longer apply are gone.
 *   - Each item's done check flips when the data behind it changes.
 *   - Commercial and industrial on hold: the five styles are made not
 *     quotable once per company, ever (turned back on, they stay on).
 *
 * Database writes happen only inside beforeAll / test / afterAll.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('Finish setup (dev database)', () => {
  let prisma: any
  let accountId = ''
  let token = ''
  let base = ''
  let server: Server
  const tag = `setup-${Date.now().toString(36)}`
  const backupIds: string[] = []
  const xcodeDir = path.join(os.tmpdir(), `${tag}-Xcode.app`)
  const HELD = ["CL - Com 6'", "CL - Com 6'+1'", "CL - Com 6'+1' Black", 'Alum - DS - Ind Abigail', 'Durafence']
  const styles = [
    { name: "WV-ND 6'x6' Privacy", category: 'Vinyl' }, { name: "CL - 4' Galv", category: 'Chainlink' },
    { name: 'Alum - ND - Emily - 48', category: 'Aluminum' },
    ...HELD.map(name => ({ name, category: name.startsWith('CL') ? 'Commercial' : name === 'Durafence' ? 'Other' : 'Aluminum', isActive: true })),
  ]

  const call = (method: string, p: string, body?: unknown) =>
    fetch(base + p, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))
  const list = async () => { const r = await call('GET', '/api/system/setup'); expect(r.status).toBe(200); return r.json.data as Array<{ key: string; done: boolean; detail: string; link?: string; label: string }> }
  const item = async (key: string) => (await list()).find(i => i.key === key)!
  const setConfig = async (patch: (c: any) => any) => {
    const b = await prisma.businessState.findUnique({ where: { accountId } })
    await prisma.businessState.update({ where: { accountId }, data: { config: patch(b.config), version: { increment: 1 } } })
  }
  const setInventory = (items: unknown[], kits: unknown[] = []) => prisma.inventoryState.update({ where: { accountId }, data: { items, kits } })

  beforeAll(async () => {
    process.env.EZ_XCODE_APP = xcodeDir
    prisma = (await import('../src/server/lib/prisma.js')).default
    const { resolveSecret } = await import('../src/server/lib/secrets.js')
    const user = await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null } }, orderBy: { createdAt: 'asc' } })
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    await prisma.businessState.create({ data: { accountId, config: { fenceStyles: styles, pricing: {} } } })
    await prisma.inventoryState.create({ data: { accountId, items: [], bundles: [], locations: [], stockLevels: [], transactions: [], kits: [] } })
    token = jwt.sign({ sub: user.id, email: user.email, role: 'admin', firstName: 'Test', lastName: 'Setup', crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '10m' })
    const app = express()
    app.use(express.json())
    app.use('/api/system', (await import('../src/server/routes/system.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    delete process.env.EZ_XCODE_APP
    fs.rmSync(xcodeDir, { recursive: true, force: true })
    if (backupIds.length) await prisma.backupLog.deleteMany({ where: { id: { in: backupIds } } }).catch(() => {})
    if (!accountId) return
    for (const m of ['savedJob', 'savedQuote', 'crmContact', 'voiceCheck', 'calendarSyncState', 'inventoryState', 'businessState', 'accountKeyValue']) {
      await prisma[m].deleteMany({ where: { accountId } }).catch((e: unknown) => console.error(`[setup test] ${m} cleanup:`, e))
    }
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch((e: unknown) => console.error('[setup test] account cleanup:', e))
  })

  test('each item links to the screen and filter that does it; Abigail width is gone', async () => {
    const links = Object.fromEntries((await list()).map(i => [i.key, i.link ?? null]))
    expect(links).toEqual({
      'sub-rates': '/settings?tab=pricing&focus=sub-rates',
      'inventory-prices': '/inventory?tab=catalog&price=unconfirmed',
      'fill-in': '/inventory?tab=fillin',
      'close-out': '/operations',
      'off-schedule': '/operations?q=not on GD Schedule',
      'schedule-contacts': '/customers?filter=missing-contact-schedule',
      'google-calendar': '/settings?tab=calendar',
      'voice-check': '/settings?tab=voice&focus=voice-check',
      xcode: null, uptimerobot: null, 'offsite-backup': null,
    })
    const r = await call('POST', '/api/system/setup', { key: 'abigail', value: '8' })
    expect(r.status).toBe(400)
  })

  test('sub-rates: done once gates, tear out, chain link and aluminum rates are set', async () => {
    expect((await item('sub-rates')).done).toBe(false)
    await setConfig(c => ({ ...c, pricing: { subWalkGate: 40, subDblGate: 80, subTearOutSection: 5, subTearOutGate: 10, subRateByCategory: { Chainlink: 2 } } }))
    const half = await item('sub-rates')
    expect(half.done).toBe(false)
    expect(half.detail).toBe('Still missing: aluminum.')
    // A rate on an aluminum style counts only if that style can be quoted.
    await setConfig(c => ({ ...c, fenceStyles: c.fenceStyles.map((s: any) => s.name === 'Alum - DS - Ind Abigail' ? { ...s, subRate: 3, quotable: false } : s) }))
    expect((await item('sub-rates')).done).toBe(false)
    await setConfig(c => ({ ...c, fenceStyles: c.fenceStyles.map((s: any) => s.name === 'Alum - ND - Emily - 48' ? { ...s, subRate: 3 } : s) }))
    expect((await item('sub-rates')).done).toBe(true)
  })

  test('inventory-prices: done when every active price is confirmed', async () => {
    await setInventory([{ id: 'a', name: 'Post', unitCost: 10, priceImported: true, priceUpdatedAt: '2026-10-01' }, { id: 'b', name: 'Old cap', unitCost: 1, status: 'inactive' }])
    const one = await item('inventory-prices')
    expect(one.done).toBe(false)
    expect(one.detail).toBe('1 of 1 prices not confirmed yet.')
    await setInventory([{ id: 'a', name: 'Post', unitCost: 10, priceImported: false, priceUpdatedAt: '2026-10-19' }, { id: 'b', name: 'Old cap', unitCost: 1, status: 'inactive' }])
    expect((await item('inventory-prices')).done).toBe(true)
  })

  test('fill-in: $0 prices count; commercial gate parts and Durafence only while they can be quoted', async () => {
    await setConfig(c => ({ ...c, fenceStyles: c.fenceStyles.map((s: any) => HELD.includes(s.name) ? { ...s, quotable: false } : s) }))
    await setInventory([{ id: 'a', name: 'Post', unitCost: 0 }])
    let it = await item('fill-in')
    expect(it.done).toBe(false)
    expect(it.detail).toMatch(/^Still to fill in: 1 prices at \$0\. Commercial and industrial parts wait/)
    await setInventory([{ id: 'a', name: 'Post', unitCost: 10 }])
    expect((await item('fill-in')).done).toBe(true)
    // CL - Com 6' back on for quoting: its gate parts are asked for again.
    await setConfig(c => ({ ...c, fenceStyles: c.fenceStyles.map((s: any) => s.name === "CL - Com 6'" ? { ...s, quotable: true } : s) }))
    it = await item('fill-in')
    expect(it.done).toBe(false)
    expect(it.detail).toContain("gate parts for CL - Com 6'")
    expect(it.detail).not.toContain('Durafence')
    await setInventory([{ id: 'a', name: 'Post', unitCost: 10 }], [{ id: 'k', styleName: "CL - Com 6'", kits: {}, filledInAt: new Date().toISOString() }])
    expect((await item('fill-in')).done).toBe(true)
  })

  test('close-out: done when each is Complete and paid, archived, or its quote is Lost; Open shows just the open ones', async () => {
    const q = await prisma.savedQuote.create({ data: { accountId, customerName: 'Bill Tieman', runs: [], pullSheet: [], status: 'SOLD' } })
    const [pahl, madsen, tieman] = await Promise.all([
      prisma.savedJob.create({ data: { accountId, customerName: 'Diane Pahl', status: 'invoiced', paymentStatus: 'not_invoiced' } }),
      prisma.savedJob.create({ data: { accountId, customerName: 'Brenda Madsen', status: 'completed', paymentStatus: 'not_invoiced' } }),
      prisma.savedJob.create({ data: { accountId, customerName: 'Bill Tieman', status: 'completed', paymentStatus: 'not_invoiced', quoteId: q.id } }),
    ])
    let it = await item('close-out')
    expect(it.done).toBe(false)
    expect(it.link?.startsWith('/operations?ids=')).toBe(true)
    expect(new Set(it.link!.split('=')[1].split(','))).toEqual(new Set([pahl.id, madsen.id, tieman.id]))
    // Madsen: Complete and paid.
    await prisma.savedJob.update({ where: { id: madsen.id }, data: { paymentStatus: 'paid' } })
    // Pahl: archived (removed from the board).
    await prisma.savedJob.update({ where: { id: pahl.id }, data: { archivedAt: new Date() } })
    it = await item('close-out')
    expect(it.done).toBe(false)
    expect(it.link).toBe(`/operations?ids=${tieman.id}`)
    expect(it.detail).toMatch(/^Bill Tieman: completed, not paid\./)
    // Tieman: his quote marked Lost.
    await prisma.savedQuote.update({ where: { id: q.id }, data: { status: 'LOST' } })
    it = await item('close-out')
    expect(it.done).toBe(true)
    expect(it.link).toBe('/operations')
  })

  test('off-schedule: counts the tagged jobs; done when looked at', async () => {
    await prisma.savedJob.create({ data: { accountId, customerName: 'Tagged One', status: 'paid', notes: 'Old job. Tag: not on GD Schedule' } })
    let it = await item('off-schedule')
    expect(it.label).toBe('The 1 jobs not on the GD Schedule')
    expect(it.done).toBe(false)
    expect((await call('POST', '/api/system/setup', { key: 'off-schedule', value: 'reviewed' })).status).toBe(200)
    it = await item('off-schedule')
    expect(it.done).toBe(true)
  })

  test('schedule-contacts: GD Schedule customers with neither phone nor email; done once each has one', async () => {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'Otter', lastName: 'Test', phone: '', email: null, notes: 'Created from the GD Schedule (first job Apr 26).' } })
    await prisma.crmContact.create({ data: { accountId, firstName: 'Jobnimbus', lastName: 'Test', notes: 'Imported from JobNimbus' } })
    let it = await item('schedule-contacts')
    expect(it.done).toBe(false)
    expect(it.detail).toBe('1 customer still has neither.')
    await prisma.crmContact.update({ where: { id: c.id }, data: { phone: '3525550100' } })
    it = await item('schedule-contacts')
    expect(it.done).toBe(true)
  })

  test('google-calendar: done when connected to "Getter Done Fence", turned on, no error', async () => {
    await prisma.calendarSyncState.create({ data: { accountId, calendarName: 'Other', activatedAt: new Date() } })
    expect((await item('google-calendar')).done).toBe(false)
    await prisma.calendarSyncState.update({ where: { accountId }, data: { calendarName: 'Getter Done Fence', lastError: 'expired' } })
    expect((await item('google-calendar')).done).toBe(false)
    await prisma.calendarSyncState.update({ where: { accountId }, data: { lastError: null } })
    expect((await item('google-calendar')).done).toBe(true)
  })

  test('voice-check: a check from a computer does not count; one from a phone does', async () => {
    await prisma.voiceCheck.create({ data: { accountId, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', results: {} } })
    expect((await item('voice-check')).done).toBe(false)
    await prisma.voiceCheck.create({ data: { accountId, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', results: {} } })
    expect((await item('voice-check')).done).toBe(true)
  })

  test('xcode: done when Xcode is on the Mac', async () => {
    expect((await item('xcode')).done).toBe(false)
    fs.mkdirSync(xcodeDir, { recursive: true })
    expect((await item('xcode')).done).toBe(true)
  })

  test('uptimerobot: done when UptimeRobot checked in the last 2 days', async () => {
    await prisma.accountKeyValue.create({ data: { accountId, key: 'uptimeRobotSeenAt', value: new Date(Date.now() - 3 * 86_400_000).toISOString() } })
    expect((await item('uptimerobot')).done).toBe(false)
    await prisma.accountKeyValue.update({ where: { accountId_key: { accountId, key: 'uptimeRobotSeenAt' } }, data: { value: new Date().toISOString() } })
    expect((await item('uptimerobot')).done).toBe(true)
  })

  test('offsite-backup: a copy older than 2 days does not count; a fresh one does', async () => {
    // The backup log is the Mac's, not the company's: other copies may already be there.
    const recent = await prisma.backupLog.findFirst({ where: { backupType: 'offsite', status: 'success', completedAt: { gte: new Date(Date.now() - 2 * 86_400_000) } } })
    const old = await prisma.backupLog.create({ data: { backupType: 'offsite', filePath: `/tmp/${tag}-old`, status: 'success', startedAt: new Date(Date.now() - 3 * 86_400_000), completedAt: new Date(Date.now() - 3 * 86_400_000) } })
    backupIds.push(old.id)
    expect((await item('offsite-backup')).done).toBe(!!recent)
    const fresh = await prisma.backupLog.create({ data: { backupType: 'offsite', filePath: `/tmp/${tag}-new`, status: 'success', startedAt: new Date(), completedAt: new Date() } })
    backupIds.push(fresh.id)
    expect((await item('offsite-backup')).done).toBe(true)
  })

  test('styles on hold: made once, three at once leave one change; turned back on, it stays on', async () => {
    const { ensureStylesOnHold, STYLES_ON_HOLD_KEY } = await import('../src/server/lib/stylesOnHold.js')
    await setConfig(c => ({ ...c, fenceStyles: styles }))
    const runs = await Promise.all([ensureStylesOnHold(accountId), ensureStylesOnHold(accountId), ensureStylesOnHold(accountId)])
    expect(runs.filter(r => r.length).length).toBe(1)
    expect(runs.find(r => r.length)!.sort()).toEqual([...HELD].sort())
    const after = (await prisma.businessState.findUnique({ where: { accountId } })).config.fenceStyles
    expect(after.filter((s: any) => s.quotable === false).map((s: any) => s.name).sort()).toEqual([...HELD].sort())
    expect(after.find((s: any) => s.name === "CL - 4' Galv").quotable).toBeUndefined()
    expect(await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: STYLES_ON_HOLD_KEY } } })).not.toBeNull()
    // Jonathan turns CL - Com 6' back on; the next server start leaves it on.
    await setConfig(c => ({ ...c, fenceStyles: c.fenceStyles.map((s: any) => s.name === "CL - Com 6'" ? { ...s, quotable: true } : s) }))
    expect(await ensureStylesOnHold(accountId)).toEqual([])
    const later = (await prisma.businessState.findUnique({ where: { accountId } })).config.fenceStyles
    expect(later.find((s: any) => s.name === "CL - Com 6'").quotable).toBe(true)
  })
})
