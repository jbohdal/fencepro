/**
 * Smaller list answers for the phone (walkthrough round 2, item 2, Oct 26,
 * 2026): every page load read ~14 MB of JSON, half of it the same field names
 * repeated on each of thousands of rows.
 *
 * A GET that asks for `?shape=table` gets its list (`data`, or the pipeline's
 * `data.leads`) as one table: the field names once, then each row's values in
 * that order. Nothing else changes: the web app turns it back into the same
 * rows (apps/web/src/listTable.ts). A field missing from a row stays missing.
 * Without `shape=table` the answer is exactly as before, so every other
 * caller is untouched.
 *
 * Also left out of a table: fields no screen reads from a list and that are
 * fetched with the one record when needed (LIST_ONLY_OMIT): the company id on
 * every row, and a signed quote's signature picture, IP and browser.
 *
 * Mounted in index.ts before the cost and Installer filters, so it works on
 * what they leave (they run first and still see plain rows).
 *
 * Every JSON answer under /api is also marked no-store (unless a route set its
 * own Cache-Control): the phone's browser keeps no copy of business data in
 * its cache, and a reload does not hold the last load's answers in memory.
 */

export interface ListTable {
  $table: 1
  cols: string[]
  rows: unknown[][]
  /** Rows (by index) that lack some fields: those fields' column numbers. */
  missing?: Record<number, number[]>
}

/**
 * Not in a table: the company id, and fields the phone's stores do not keep
 * (apps/web/src customerStore.ts and quoteStore.ts fromApi; the test
 * tests/listTable.test.ts fails if one of them starts reading one). The
 * customer's texting yes is read with the customer (TextConsent.tsx).
 */
export const LIST_ONLY_OMIT: Record<string, Set<string>> = {
  '/api/saved-quotes': new Set(['accountId', 'ownerId', 'createdAt', 'updatedAt', 'acceptedSignature', 'acceptedIp', 'acceptedUserAgent', 'firstViewedAt', 'lastViewedAt', 'viewCount']),
  '/api/crm-contacts': new Set(['accountId', 'ownerId', 'updatedAt', 'isCompleted', 'mergedIntoId', 'portalCustomerId', 'textConsent', 'textConsentAt', 'textConsentBy', 'textConsentById', 'textConsentSource']),
  '/api/saved-jobs': new Set(['accountId']),
  '/api/appointments': new Set(['accountId']),
}

const isRow = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/** Rows of objects as one table. Null when it is not a list of plain objects. */
export function toTable(list: unknown[], omit: Set<string> = new Set()): ListTable | null {
  if (!list.every(isRow)) return null
  const cols: string[] = []
  const at = new Map<string, number>()
  for (const r of list as Record<string, unknown>[]) {
    for (const k of Object.keys(r)) if (!at.has(k) && !omit.has(k)) { at.set(k, cols.length); cols.push(k) }
  }
  const missing: Record<number, number[]> = {}
  const rows = (list as Record<string, unknown>[]).map((r, i) => {
    const out = new Array<unknown>(cols.length)
    let gone: number[] | null = null
    for (let c = 0; c < cols.length; c++) {
      if (Object.prototype.hasOwnProperty.call(r, cols[c]) && r[cols[c]] !== undefined) out[c] = r[cols[c]]
      else { out[c] = null; (gone ??= []).push(c) }
    }
    if (gone) missing[i] = gone
    return out
  })
  return { $table: 1, cols, rows, ...(Object.keys(missing).length ? { missing } : {}) }
}

/** The list in an answer body as a table (data, or data.leads), the rest as is. */
export function tableBody(body: any, omit?: Set<string>): any {
  if (!body || typeof body !== 'object') return body
  if (Array.isArray(body.data)) {
    const t = toTable(body.data, omit)
    return t ? { ...body, data: t } : body
  }
  if (body.data && typeof body.data === 'object' && Array.isArray(body.data.leads)) {
    const t = toTable(body.data.leads, omit)
    return t ? { ...body, data: { ...body.data, leads: t } } : body
  }
  return body
}

/** Express middleware for /api (see the top of this file). */
export function listTables(req: any, res: any, next: any): void {
  const json = res.json.bind(res)
  const table = req.method === 'GET' && req.query?.shape === 'table'
  const base = String(req.baseUrl || '') + String(req.path || '')
  const omit = table ? Object.entries(LIST_ONLY_OMIT).find(([p]) => base === p || base === `${p}/`)?.[1] : undefined
  res.json = (body: any) => {
    if (!res.get('Cache-Control')) res.set('Cache-Control', 'no-store')
    return json(table && res.statusCode < 400 ? tableBody(body, omit) : body)
  }
  next()
}
