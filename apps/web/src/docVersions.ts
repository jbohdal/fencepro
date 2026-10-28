/**
 * Where the server's Sales Pipeline board and business record are, as the
 * server says it in the answer to every save (X-Doc-Versions, portal
 * lib/docVersions.ts):
 *
 *   X-Doc-Versions: pipeline=3921, business=3219
 *
 * The server writes those two records itself as part of other saves
 * (scheduling an install moves the card; a signed proposal or a new job adds
 * the job's checklist and Sales Order). The stores that keep a copy of them
 * (pipelineStore, businessStateStore) are told here when the server is
 * ahead of their copy, and read it again before their next save, so that
 * save is not refused with 409 for a change this same person caused
 * (review, Oct 27 2026).
 *
 * Only versions pass through here, never business data.
 */

export type DocName = 'pipeline' | 'business'

const newest: Record<DocName, number> = { pipeline: -1, business: -1 }
const listeners: Record<DocName, Set<(v: number) => void>> = { pipeline: new Set(), business: new Set() }

/** The header's versions: { pipeline: n, business: n } (a record the header leaves out is left out). */
export function parseDocVersions(header: string | null | undefined): Partial<Record<DocName, number>> {
  const out: Partial<Record<DocName, number>> = {}
  for (const part of String(header ?? '').split(',')) {
    const m = part.trim().match(/^(pipeline|business)=(\d+)$/)
    if (m) out[m[1] as DocName] = Number(m[2])
  }
  return out
}

/** Read from every answer (crmAuth.fetchWithAuth). */
export function noteDocVersions(header: string | null | undefined): void {
  const seen = parseDocVersions(header)
  for (const name of Object.keys(seen) as DocName[]) {
    const v = seen[name]!
    if (v <= newest[name]) continue
    newest[name] = v
    for (const fn of listeners[name]) { try { fn(v) } catch { /* a store's own problem, not the answer's */ } }
  }
}

/** The newest version the server has said for a record (-1: not said yet on this visit). */
export function serverVersionOf(name: DocName): number { return newest[name] }

/** Told each time the server says a newer version of the record. */
export function onServerVersion(name: DocName, fn: (v: number) => void): () => void {
  listeners[name].add(fn)
  return () => { listeners[name].delete(fn) }
}

/** For tests: forget what was said. */
export function resetDocVersions(): void { newest.pipeline = -1; newest.business = -1 }
