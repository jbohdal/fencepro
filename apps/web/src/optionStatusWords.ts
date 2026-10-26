/**
 * What Settings → Fence styles says under a choice (a color, or a choice that
 * waits for prices such as chain link Dig set). Review, Oct 26 2026: Green was
 * switched off but only said "waiting for prices"; Dig set said "waiting for
 * prices on 10 parts… switches on by itself" while galvanized and black 4 ft
 * dig set were quotable. A choice switched off says so first; a choice that
 * waits for prices says which fences wait and which are quotable now.
 */

export type StatusTone = 'ok' | 'wait' | 'off'
export interface StatusLine { tone: StatusTone; text: string }

const parts = (n: number) => `${n} part${n === 1 ? '' : 's'}`

/** A color (priced by part or by piece). `waitingFor`: "prices on 8 parts in Inventory", or null when fully priced. */
export function colorStatusWords(on: boolean, waitingFor: string | null): StatusLine[] {
  if (!on) return [{ tone: 'off', text: waitingFor ? `Switched off. It is also waiting for ${waitingFor}.` : 'Switched off: fully priced, switch it on to quote it.' }]
  return waitingFor ? [{ tone: 'wait', text: `Not available for quoting: waiting for ${waitingFor}.` }] : [{ tone: 'ok', text: 'Fully priced: available for quoting' }]
}

/** One fence under a choice that waits for prices. */
export interface WaitFence {
  /** Its name without the choice ("Black Chain Link, 4 ft, Residential"). */
  label: string
  /** Its kit parts with no Inventory price. */
  unpriced: number
  /** Held back by something else too: switched off (itself, its color, height…) or archived. */
  switchedOff: boolean
}

/** A choice that waits for prices (chain link Dig set): fence by fence. */
export function waitForPricesWords(on: boolean, fences: WaitFence[]): StatusLine[] {
  const waiting = fences.filter(f => f.unpriced > 0)
  const byItself = waiting.filter(f => !f.switchedOff)
  const offToo = waiting.filter(f => f.switchedOff)
  const ready = fences.filter(f => f.unpriced === 0 && !f.switchedOff)
  const list = (fs: WaitFence[]) => fs.map(f => `${f.label} (${parts(f.unpriced)})`).join('; ')
  const out: StatusLine[] = []
  if (!on) out.push({ tone: 'off', text: `Switched off${waiting.length ? '' : ': every fence is fully priced, switch it on to quote them'}.` })
  if (on && !waiting.length) return [{ tone: 'ok', text: 'Fully priced: available for quoting' }]
  if (on && ready.length) out.push({ tone: 'ok', text: `Available for quoting: ${ready.map(f => f.label).join('; ')}.` })
  if (byItself.length) out.push({ tone: 'wait', text: `Waiting for prices in Inventory: ${list(byItself)}. ${byItself.length === 1 ? 'It switches' : 'Each switches'} on by itself once ${byItself.length === 1 ? 'they are' : 'its parts are'} in${on ? '' : ' and this is switched on'}.` })
  if (offToo.length) out.push({ tone: 'wait', text: `Switched off, and waiting for prices: ${list(offToo)}.` })
  return out
}

/** A fence row: switched off says so; held back by the tree says why. */
export function fenceRowWords(quotable: boolean | undefined, held: string | undefined): string | null {
  if (quotable === false) return held ? `Switched off. Also: ${held}` : 'Switched off'
  return held ? `Not available for quoting: ${held}` : null
}
