/**
 * The pull sheet on file for a signed quote (the customer's Pull Sheets, BusinessState.pullSheets), when the
 * customer signs on their link: the same rule as Mark sold in the app (web/src/signedContractFlow.ts). Signed for
 * another option than the one on file (chain link on a vinyl quote), the signed fence's pull sheet goes on file as
 * the next version; nothing on file is replaced or deleted, so a sheet kept by hand is never lost (Nov 3 2026).
 * With none on file yet, the signed one is put on file.
 */

import crypto from 'crypto'
import prisma from './prisma.js'
import { plainStyleName } from './estimates.js'

export interface PullSheetOnFile {
  id: string
  customerId: string
  customerName: string
  jobId?: string
  jobName?: string
  quoteId: string
  quoteName: string
  versionSnapshot: unknown
  versionNumber: number
  linkedAt: string
  linkedBy: string
}

/** The list with the signed sheet added as the next version, or null when the newest on file for the quote is that sheet already. Pure. */
export function planPullSheetOnFile(list: PullSheetOnFile[], entry: Omit<PullSheetOnFile, 'id' | 'versionNumber'>, id: string): PullSheetOnFile[] | null {
  const mine = list.filter(ps => ps?.quoteId === entry.quoteId).sort((a, b) => String(b.linkedAt).localeCompare(String(a.linkedAt)))
  if (mine[0] && JSON.stringify(mine[0].versionSnapshot) === JSON.stringify(entry.versionSnapshot)) return null
  return [{ ...entry, id, versionNumber: mine.length + 1 }, ...list]
}

/** After the customer signs on the link: the signed quote's pull sheet on file (a new version when it differs). */
export async function fileSignedPullSheet(accountId: string, quoteId: string, linkedBy: string): Promise<void> {
  const q = await prisma.savedQuote.findUnique({ where: { id: quoteId }, select: { crmContactId: true, customerName: true, fenceStyle: true, pullSheet: true } })
  if (!q?.crmContactId || !Array.isArray(q.pullSheet) || q.pullSheet.length === 0) return
  const job = await prisma.savedJob.findFirst({ where: { accountId, quoteId }, select: { id: true } })
  const entry = {
    customerId: q.crmContactId, customerName: q.customerName ?? '',
    ...(job ? { jobId: job.id, jobName: q.customerName ?? '' } : {}),
    quoteId, quoteName: `${await plainStyleName(q.fenceStyle)} — ${q.customerName ?? ''}`,
    versionSnapshot: q.pullSheet, linkedAt: new Date().toISOString(), linkedBy,
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const s = await prisma.businessState.findUnique({ where: { accountId }, select: { pullSheets: true, version: true } })
    if (!s) return
    const next = planPullSheetOnFile((Array.isArray(s.pullSheets) ? s.pullSheets : []) as unknown as PullSheetOnFile[], entry, crypto.randomUUID())
    if (!next) return
    const done = await prisma.businessState.updateMany({ where: { accountId, version: s.version }, data: { pullSheets: next as any, version: { increment: 1 } } })
    if (done.count === 1) return
  }
  console.error(`[pull sheets] quote ${quoteId}: the business record kept changing; the signed pull sheet was not put on file`)
}
