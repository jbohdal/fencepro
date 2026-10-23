/**
 * Pipeline cards an import put on the board (lib/customerImport.ts) carry
 * importBatchId and importStage, the column they were put in. While such a
 * card is still in that column it is quiet: no time automations
 * (lib/automations/queue.ts scanTimeTriggers) and no "first follow up"
 * (lib/followUps.ts runFirstFollowUp). A person moving it to another column
 * is a real move and everything works as for any card from then on.
 *
 * No imports, so the automation worker and the follow ups can use it.
 */
export function isQuietImportCard(card: unknown): boolean {
  const c = card as { importBatchId?: unknown; importStage?: unknown; stage?: unknown } | null
  return !!c && typeof c.importBatchId === 'string' && !!c.importBatchId && typeof c.importStage === 'string' && c.stage === c.importStage
}
