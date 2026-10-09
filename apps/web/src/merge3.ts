/**
 * Three way merge for the records that are saved whole (pipeline, inventory,
 * business state, schedule, vendors, cloud storage keys).
 *
 * When a save is refused because another tab or device saved first, the
 * change made here is worked out as "what differs between the copy this tab
 * started from (base) and what it holds now (mine)", and that change is put
 * on top of the newest server copy (theirs). Changes to different records, or
 * to different fields of the same record, both survive. Where both sides
 * changed the very same field, mine goes on top, because it is the later
 * action. The one thing that cannot be reapplied is an edit to a record the
 * other side deleted; that is reported, not guessed at.
 */

export interface MergeResult<T> {
  merged: T
  /** Plain sentences for anything of mine that could not be put on top. */
  problems: string[]
}

type Json = unknown
const isObj = (v: Json): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter(k => a[k] !== undefined), kb = Object.keys(b).filter(k => b[k] !== undefined)
    return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k]))
  }
  return false
}

/** A stable key for a list item, or null when the list cannot be merged item by item. */
function keyOf(item: Json): string | null {
  if (!isObj(item)) return null
  if (typeof item.id === 'string' || typeof item.id === 'number') return `id:${item.id}`
  // Stock levels have no id of their own: one row per item per location.
  if (typeof item.itemId === 'string' && typeof item.locationId === 'string') return `stock:${item.itemId}|${item.locationId}`
  return null
}

function keyed(list: Json[]): Map<string, Json> | null {
  const m = new Map<string, Json>()
  for (const item of list) {
    const k = keyOf(item)
    if (k === null || m.has(k)) return null
    m.set(k, item)
  }
  return m
}

const isPlain = (v: Json) => v === null || ['string', 'number', 'boolean'].includes(typeof v)
const allPlainUnique = (list: Json[]) => list.every(isPlain) && new Set(list).size === list.length

function label(item: Json): string {
  if (!isObj(item)) return 'an item'
  const name = [item.firstName, item.lastName].filter(x => typeof x === 'string' && x).join(' ')
    || item.name || item.title || item.clientName || item.customerName || item.invoiceNumber || item.label
  return typeof name === 'string' && name ? `"${name}"` : 'an item'
}

function mergeValue(base: Json, mine: Json, theirs: Json, problems: string[]): Json {
  if (deepEqual(mine, base)) return theirs       // I did not touch it
  if (deepEqual(theirs, base)) return mine       // only I touched it
  if (deepEqual(mine, theirs)) return mine       // we made the same change

  if (Array.isArray(mine) && Array.isArray(theirs)) {
    const b = Array.isArray(base) ? base : []
    const kb = keyed(b), km = keyed(mine), kt = keyed(theirs)
    if (kb && km && kt) {
      // Their list, with my per item changes on top.
      const out: Json[] = []
      for (const [k, theirItem] of kt) {
        if (!km.has(k)) {
          if (kb.has(k)) continue                 // I deleted it
          out.push(theirItem)                     // they added it
        } else {
          out.push(mergeValue(kb.get(k), km.get(k), theirItem, problems))
        }
      }
      const added: Json[] = []
      for (const [k, myItem] of km) {
        if (kt.has(k)) continue
        if (!kb.has(k)) added.push(myItem)        // I added it
        else if (!deepEqual(myItem, kb.get(k))) {
          problems.push(`${label(myItem)} was deleted on another device, so your change to it could not be saved.`)
        }                                         // else: they deleted something I had not touched
      }
      // New items keep the end of the list they were put on.
      const atFront = added.length > 0 && mine.length > 0 && keyOf(mine[0]) === keyOf(added[0])
      return atFront ? [...added, ...out] : [...out, ...added]
    }
    if (allPlainUnique(b) && allPlainUnique(mine) && allPlainUnique(theirs)) {
      // A plain list such as stage names or work days: apply my additions and removals to theirs.
      const removed = new Set(b.filter(x => !mine.includes(x)))
      const addedPlain = mine.filter(x => !b.includes(x) && !theirs.includes(x))
      return [...theirs.filter(x => !removed.has(x)), ...addedPlain]
    }
    return mine                                   // no way to split it: my version goes on top
  }

  if (isObj(mine) && isObj(theirs)) {
    const b = isObj(base) ? base : {}
    const out: Record<string, Json> = {}
    for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      const v = mergeValue(b[k], mine[k], theirs[k], problems)
      if (v !== undefined) out[k] = v
    }
    return out
  }

  return mine                                     // the same field changed on both sides: mine is the later action
}

export function merge3<T>(base: T, mine: T, theirs: T): MergeResult<T> {
  const problems: string[] = []
  const merged = mergeValue(base, mine, theirs, problems) as T
  return { merged, problems }
}
