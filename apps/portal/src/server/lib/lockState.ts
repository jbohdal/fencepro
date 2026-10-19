/**
 * Lock a company's Settings (BusinessState) and Inventory (InventoryState)
 * rows for the rest of a transaction, before reading them to change them.
 *
 * The one-time steps at start-up each read Settings and Inventory, add their
 * own pieces and save the whole thing back. Run side by side, the later save
 * erased the earlier one's additions (Oct 19, 2026: the chain link dig set step
 * saved over the wood step on live). With the rows locked first, the second
 * step waits, and its reads (each statement sees the latest committed data)
 * start from what the first one saved. Always Settings first, then
 * Inventory, so two steps can never wait on each other.
 */

export async function lockAccountState(tx: any, accountId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "BusinessState" WHERE "accountId" = ${accountId} FOR UPDATE`
  await tx.$queryRaw`SELECT 1 FROM "InventoryState" WHERE "accountId" = ${accountId} FOR UPDATE`
}
