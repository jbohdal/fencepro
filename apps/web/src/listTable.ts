/**
 * Big lists come from the server as one table when asked with ?shape=table
 * (apps/portal/src/server/lib/listTable.ts): the field names once, then each
 * row's values. This turns it back into the same rows. A plain list (an older
 * server) is returned as it is.
 */

interface ListTable { $table: 1; cols: string[]; rows: unknown[][]; missing?: Record<string, number[]> }

const isTable = (x: unknown): x is ListTable =>
  !!x && typeof x === 'object' && (x as ListTable).$table === 1 && Array.isArray((x as ListTable).cols) && Array.isArray((x as ListTable).rows)

/** The rows of a list answer: a table turned back into objects, or the list as sent. */
export function fromTable<T = Record<string, unknown>>(x: unknown): T[] | unknown {
  if (!isTable(x)) return x
  const { cols, rows, missing } = x
  return rows.map((r, i) => {
    const gone = missing?.[i]
    const o: Record<string, unknown> = {}
    for (let c = 0; c < cols.length; c++) if (!gone || !gone.includes(c)) o[cols[c]] = r[c]
    return o as T
  })
}

/** A list answer's body with its table (data, or data.leads) turned back into rows. */
export function untableBody<B>(body: B): B {
  const b = body as any
  if (!b || typeof b !== 'object') return body
  if (isTable(b.data)) return { ...b, data: fromTable(b.data) }
  if (b.data && typeof b.data === 'object' && isTable(b.data.leads)) return { ...b, data: { ...b.data, leads: fromTable(b.data.leads) } }
  return body
}

/** The path with ?shape=table (or &shape=table) added. */
export function asTable(path: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}shape=table`
}
