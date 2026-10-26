/**
 * "Where every dollar goes": a row of 20 pickets, each 5% of the price,
 * colored Materials / Labor / Overhead / Profit (and Commission when there is
 * one), with the percent and dollars under each. Internal only: it is on the
 * quote builder and the quote view, never on the proposal or the crew packet.
 */

const COLORS = {
  materials: '#5E28A1', // brand purple
  labor: '#D97706',
  overhead: '#746C80',
  commission: '#2563EB',
  profit: '#15803D',
} as const
type Part = keyof typeof COLORS
const LABEL: Record<Part, string> = { materials: 'Materials', labor: 'Labor', overhead: 'Overhead', commission: 'Commission', profit: 'Profit' }

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

export interface DollarSplit {
  price: number; materials: number; labor: number; commission: number; overheadPct: number
  /** Cents the price was rounded down by to the whole dollar: out of profit, never overhead. */
  roundingCents?: number
  /** The ± dollar adjustment in the price (cents, −3000 = $30 off): out of profit, never overhead. */
  adjustmentCents?: number
  /** The fence's style category: chain link has no pickets, so its row is posts (round 3, Oct 26 2026). */
  category?: string | null
}

/** Chain link (and commercial chain link) is drawn as posts, every other fence as pickets. */
export const isPostFence = (category: string | null | undefined) => /^(chain|commercial)/i.test(String(category ?? '').trim())

/** Dollars and share of the price for each part; profit is what is left. Overhead is on the price before the ± dollar adjustment and the rounding. */
export function splitDollars({ price, materials, labor, commission, overheadPct, roundingCents, adjustmentCents }: DollarSplit) {
  const overhead = (price + (roundingCents ?? 0) / 100 - (adjustmentCents ?? 0) / 100) * (overheadPct / 100)
  const profit = price - materials - labor - commission - overhead
  const parts: Array<{ part: Part; dollars: number }> = [
    { part: 'materials', dollars: materials },
    { part: 'labor', dollars: labor },
    { part: 'overhead', dollars: overhead },
    ...(commission > 0 ? [{ part: 'commission' as Part, dollars: commission }] : []),
    { part: 'profit', dollars: profit },
  ]
  return parts.map(p => ({ ...p, pct: price > 0 ? (p.dollars / price) * 100 : 0 }))
}

/** How many of the 20 pickets each part gets (largest remainder, so they always add to 20). */
export function picketCounts(shares: Array<{ part: Part; pct: number }>): Array<{ part: Part; count: number }> {
  const pos = shares.map(s => ({ part: s.part, raw: Math.max(0, s.pct) / 5 }))
  const total = pos.reduce((t, s) => t + s.raw, 0)
  const scaled = pos.map(s => ({ ...s, raw: total > 0 ? (s.raw * 20) / total : 0 }))
  const out = scaled.map(s => ({ part: s.part, count: Math.floor(s.raw), rem: s.raw - Math.floor(s.raw) }))
  let left = 20 - out.reduce((t, s) => t + s.count, 0)
  for (const s of [...out].sort((a, b) => b.rem - a.rem)) { if (left <= 0) break; s.count += 1; left -= 1 }
  return out.map(({ part, count }) => ({ part, count }))
}

export default function DollarPickets(props: DollarSplit) {
  if (!(props.price > 0)) return null
  const parts = splitDollars(props)
  const counts = picketCounts(parts)
  const pickets = counts.flatMap(c => Array.from({ length: c.count }, () => c.part))
  const posts = isPostFence(props.category)
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4" data-dollar-pickets aria-label="Where every dollar goes">
      <p className="text-sm font-semibold text-gray-900">Where every dollar goes</p>
      <p className="text-xs text-gray-500" data-dollar-unit={posts ? 'post' : 'picket'}>Each {posts ? 'post' : 'picket'} is 5% of the price. Only on this screen, never on the proposal or the crew packet.</p>
      <svg viewBox="0 0 400 90" className="w-full h-auto mt-2" role="img" aria-label={parts.map(p => `${LABEL[p.part]} ${Math.round(p.pct)}%`).join(', ')}>
        <rect x="0" y="62" width="400" height="6" fill="#CBC4D6" rx="2" />
        <rect x="0" y="34" width="400" height="6" fill="#CBC4D6" rx="2" />
        {pickets.map((part, i) => (
          posts
            ? <path key={i} d={`M${i * 20 + 5},88 V10 Q${i * 20 + 10},2 ${i * 20 + 15},10 V88 Z`} fill={COLORS[part]} data-picket={part} />
            : <path key={i} d={`M${i * 20 + 3},88 V12 L${i * 20 + 10},2 L${i * 20 + 17},12 V88 Z`} fill={COLORS[part]} data-picket={part} />
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3">
        {parts.map(p => (
          <div key={p.part} className="text-xs min-w-[5.5rem]" data-dollar-part={p.part}>
            <p className="flex items-center gap-1.5 font-semibold text-gray-900"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLORS[p.part] }} />{LABEL[p.part]}</p>
            <p className={`tabular-nums ${p.dollars < 0 ? 'text-red-700 font-semibold' : 'text-gray-700'}`}>{Math.round(p.pct)}% · {money(p.dollars)}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
