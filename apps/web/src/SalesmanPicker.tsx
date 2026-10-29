/**
 * The "Salesman" choice on Add lead, New Customer and the quote's New
 * Customer (salesmanChoice.ts). The person entering is preselected; picking
 * someone else says what that means before saving.
 */

import { useEffect } from 'react'
import { choiceWords, isMyRep, onlyMe, useSalesmen } from './salesmanChoice'

export default function SalesmanPicker({ value, onChange, onQuote = false, className = '' }: {
  /** The Salesman's name ('' until the choice is made: it is set to the person entering). */
  value: string
  onChange: (name: string) => void
  /** On the quote's New Customer: the quote stays the maker's (said in the words below). */
  onQuote?: boolean
  className?: string
}) {
  const { list, failed } = useSalesmen()
  const shown = list ?? onlyMe()
  const me = shown.choices.find(c => c.me)
  // Preselect the person entering, once.
  useEffect(() => { if (!value.trim() && me?.name) onChange(me.name) }, [value, me?.name]) // eslint-disable-line react-hooks/exhaustive-deps
  const options = shown.choices.some(c => c.name === value) || !value.trim()
    ? shown.choices
    : [...shown.choices, { id: `typed-${value}`, name: value, role: '', me: isMyRep(value) }]
  const words = choiceWords(value, { onQuote })
  return (
    <div className={className} data-salesman-choice>
      <label className="text-xs text-gray-500 mb-1 block" htmlFor="salesman-choice">Salesman</label>
      <select id="salesman-choice" data-salesman-select
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px] bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
        value={value} onChange={e => onChange(e.target.value)}>
        {options.map(c => <option key={c.id} value={c.name}>{c.me ? `${c.name} (me)` : c.name}</option>)}
      </select>
      {!list && !failed && <p className="text-xs text-gray-500 mt-1">Loading the Salesmen…</p>}
      {failed && <p className="text-xs text-amber-800 mt-1" data-salesman-offline>No signal for the Salesman list: it saves with you as Salesman. The owner or office can change it later.</p>}
      {words && <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-1.5" data-salesman-words>{words}</p>}
    </div>
  )
}
