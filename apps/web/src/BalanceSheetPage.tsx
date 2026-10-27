/**
 * Balance Sheet
 *
 * From the records:  Accounts Receivable = what the Billing page shows as
 *                    Outstanding (moneyTruth.receivablesTotal), Accounts
 *                    Payable = open vendor bills.
 * Typed in the editor: cash, equipment, loans, equity and the rest.
 * It always balances: equity not typed is worked out (assets - liabilities)
 * and shown as its own line with what is missing (moneyTruth.balanceSheet).
 */

import { useState, useMemo } from 'react'
import {
  getBsEntries, getBsEntriesAsOf, createBsEntry, updateBsEntry, deleteBsEntry,
  type BalanceSheetEntry, type BalanceSheetCategory,
} from './financeStore'
import { getBills } from './vendorStore'
import { useBackLayer } from './nav'
import { businessDate } from './businessDate'
import { getConfig } from './configStore'
import { balanceSheet, type BalanceResult } from './moneyTruth'
import { useReceivables, receivablesNow } from './moneyLoad'

const fmt = (c: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(c / 100)

const CATEGORY_LABELS: Record<BalanceSheetCategory, string> = {
  current_asset: 'Current Asset',
  fixed_asset: 'Fixed Asset',
  other_asset: 'Other Asset',
  current_liability: 'Current Liability',
  long_term_liability: 'Long-Term Liability',
  equity: 'Equity',
}

const CATEGORIES: BalanceSheetCategory[] = [
  'current_asset', 'fixed_asset', 'other_asset',
  'current_liability', 'long_term_liability', 'equity',
]

function liveApCents(): number {
  const bills = getBills()
  let total = 0
  for (const b of bills) {
    if (b.status === 'void') continue
    if (b.balanceDueCents > 0) total += b.balanceDueCents
  }
  return total
}

/** "a, b and c". */
const listWords = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

export default function BalanceSheetPage() {
  const today = businessDate(new Date())
  const [asOfDate, setAsOfDate] = useState(today)
  const [showEditor, setShowEditor] = useState(false)
  const [bumpKey, setBumpKey] = useState(0)
  const { rows: owed, error: owedError } = useReceivables()

  const manualEntries = useMemo(() => getBsEntriesAsOf(asOfDate), [asOfDate, bumpKey])

  // Group manual entries by category
  const byCategory: Record<BalanceSheetCategory, BalanceSheetEntry[]> = {
    current_asset: [], fixed_asset: [], other_asset: [],
    current_liability: [], long_term_liability: [], equity: [],
  }
  for (const e of manualEntries) byCategory[e.category].push(e)

  // Receivables: the same Outstanding as the Billing page (owed today; the records keep no history of it).
  const ar = receivablesNow(owed ?? [], today).outstandingCents
  const ap = liveApCents()
  const bs = balanceSheet({ arCents: ar, apCents: ap, entries: manualEntries })
  const pastDay = asOfDate !== today

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Balance Sheet</h1>
          <p className="text-sm text-gray-500 mt-1">Receivables (the same as Billing) and payables come from the records; the rest is typed in the Balance Sheet Editor.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-500 font-semibold" htmlFor="bs-as-of">As of</label>
          <input id="bs-as-of" type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value || today)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5" />
          <button onClick={() => setShowEditor(true)}
            className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg">Balance Sheet Editor</button>
          <button onClick={() => exportBsPdf({ asOfDate, ar, ap, byCategory, bs })}
            className="text-sm bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg">Export PDF</button>
        </div>
      </div>

      {owedError && <p className="text-sm text-red-700">{owedError} Accounts Receivable shows $0 until it loads.</p>}

      {/* What it is built from, and what is missing */}
      <div className={`rounded-2xl border p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 ${bs.missing.length ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`} data-bs-status>
        <div>
          <p className={`text-sm font-bold ${bs.missing.length ? 'text-amber-900' : 'text-green-800'}`}>
            {bs.workedOutEquityCents === 0 ? 'Balanced from what is entered' : 'Balanced: equity not entered is worked out'}
          </p>
          <p className="text-xs text-gray-700 mt-0.5">
            {bs.workedOutEquityCents !== 0 && <>Assets minus liabilities minus the equity typed in leaves {fmt(bs.workedOutEquityCents)}, shown as "Equity not entered (worked out)". </>}
            {bs.missing.length > 0 && <>Not entered yet: {listWords(bs.missing)}. Add them in the Balance Sheet Editor; until then this sheet shows only receivables and payables.</>}
            {pastDay && <> Receivables and payables are as of today: the records keep no history of them.</>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Total Assets / Liabilities + Equity</p>
          <p className="text-sm font-bold text-gray-900" data-bs-totals={`${bs.assetsCents}/${bs.liabilitiesAndEquityCents}`}>{fmt(bs.assetsCents)} / {fmt(bs.liabilitiesAndEquityCents)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Assets */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 font-bold text-xs text-gray-500">Assets</div>
          <div className="divide-y divide-gray-50">
            <SubHeader label="Current Assets" />
            {byCategory.current_asset.map(e => (
              <BsRow key={e.id} label={e.label} amount={e.amountCents} />
            ))}
            <BsRow label="Accounts Receivable (same as Billing)" amount={ar} autoLabel data="ar" />
            <BsRow label="Total Current Assets" amount={bs.currentAssetsCents} bold />

            <SubHeader label="Fixed Assets" />
            {byCategory.fixed_asset.map(e => (
              <BsRow key={e.id} label={e.label} amount={e.amountCents} />
            ))}
            <BsRow label="Total Fixed Assets" amount={bs.fixedAssetsCents} bold />

            {byCategory.other_asset.length > 0 && (
              <>
                <SubHeader label="Other Assets" />
                {byCategory.other_asset.map(e => (
                  <BsRow key={e.id} label={e.label} amount={e.amountCents} />
                ))}
                <BsRow label="Total Other Assets" amount={bs.otherAssetsCents} bold />
              </>
            )}

            <div className="px-6 py-3 bg-gray-100 font-bold flex justify-between">
              <span>Total Assets</span>
              <span>{fmt(bs.assetsCents)}</span>
            </div>
          </div>
        </div>

        {/* Liabilities + Equity */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 font-bold text-xs text-gray-500">Liabilities &amp; Equity</div>
          <div className="divide-y divide-gray-50">
            <SubHeader label="Current Liabilities" />
            <BsRow label="Accounts Payable (open vendor bills)" amount={ap} autoLabel data="ap" />
            {byCategory.current_liability.map(e => (
              <BsRow key={e.id} label={e.label} amount={e.amountCents} />
            ))}
            <BsRow label="Total Current Liabilities" amount={bs.currentLiabilitiesCents} bold />

            <SubHeader label="Long-Term Liabilities" />
            {byCategory.long_term_liability.map(e => (
              <BsRow key={e.id} label={e.label} amount={e.amountCents} />
            ))}
            <BsRow label="Total Long-Term Liabilities" amount={bs.longTermLiabilitiesCents} bold />

            <div className="px-6 py-2 bg-gray-50 font-semibold flex justify-between">
              <span>Total Liabilities</span>
              <span>{fmt(bs.liabilitiesCents)}</span>
            </div>

            <SubHeader label="Equity" />
            {byCategory.equity.map(e => (
              <BsRow key={e.id} label={e.label} amount={e.amountCents} />
            ))}
            {bs.workedOutEquityCents !== 0 && <BsRow label="Equity not entered (worked out)" amount={bs.workedOutEquityCents} worked data="equity-worked-out" />}
            <BsRow label="Total Equity" amount={bs.equityCents} bold />

            <div className="px-6 py-3 bg-gray-100 font-bold flex justify-between">
              <span>Total Liabilities &amp; Equity</span>
              <span>{fmt(bs.liabilitiesAndEquityCents)}</span>
            </div>
          </div>
        </div>
      </div>

      {showEditor && (
        <BalanceSheetEditor
          onClose={() => setShowEditor(false)}
          onSaved={() => setBumpKey(k => k + 1)}
        />
      )}
    </div>
  )
}

function SubHeader({ label }: { label: string }) {
  return <div className="px-6 py-2 text-xs font-semibold text-gray-500 bg-gray-50">{label}</div>
}

function BsRow({ label, amount, bold, autoLabel, worked, data }: { label: string; amount: number; bold?: boolean; autoLabel?: boolean; worked?: boolean; data?: string }) {
  return (
    <div className={`px-6 py-2 flex justify-between items-center text-sm ${bold ? 'bg-gray-50 font-semibold' : ''} ${worked ? 'italic' : ''}`} data-bs-row={data} data-cents={amount}>
      <span className={`${bold ? 'text-gray-900' : 'text-gray-600'}`} style={{ paddingLeft: bold ? 0 : 16 }}>
        {label}
        {autoLabel && <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">From records</span>}
        {worked && <span className="ml-2 text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded not-italic">Worked out</span>}
      </span>
      <span className={bold ? 'text-gray-900' : 'text-gray-700'}>{fmt(amount)}</span>
    </div>
  )
}

// ── Editor modal ──

function BalanceSheetEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  useBackLayer(onClose, { key: 'balance-sheet-editor' })
  const [entries, setEntries] = useState<BalanceSheetEntry[]>(() => getBsEntries())
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<BalanceSheetEntry | null>(null)

  function reload() { setEntries(getBsEntries()); onSaved() }
  function handleDelete(id: string) {
    if (!confirm('Delete this entry?')) return
    deleteBsEntry(id)
    reload()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col modal-responsive">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Balance Sheet Editor</h3>
          <button onClick={onClose} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-2xl">×</button>
        </div>
        <div className="p-6 flex-1 overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-gray-500">Add, edit, and delete manual balance sheet entries. Historical snapshots preserved — balance sheet can be viewed as of any past date.</p>
            <button onClick={() => { setEditing(null); setShowForm(true) }}
              className="btn btn-primary">+ Add entry</button>
          </div>
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-xs text-gray-500 font-semibold">
                  <th className="px-4 py-2 text-left">As Of</th>
                  <th className="px-4 py-2 text-left">Category</th>
                  <th className="px-4 py-2 text-left">Label</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {entries.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-gray-400">No entries yet</td></tr>
                ) : entries.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-700">{e.asOfDate}</td>
                    <td className="px-4 py-2 text-gray-600">{CATEGORY_LABELS[e.category]}</td>
                    <td className="px-4 py-2 text-gray-900">{e.label}</td>
                    <td className="px-4 py-2 text-right font-medium">{fmt(e.amountCents)}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => { setEditing(e); setShowForm(true) }} className="text-blue-600 hover:underline text-xs mr-2">Edit</button>
                      <button onClick={() => handleDelete(e.id)} className="text-red-600 hover:underline text-xs">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {showForm && (
          <BsEntryForm initial={editing} onCancel={() => setShowForm(false)} onSaved={() => { setShowForm(false); reload() }} />
        )}
      </div>
    </div>
  )
}

function BsEntryForm({ initial, onCancel, onSaved }: { initial: BalanceSheetEntry | null; onCancel: () => void; onSaved: () => void }) {
  useBackLayer(onCancel, { key: 'bs-entry-form' })
  const [asOfDate, setAsOfDate] = useState(initial?.asOfDate ?? businessDate(new Date()))
  const [category, setCategory] = useState<BalanceSheetCategory>(initial?.category ?? 'current_asset')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [amount, setAmount] = useState(initial ? (initial.amountCents / 100).toFixed(2) : '')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  function handleSave() {
    if (!label.trim() || !amount) return
    const amountCents = Math.round(parseFloat(amount) * 100)
    const data = { asOfDate, category, label: label.trim(), amountCents, notes }
    if (initial) updateBsEntry(initial.id, data)
    else createBsEntry(data)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-60 bg-black/50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto modal-responsive">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">{initial ? 'Edit' : 'Add'} Balance Sheet Entry</h3>
          <button onClick={onCancel} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-2xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs text-gray-500 font-semibold">As Of Date</label>
            <input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-semibold">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value as BalanceSheetCategory)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1">
              {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 font-semibold">Label</label>
            <input type="text" value={label} onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Cash, Equipment, Vehicle Loan"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-semibold">Amount ($)</label>
            <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-semibold">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onCancel} className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2">Cancel</button>
          <button onClick={handleSave}
            className="btn btn-primary">Save</button>
        </div>
      </div>
    </div>
  )
}

// ── Export ──

function exportBsPdf(ctx: {
  asOfDate: string; ar: number; ap: number;
  byCategory: Record<BalanceSheetCategory, BalanceSheetEntry[]>;
  bs: BalanceResult;
}) {
  const { bs } = ctx
  const company = getConfig().company?.name || 'Getter Done Fence'
  const rows = (items: BalanceSheetEntry[]) => items.map(e => `<tr><td>${e.label}</td><td class="amt">${fmt(e.amountCents)}</td></tr>`).join('')

  const html = `
<!doctype html>
<html><head><meta charset="utf-8"><title>Balance Sheet — ${ctx.asOfDate}</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; padding: 40px; color: #1f2937; }
  h1 { margin: 0; font-size: 22px; } h2 { margin: 0 0 16px; font-size: 13px; color: #6b7280; font-weight: 500; }
  .section { background: #f9fafb; padding: 6px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; margin-top: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 12px; }
  td { padding: 4px 10px; border-bottom: 1px solid #f3f4f6; }
  td.amt { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: 700; background: #f9fafb; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .badge { padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; }
  .ok { background: #d1fae5; color: #065f46; } .bad { background: #fef3c7; color: #92400e; }
</style></head><body>
<h1>${company}</h1>
<h2>Balance Sheet — As of ${ctx.asOfDate}</h2>
<p><span class="badge ${bs.missing.length ? 'bad' : 'ok'}">${bs.workedOutEquityCents === 0 ? 'Balanced from what is entered' : 'Balanced: equity not entered is worked out (' + fmt(bs.workedOutEquityCents) + ')'}</span>${bs.missing.length ? ' Not entered yet: ' + listWords(bs.missing) + '.' : ''}</p>
<div class="grid">
  <div>
    <div class="section">Assets — Current</div>
    <table>${rows(ctx.byCategory.current_asset)}<tr><td>Accounts Receivable (same as Billing)</td><td class="amt">${fmt(ctx.ar)}</td></tr><tr class="total"><td>Total Current Assets</td><td class="amt">${fmt(bs.currentAssetsCents)}</td></tr></table>
    <div class="section">Assets — Fixed</div>
    <table>${rows(ctx.byCategory.fixed_asset)}<tr class="total"><td>Total Fixed Assets</td><td class="amt">${fmt(bs.fixedAssetsCents)}</td></tr></table>
    ${ctx.byCategory.other_asset.length ? `<div class="section">Other Assets</div><table>${rows(ctx.byCategory.other_asset)}<tr class="total"><td>Total Other Assets</td><td class="amt">${fmt(bs.otherAssetsCents)}</td></tr></table>` : ''}
    <table><tr class="total"><td>Total Assets</td><td class="amt">${fmt(bs.assetsCents)}</td></tr></table>
  </div>
  <div>
    <div class="section">Liabilities — Current</div>
    <table><tr><td>Accounts Payable (open vendor bills)</td><td class="amt">${fmt(ctx.ap)}</td></tr>${rows(ctx.byCategory.current_liability)}<tr class="total"><td>Total Current Liabilities</td><td class="amt">${fmt(bs.currentLiabilitiesCents)}</td></tr></table>
    <div class="section">Liabilities — Long Term</div>
    <table>${rows(ctx.byCategory.long_term_liability)}<tr class="total"><td>Total Long-Term Liabilities</td><td class="amt">${fmt(bs.longTermLiabilitiesCents)}</td></tr></table>
    <table><tr class="total"><td>Total Liabilities</td><td class="amt">${fmt(bs.liabilitiesCents)}</td></tr></table>
    <div class="section">Equity</div>
    <table>${rows(ctx.byCategory.equity)}${bs.workedOutEquityCents !== 0 ? `<tr><td><i>Equity not entered (worked out)</i></td><td class="amt">${fmt(bs.workedOutEquityCents)}</td></tr>` : ''}<tr class="total"><td>Total Equity</td><td class="amt">${fmt(bs.equityCents)}</td></tr></table>
    <table><tr class="total"><td>Total Liabilities &amp; Equity</td><td class="amt">${fmt(bs.liabilitiesAndEquityCents)}</td></tr></table>
  </div>
</div>
<script>window.print()</script>
</body></html>`
  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close() }
}
