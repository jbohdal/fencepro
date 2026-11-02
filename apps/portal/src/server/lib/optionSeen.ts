/**
 * What a customer tapped: an option's fence and price. The proposal page sends it when signing and the server compares
 * it in the signing transaction, so a place number can never sign a different fence than the one read (review Nov 2
 * 2026). Style and price only: the page's names, folded tier and warranty update overlay never change it.
 *
 * Pure: the web app's proposalOptions.ts says the same in its stamp (a test pins the two together).
 */
export function optionSeen(o: { fenceStyle?: string; finalPrice?: number } | null | undefined): string {
  return `${String(o?.fenceStyle ?? '')}|${Math.round((Number(o?.finalPrice) || 0) * 100)}`
}
