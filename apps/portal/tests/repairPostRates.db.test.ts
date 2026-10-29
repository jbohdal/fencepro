/**
 * #31 (Jonathan, Oct 29 2026): "Pulling old posts: $10 per post. Hauling away:
 * $10 per post. Concrete footer disposal: $15 per post." The start-up step
 * (lib/repairPostRates.ts) on a throwaway company on the dev database
 * (DEV_DB=1; refuses any other):
 *
 *   - sets the per post rates in Settings > Moves and Repairs, with a dated
 *     history entry holding the rates they replaced, and logs it;
 *   - runs once: a second start changes nothing, and a rate changed by hand
 *     afterwards stays;
 *   - leaves the rest of Settings and every saved quote as they were.
 */

import 'dotenv/config'
import crypto from 'crypto'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { withRepairPostRates, REPAIR_POST_RATES } from '../src/server/lib/repairPostRates'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

const LIVE_BEFORE = { woodFactorPct: 115, repairProfitPct: 20, minimumJobCents: 35000, pullNdLaborCents: 250, pullNdDisposalCents: 750, pullDsLaborCents: 1200, pullDsDisposalCents: 2400, itemMultipliers: { resetPost: 8 } }

describe('the new rates, pure', () => {
  test('the five rates, the rest kept, a history entry with the day and what they replaced', () => {
    const r = withRepairPostRates(LIVE_BEFORE, '2026-10-29')
    expect(r.moveRepair).toMatchObject({ ...LIVE_BEFORE, pullNdLaborCents: 1000, pullDsLaborCents: 1000, pullNdDisposalCents: 1000, pullDsDisposalCents: 1000, footerDisposalCents: 1500 })
    expect(r.previous).toEqual({ pullNdLaborCents: 250, pullDsLaborCents: 1200, pullNdDisposalCents: 750, pullDsDisposalCents: 2400, footerDisposalCents: null })
    expect(r.moveRepair.rateHistory).toEqual([{ effectiveFrom: '2026-10-29', rates: REPAIR_POST_RATES, previous: r.previous, by: 'Jonathan', note: expect.stringContaining('$15') }])
    // No Settings yet: the rates alone.
    expect(withRepairPostRates(undefined, '2026-10-29').previous.pullNdLaborCents).toBeNull()
  })
})

describe.skipIf(!process.env.DEV_DB || !onDev)('the start-up step (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const S = await import('../src/server/lib/repairPostRates.js')
  const tag = `repair-rates-${crypto.randomUUID().slice(0, 8)}`
  let accountId = ''
  let quoteId = ''
  const priced = { lines: [{ key: 'resetPost:pull', label: 'Pull old posts (no dig)', kind: 'labor', cents: 250, math: '1 posts × $2.50' }], priceCents: 35000 }

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    await prisma.businessState.create({ data: { accountId, config: { company: { name: 'Getter Done Fence', phone: '3527894314' }, moveRepair: LIVE_BEFORE } as any } })
    quoteId = (await prisma.savedQuote.create({ data: { accountId, customerName: `Repair ${tag}`, fenceStyle: "WV-ND 6'x8' Privacy", runs: [], pullSheet: [], finalPrice: 350, status: 'SENT', work: { version: 1, type: 'repair', repair: { items: { resetPost: 1 } }, priced } } as any })).id
  })

  afterAll(async () => {
    if (!accountId) return
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  const cfg = async () => (await prisma.businessState.findUnique({ where: { accountId } }))!

  test('sets the rates once, dated and logged; the rest of Settings and the saved quote stay', async () => {
    const v0 = (await cfg()).version
    const out = await S.ensureRepairPostRates(accountId, new Date('2026-10-29T20:00:00Z'))
    expect(out?.previous).toMatchObject({ pullNdLaborCents: 250, pullDsDisposalCents: 2400, footerDisposalCents: null })
    const b = await cfg()
    expect(b.version).toBe(v0 + 1)
    const mr = (b.config as any).moveRepair
    expect(mr).toMatchObject({ pullNdLaborCents: 1000, pullDsLaborCents: 1000, pullNdDisposalCents: 1000, pullDsDisposalCents: 1000, footerDisposalCents: 1500, repairProfitPct: 20, minimumJobCents: 35000, itemMultipliers: { resetPost: 8 } })
    expect(mr.rateHistory).toHaveLength(1)
    expect(mr.rateHistory[0]).toMatchObject({ effectiveFrom: '2026-10-29', by: 'Jonathan' })
    expect((b.config as any).company.phone).toBe('3527894314')
    const key = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: S.REPAIR_POST_RATES_KEY } } })
    expect((key!.value as any)).toMatchObject({ effectiveFrom: '2026-10-29', rates: REPAIR_POST_RATES })
    const log = await prisma.crmAuditLog.findFirst({ where: { entityType: 'BusinessState', entityId: accountId }, orderBy: { createdAt: 'desc' } })
    expect(JSON.stringify(log?.newValues)).toContain('#31')
    // The quote saved before keeps the price and cost lines it was priced with.
    const q = (await prisma.savedQuote.findUnique({ where: { id: quoteId } }))!
    expect(q.finalPrice).toBe(350)
    expect((q.work as any).priced).toEqual(priced)
  })

  test('a second start changes nothing; a rate changed by hand afterwards stays', async () => {
    const b = await cfg()
    const hand = { ...(b.config as any), moveRepair: { ...(b.config as any).moveRepair, footerDisposalCents: 1800 } }
    await prisma.businessState.update({ where: { accountId }, data: { config: hand } })
    const v = (await cfg()).version
    expect(await S.ensureRepairPostRates(accountId)).toBeNull()
    const after = await cfg()
    expect(after.version).toBe(v)
    expect((after.config as any).moveRepair.footerDisposalCents).toBe(1800)
    expect((after.config as any).moveRepair.rateHistory).toHaveLength(1)
  })
})
