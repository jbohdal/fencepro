/**
 * The "Salesman" choice on Add lead, New Customer and the quote's New
 * Customer (salesmanChoice.ts). It starts on the person entering (the owner,
 * a Salesman) or, for the office, on the owner (D4); picking someone else
 * says what that means before saving.
 */

import { useEffect } from 'react'
import { choiceWords, isMyRep, onlyMe, preselectOf, useSalesmen } from './salesmanChoice'

export default function SalesmanPicker({ value, onChange, onQuote = false, className = '' }: {
  /** The Salesman's name ('' until the choice is made: it is set to where the choice starts). */
  value: string
  onChange: (name: string) => void
  /** On the quote's New Customer: the quote stays the maker's (said in the words below). */
  onQuote?: boolean
  className?: string
}) {
  const { list, failed } = useSalesmen()
  const shown = list ?? onlyMe()
  const start = preselectOf(shown)
  // Start on the person entering (the office: the owner), once.
  useEffect(() => { if (!value.trim() && start) onChange(start) }, [value, start]) // eslint-disable-line react-hooks/exhaustive-deps
  const options = shown.choices.some(c => c.name === value) || !value.trim()
    ? shown.choices
    : [...shown.choices, { id: `typed-${value}`, name: value, role: '', me: isMyRep(value) }]
  const words = choiceWords(value, { onQuote, preselect: start })
  return (
    <div className={className} data-salesman-choice>
      <label className="text-xs text-gray-500 mb-1 block" htmlFor="salesman-choice">Salesman</label>
      <select id="salesman-choice" data-salesman-select
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px] bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
        value={value} onChange={e => onChange(e.target.value)}>
        {/* The office with no list yet (no signal): saved blank, the server gives it to the owner. */}
        {!value.trim() && !options.length && <option value="">The owner</option>}
        {options.map(c => <option key={c.id} value={c.name}>{c.me ? `${c.name} (me)` : c.name}</option>)}
      </select>
      {!list && !failed && <p className="text-xs text-gray-500 mt-1">Loading the Salesmen…</p>}
      {failed && <p className="text-xs text-amber-800 mt-1" data-salesman-offline>{start ? 'No signal for the Salesman list: it saves with you as Salesman.' : 'No signal for the Salesman list: it saves with the owner as Salesman.'} The owner or office can change it later.</p>}
      {words && <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-1.5" data-salesman-words>{words}</p>}
    </div>
  )
}
