/**
 * What the quote window says on a signed quote whose job was changed by an
 * approved change order (walkthrough recheck, Oct 27 2026: after CO-1 the
 * quote window still showed 296 ft, 30 sections and the old pull sheet, with
 * nothing saying the job's pull sheet was at rev 2).
 *
 * The signed quote itself is never changed (a saved quote keeps its prices);
 * this only says what the job is now and which pull sheet to order from:
 * "Changed by CO-1 (signed 10/27): the job now has 316 ft, 32 sections. The
 * job's pull sheet is rev 2."
 *
 * The pull sheet revision is worked out the way the server's customer pull
 * sheets are (lib/customerPullSheets.ts): the newest approved change order
 * that changed the work (from the yard drawing), its contract revision, else
 * one more than the ones before it.
 *
 * Pure, no screen code: tested in apps/portal/tests/quoteChangeNote.test.ts.
 */

export interface ChangeOrderForNote {
  number: number
  status: string
  approvedAt?: string | null
  signedAt?: string | null
  contractRev?: number | null
  totalCents: number
  work?: { footage: number; sections: number } | null
  jobWork?: { footage: number; sections: number } | null
}

export interface QuoteChangeNote {
  /** "Changed by CO-1 (signed 10/27): the job now has 316 ft, 32 sections. The job's pull sheet is rev 2." */
  text: string
  /** The job's pull sheet revision now; null when no change order changed the materials (typed lines only). */
  pullSheetRev: number | null
  /** What the pull sheet section of the quote window says. */
  pullSheetText: string
}

/** "10/27" in Ocala's time. */
const md = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric' })

/** "CO-1 (signed 10/27)", or "CO-2 (approved 10/28, not signed yet)" for one approved verbally. */
function coWords(o: ChangeOrderForNote): string {
  if (o.signedAt) return `CO-${o.number} (signed ${md(o.signedAt)})`
  if (o.approvedAt) return `CO-${o.number} (approved ${md(o.approvedAt)}, not signed yet)`
  return `CO-${o.number}`
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const dollars = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(cents / 100)

/** The note for a signed quote and its change orders; null when none is approved. */
export function quoteChangeNote(orders: readonly ChangeOrderForNote[], signedPriceCents: number): QuoteChangeNote | null {
  const approved = orders
    .filter(o => o.status === 'approved')
    .sort((a, b) => (a.approvedAt ?? '').localeCompare(b.approvedAt ?? '') || a.number - b.number)
  if (!approved.length) return null
  const withWork = approved.filter(o => o.work)
  const last = withWork[withWork.length - 1]
  const w = last ? (last.jobWork ?? last.work)! : null
  const rev = last ? (last.contractRev ?? withWork.length + 1) : null
  const contractCents = signedPriceCents + approved.reduce((s, o) => s + o.totalCents, 0)
  const head = `Changed by ${list(approved.map(coWords))}`
  if (w && rev) {
    return {
      text: `${head}: the job now has ${Math.round(w.footage)} ft, ${w.sections} sections. The job's pull sheet is rev ${rev}.`,
      pullSheetRev: rev,
      pullSheetText: `This is the pull sheet as signed. The job's pull sheet is rev ${rev}, with ${list(withWork.map(o => `CO-${o.number}`))} in it: order from the job's pull sheet.`,
    }
  }
  return {
    text: `${head}: the contract is now ${dollars(contractCents)}. The fence and the pull sheet are as signed.`,
    pullSheetRev: null,
    pullSheetText: 'The change orders changed the price only, not the materials: this pull sheet is still the one to order from.',
  }
}
