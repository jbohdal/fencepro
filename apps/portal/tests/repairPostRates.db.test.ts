/**
 * #31 (Jonathan, Oct 29 2026): "Pulling old posts: $10 per post. Hauling away:
 * $10 per post. Concrete footer disposal: $15 per post." Corrected the same
 * day: "$10 applies to no dig posts only. Dig set posts keep $12 to pull and
 * $24 to haul, since they come out with concrete." The start-up step
 * (lib/repairPostRates.ts) on throwaway companies on the dev database
 * (DEV_DB=1; refuses any other):
 *
 *   - sets the no dig pull and disposal and the concrete footer rate in
 *     Settings > Moves and Repairs, with a dated history entry holding only
 *     the rates that changed and the ones they replaced, and logs it;
 *   - never touches the dig set pull or disposal: saved values stay, blank
 *     stays blank;
 *   - runs once: a second start changes nothing, and a rate changed by hand
 *     afterwards stays;
 *   - on a company where the rates are already set (a dev copy that ran the
 *     first version), changes nothing and adds no entry or log line;
 *   - leaves the rest of Settings and every saved quote as they were.
 */

import 'dotenv/config'
import crypto from 'crypto'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { withRepairPostRates, REPAIR_POST_RATES, REPAIR_POST_RATES_KEY } from '../src/server/lib/repairPostRates'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

/** Live's config.moveRepair, read only on Oct 29 2026. */
const LIVE_BEFORE = { woodFactorPct: 115, repairProfitPct: 20, minimumJobCents: 35000, pullNdLaborCents: 250, pullNdDisposalCents: 750, pullDsLaborCents: 1200, pullDsDisposalCents: 2400, itemMultipliers: { resetPost: 8 } }

describe('the new rates, pure', () => {
  test('the step sets no dig pull, no dig disposal and the footer only; a new key', () => {
    expect(REPAIR_POST_RATES).toEqual({ pullNdLaborCents: 1000, pullNdDisposalCents: 1000, footerDisposalCents: 1500 })
    expect(REPAIR_POST_RATES_KEY).toBe('migration:repair-post-rates-2026-10-29b')
  })

  test('live: no dig to $10 / $10, footer $15, dig set stays $12 / $24; the entry holds only what changed', () => {
    const r = withRepairPostRates(LIVE_BEFORE, '2026-10-29')
    expect(r.moveRepair).toEqual({
      ...LIVE_BEFORE, pullNdLaborCents: 1000, pullNdDisposalCents: 1000, pullDsLaborCents: 1200, pullDsDisposalCents: 2400, footerDisposalCents: 1500,
      rateHistory: [{ effectiveFrom: '2026-10-29', rates: { pullNdLaborCents: 1000, pullNdDisposalCents: 1000, footerDisposalCents: 1500 }, previous: { pullNdLaborCents: 250, pullNdDisposalCents: 750, footerDisposalCents: null }, by: 'Jonathan', note: expect.stringContaining('dig set unchanged') }],
    })
  })

  test('dig set blank stays blank; no Settings yet gets the three rates alone', () => {
    const blank = withRepairPostRates({ pullNdLaborCents: null, pullDsLaborCents: null }, '2026-10-29')
    expect(blank.moveRepair.pullDsLaborCents).toBeNull()
    expect('pullDsDisposalCents' in blank.moveRepair).toBe(false)
    const none = withRepairPostRates(undefined, '2026-10-29')
    expect(Object.keys(none.moveRepair).sort()).toEqual(['footerDisposalCents', 'pullNdDisposalCents', 'pullNdLaborCents', 'rateHistory'])
    expect(none.previous).toEqual({ pullNdLaborCents: null, pullNdDisposalCents: null, footerDisposalCents: null })
  })

  test('a rate already at its value is left out; none changed means no entry and Settings as it was', () => {
    const some = withRepairPostRates({ pullNdLaborCents: 1000, pullNdDisposalCents: 750 }, '2026-10-29')
    expect(some.rates).toEqual({ pullNdDisposalCents: 1000, footerDisposalCents: 1500 })
    expect(some.previous).toEqual({ pullNdDisposalCents: 750, footerDisposalCents: null })
    // A dev copy that ran the first version (dig set $10 there): nothing to do, dig set left.
    const ranOld = { pullNdLaborCents: 1000, pullNdDisposalCents: 1000, pullDsLaborCents: 1000, pullDsDisposalCents: 1000, footerDisposalCents: 1500, rateHistory: [{ effectiveFrom: '2026-10-29', rates: {}, by: 'Jonathan' }] }
    const r = withRepairPostRates(ranOld, '2026-10-29')
    expect(r.rates).toEqual({})
    expect(r.previous).toEqual({})
    expect(r.moveRepair).toEqual(ranOld)
  })
})

describe.skipIf(!process.env.DEV_DB || !onDev)('the start-up step (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const S = await import('../src/server/lib/repairPostRates.js')
  const tag = `repair-rates-${crypto.randomUUID().slice(0, 8)}`
  const accounts: string[] = []
  let accountId = ''
  let quoteId = ''
  const priced = { lines: [{ key: 'resetPost:pull', label: 'Pull old posts (no dig)', kind: 'labor', cents: 250, math: '1 posts × $2.50' }], priceCents: 35000 }

  const company = async (moveRepair: unknown) => {
    const id = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    accounts.push(id)
    await prisma.businessState.create({ data: { accountId: id, config: { company: { name: 'Getter Done Fence', phone: '3527894314' }, moveRepair } as any } })
    return id
  }

  beforeAll(async () => {
    accountId = await company(LIVE_BEFORE)
    quoteId = (await prisma.savedQuote.create({ data: { accountId, customerName: `Repair ${tag}`, fenceStyle: "WV-ND 6'x8' Privacy", runs: [], pullSheet: [], finalPrice: 350, status: 'SENT', work: { version: 1, type: 'repair', repair: { items: { resetPost: 1 } }, priced } } as any })).id
  })

  afterAll(async () => {
    if (!accounts.length) return
    await prisma.savedQuote.deleteMany({ where: { accountId: { in: accounts } } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId: { in: accounts } } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: accounts } } })
    await prisma.businessState.deleteMany({ where: { accountId: { in: accounts } } })
    await prisma.crmAccount.deleteMany({ where: { id: { in: accounts } } })
  })

  const cfg = async (id = accountId) => (await prisma.businessState.findUnique({ where: { accountId: id } }))!
  const logs = (id: string) => prisma.crmAuditLog.findMany({ where: { entityType: 'BusinessState', entityId: id } })

  test('live\'s rates: no dig and footer set once, dated and logged; dig set, the rest of Settings and the saved quote stay', async () => {
    const v0 = (await cfg()).version
    const out = await S.ensureRepairPostRates(accountId, new Date('2026-10-29T20:00:00Z'))
    expect(out).toEqual({
      rates: { pullNdLaborCents: 1000, pullNdDisposalCents: 1000, footerDisposalCents: 1500 },
      previous: { pullNdLaborCents: 250, pullNdDisposalCents: 750, footerDisposalCents: null },
    })
    const b = await cfg()
    expect(b.version).toBe(v0 + 1)
    const mr = (b.config as any).moveRepair
    expect(mr).toMatchObject({ pullNdLaborCents: 1000, pullDsLaborCents: 1200, pullNdDisposalCents: 1000, pullDsDisposalCents: 2400, footerDisposalCents: 1500, repairProfitPct: 20, minimumJobCents: 35000, itemMultipliers: { resetPost: 8 } })
    expect(mr.rateHistory).toHaveLength(1)
    expect(mr.rateHistory[0]).toMatchObject({ effectiveFrom: '2026-10-29', by: 'Jonathan', rates: out!.rates, previous: out!.previous })
    expect((b.config as any).company.phone).toBe('3527894314')
    const key = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: S.REPAIR_POST_RATES_KEY } } })
    expect((key!.value as any)).toMatchObject({ effectiveFrom: '2026-10-29', rates: out!.rates, previous: out!.previous })
    const log = await logs(accountId)
    expect(log).toHaveLength(1)
    expect(JSON.stringify(log[0].newValues)).toContain('#31')
    expect(JSON.stringify(log[0].newValues)).not.toContain('pullDs')
    expect(JSON.stringify(log[0].oldValues)).not.toContain('pullDs')
    // The quote saved before keeps the price and cost lines it was priced with.
    const q = (await prisma.savedQuote.findUnique({ where: { id: quoteId } }))!
    expect(q.finalPrice).toBe(350)
    expect((q.work as any).priced).toEqual(priced)
  })

  test('a second start changes nothing; a rate changed by hand afterwards stays', async () => {
    const b = await cfg()
    const hand = { ...(b.config as any), moveRepair: { ...(b.config as any).moveRepair, footerDisposalCents: 1800, pullNdLaborCents: 900 } }
    await prisma.businessState.update({ where: { accountId }, data: { config: hand } })
    const v = (await cfg()).version
    expect(await S.ensureRepairPostRates(accountId)).toBeNull()
    const after = await cfg()
    expect(after.version).toBe(v)
    expect((after.config as any).moveRepair).toMatchObject({ footerDisposalCents: 1800, pullNdLaborCents: 900 })
    expect((after.config as any).moveRepair.rateHistory).toHaveLength(1)
    expect(await logs(accountId)).toHaveLength(1)
  })

  test('dig set blank (the dev copy): stays blank', async () => {
    const id = await company({ pullNdLaborCents: null, pullNdDisposalCents: null, pullDsLaborCents: null, pullDsDisposalCents: null, footerDisposalCents: null })
    await S.ensureRepairPostRates(id, new Date('2026-10-29T20:00:00Z'))
    const mr = ((await cfg(id)).config as any).moveRepair
    expect(mr).toMatchObject({ pullNdLaborCents: 1000, pullNdDisposalCents: 1000, footerDisposalCents: 1500, pullDsLaborCents: null, pullDsDisposalCents: null })
    expect(mr.rateHistory[0].rates).toEqual(REPAIR_POST_RATES)
  })

  test('a dev copy that ran the first version: nothing changes, no entry, no log line, the key is recorded', async () => {
    const ranOld = { pullNdLaborCents: 1000, pullNdDisposalCents: 1000, pullDsLaborCents: 1000, pullDsDisposalCents: 1000, footerDisposalCents: 1500, rateHistory: [{ effectiveFrom: '2026-10-29', rates: { pullDsLaborCents: 1000 }, by: 'Jonathan' }] }
    const id = await company(ranOld)
    await prisma.accountKeyValue.create({ data: { accountId: id, key: 'migration:repair-post-rates-2026-10-29', value: {} } })
    const v0 = (await cfg(id)).version
    expect(await S.ensureRepairPostRates(id)).toEqual({ rates: {}, previous: {} })
    const b = await cfg(id)
    expect(b.version).toBe(v0)
    expect((b.config as any).moveRepair).toEqual(ranOld)
    expect(await logs(id)).toHaveLength(0)
    expect(await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId: id, key: S.REPAIR_POST_RATES_KEY } } })).not.toBeNull()
  })
})
