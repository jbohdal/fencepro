/**
 * Good, Better, Best tier sets (model ProposalTierSet): the starting sets are
 * made here, once per company, ever (what they are: lib/tierStarters.ts).
 * One transaction holds a lock for the company; the categories already made
 * are kept with the company (AccountKeyValue 'tierSetsMade'), so a set
 * Jonathan deleted stays deleted, and the database allows one set per
 * category, so two or three requests at the same moment still leave one.
 */

import prisma from './prisma.js'
import { startersFor } from './tierStarters.js'
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
