/**
 * Records created in the browser arrive with an id the browser chose (a UUID).
 * The server keeps that id instead of minting its own, so everything the
 * browser already linked to the record (a quote to its customer, a job to its
 * quote, a checklist to its job) still points at the right thing.
 */

import { z } from 'zod'

/** Optional client chosen id: UUID or similar, never free form text. */
export const clientIdSchema = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Invalid id').optional()

export type ClientIdDecision<T> =
  /** No usable id: let the database generate one. */
  | { kind: 'generate' }
  /** The id is free: create the row with it. */
  | { kind: 'use'; id: string }
  /** This company already has a row with that id (a retried create). */
  | { kind: 'exists'; row: T }

/**
 * Decide what to do with a client chosen id. `find` looks the id up; a row
 * that belongs to another company is never touched and never revealed.
 */
export async function decideClientId<T extends { accountId: string | null }>(
  id: string | undefined,
  accountId: string,
  find: (id: string) => Promise<T | null>,
): Promise<ClientIdDecision<T>> {
  if (!id) return { kind: 'generate' }
  const existing = await find(id)
  if (!existing) return { kind: 'use', id }
  if (existing.accountId === accountId) return { kind: 'exists', row: existing }
  return { kind: 'generate' }
}
