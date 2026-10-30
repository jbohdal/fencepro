/**
 * The deposit the quote window's Preview says, as the server sends it (dev
 * database, DEV_DB=1; refuses any other), in a throwaway company:
 *   GET /api/saved-quotes/:id/deposit-terms, and the customer's copy
 *   (GET /api/saved-quotes/share/:token) carry the same answer:
 *   0% or blank none, 30% 30, no proposal the standard 50, signed before the
 *   Oct 29 2026 rules as signed. Another company's quote is not found.
 * Removes what it made.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('the Preview\'s deposit from the server (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: savedQuotes } = await import('../src/server/routes/saved-quotes.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { CUSTOMER_DOLLARS_KEY } = await import('../src/server/lib/customerDollars.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

  const stamp = Date.now().toString(36)
  let accountId = '', otherId = '', base = '', owner = '', stranger = ''
  let server: ReturnType<express.Express['listen']>
  const ids: Record<string, string> = {}
  const tokens: Record<string, string> = {}
  const get = (who: string, p: string) => fetch(base + p, { headers: who ? { Authorization: `Bearer ${who}` } : {} }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) as any }))
  const option = { label: 'White Vinyl Privacy', fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 7113.83, perFoot: 0, sections: 19 }
  const proposalAt = (depositPct: unknown) => ({ version: 1, recommended: 0, options: [option], ...(depositPct === 'absent' ? {} : { depositPct }) })

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test preview deposit-${stamp}`, status: 'active' } })).id
    otherId = (await prisma.crmAccount.create({ data: { name: `Test preview deposit other-${stamp}`, status: 'active' } })).id
    // The rules began an hour ago for this company.
    await prisma.accountKeyValue.create({ data: { accountId, key: CUSTOMER_DOLLARS_KEY, value: new Date(Date.now() - 3_600_000).toISOString() } })
    const sign = (acc: string) => jwt.sign({ sub: `preview-test-${stamp}`, email: 'preview@example.invalid', role: 'super_admin', crmAccountId: acc }, secret, { expiresIn: '10m' })
    owner = sign(accountId); stranger = sign(otherId)
    const make = async (key: string, proposal: unknown, extra: Record<string, unknown> = {}) => {
      tokens[key] = `preview-dep-${key}-${crypto.randomBytes(8).toString('hex')}`
      ids[key] = (await prisma.savedQuote.create({ data: {
        accountId, customerName: `E2E Preview ${key}`, customerPhone: '3525550188', customerEmail: '', customerAddress: '1 Preview Test Way, Ocala, FL',
        fenceStyle: option.fenceStyle, runs: [150], sections: 19, corners: 0, ends: 2, walkGates: 1,
        materialCost: 3000, laborCost: 1000, tearOutCost: 0, totalCOGS: 4000, finalPrice: 7113.83, gmPct: 0.45, pullSheet: [],
        status: 'SENT', proposal: proposal as any, shareToken: tokens[key], shareExpiresAt: new Date(Date.now() + 20 * 86_400_000), ...extra,
      } as any })).id
    }
    await make('zero', proposalAt(0))
    await make('blank', proposalAt(null))
    await make('absent', proposalAt('absent'))
    await make('thirty', proposalAt(30))
    await make('none', undefined)
    await make('oldSigned', proposalAt(0), { status: 'SOLD', soldAt: new Date('2026-10-20T15:00:00Z') })
    await make('newSigned', proposalAt(0), { status: 'SOLD', soldAt: new Date() })
    const app = express()
    app.use(express.json())
    app.use('/api/saved-quotes', savedQuotes)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    await prisma.savedQuote.deleteMany({ where: { accountId: { in: [accountId, otherId].filter(Boolean) } } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId: { in: [accountId, otherId].filter(Boolean) } } })
    await prisma.crmAccount.deleteMany({ where: { id: { in: [accountId, otherId].filter(Boolean) } } })
  })

  const expected: Record<string, { asSigned: boolean; depositPct: number | null }> = {
    zero: { asSigned: false, depositPct: null },
    blank: { asSigned: false, depositPct: null },
    absent: { asSigned: false, depositPct: null },
    thirty: { asSigned: false, depositPct: 30 },
    none: { asSigned: false, depositPct: 50 },
    oldSigned: { asSigned: true, depositPct: null },
    newSigned: { asSigned: false, depositPct: null },
  }

  test('the quote window\'s Preview: 0% and blank none, 30% 30, no proposal 50, signed before the rules as signed', async () => {
    for (const [key, want] of Object.entries(expected)) {
      const r = await get(owner, `/api/saved-quotes/${ids[key]}/deposit-terms`)
      expect([key, r.status, r.json?.data]).toEqual([key, 200, want])
    }
  })

  test('the customer\'s copy carries the same answer', async () => {
    for (const key of ['zero', 'blank', 'thirty', 'none']) {
      const r = await get('', `/api/saved-quotes/share/${tokens[key]}`)
      expect([key, r.status, r.json?.data?.depositTerms]).toEqual([key, 200, expected[key]])
      // Still no costs in the customer's copy.
      expect(r.json.data.materialCost).toBe(0)
    }
  })

  test('signed in, and only for its own company', async () => {
    expect((await get('', `/api/saved-quotes/${ids.zero}/deposit-terms`)).status).toBe(401)
    expect((await get(stranger, `/api/saved-quotes/${ids.zero}/deposit-terms`)).status).toBe(404)
  })
})
