/**
 * The versions of the two records every screen keeps a copy of (the Sales
 * Pipeline board and the business record), sent with the answer to every
 * staff save.
 *
 * Both are saved with a version check (lib/versioned.ts): a browser saving
 * from an older copy is refused with 409 and has to merge and send again. The
 * server also writes them itself as part of other saves: scheduling an
 * install moves the job's card, a signed proposal or a new job adds the job's
 * checklist and its Sales Order, a new customer adds a card. The browser did
 * not know, so its next save of the board or the business record was built
 * on the old version and came back 409 (review, Oct 27 2026: booking a visit,
 * saving a quote, scheduling an install).
 *
 * Every answer to a save (any method but GET) now says, in the
 * X-Doc-Versions header, where both records are after it:
 *
 *   X-Doc-Versions: pipeline=3921, business=3219
 *
 * The browser reads its copy again when the server is ahead
 * (apps/web/src/docVersions.ts) before it saves, so an ordinary save goes once.
 * Saves are still version checked: two people saving at once is still caught
 * and merged.
 */

import type { NextFunction, Request, Response } from 'express'
import prisma from './prisma.js'

export const DOC_VERSIONS_HEADER = 'X-Doc-Versions'

/** "pipeline=<n>, business=<n>" for the account; a record not made yet is left out. */
export async function docVersionsOf(accountId: string): Promise<string> {
  const [p, b] = await Promise.all([
    prisma.pipelineState.findUnique({ where: { accountId }, select: { version: true } }),
    prisma.businessState.findUnique({ where: { accountId }, select: { version: true } }),
  ])
  return [p ? `pipeline=${p.version}` : '', b ? `business=${b.version}` : ''].filter(Boolean).join(', ')
}

/** Parse the header (for tests and tools): { pipeline: n, business: n }. */
export function parseDocVersions(header: string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const part of String(header ?? '').split(',')) {
    const m = part.trim().match(/^([a-z-]+)=(\d+)$/)
    if (m) out[m[1]] = Number(m[2])
  }
  return out
}

/**
 * Express middleware for /api: on a staff save (not GET, HEAD or OPTIONS) the
 * JSON answer waits for the two versions, read after the route's own writes,
 * and carries them in the header. A request without a staff account (public
 * links, the customer portal) is answered as before.
 */
export function tagDocVersions(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') { next(); return }
  const json = res.json.bind(res)
  res.json = ((body: unknown) => {
    const accountId = (req as any).user?.crmAccountId as string | undefined
    const staff = !!accountId && (req as any).user?.role !== 'customer'
    if (!staff || res.headersSent) return json(body)
    docVersionsOf(accountId!)
      .then(v => { if (v && !res.headersSent) res.setHeader(DOC_VERSIONS_HEADER, v) })
      .catch(() => { /* the answer goes without it; the browser's next save is still version checked */ })
      .finally(() => { json(body) })
    return res
  }) as Response['json']
  next()
}
