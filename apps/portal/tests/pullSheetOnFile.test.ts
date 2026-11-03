/**
 * The customer's pull sheet on file when they sign on the link (lib/pullSheetOnFile.ts), the same rule as Mark sold
 * in the app (web/src/signedContractFlow.ts): another option signed than the one on file, the signed fence's sheet
 * goes on file as the next version; nothing on file is replaced or deleted.
 */

import { describe, test, expect } from 'vitest'
import { planPullSheetOnFile, type PullSheetOnFile } from '../src/server/lib/pullSheetOnFile'

const vinyl = [{ item: '*Vinyl, White, Picket', qty: 200 }]
const chain = [{ item: 'Galv, Fabric, 48"', qty: 4 }]
const onFile = (quoteId: string, snap: unknown, n: number, at: string, by = 'auto'): PullSheetOnFile =>
  ({ id: `ps${n}${quoteId}`, customerId: 'c1', customerName: 'A', quoteId, quoteName: 'x', versionSnapshot: snap, versionNumber: n, linkedAt: at, linkedBy: by })
const entry = (snap: unknown) => ({ customerId: 'c1', customerName: 'A', quoteId: 'q1', quoteName: 'Galvanized Chain Link — A', versionSnapshot: snap, linkedAt: '2026-11-03T08:00:00.000Z', linkedBy: 'customer (proposal link)' })

describe('the signed pull sheet on file', () => {
  test('another option signed: the next version goes on file, first; every sheet on file stays as it was', () => {
    const list = [onFile('q1', vinyl, 1, '2026-11-01T10:00:00.000Z'), onFile('q2', vinyl, 1, '2026-11-02T10:00:00.000Z', 'Jonathan (by hand)')]
    const next = planPullSheetOnFile(list, entry(chain), 'new')!
    expect(next.length).toBe(3)
    expect(next[0]).toMatchObject({ id: 'new', quoteId: 'q1', versionNumber: 2, versionSnapshot: chain })
    expect(next.slice(1)).toEqual(list)
  })
  test('the newest on file is the signed sheet already: nothing to do', () => {
    const list = [onFile('q1', vinyl, 1, '2026-11-01T10:00:00.000Z'), onFile('q1', chain, 2, '2026-11-02T10:00:00.000Z')]
    expect(planPullSheetOnFile(list, entry(chain), 'new')).toBeNull()
  })
  test('none on file yet: the signed one goes on file as version 1', () => {
    expect(planPullSheetOnFile([], entry(chain), 'new')).toEqual([{ ...entry(chain), id: 'new', versionNumber: 1 }])
  })
})
