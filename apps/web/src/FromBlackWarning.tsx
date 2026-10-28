/**
 * The quote builder's warning for parts still priced from another part
 * (Jonathan, Oct 27 2026: "Any part still priced from Black shows a warning on
 * the quote so the salesman knows it's low"). Shown to the Salesman and the
 * office in the Style and Price steps; never on anything the customer sees
 * (the proposal, the customer's page, the PDF are built elsewhere and do not
 * use it).
 */

import type { PriceFrom } from './priceAge'

export interface BorrowedPart { item: { id: string; name: string; unitCost: number }; from: PriceFrom }

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

export default function FromBlackWarning({ parts, where }: { parts: BorrowedPart[]; where: 'style' | 'price' }) {
  if (!parts.length) return null
  const n = parts.length
  return (
    <div className="bg-red-50 border border-red-300 rounded-xl p-3 space-y-1.5" data-from-black={where} role="alert">
      <p className="text-sm font-semibold text-red-800">
        Price may be low: {n} green part{n === 1 ? ' is' : 's are'} priced from Black
      </p>
      <p className="text-xs text-red-800 leading-snug">
        No green price has been entered for {n === 1 ? 'it' : 'them'} yet, so {n === 1 ? 'it uses' : 'they use'} the Black part's price, which can be lower than green costs.
      </p>
      {parts.slice(0, 8).map(({ item, from }) => (
        <p key={item.id} className="text-xs text-red-800 leading-snug" data-from-black-part={item.name}>
          {item.name.replace(/^\*/, '').trim()} · {money(from.cents)} (Black's price)
        </p>
      ))}
      {n > 8 && <p className="text-xs text-red-800">and {n - 8} more</p>}
      <p className="text-xs text-red-800">OK to quote; allow for it. The office enters green prices in Inventory.</p>
    </div>
  )
}
