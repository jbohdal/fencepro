/**
 * Lead sources and customer tags on the server: each company's two option
 * lists (Settings > Lead Sources, Settings > Customer Tags), where they are
 * kept, and the only ways they change. The rules for reading them are in
 * optionListModel.ts, the same file the web app uses.
 *
 * Kept in AccountKeyValue ('fencepro_lead_sources', 'fencepro_customer_tags';
 * one row per company each, versioned). Only /api/option-lists writes them
 * (routes/option-lists.ts); /api/kv refuses the keys, and Settings' old plain
 * lists (config.leadSources, config.customerTags) are no longer read.
 *
 *   - Saving a list: an option can only leave the list unused, or merged into
 *     another (its words then count as that one's). Built-ins stay.
 *   - Records keep their words. A save of a customer, quote, job or card
 *     keeps an id or linked word as it is, makes an option's name typed in
 *     any capital letters that option's id, and keeps anything else as typed
 *     (wordToSave).
 *   - Once per company (ensureOptionListsAll, at start up): the lists made
 *     from the Settings words and every word on records; no record changes.
 */

import prisma from './prisma.js'
import { lockAccountState } from './lockState.js'
import {
  cleanOptions, normalizeOptions, optionsProblem, optionsFromOld, wordsOf, wordToSave, START_MERGES, BUILT_IN_OPTIONS,
  type OptionDef, type OptionListKind, type RecordWord,
} from './optionListModel.js'

export const OPTION_LIST_KEY: Record<OptionListKind, string> = { leadSources: 'fencepro_lead_sources', customerTags: 'fencepro_customer_tags' }
export const OPTION_LISTS_MIGRATION_KEY = 'migration:option-lists-2026-10'
export const OPTION_KINDS: OptionListKind[] = ['leadSources', 'customerTags']
export const isOptionKind = (k: unknown): k is OptionListKind => k === 'leadSources' || k === 'customerTags'

type Db = any

export const isOptionList = (v: unknown) => Array.isArray(v) && v.every((x: any) => x && typeof x.id === 'string' && Array.isArray(x.alsoMatches))

export interface OptionList { options: OptionDef[]; version: number }

/** Settings' old plain list: what forms offered before. */
async function oldSettingsWords(accountId: string, kind: OptionListKind, db: Db): Promise<string[]> {
  const b = await db.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const v = (b?.config as any)?.[kind]
  return Array.isArray(v) ? v.filter((w: unknown): w is string => typeof w === 'string' && !!w.trim()) : []
}

/** The company's list. Before its one-time step has run: the old Settings words and the built-ins. */
export async function loadOptionList(accountId: string, kind: OptionListKind, db: Db = prisma): Promise<OptionList> {
  const row = await db.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: OPTION_LIST_KEY[kind] } } })
  if (row && isOptionList(row.value)) return { options: normalizeOptions(row.value, kind), version: row.version }
  const words = await oldSettingsWords(accountId, kind, db)
  return { options: normalizeOptions(words.map((w, i) => ({ id: w, name: w, order: i, alsoMatches: [] })), kind), version: row?.version ?? 0 }
}

/** Every word on records, with how many records have it and whether a customer made in the last 12 months has it. */
export async function recordWords(accountId: string, kind: OptionListKind, db: Db = prisma, now = new Date()): Promise<Array<RecordWord & { tables: Record<string, number> }>> {
  const since = new Date(now.getTime() - 365 * 86_400_000)
  const m = new Map<string, RecordWord & { tables: Record<string, number> }>()
  const add = (word: unknown, table: string, recent = false) => {
    if (typeof word !== 'string' || !word.trim()) return
    const r = m.get(word) ?? { word, count: 0, recentCustomer: false, tables: {} }
    r.count++; r.tables[table] = (r.tables[table] ?? 0) + 1
    if (recent) r.recentCustomer = true
    m.set(word, r)
  }
  // all rows: a deleted record keeps its word and can be restored, so its word still counts.
  const contacts = await db.crmContact.findMany({ where: { accountId }, select: { leadSource: true, tags: true, createdAt: true } })
  const p = await db.pipelineState.findUnique({ where: { accountId }, select: { leads: true, archivedLeads: true } })
  const cards = [...(((p?.leads as any[]) ?? [])), ...(((p?.archivedLeads as any[]) ?? []))]
  if (kind === 'leadSources') {
    for (const c of contacts) add(c.leadSource, 'customers', c.createdAt >= since)
    // all rows: a deleted record keeps its word and can be restored, so its word still counts.
    for (const q of await db.savedQuote.findMany({ where: { accountId }, select: { leadSource: true } })) add(q.leadSource, 'quotes')
    // all rows: a deleted record keeps its word and can be restored, so its word still counts.
    for (const j of await db.savedJob.findMany({ where: { accountId }, select: { leadSource: true } })) add(j.leadSource, 'jobs')
    for (const l of cards) add(l?.leadSource, 'cards')
  } else {
    for (const c of contacts) for (const t of Array.isArray(c.tags) ? (c.tags as unknown[]) : []) add(t, 'customers', c.createdAt >= since)
    for (const l of cards) for (const t of Array.isArray(l?.tags) ? (l.tags as unknown[]) : []) add(t, 'cards')
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
}

async function lockList(tx: Db, accountId: string, kind: OptionListKind) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'option-list:' + kind + ':' + accountId}))`
}

async function writeList(tx: Db, accountId: string, kind: OptionListKind, options: OptionDef[], userId: string | null): Promise<OptionList> {
  const value = cleanOptions(options) as any
  const row = await tx.accountKeyValue.upsert({
    where: { accountId_key: { accountId, key: OPTION_LIST_KEY[kind] } },
    create: { accountId, key: OPTION_LIST_KEY[kind], value, updatedBy: userId },
    update: { value, updatedBy: userId, version: { increment: 1 } },
  })
  return { options: normalizeOptions(row.value, kind), version: row.version }
}

export type SaveAnswer =
  | { ok: true; list: OptionList }
  | { ok: false; status: number; code: string; error: string; list?: OptionList; inUse?: { word: string; count: number } }

/** Save the whole list (rename, reorder, hide, add, merge, undo merge, delete an unused option). */
export async function saveOptionList(accountId: string, kind: OptionListKind, raw: unknown, baseVersion: number, userId: string | null): Promise<SaveAnswer> {
  return prisma.$transaction(async tx => {
    await lockList(tx, accountId, kind)
    const cur = await loadOptionList(accountId, kind, tx)
    if (cur.version !== baseVersion) return { ok: false, status: 409, code: 'STALE', error: 'Someone else saved this list first. Their list is on screen now; make your change again.', list: cur }
    const next = cleanOptions(raw)
    for (const o of next) if (BUILT_IN_OPTIONS[kind].includes(o.id)) o.builtIn = true; else o.builtIn = false
    const problem = optionsProblem(next, kind)
    if (problem) return { ok: false, status: 400, code: 'INVALID', error: problem, list: cur }
    // A word that leaves the list (not kept as an option or a link) must be on no record.
    const kept = new Set(next.flatMap(wordsOf))
    const gone = cur.options.flatMap(wordsOf).filter(w => !kept.has(w))
    if (gone.length) {
      const used = new Map((await recordWords(accountId, kind, tx)).map(r => [r.word, r.count]))
      const w = gone.find(x => (used.get(x) ?? 0) > 0)
      if (w) return { ok: false, status: 409, code: 'IN_USE', error: `"${w}" is on ${used.get(w)} record(s). Merge it into another option instead of deleting it.`, list: cur, inUse: { word: w, count: used.get(w)! } }
    }
    return { ok: true, list: await writeList(tx, accountId, kind, next, userId) }
  }, { timeout: 20_000 })
}

/** The word a save keeps, by the company's list (see wordToSave). */
export async function canonicalWord(accountId: string, kind: OptionListKind, word: string | null | undefined, db: Db = prisma): Promise<string | null | undefined> {
  if (!word || !word.trim()) return word
  return wordToSave((await loadOptionList(accountId, kind, db)).options, word)
}
export async function canonicalTags(accountId: string, tags: unknown, db: Db = prisma): Promise<unknown> {
  if (!Array.isArray(tags) || !tags.length) return tags
  const { options } = await loadOptionList(accountId, 'customerTags', db)
  return [...new Set(tags.map(t => (typeof t === 'string' ? wordToSave(options, t) : t)))]
}

/** What the one-time step would write for a company, read only. */
export async function planOptionLists(accountId: string, db: Db = prisma, now = new Date()) {
  const out: Record<OptionListKind, ReturnType<typeof optionsFromOld> & { write: boolean; settingsWords: string[]; words: Awaited<ReturnType<typeof recordWords>> }> = {} as any
  for (const kind of OPTION_KINDS) {
    const row = await db.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: OPTION_LIST_KEY[kind] } } })
    const settingsWords = await oldSettingsWords(accountId, kind, db)
    const words = await recordWords(accountId, kind, db, now)
    if (row && isOptionList(row.value)) { out[kind] = { write: false, options: normalizeOptions(row.value, kind), caseLinks: [], merged: [], hidden: [], settingsWords, words }; continue }
    out[kind] = { write: true, ...optionsFromOld(kind, settingsWords, words, START_MERGES[kind], now.toISOString()), settingsWords, words }
  }
  return out
}

/**
 * Once per company, ever (AccountKeyValue OPTION_LISTS_MIGRATION_KEY): both
 * lists, from the Settings words and every word on records. Case twins are
 * linked, Google and Repeat Customer merged, the built-ins hidden from
 * pickers. No record is touched.
 */
export async function ensureOptionLists(accountId: string): Promise<null | Record<OptionListKind, { wrote: boolean; caseLinks: Array<{ word: string; into: string }>; merged: Array<{ from: string; into: string }>; hidden: string[] }>> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'option-lists-once:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: OPTION_LISTS_MIGRATION_KEY } } })
    if (done) return null
    await lockAccountState(tx, accountId)
    for (const kind of OPTION_KINDS) await lockList(tx, accountId, kind)
    const plan = await planOptionLists(accountId, tx)
    const out: any = {}
    for (const kind of OPTION_KINDS) {
      const p = plan[kind]
      if (p.write) await writeList(tx, accountId, kind, p.options, null)
      out[kind] = { wrote: p.write, caseLinks: p.caseLinks, merged: p.merged, hidden: p.hidden }
    }
    await tx.accountKeyValue.create({ data: { accountId, key: OPTION_LISTS_MIGRATION_KEY, value: { at: new Date().toISOString(), ...out, oldSettings: { leadSources: plan.leadSources.settingsWords, customerTags: plan.customerTags.settingsWords } } as any } })
    return out
  }, { timeout: 30_000 })
}

/** At server start: every company with saved settings. */
export async function ensureOptionListsAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const out = await ensureOptionLists(r.accountId)
      if (!out) continue
      for (const kind of OPTION_KINDS) {
        const o = out[kind]
        if (!o.wrote) continue
        console.log(`[option lists] ${r.accountId} ${kind}: list made${o.caseLinks.length ? `; linked (capital letters): ${o.caseLinks.map(c => `${c.word} -> ${c.into}`).join(', ')}` : ''}${o.merged.length ? `; merged: ${o.merged.map(m => `${m.from} -> ${m.into}`).join(', ')}` : ''}${o.hidden.length ? `; hidden (no customer in 12 months): ${o.hidden.join(', ')}` : ''}`)
      }
    } catch (err) { console.error('[option lists] one-time lists failed:', err) }
  }
}
