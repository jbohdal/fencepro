/**
 * Good, Better, Best tier sets (model ProposalTierSet): the starting sets are
 * made here, once per company, ever (what they are: lib/tierStarters.ts).
 * One transaction holds a lock for the company; the categories already made
 * are kept with the company (AccountKeyValue 'tierSetsMade'), so a set
 * Jonathan deleted stays deleted, and the database allows one set per
 * category, so two or three requests at the same moment still leave one.
 */

import prisma from './prisma.js'
import { startersFor, CHAIN_STARTER, ALUM_STARTER, TWO_OPTION_POPULAR } from './tierStarters.js'
export { tierSetBodySchema, MAX_TIERS } from './tierStarters.js'

const MADE_KEY = 'tierSetsMade'

/** Make the starting tier sets for a company, once (deleted ones stay deleted). */
export async function ensureTierSets(accountId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tiersets:' + accountId}))`
    const kv = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: MADE_KEY } } })
    const made = new Set<string>(Array.isArray(kv?.value) ? (kv!.value as string[]) : [])
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const starters = startersFor(b?.config)
    // A category that already has a set (made by hand) counts as made.
    if (!kv) {
      const have = await tx.proposalTierSet.findMany({ where: { accountId }, select: { category: true } })
      const cats = new Set(have.map(h => h.category.toLowerCase()))
      for (const s of starters) if (cats.has(s.category.toLowerCase())) made.add(s.key)
    }
    const todo = starters.filter(s => !made.has(s.key))
    if (todo.length) await tx.proposalTierSet.createMany({
      data: todo.map(s => ({ accountId, category: s.category, tiers: s.tiers as any, popular: s.popular, sortOrder: s.sortOrder, starter: s.key })),
      skipDuplicates: true,
    })
    for (const s of todo) made.add(s.key)
    if (!kv || todo.length) await tx.accountKeyValue.upsert({
      where: { accountId_key: { accountId, key: MADE_KEY } },
      create: { accountId, key: MADE_KEY, value: [...made] },
      update: { value: [...made] },
    })
  }, { timeout: 15_000 })
}

// ── Aluminum and chain link: two options (Oct 2026) ───────────────────────────

export const TWO_OPTION_KEY = 'migration:two-option-tiers-2026-10'

/** Which two option set a tier set gets, by the starter it was made from or its category. */
function twoOptionFor(row: { starter: string | null; category: string }) {
  const c = row.category.trim().toLowerCase().replace(/\s+/g, '')
  if (row.starter === 'chainlink' || c === 'chainlink') return CHAIN_STARTER
  if (row.starter === 'aluminum' || c === 'aluminum') return ALUM_STARTER
  return null
}

/**
 * The aluminum and chain link tier sets become two options, Dig set with
 * concrete and No dig (Most popular), once per company, ever (AccountKeyValue
 * 'migration:two-option-tiers-2026-10'): a set Jonathan edits afterwards stays
 * as he leaves it, and one he deleted stays deleted. Sets made later start
 * this way (tierStarters.ts). Saved and sent proposals keep the tier set they
 * were made with, so their options and prices do not change.
 */
export async function ensureTwoOptionTiers(accountId: string): Promise<string[]> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tiersets:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: TWO_OPTION_KEY } } })
    if (done) return []
    const rows = await tx.proposalTierSet.findMany({ where: { accountId }, select: { id: true, starter: true, category: true } })
    const changed: string[] = []
    for (const r of rows) {
      const tiers = twoOptionFor(r)
      if (!tiers) continue
      await tx.proposalTierSet.update({ where: { id: r.id }, data: { tiers: tiers as any, popular: TWO_OPTION_POPULAR, version: { increment: 1 } } })
      changed.push(r.category)
    }
    await tx.accountKeyValue.create({ data: { accountId, key: TWO_OPTION_KEY, value: { at: new Date().toISOString(), changed } } })
    return changed
  }, { timeout: 15_000 })
}

/** At server start: every company with saved settings. */
export async function ensureTwoOptionTiersAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const changed = await ensureTwoOptionTiers(r.accountId)
      if (changed.length) console.log(`[tiers] two options for ${r.accountId}: ${changed.join(', ')}`)
    } catch (err) { console.error('[tiers] could not make the two option sets:', err) }
  }
}
