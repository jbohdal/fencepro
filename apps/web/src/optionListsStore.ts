/**
 * Lead sources and customer tags: the two option lists every form, record,
 * filter and report reads. Kept on the server (/api/option-lists; the
 * company's AccountKeyValue rows 'fencepro_lead_sources' and
 * 'fencepro_customer_tags', version checked) and changed only from Settings >
 * Lead Sources and Settings > Customer Tags. The rules for reading them are in
 * optionListModel.ts, the same file the server uses.
 *
 * Records keep the word they were saved with (an option's id, or a linked
 * word). What shows is the option's name (labelFor); reports and filters group
 * by the option (groupKeyFor), so merged words add up.
 *
 * Read at sign in, again with the other lists (liveRefresh), and right after a
 * save, so a rename shows on every device without a reload.
 */
import { useEffect, useState } from 'react'
import { sendJson } from './syncHttp'
import {
  normalizeOptions, labelFor, groupKeyFor, pickerOptions, optionFor, BUILT_IN_OPTIONS, SHOWN_BUILT_INS,
  type OptionDef, type OptionListKind,
} from './optionListModel'

export type { OptionDef, OptionListKind } from './optionListModel'

const EVT = 'fencepro:option_lists:updated'
export const OPTION_LISTS_UPDATED_EVENT = EVT

const lists: Record<OptionListKind, OptionDef[]> = {
  leadSources: normalizeOptions([], 'leadSources'),
  customerTags: normalizeOptions([], 'customerTags'),
}
const versions: Record<OptionListKind, number> = { leadSources: 0, customerTags: 0 }
let loaded = false
let initPromise: Promise<void> | null = null

function emit() { try { window.dispatchEvent(new CustomEvent(EVT)) } catch { /* not in a browser */ } }

function take(kind: OptionListKind, data: any): boolean {
  if (!data || !Array.isArray(data.options)) return false
  const next = normalizeOptions(data.options, kind)
  const v = Number(data.version) || 0
  const same = loaded && v === versions[kind] && JSON.stringify(next) === JSON.stringify(lists[kind])
  lists[kind] = next
  versions[kind] = v
  return !same
}

async function readAll(): Promise<boolean> {
  const r = await sendJson('GET', '/api/option-lists')
  if (!r.result.ok || !r.json?.data) return false
  const a = take('leadSources', r.json.data.leadSources)
  const b = take('customerTags', r.json.data.customerTags)
  const first = !loaded
  loaded = true
  if (a || b || first) emit()
  return true
}

export function initOptionLists(): Promise<void> {
  if (loaded) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => { await readAll() })().finally(() => { if (!loaded) initPromise = null })
  return initPromise
}
export const isOptionListsLoaded = () => loaded

/** Read again (another device changed a list). Quiet when nothing changed. */
export async function refreshOptionLists(): Promise<void> { await readAll() }

export function getOptions(kind: OptionListKind): OptionDef[] { return lists[kind] }
export function getOptionsVersion(kind: OptionListKind): number { return versions[kind] }

/** A list, kept current on screen. */
export function useOptions(kind: OptionListKind): OptionDef[] {
  const [s, setS] = useState<OptionDef[]>(lists[kind])
  useEffect(() => {
    const h = () => setS(lists[kind])
    window.addEventListener(EVT, h)
    h()
    return () => window.removeEventListener(EVT, h)
  }, [kind])
  return s
}

// ── What screens show ──
/** A record's lead source as shown (its option's name, else the word as typed). */
export const sourceLabel = (word: string | null | undefined) => labelFor(lists.leadSources, word)
/** A tag as shown. */
export const tagLabel = (word: string | null | undefined) => labelFor(lists.customerTags, word)
/** The key reports and filters group a lead source by (merged words add up). */
export const sourceKey = (word: string | null | undefined) => groupKeyFor(lists.leadSources, word)
export const tagKey = (word: string | null | undefined) => groupKeyFor(lists.customerTags, word)
/** The lead sources a picker offers (shown options, and the record's own word). */
export const sourcePicker = (current?: string | null) => pickerOptions(lists.leadSources, current ?? null)
/** The tags a picker offers (shown options, and the record's own tags). */
export const tagPicker = (current: string[] = []) => pickerOptions(lists.customerTags, current)
/** The option a typed word is (exact id, a linked word, or a name in any capital letters), or null. */
export const sourceFor = (word: string | null | undefined) => optionFor(lists.leadSources, word)
/** The words the app saves on its own (website quote, phone agent, chat). */
export const AUTOMATIC_SOURCES = new Set(BUILT_IN_OPTIONS.leadSources.filter(w => !SHOWN_BUILT_INS.has(w)))

export type SaveAnswer = { ok: true } | { ok: false; error: string; stale?: boolean }

/** Save a whole list (rename, reorder, hide, add, merge, undo merge, delete an unused option). */
export async function saveOptions(kind: OptionListKind, next: OptionDef[]): Promise<SaveAnswer> {
  const r = await sendJson('PUT', `/api/option-lists/${kind}`, { options: next.map((o, i) => ({ ...o, order: i })), baseVersion: versions[kind] })
  if (r.result.ok) { if (take(kind, r.json?.data)) emit(); return { ok: true } }
  const stale = r.status === 409 && r.json?.code === 'STALE' && !!r.json?.data
  if (stale && take(kind, r.json.data)) emit()
  return { ok: false, error: r.json?.error || 'The list could not be saved. Check the connection and try again.', stale }
}

export interface WordCount { word: string; count: number; tables: Record<string, number> }

/** Every word on records, with how many records have it (Settings: counts and "Found on records"). */
export async function getWordCounts(kind: OptionListKind): Promise<WordCount[] | null> {
  const r = await sendJson('GET', `/api/option-lists/${kind}/words`)
  return r.result.ok ? (r.json?.data as WordCount[]) : null
}
