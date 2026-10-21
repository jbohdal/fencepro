/**
 * Lead sources and customer tags: each one list of options (Settings > Lead
 * Sources, Settings > Customer Tags), and the rules every screen and the
 * server use to read them.
 *
 * This file is kept byte for byte the same in apps/web/src/optionListModel.ts
 * and apps/portal/src/server/lib/optionListModel.ts (tests/optionLists.test.ts
 * checks it). It has no imports so both sides can use it as it is.
 *
 *   - Every option has a permanent id: the word records save. The words
 *     already on customers, quotes, jobs and cards became the ids, so no
 *     record changed. Renaming an option changes only what is shown.
 *   - An option can also match other words (alsoMatches): the same word in
 *     other capital letters, and options merged into it. Reports and filters
 *     count them as one (optionFor). Undo merge brings the merged option back.
 *   - Built-in options (the words the website quote, the phone agent, the
 *     chat and the imports save) can be renamed and hidden, never deleted or
 *     merged away.
 *   - A word on a record that no option matches shows as it was typed; it is
 *     never matched to a "close" option. Settings lists it to Add or Merge.
 */

export type OptionListKind = 'leadSources' | 'customerTags'

export interface OptionLink {
  /** The word as records have it. */
  word: string
  /** case: the same word in other capital letters; merge: joined into this option (Undo merge takes it back out). */
  kind: 'case' | 'merge'
  /** A merged option as it was, brought back by Undo merge. */
  was?: { name: string; hidden: boolean; alsoMatches: OptionLink[] }
  /** When it was linked (ISO). */
  at?: string
}

export interface OptionDef {
  /** Permanent: the word saved on records. */
  id: string
  name: string
  order: number
  /** Not offered in pickers; still shown on records and in reports. */
  hidden: boolean
  /** Saved by the app itself; can be renamed and hidden, never deleted or merged away. */
  builtIn: boolean
  alsoMatches: OptionLink[]
}

export const LIST_LABEL: Record<OptionListKind, string> = { leadSources: 'Lead Sources', customerTags: 'Customer Tags' }
export const ONE_LABEL: Record<OptionListKind, string> = { leadSources: 'lead source', customerTags: 'tag' }

/** The words the app saves on its own. */
export const BUILT_IN_OPTIONS: Record<OptionListKind, string[]> = {
  leadSources: ['Website Quote', 'Phone (AI receptionist)', 'Website chat'],
  customerTags: ['Imported', 'JobNimbus', 'From schedule'],
}

const lc = (s: string) => s.trim().toLowerCase()

function cleanLinks(raw: unknown, depth = 0): OptionLink[] {
  if (!Array.isArray(raw) || depth > 4) return []
  const out: OptionLink[] = []
  for (const r of raw as any[]) {
    const word = typeof r?.word === 'string' ? r.word : ''
    if (!word.trim() || out.some(x => x.word === word)) continue
    const kind: OptionLink['kind'] = r.kind === 'case' ? 'case' : 'merge'
    const link: OptionLink = { word, kind }
    if (r.was && typeof r.was === 'object') link.was = { name: typeof r.was.name === 'string' && r.was.name.trim() ? r.was.name.trim().slice(0, 60) : word, hidden: r.was.hidden === true, alsoMatches: cleanLinks(r.was.alsoMatches, depth + 1) }
    if (typeof r.at === 'string') link.at = r.at
    out.push(link)
  }
  return out
}

/** Known fields only, one entry per id, sorted by order. */
export function cleanOptions(raw: unknown): OptionDef[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: OptionDef[] = []
  raw.forEach((r: any, i) => {
    const id = typeof r?.id === 'string' ? r.id : ''
    if (!id.trim() || id.length > 80 || seen.has(id)) return
    seen.add(id)
    out.push({
      id,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 60) : id.trim(),
      order: Number.isFinite(r.order) ? Number(r.order) : i,
      hidden: r.hidden === true,
      builtIn: r.builtIn === true,
      alsoMatches: cleanLinks(r.alsoMatches),
    })
  })
  out.sort((a, b) => a.order - b.order)
  out.forEach((o, i) => { o.order = i })
  return out
}

/** A saved list made safe to use: known fields, sorted, every built-in there. */
export function normalizeOptions(raw: unknown, kind: OptionListKind): OptionDef[] {
  const out = cleanOptions(raw)
  for (const w of BUILT_IN_OPTIONS[kind]) {
    const has = out.find(o => o.id === w)
    if (has) has.builtIn = true
    else out.push({ id: w, name: w, order: out.length, hidden: true, builtIn: true, alsoMatches: [] })
  }
  for (const o of out) if (!BUILT_IN_OPTIONS[kind].includes(o.id)) o.builtIn = false
  return out
}

/** Every word an option stands for: its id, its links and what merged options brought with them. */
export function wordsOf(o: OptionDef): string[] {
  const out = [o.id]
  const walk = (links: OptionLink[]) => { for (const l of links) { out.push(l.word); if (l.was) walk(l.was.alsoMatches) } }
  walk(o.alsoMatches)
  return out
}

/** Why a list cannot be saved, in words; null when it can. */
export function optionsProblem(list: OptionDef[], kind: OptionListKind): string | null {
  const words = new Map<string, string>()
  const names = new Set<string>()
  for (const o of list) {
    if (!o.id.trim()) return 'Every option needs an id.'
    const n = lc(o.name)
    if (!n) return 'Every option needs a name.'
    if (names.has(n)) return `Two options are called "${o.name.trim()}". Merge them, or give each its own name.`
    names.add(n)
    for (const w of wordsOf(o)) {
      if (words.has(w)) return `"${w}" is in two options (${words.get(w)} and ${o.name}).`
      words.set(w, o.name)
    }
  }
  for (const w of BUILT_IN_OPTIONS[kind]) {
    if (!list.some(o => o.id === w)) return `"${w}" is built in: the app saves it on its own. It can be renamed or hidden, not deleted or merged.`
  }
  return null
}

/**
 * The option a word on a record belongs to: the option with that id, else
 * the one that links the word, else the one whose name is that word in any
 * capital letters. Null when none does (the word shows as typed).
 */
export function optionFor(list: OptionDef[], word: string | null | undefined): OptionDef | null {
  if (!word || !word.trim()) return null
  const byId = list.find(o => o.id === word)
  if (byId) return byId
  const linked = list.find(o => wordsOf(o).includes(word))
  if (linked) return linked
  const w = lc(word)
  return list.find(o => lc(o.name) === w) ?? null
}

/** What a record's word shows as: its option's name, else the word as typed. */
export function labelFor(list: OptionDef[], word: string | null | undefined): string {
  return optionFor(list, word)?.name ?? (word ?? '')
}

/** The key reports and filters group by: the option's id, else the word as typed. */
export function groupKeyFor(list: OptionDef[], word: string | null | undefined): string {
  return optionFor(list, word)?.id ?? (word ?? '')
}

/**
 * The word a save keeps (the server's rule): an id or a linked word is kept
 * as it is; an option's name typed in any capital letters becomes that
 * option's id; anything else is kept as typed. Never a guess.
 */
export function wordToSave(list: OptionDef[], word: string | null | undefined): string {
  const raw = word ?? ''
  if (!raw.trim()) return raw
  if (list.some(o => wordsOf(o).includes(raw))) return raw
  const w = lc(raw)
  return list.find(o => lc(o.name) === w)?.id ?? raw
}

/** What a picker offers: the shown options in order, and the record's own word(s) when they are not among them. */
export function pickerOptions(list: OptionDef[], current: string | string[] | null | undefined = null): Array<{ value: string; label: string }> {
  const out = list.filter(o => !o.hidden).map(o => ({ value: o.id, label: o.name }))
  const cur = (Array.isArray(current) ? current : current ? [current] : []).filter(w => w && w.trim())
  for (const w of cur) {
    if (out.some(x => x.value === w)) continue
    const o = optionFor(list, w)
    if (o && !o.hidden && o.id !== w && out.some(x => x.value === o.id)) {
      // The record has a linked word: the picker shows it as its option, keeping the record's word.
      out.splice(out.findIndex(x => x.value === o.id), 1, { value: w, label: o.name })
      continue
    }
    out.push({ value: w, label: labelFor(list, w) })
  }
  return out
}

const renumber = (list: OptionDef[]) => list.map((o, i) => ({ ...o, order: i }))

/** Merge one option into another: it leaves the list and its words count as the other's. Undo merge brings it back. */
export function mergeOption(list: OptionDef[], fromId: string, intoId: string, at: string): { list: OptionDef[] } | { error: string } {
  const from = list.find(o => o.id === fromId)
  const into = list.find(o => o.id === intoId)
  if (!from || !into) return { error: 'Pick two options in the list.' }
  if (from.id === into.id) return { error: 'Pick another option to merge into.' }
  if (from.builtIn) return { error: `"${from.name}" is built in; it can be renamed or hidden, not merged away.` }
  const link: OptionLink = { word: from.id, kind: 'merge', was: { name: from.name, hidden: from.hidden, alsoMatches: from.alsoMatches }, at }
  return { list: renumber(list.filter(o => o.id !== fromId).map(o => (o.id === intoId ? { ...o, alsoMatches: [...o.alsoMatches, link] } : o))) }
}

/** Link a word found on records (not in the list) to an option. */
export function linkWord(list: OptionDef[], word: string, intoId: string, at: string): { list: OptionDef[] } | { error: string } {
  if (!list.some(o => o.id === intoId)) return { error: 'Pick an option in the list.' }
  if (list.some(o => wordsOf(o).includes(word))) return { error: `"${word}" already belongs to an option.` }
  return { list: list.map(o => (o.id === intoId ? { ...o, alsoMatches: [...o.alsoMatches, { word, kind: 'merge', at }] } : o)) }
}

/** Undo a merge (or a link): a merged option comes back as it was, right after the one it was merged into. */
export function undoMerge(list: OptionDef[], intoId: string, word: string): { list: OptionDef[] } | { error: string } {
  const into = list.find(o => o.id === intoId)
  const link = into?.alsoMatches.find(l => l.word === word)
  if (!into || !link) return { error: 'That merge is not in the list any more.' }
  const next = list.map(o => (o.id === intoId ? { ...o, alsoMatches: o.alsoMatches.filter(l => l.word !== word) } : o))
  if (link.was) {
    const at = next.findIndex(o => o.id === intoId)
    next.splice(at + 1, 0, { id: word, name: link.was.name, order: 0, hidden: link.was.hidden, builtIn: false, alsoMatches: link.was.alsoMatches })
  }
  return { list: renumber(next) }
}

/** Add a word found on records (or typed) as its own option, shown. */
export function addOption(list: OptionDef[], word: string): { list: OptionDef[] } | { error: string } {
  const w = word.trim().slice(0, 60)
  if (!w) return { error: 'Type a name.' }
  if (optionFor(list, w) && list.some(o => wordsOf(o).includes(w) || lc(o.name) === lc(w))) return { error: `"${w}" is already in the list.` }
  return { list: renumber([...list, { id: word.length <= 80 ? word : w, name: w, order: list.length, hidden: false, builtIn: false, alsoMatches: [] }]) }
}

/** Words on records that no option matches, most used first. */
export function foundOnRecords(list: OptionDef[], counts: Array<{ word: string; count: number }>): Array<{ word: string; count: number }> {
  return counts.filter(c => c.word && c.word.trim() && !optionFor(list, c.word)).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
}

export interface RecordWord { word: string; count: number; recentCustomer: boolean }

/**
 * The list the one-time step writes: the Settings words first (shown), then
 * every other word on records, most used first (shown when a customer
 * created in the last 12 months has it, else hidden). A word that differs
 * from one already in the list only in capital letters is linked to it. The
 * built-ins are there, hidden from pickers. Then the merges asked for.
 */
export function optionsFromOld(kind: OptionListKind, settingsWords: unknown, recordWords: RecordWord[], merges: Array<[string, string]>, at: string): {
  options: OptionDef[]; caseLinks: Array<{ word: string; into: string }>; merged: Array<{ from: string; into: string }>; hidden: string[]
} {
  const options: OptionDef[] = []
  const caseLinks: Array<{ word: string; into: string }> = []
  const hidden: string[] = []
  const put = (word: string, hide: boolean) => {
    if (!word.trim() || options.some(o => wordsOf(o).includes(word))) return
    const twin = options.find(o => lc(o.id) === lc(word))
    if (twin) { twin.alsoMatches.push({ word, kind: 'case', at }); caseLinks.push({ word, into: twin.id }); return }
    options.push({ id: word, name: word.trim().slice(0, 60), order: options.length, hidden: hide, builtIn: false, alsoMatches: [] })
    if (hide) hidden.push(word)
  }
  for (const w of Array.isArray(settingsWords) ? settingsWords : []) if (typeof w === 'string') put(w, false)
  for (const r of [...recordWords].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))) {
    if (BUILT_IN_OPTIONS[kind].includes(r.word)) continue
    put(r.word, !r.recentCustomer)
  }
  for (const w of BUILT_IN_OPTIONS[kind]) {
    const has = options.find(o => o.id === w)
    if (has) { has.builtIn = true; has.hidden = true }
    else options.push({ id: w, name: w, order: options.length, hidden: true, builtIn: true, alsoMatches: [] })
  }
  let list = renumber(options)
  const merged: Array<{ from: string; into: string }> = []
  for (const [from, into] of merges) {
    const r = mergeOption(list, from, into, at)
    if ('list' in r) { list = r.list; merged.push({ from, into }) }
  }
  return { options: list, caseLinks, merged, hidden }
}

/** The merges Jonathan asked for at the one-time step (Oct 20, 2026). */
export const START_MERGES: Record<OptionListKind, Array<[string, string]>> = {
  leadSources: [['Google', 'website/google'], ['Repeat Customer', 'repeat business']],
  customerTags: [],
}
