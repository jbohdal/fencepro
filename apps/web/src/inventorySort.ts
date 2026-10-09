/**
 * Display order for the Item Catalog: grouped by category, A to Z inside each
 * group. Only the view is ordered; the saved item list is left as it is.
 */

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Price book names carry leading asterisks ("*Vinyl, ...") and stray double
 *  spaces. Neither should decide where an item files. */
function sortName(name: string): string {
  return name.replace(/^[*\s]+/, '').replace(/\s+/g, ' ')
}

/** A to Z, ignoring case, with sizes in number order (4' x 8' before 4' x 10'). */
export function compareItemNames(a: string, b: string): number {
  return collator.compare(sortName(a), sortName(b)) || a.localeCompare(b)
}

export interface CatalogGroup<T> {
  /** Category name, or NEW_ITEMS_GROUP for items added since the last save. */
  key: string
  items: T[]
}

export const NEW_ITEMS_GROUP = '__new__'

/**
 * Group items for the catalog table.
 *
 * `filedNames` holds the name each item had when the list was last loaded or
 * saved. Items are ordered by that name, not the live one, so a row does not
 * jump away while its name is being typed. Items missing from it are new and
 * unsaved; they come first so "+ Add item" lands where it can be seen.
 */
export function groupCatalog<T extends { id: string; name: string; category: string }>(
  items: T[],
  filedNames: ReadonlyMap<string, string>,
  categoryOrder: readonly string[],
): CatalogGroup<T>[] {
  const fresh: T[] = []
  const byCategory = new Map<string, T[]>()
  for (const item of items) {
    if (!filedNames.has(item.id)) { fresh.push(item); continue }
    const cat = item.category || 'Uncategorized'
    const list = byCategory.get(cat)
    if (list) list.push(item)
    else byCategory.set(cat, [item])
  }

  const nameOf = (i: T) => filedNames.get(i.id) ?? i.name
  const rank = (cat: string) => {
    const idx = categoryOrder.indexOf(cat)
    return idx < 0 ? categoryOrder.length : idx
  }
  const groups: CatalogGroup<T>[] = [...byCategory.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || collator.compare(a, b))
    .map(([key, list]) => ({ key, items: [...list].sort((a, b) => compareItemNames(nameOf(a), nameOf(b))) }))

  return fresh.length > 0 ? [{ key: NEW_ITEMS_GROUP, items: fresh }, ...groups] : groups
}
