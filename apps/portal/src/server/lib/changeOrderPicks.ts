/**
 * The change order pick list on the server (web/src/changeOrderPicks.ts
 * through the estimate bundle): the Repair price list and the Inventory
 * catalog priced for the job's style as it is now (the newest approved change
 * order's drawing, else the signed quote), at Settings today. Prices only:
 * what any login that makes change orders may see (a Salesman too).
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { dataFor } from './quotePricing.js'
import { workNow } from './changeOrderWork.js'

const err = (status: number, message: string) => Object.assign(new Error(message), { status })

/** The job's style now and whether the quote has a salesman (commission), for a quote of this company. */
async function inputFor(accountId: string, quoteId: string): Promise<{ fenceStyle: string; hasSalesman: boolean }> {
  const q = await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId, deletedAt: null }, select: { fenceStyle: true, hasSalesman: true } })
  if (!q) throw err(404, 'Quote not found')
  const now = (await workNow(accountId, quoteId)).work as { fenceStyle?: unknown } | null
  const fenceStyle = typeof now?.fenceStyle === 'string' && now.fenceStyle ? now.fenceStyle : q.fenceStyle
  return { fenceStyle, hasSalesman: !!q.hasSalesman }
}

export async function pickListFor(accountId: string, quoteId: string) {
  const input = await inputFor(accountId, quoteId)
  const m = await pricingModule() as any
  return m.changeOrderPicksFor(await dataFor(accountId), input)
}

export async function pickPriceFor(accountId: string, quoteId: string, source: string, qty: number) {
  const input = await inputFor(accountId, quoteId)
  const m = await pricingModule() as any
  const r = m.changeOrderPickPriceFor(await dataFor(accountId), input, source, qty)
  if (!r) throw err(404, 'That item is not on the list any more. Pick it again or type a custom line.')
  return { ...r, source, fenceStyle: input.fenceStyle }
}
