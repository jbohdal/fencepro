/**
 * The quote builder's Save window for a Salesman's saved quote (review, Oct 30 2026): with the builder already open
 * when the owner moved the quote, Save opened the window, New Customer made a customer ("Gina", 0 quotes) and only
 * then did the save find the quote was moved. Now the server is asked when the window would open and again before a
 * customer is made or picked; moved: nothing opens and nothing is made (the app says "The owner moved this to
 * <name>" once and closes the builder, App.tsx). No answer (no signal): she goes on as before.
 */

export type StillMine = (quoteId: string) => Promise<'mine' | 'moved' | 'unknown'>

/** The check for this builder: none for a new quote or another login (always true). */
export function saveGate(opts: { isSalesman: boolean; quoteId?: string | null; check: StillMine }): () => Promise<boolean> {
  const id = opts.quoteId
  if (!opts.isSalesman || !id) return async () => true
  return async () => (await opts.check(id)) !== 'moved'
}

/** A submit that asks `gate` first and runs `submit` once (a second tap while asking does nothing). */
export function gatedOnce(gate: () => Promise<boolean>, submit: () => void): () => Promise<boolean> {
  let busy = false
  return async () => {
    if (busy) return false
    busy = true
    try {
      if (!(await gate())) return false
      submit()
      return true
    } finally { busy = false }
  }
}
