import { useEffect, useState, useMemo } from 'react'
import { styleLabel } from './fenceCatalog'
import type { SavedQuote } from './QuotesPage'
import { getQuotes, getArchivedQuotes } from './quoteStore'
import { sizeText } from './moveRepair'
import { cloudStorage } from './cloudStorage'
import { useBackLayer } from './nav'
import { businessDate } from './businessDate'
import { can } from './permissions'
import NumberField from './NumberField'
import { dollarsToCents, centsToDollars } from './numberText'
import { lowTarget } from './moneyLoad'
import { loadJobCostPrefill, type JobCostPrefill } from './takeoffStore'
import { costRow, crewLineCents, crewTotalCents, entryLaborCents, laborBasis, laborShown, quoteHasCost, resultOf, type CostRow, type CrewEntry, type JobCostEntry } from './jobCostLabor'

/* ───────── types ───────── */

interface CostedJob {
  entry: JobCostEntry
  quote: SavedQuote
  row: CostRow
  /** The labor cost used for profit, in dollars. */
  actualLaborCost: number
  /** Null when the quote has no cost on file. */
  laborVariance: number | null
  /** Actual hours less the quote's, only when both are there (hours are optional and never part of the cost). */
  laborHrsVariance: number | null
  /** Null when the quote has no material cost on file. */
  materialPct: number | null
  totalActCOGS: number
}

interface BudgetState {
  revenueGoal: number
  overheadPct: number
  laborPct: number
  materialsPct: number
  netProfitPct: number
}

/* ───────── helpers ───────── */

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const fmt2 = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

const NOT_AVAILABLE = 'Not available'
/** A money figure, or plainly not available. */
const orNone = (n: number | null, show: (n: number) => string) => (n === null ? NOT_AVAILABLE : show(n))
const NO_COST = 'This quote has no cost on file.'
const BEFORE_COMMISSION = 'Profit and margin are price less cost, before any commission.'

/** Green, yellow or red against the target margin; plain when not known. */
function gmTone(gm: number | null): string {
  if (gm === null) return 'text-gray-500'
  return gm >= lowTarget() ? 'text-green-600' : gm >= lowTarget() - 0.05 ? 'text-yellow-600' : 'text-red-500'
}

/** The average of the numbers, null when there are none. */
const avgOf = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null)
const signed = (n: number, show: (n: number) => string) => `${n >= 0 ? '+' : ''}${show(n)}`
/** Hours are entered on few jobs: an hours average needs at least this many (1 of 8 read as a pattern). */
const MIN_HOUR_JOBS = 3

const uid = () => Math.random().toString(36).slice(2, 9)

const STORAGE_KEY = 'fencepro_jobcosting'

/** Archived too: the same quotes the P&L reads, so an entry reads the same on both. */
function loadQuotes(): SavedQuote[] {
  return [...getQuotes(), ...(getArchivedQuotes() as SavedQuote[])]
}

function loadEntries(): JobCostEntry[] {
  try {
    const raw = cloudStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveEntries(entries: JobCostEntry[]) {
  cloudStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

function fenceCategory(style: string): string {
  if (style.toLowerCase().includes('vinyl') || style.startsWith('WV') || style.startsWith('TV')) return 'Vinyl'
  if (style.toLowerCase().includes('alum')) return 'Aluminum'
  if (style.toLowerCase().includes('com')) return 'Commercial'
  if (style.startsWith('CL')) return 'Chainlink'
  return 'Other'
}

function varianceColor(pct: number): string {
  if (Math.abs(pct) <= 0.05) return 'text-green-600'
  if (Math.abs(pct) <= 0.15) return 'text-yellow-600'
  return 'text-red-500'
}

function varianceArrow(val: number): string {
  if (val > 0) return '▲'
  if (val < 0) return '▼'
  return '—'
}

/* ───────── Cost a Job Modal ───────── */

function CostAJobModal({
  soldQuotes,
  existingIds,
  onSave,
  onClose,
  editEntry,
}: {
  soldQuotes: SavedQuote[]
  existingIds: Set<string>
  onSave: (entry: JobCostEntry) => void
  onClose: () => void
  editEntry?: JobCostEntry | null
}) {
  useBackLayer(onClose, { key: 'cost-a-job-modal' })
  const [quoteId, setQuoteId] = useState(editEntry?.quoteId || '')
  const [completionDate, setCompletionDate] = useState(editEntry?.completionDate || businessDate(new Date()))
  const [actualLaborHrs, setActualLaborHrs] = useState(Number(editEntry?.actualLaborHrs) || 0)
  const [actualOtherCents, setActualOtherCents] = useState(dollarsToCents(Number(editEntry?.actualOtherCosts) || 0))
  const [notes, setNotes] = useState(editEntry?.notes || '')
  const [crew, setCrew] = useState<CrewEntry[]>(editEntry?.crew || [])

  const availableQuotes = soldQuotes.filter(q => !existingIds.has(q.id) || q.id === editEntry?.quoteId)
  const selectedQuote = soldQuotes.find(q => q.id === quoteId)

  // Prefills come from the server (bills, Sales Orders, takeoff). A saved entry shows what was saved: they fill nothing on it.
  const [prefill, setPrefill] = useState<JobCostPrefill | null>(null)
  const [prefillState, setPrefillState] = useState<'idle' | 'loading' | 'done' | 'failed'>('idle')
  // A typed number stays until changed. Not typed: labor follows the crew total, else the base (prefill, or what was saved).
  const [laborTyped, setLaborTyped] = useState(editEntry?.laborCostTyped === true)
  const [typedLaborCents, setTypedLaborCents] = useState(editEntry?.actualLaborCostCents ?? 0)
  const [materialTyped, setMaterialTyped] = useState(!!editEntry)
  const [typedMaterialCents, setTypedMaterialCents] = useState(dollarsToCents(Number(editEntry?.actualMaterialCost) || 0))

  useEffect(() => {
    if (!quoteId) { setPrefill(null); setPrefillState('idle'); return }
    let live = true
    setPrefill(null)
    setPrefillState('loading')
    loadJobCostPrefill(quoteId).then(p => {
      if (!live) return
      setPrefill(p)
      setPrefillState(p ? 'done' : 'failed')
    })
    return () => { live = false }
  }, [quoteId])

  const crewCents = crewTotalCents(crew)
  const quoteLaborCents = selectedQuote ? dollarsToCents(selectedQuote.laborCost) : 0
  const quoteMaterialCents = selectedQuote ? dollarsToCents(selectedQuote.materialCost) : 0
  const oldHoursEntry = !!editEntry && !!selectedQuote && laborBasis(editEntry) === 'hours'
  const sub = editEntry?.laborKind ? editEntry.laborKind === 'sub' : !!prefill?.sub
  const laborLabel = sub ? 'Paid to sub ($)' : 'Actual Labor Cost ($)'
  const hasEstimate = !!selectedQuote && quoteHasCost(selectedQuote)
  // A saved entry that followed its crew lines still does (an old one on a sub job too); otherwise a sub job's amount wins over crew lines unless typed.
  const savedFromCrew = !!editEntry && (laborBasis(editEntry) === 'crew' || (laborBasis(editEntry) === 'saved' && editEntry.laborCostTyped !== true && editEntry.laborKind !== 'sub' && crewTotalCents(editEntry.crew) > 0))
  const crewFlows = !sub || (savedFromCrew && laborBasis(editEntry!) === 'crew')
  // What a saved entry keeps when the box is not typed in: its own number. One saved typed or from its crew goes back to the prefill.
  const keepsSaved = !!editEntry && !!selectedQuote && !savedFromCrew && editEntry.laborCostTyped !== true
  const baseLaborCents = keepsSaved ? entryLaborCents(editEntry!, selectedQuote!) : prefill?.labor.cents ?? quoteLaborCents
  const laborCents = laborShown({ typed: laborTyped, typedCents: typedLaborCents, crewCents, baseCents: baseLaborCents, crewFlows })
  const materialCents = materialTyped ? typedMaterialCents : prefill?.material.cents ?? quoteMaterialCents

  const savedLaborWords = oldHoursEntry ? 'Old entry: this came from hours x a rate. Change it to the real cost and save.' : editEntry?.laborSource || ''
  const prefillWords = prefillState === 'failed' ? "From the quote's labor $. The job's bills and takeoff could not be loaded, so check this." : prefill?.labor.words ?? ''
  const laborWords = laborTyped ? 'Typed by you' : crewCents > 0 && crewFlows ? 'From the crew breakdown' : keepsSaved ? savedLaborWords : prefillWords
  const savedMaterialWords = editEntry?.materialSource || 'As entered before'
  const prefillMaterialWords = prefillState === 'failed' ? 'From the quote estimate. The job\'s bills and Sales Order could not be loaded, so check this.' : prefill?.material.words ?? ''
  const materialWords = editEntry ? (typedMaterialCents === dollarsToCents(Number(editEntry.actualMaterialCost) || 0) ? savedMaterialWords : 'Typed by you') : materialTyped ? 'Typed by you' : prefillMaterialWords

  function commitLabor(cents: number) {
    setTypedLaborCents(cents)
    setLaborTyped(true)
  }

  function commitMaterial(cents: number) {
    setTypedMaterialCents(cents)
    setMaterialTyped(true)
  }

  /** Picking another job drops everything entered for the last one: crew, other costs, hours, notes, anything typed. */
  function pickQuote(id: string) {
    setQuoteId(id)
    setLaborTyped(false)
    setMaterialTyped(false)
    setCrew([])
    setActualOtherCents(0)
    setActualLaborHrs(0)
    setNotes('')
  }

  function addCrewMember() {
    setCrew(prev => [...prev, { name: '', hours: 0, rate: 0 }])
  }

  function updateCrew(i: number, field: keyof CrewEntry, val: string | number) {
    setCrew(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: field === 'name' ? val : Number(val) || 0 } : c))
  }

  function removeCrew(i: number) {
    setCrew(prev => prev.filter((_, idx) => idx !== i))
  }

  function handleSave() {
    if (!quoteId) return
    // An old hours entry saved with its labor box untouched stays old and stays on the fix list ("don't change without my OK").
    const keepOld = oldHoursEntry && !laborTyped && !(crewFlows && crewCents > 0)
    onSave({
      id: editEntry?.id || uid(),
      quoteId,
      completionDate,
      actualLaborHrs,
      // A line with hours or pay stays even with no name: it is in the total.
      crew: crew.filter(c => c.name.trim() || crewLineCents(c) > 0),
      actualMaterialCost: centsToDollars(materialCents),
      actualOtherCosts: centsToDollars(actualOtherCents),
      notes,
      materialSource: materialWords,
      ...(keepOld
        ? { frozenOldLaborCents: baseLaborCents }
        : { actualLaborCostCents: laborCents, laborCostTyped: laborTyped, laborKind: sub ? 'sub' as const : 'crew' as const, laborSource: laborWords }),
    })
  }

  const hasCrewPay = crewCents > 0
  const showResult = !!selectedQuote
  const priceCents = selectedQuote ? dollarsToCents(selectedQuote.finalPrice) : 0
  const actualCostCents = laborCents + materialCents + actualOtherCents
  const estCostCents = selectedQuote ? dollarsToCents(selectedQuote.totalCOGS) : 0
  const est = resultOf(priceCents, estCostCents)
  const hasActual = actualCostCents > 0
  const act = resultOf(priceCents, actualCostCents)
  const waiting = !editEntry && prefillState === 'loading'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[640px] max-h-[80vh] overflow-y-auto mx-4 lg:mx-0 modal-responsive" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-bold text-gray-900 text-lg">{editEntry ? 'Edit Job Cost' : 'Cost a Completed Job'}</h2>
          <button onClick={onClose} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Select quote */}
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">Select Sold Quote</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              value={quoteId}
              onChange={e => pickQuote(e.target.value)}
              disabled={!!editEntry}
            >
              <option value="">— Choose a job —</option>
              {availableQuotes.map(q => (
                <option key={q.id} value={q.id}>
                  {q.customerName} — {styleLabel(q.fenceStyle)} — {fmt(q.finalPrice)} ({q.date})
                </option>
              ))}
            </select>
          </div>

          {/* Estimate preview */}
          {selectedQuote && (
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-400 font-semibold mb-2">Quote Estimate</p>
              {!hasEstimate && <p className="text-sm font-medium text-gray-700" data-no-cost>{NO_COST} The estimate is not available.</p>}
              {hasEstimate && <div className="grid grid-cols-4 gap-3 text-sm">
                <div><p className="text-gray-400 text-xs">Labor Hrs</p><p className="font-bold">{selectedQuote.adjLaborHrs?.toFixed(1) || '—'}</p></div>
                <div><p className="text-gray-400 text-xs">Labor $</p><p className="font-bold">{fmt(selectedQuote.laborCost)}</p></div>
                <div><p className="text-gray-400 text-xs">Materials</p><p className="font-bold">{fmt(selectedQuote.materialCost)}</p></div>
                <div><p className="text-gray-400 text-xs">Total cost</p><p className="font-bold">{fmt(selectedQuote.totalCOGS)}</p></div>
              </div>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Completion Date</label>
              <input
                type="date"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={completionDate}
                onChange={e => setCompletionDate(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="jc-labor-hrs" className="text-xs text-gray-500 font-medium mb-1 block">Actual Total Labor Hours (optional)</label>
              <NumberField id="jc-labor-hrs" kind="number" min={0} decimals={2} placeholder="e.g. 24.5" className="!text-left"
                value={actualLaborHrs} onCommit={setActualLaborHrs} />
              <p className="text-xs text-gray-400 mt-1">For your records. Hours never change the cost.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="jc-labor-cost" className="text-xs text-gray-500 font-medium mb-1 block">{laborLabel}</label>
              <NumberField id="jc-labor-cost" kind="money" min={0} cents={true} className="!text-left" data-labor-kind={sub ? 'sub' : 'crew'}
                value={laborCents} onCommit={commitLabor} disabled={waiting} />
              {selectedQuote && (
                <p className="text-xs text-gray-500 mt-1" data-source="labor">
                  {waiting ? 'Looking at this job…' : laborWords}
                  {prefill && !waiting && !editEntry?.laborKind && <span className="text-gray-400"> · {sub ? 'Sub job' : 'Crew job'}: {prefill.kindWhy}</span>}
                </p>
              )}
              {hasCrewPay && !crewFlows && !laborTyped && (
                <p className="text-xs text-gray-500 mt-1">
                  Crew adds up to {fmt2(crewCents / 100)}. Paid to sub stays as it is.{' '}
                  <button type="button" onClick={() => commitLabor(crewCents)} className="text-orange-500 hover:text-orange-600 font-semibold">Use the crew total</button>
                </p>
              )}
              {laborTyped && (
                <p className="text-xs text-gray-500 mt-1">
                  {hasCrewPay && <>Crew adds up to {fmt2(crewCents / 100)}. </>}
                  {hasCrewPay && <button type="button" onClick={() => (crewFlows ? setLaborTyped(false) : commitLabor(crewCents))} className="text-orange-500 hover:text-orange-600 font-semibold">Use the crew total</button>}
                  {(!hasCrewPay || !crewFlows) && <button type="button" onClick={() => setLaborTyped(false)} className="text-orange-500 hover:text-orange-600 font-semibold">{hasCrewPay ? ' or ' : ''}Use {fmt2(baseLaborCents / 100)}</button>}
                </p>
              )}
              {!editEntry && prefill?.labor.note && !laborTyped && <p className="text-xs text-yellow-700 mt-1">{prefill.labor.note}</p>}
            </div>
            <div>
              <label htmlFor="jc-material" className="text-xs text-gray-500 font-medium mb-1 block">Actual Material Cost</label>
              <NumberField id="jc-material" kind="money" min={0} cents={true} className="!text-left"
                value={materialCents} onCommit={commitMaterial} disabled={waiting} />
              {selectedQuote && <p className="text-xs text-gray-500 mt-1" data-source="material">{waiting ? 'Looking at this job…' : materialWords}</p>}
              {!editEntry && materialTyped && (
                <p className="text-xs mt-1">
                  <button type="button" onClick={() => setMaterialTyped(false)} className="text-orange-500 hover:text-orange-600 font-semibold">Use {fmt2((prefill?.material.cents ?? quoteMaterialCents) / 100)}</button>
                </p>
              )}
              {!editEntry && prefill?.material.note && !materialTyped && <p className="text-xs text-yellow-700 mt-1">{prefill.material.note}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="jc-other" className="text-xs text-gray-500 font-medium mb-1 block">Other Costs (extras, change orders)</label>
              <NumberField id="jc-other" kind="money" min={0} cents={true} className="!text-left"
                value={actualOtherCents} onCommit={setActualOtherCents} />
              {(prefill?.tearOutCents ?? 0) > 0 && <p className="text-xs text-gray-500 mt-1">The quote has {fmt2(prefill!.tearOutCents / 100)} tear out. It is not in labor or material here; add it here if it was paid.</p>}
            </div>
          </div>

          {/* Crew breakdown */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-500 font-medium">Crew Breakdown (optional)</label>
              <button onClick={addCrewMember} className="text-xs text-orange-500 hover:text-orange-600 font-semibold">+ Add crew member</button>
            </div>
            {crew.length > 0 && (
              <div className="space-y-2">
                {crew.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                      placeholder="Name"
                      value={c.name}
                      onChange={e => updateCrew(i, 'name', e.target.value)}
                    />
                    <NumberField kind="number" min={0} decimals={2} width="w-20" label={`Hours for crew member ${i + 1}`} placeholder="Hours"
                      value={c.hours} onCommit={h => updateCrew(i, 'hours', h)} />
                    <NumberField kind="money" min={0} width="w-24" label={`Dollars an hour for crew member ${i + 1}`} placeholder="$/hr"
                      value={dollarsToCents(c.rate)} onCommit={r => updateCrew(i, 'rate', centsToDollars(r))} />
                    <span className="text-xs text-gray-400 w-16 text-right">{fmt2(crewLineCents(c) / 100)}</span>
                    <button onClick={() => removeCrew(i)} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-300 hover:text-red-400 text-lg leading-none">×</button>
                  </div>
                ))}
                <div className="text-xs text-gray-400 text-right">
                  Crew total: {crew.reduce((s, c) => s + c.hours, 0).toFixed(1)} hrs · {fmt2(crewCents / 100)}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">Notes</label>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
              rows={2}
              placeholder="Any notes about this job — weather issues, scope changes, etc."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          {/* The result before saving, next to the quote estimate */}
          {showResult && (
            <div className="bg-gray-50 rounded-xl p-4" data-job-result>
              <p className="text-xs text-gray-400 font-semibold mb-2">Result if saved</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400">
                    <th className="text-left font-medium pb-1"></th>
                    <th className="text-right font-medium pb-1">Quote estimate</th>
                    <th className="text-right font-medium pb-1">Actual</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td className="py-0.5 text-gray-600">Price</td><td className="py-0.5 text-right text-gray-500">{fmt2(priceCents / 100)}</td><td className="py-0.5 text-right font-semibold text-gray-900">{fmt2(priceCents / 100)}</td></tr>
                  <tr><td className="py-0.5 text-gray-600">Total cost</td><td className="py-0.5 text-right text-gray-500" data-est="cost">{hasEstimate ? fmt2(estCostCents / 100) : NOT_AVAILABLE}</td><td className="py-0.5 text-right font-semibold text-gray-900" data-result="cost">{hasActual ? fmt2(actualCostCents / 100) : 'Not entered'}</td></tr>
                  <tr><td className="py-0.5 text-gray-600">Profit</td><td className="py-0.5 text-right text-gray-500">{hasEstimate ? fmt2(est.profitCents / 100) : NOT_AVAILABLE}</td><td className="py-0.5 text-right font-semibold text-gray-900" data-result="profit">{hasActual ? fmt2(act.profitCents / 100) : 'Not entered'}</td></tr>
                  <tr><td className="py-0.5 text-gray-600">Margin</td><td className="py-0.5 text-right text-gray-500">{hasEstimate ? `${est.marginPct.toFixed(1)}%` : NOT_AVAILABLE}</td><td className={`py-0.5 text-right font-bold ${!hasActual || !hasEstimate ? 'text-gray-900' : act.marginPct >= est.marginPct ? 'text-green-600' : 'text-red-500'}`} data-result="margin">{hasActual ? `${act.marginPct.toFixed(1)}%` : 'Not entered'}</td></tr>
                </tbody>
              </table>
              <p className="text-xs text-gray-400 mt-2">{BEFORE_COMMISSION}</p>
              {(prefill?.changeOrders.count ?? 0) > 0 && (
                <p className="text-xs text-yellow-700 mt-1">This job has approved change orders ({fmt2(prefill!.changeOrders.priceCents / 100)}). The price here is the signed quote, without them.</p>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!quoteId || waiting}
            className="btn btn-primary"
          >
            {editEntry ? 'Update' : 'Save Job Cost'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ───────── Job Detail Drawer ───────── */

function JobDetailDrawer({ job, onClose, onEdit }: { job: CostedJob; onClose: () => void; onEdit: () => void }) {
  useBackLayer(onClose, { key: 'job-detail-drawer' })
  const { quote: q, entry: e } = job
  const oldHours = laborBasis(e) === 'hours'

  function VarRow({ label, est, act, unit = '$' }: { label: string; est: number | null; act: number; unit?: string }) {
    const fmtVal = unit === '$' ? fmt : (n: number) => n.toFixed(1)
    if (est === null) {
      return (
        <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
          <span className="text-sm text-gray-700 font-medium">{label}</span>
          <div className="flex items-center gap-2 sm:gap-4 text-sm">
            <span className="text-xs text-gray-400 text-right">{NOT_AVAILABLE}</span>
            <span className="font-bold text-gray-900 w-14 sm:w-20 text-right">{fmtVal(act)}</span>
          </div>
        </div>
      )
    }
    const diff = act - est
    const pct = est > 0 ? diff / est : 0
    return (
      <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
        <span className="text-sm text-gray-700 font-medium">{label}</span>
        <div className="flex items-center gap-2 sm:gap-4 text-sm">
          <span className="text-gray-400 w-14 sm:w-20 text-right">{fmtVal(est)}</span>
          <span className="font-bold text-gray-900 w-14 sm:w-20 text-right">{fmtVal(act)}</span>
          <span className={`font-bold w-16 sm:w-20 text-right ${varianceColor(pct)}`}>
            {varianceArrow(diff)} {unit === '$' ? fmt(Math.abs(diff)) : Math.abs(diff).toFixed(1)}
          </span>
          <span className={`hidden sm:inline text-xs font-bold w-14 text-right ${varianceColor(pct)}`}>
            {pct >= 0 ? '+' : ''}{fmtPct(pct)}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-[520px] bg-white shadow-2xl flex flex-col h-full overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">{q.customerName}</h2>
            <p className="text-sm text-gray-400">{styleLabel(q.fenceStyle)} · {sizeText(q.sections, q.work)} · {e.completionDate}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={onEdit} className="text-sm font-semibold text-orange-500 hover:text-orange-600 px-2 min-h-[48px]">Edit</button>
            <button onClick={onClose} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Price & margin summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400">Sale Price</p>
              <p className="text-lg font-bold text-gray-900">{fmt(q.finalPrice)}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400">Est GM</p>
              <p className={`text-lg font-bold ${job.row.estGM === null ? 'text-gray-500' : job.row.estGM >= lowTarget() ? 'text-green-600' : 'text-yellow-600'}`}>{orNone(job.row.estGM, fmtPct)}</p>
            </div>
            <div className={`rounded-xl p-3 text-center ${job.row.actGM === null ? 'bg-gray-50' : job.row.actGM >= lowTarget() ? 'bg-green-50' : job.row.actGM >= lowTarget() - 0.05 ? 'bg-yellow-50' : 'bg-red-50'}`}>
              <p className="text-xs text-gray-400">Actual GM</p>
              <p className={`text-lg font-bold ${gmTone(job.row.actGM)}`}>{orNone(job.row.actGM, fmtPct)}</p>
            </div>
          </div>
          {!job.row.hasEstimate && <p className="text-sm font-medium text-gray-700">{NO_COST} The estimate is not available.</p>}
          <p className="text-xs text-gray-400">{BEFORE_COMMISSION}</p>

          {/* Variance table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400 font-semibold">Variance Breakdown</span>
              <div className="flex gap-2 sm:gap-4 text-xs text-gray-400">
                <span className="w-14 sm:w-20 text-right">Estimate</span>
                <span className="w-14 sm:w-20 text-right">Actual</span>
                <span className="w-16 sm:w-20 text-right">Variance</span>
                <span className="hidden sm:inline w-14 text-right">%</span>
              </div>
            </div>
            {Number(e.actualLaborHrs) > 0 && <VarRow label="Labor Hours" est={job.row.hasEstimate ? q.adjLaborHrs || 0 : null} act={e.actualLaborHrs} unit="hrs" />}
            <VarRow label={e.laborKind === 'sub' ? 'Paid to sub' : 'Labor Cost'} est={job.row.hasEstimate ? q.laborCost : null} act={job.actualLaborCost} />
            <VarRow label="Material Cost" est={job.row.hasEstimate ? q.materialCost : null} act={e.actualMaterialCost} />
            {e.actualOtherCosts > 0 && (
              <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
                <span className="text-sm text-gray-700 font-medium">Other Costs</span>
                <span className="text-sm font-bold text-gray-900">{fmt(e.actualOtherCosts)}</span>
              </div>
            )}
            <VarRow label="Total COGS" est={job.row.estCents === null ? null : job.row.estCents / 100} act={job.totalActCOGS} />
          </div>

          {(e.laborSource || oldHours || e.materialSource) && (
            <div className="text-xs text-gray-500 space-y-1">
              {oldHours && <p>Labor on this old entry came from hours x a rate. Tap Edit to enter the real cost.</p>}
              {!oldHours && e.laborSource && <p>Labor: {e.laborSource}</p>}
              {e.materialSource && <p>Material: {e.materialSource}</p>}
            </div>
          )}

          {/* Crew breakdown */}
          {e.crew.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 font-semibold mb-2">Crew Breakdown</p>
              <div className="bg-gray-50 rounded-xl overflow-hidden">
                <table className="w-full text-sm table-responsive-cards">
                  <thead>
                    <tr className="text-xs text-gray-400">
                      <th className="text-left px-4 py-2">Name</th>
                      <th className="text-right px-4 py-2">Hours</th>
                      <th className="text-right px-4 py-2">Rate</th>
                      <th className="text-right px-4 py-2">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.crew.map((c, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td data-label="Name" className="px-4 py-2 font-medium text-gray-900">{c.name}</td>
                        <td data-label="Hours" className="px-4 py-2 text-right text-gray-700">{c.hours.toFixed(1)}</td>
                        <td data-label="Rate" className="px-4 py-2 text-right text-gray-500">{fmt2(c.rate)}/hr</td>
                        <td data-label="Cost" className="px-4 py-2 text-right font-bold text-gray-900">{fmt2(crewLineCents(c) / 100)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Notes */}
          {e.notes && (
            <div>
              <p className="text-xs text-gray-400 font-semibold mb-1">Notes</p>
              <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{e.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   JOB COSTING TAB
   ═══════════════════════════════════════════════ */

export default function JobCostingTab({ state: _state }: { state: BudgetState }) {
  const [entries, setEntries] = useState<JobCostEntry[]>(loadEntries)
  const [showModal, setShowModal] = useState(false)
  const [editEntry, setEditEntry] = useState<JobCostEntry | null>(null)
  const [selectedJob, setSelectedJob] = useState<CostedJob | null>(null)

  const quotes = useMemo(() => loadQuotes(), [])
  const soldQuotes = useMemo(() => quotes.filter(q => q.status === 'SOLD'), [quotes])
  const existingIds = useMemo(() => new Set(entries.map(e => e.quoteId)), [entries])

  // Join entries with quotes to create CostedJob[]
  const costedJobs: CostedJob[] = useMemo(() => {
    return entries
      .map(entry => {
        const quote = quotes.find(q => q.id === entry.quoteId)
        if (!quote) return null

        // One rule with the customer's tab (jobCostLabor.ts). Hours are never part of the cost.
        const row = costRow(entry, quote)
        const actualLaborCost = row.laborCents / 100
        const hasHours = row.hasEstimate && Number(entry.actualLaborHrs) > 0 && (quote.adjLaborHrs || 0) > 0

        return {
          entry,
          quote,
          row,
          actualLaborCost,
          laborVariance: row.hasEstimate ? actualLaborCost - quote.laborCost : null,
          laborHrsVariance: hasHours ? entry.actualLaborHrs - quote.adjLaborHrs : null,
          materialPct: row.hasEstimate && quote.materialCost > 0 ? (entry.actualMaterialCost - quote.materialCost) / quote.materialCost : null,
          totalActCOGS: row.actualCents / 100,
        } as CostedJob
      })
      .filter(Boolean) as CostedJob[]
  }, [entries, quotes])

  // Aggregate stats
  const stats = useMemo(() => {
    if (costedJobs.length === 0) return null
    // Estimates: only jobs whose quote has a cost on file. Actuals: only entries with a cost in them.
    const compared = costedJobs.filter(j => j.row.hasEstimate && j.row.hasActual)
    const laborEst = compared.filter(j => j.quote.laborCost > 0)
    const avgLaborCostVar = avgOf(compared.map(j => j.laborVariance as number))
    const avgLaborEst = avgOf(laborEst.map(j => j.quote.laborCost))
    // Hours are optional: only jobs with hours on both sides count here.
    const withHours = costedJobs.filter(j => j.laborHrsVariance !== null)
    const avgLaborVar = avgOf(withHours.map(j => j.laborHrsVariance as number))
    const avgMaterialVar = avgOf(compared.filter(j => j.materialPct !== null).map(j => j.materialPct as number))
    const avgEstGM = avgOf(costedJobs.filter(j => j.row.estGM !== null).map(j => j.row.estGM as number))
    const avgActGM = avgOf(costedJobs.filter(j => j.row.actGM !== null).map(j => j.row.actGM as number))
    // The compare of margins is on the same jobs.
    const bothGM = compared.filter(j => j.row.estGM !== null && j.row.actGM !== null)
    const bothEstGM = avgOf(bothGM.map(j => j.row.estGM as number))
    const bothActGM = avgOf(bothGM.map(j => j.row.actGM as number))

    // By fence style
    const groups: Record<string, CostedJob[]> = {}
    costedJobs.forEach(j => {
      const cat = fenceCategory(j.quote.fenceStyle)
      ;(groups[cat] ??= []).push(j)
    })
    const byStyle: Record<string, { jobs: number; avgLaborCostVar: number | null; hrJobs: number; avgLaborVar: number; avgMatVar: number | null; avgActGM: number | null }> = {}
    Object.entries(groups).forEach(([cat, list]) => {
      const both = list.filter(j => j.row.hasEstimate && j.row.hasActual)
      const hrs = list.filter(j => j.laborHrsVariance !== null)
      byStyle[cat] = {
        jobs: list.length,
        avgLaborCostVar: avgOf(both.map(j => j.laborVariance as number)),
        hrJobs: hrs.length,
        avgLaborVar: avgOf(hrs.map(j => j.laborHrsVariance as number)) ?? 0,
        avgMatVar: avgOf(both.filter(j => j.materialPct !== null).map(j => j.materialPct as number)),
        avgActGM: avgOf(list.filter(j => j.row.actGM !== null).map(j => j.row.actGM as number)),
      }
    })

    return { avgLaborCostVar, avgLaborEst, avgLaborVar, hourJobs: withHours.length, avgMaterialVar, avgEstGM, avgActGM, bothEstGM, bothActGM, byStyle }
  }, [costedJobs])

  // Insights
  const insights = useMemo(() => {
    if (!stats) return []
    const msgs: string[] = []
    const costVar = stats.avgLaborCostVar ?? 0
    const laborPct = stats.avgLaborEst ? costVar / stats.avgLaborEst : 0
    if (laborPct > 0.05) msgs.push(`Labor costs are running ${fmt(costVar)} a job above estimates on average.`)
    else if (laborPct < -0.05) msgs.push(`Labor costs are coming in ${fmt(Math.abs(costVar))} a job below estimates on average.`)
    const hours = stats.avgLaborVar ?? 0
    const across = `(${stats.hourJobs} of ${costedJobs.length} jobs have hours)`
    if (stats.hourJobs >= MIN_HOUR_JOBS && hours > 1) msgs.push(`You underestimate labor by an average of ${hours.toFixed(1)} hours per job ${across}.`)
    else if (stats.hourJobs >= MIN_HOUR_JOBS && hours < -1) msgs.push(`You overestimate labor by an average of ${Math.abs(hours).toFixed(1)} hours per job ${across}. Your crew is faster than expected.`)
    const matVar = stats.avgMaterialVar ?? 0
    if (matVar > 0.05) msgs.push(`Material costs are running ${fmtPct(matVar)} above estimates on average.`)
    else if (matVar < -0.05) msgs.push(`Material costs are coming in ${fmtPct(Math.abs(matVar))} below estimates — good purchasing.`)
    if (stats.bothActGM !== null && stats.bothEstGM !== null) {
      if (stats.bothActGM < stats.bothEstGM - 0.03) msgs.push(`Actual margins (${fmtPct(stats.bothActGM)}) are below quoted margins (${fmtPct(stats.bothEstGM)}) — review your estimating.`)
      else if (stats.bothActGM >= stats.bothEstGM) msgs.push(`Actual margins are meeting or beating estimates — your pricing model is solid.`)
    }

    Object.entries(stats.byStyle).forEach(([style, d]) => {
      if (d.hrJobs >= MIN_HOUR_JOBS && d.avgLaborVar > 2) msgs.push(`${style} jobs average ${d.avgLaborVar.toFixed(1)} extra labor hours (${d.hrJobs} of ${d.jobs} jobs have hours) — consider adjusting man-hour rates for this style.`)
    })
    return msgs
  }, [stats])

  function handleSave(entry: JobCostEntry) {
    setEntries(prev => {
      const exists = prev.find(e => e.id === entry.id)
      const updated = exists ? prev.map(e => e.id === entry.id ? entry : e) : [entry, ...prev]
      saveEntries(updated)
      return updated
    })
    setShowModal(false)
    setEditEntry(null)
  }

  function handleDelete(id: string) {
    setEntries(prev => {
      const updated = prev.filter(e => e.id !== id)
      saveEntries(updated)
      return updated
    })
    setSelectedJob(null)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Job Costing</h2>
          <p className="text-sm text-gray-400 mt-0.5">Compare estimates to actuals. Enter real costs after job completion.</p>
        </div>
        <button
          onClick={() => { setEditEntry(null); setShowModal(true) }}
          className="btn btn-primary"
        >
          + Cost a Job
        </button>
      </div>

      {/* Aggregate KPIs */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 lg:gap-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 font-semibold mb-1">Jobs Costed</p>
            <p className="text-xl lg:text-2xl font-bold text-gray-900">{costedJobs.length}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 font-semibold mb-1">Avg Labor Variance</p>
            <p className={`text-xl lg:text-2xl font-bold ${stats.avgLaborCostVar === null ? 'text-gray-500' : varianceColor(stats.avgLaborEst ? stats.avgLaborCostVar / stats.avgLaborEst : 0)}`}>
              {orNone(stats.avgLaborCostVar, n => signed(n, fmt))}
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 font-semibold mb-1">Avg Material Variance</p>
            <p className={`text-xl lg:text-2xl font-bold ${stats.avgMaterialVar === null ? 'text-gray-500' : varianceColor(stats.avgMaterialVar)}`}>
              {orNone(stats.avgMaterialVar, n => signed(n, fmtPct))}
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 font-semibold mb-1">Avg Est GM</p>
            <p className="text-xl lg:text-2xl font-bold text-gray-500">{orNone(stats.avgEstGM, fmtPct)}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 font-semibold mb-1">Avg Actual GM</p>
            <p className={`text-xl lg:text-2xl font-bold ${gmTone(stats.avgActGM)}`}>
              {orNone(stats.avgActGM, fmtPct)}
            </p>
          </div>
        </div>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5">
          <p className="text-xs font-semibold text-orange-600 mb-2">Insights from {costedJobs.length} costed jobs</p>
          <ul className="space-y-1.5">
            {insights.map((msg, i) => (
              <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                <span className="text-orange-400 mt-0.5">•</span>
                {msg}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* By style breakdown */}
      {stats && Object.keys(stats.byStyle).length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="font-bold text-gray-900">Variance by Fence Style</h3>
          </div>
          <table className="w-full text-sm table-responsive-cards">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500">Style</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Jobs</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Avg Labor Var</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Avg Material Var</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Avg Actual GM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {Object.entries(stats.byStyle).sort((a, b) => b[1].jobs - a[1].jobs).map(([style, d]) => (
                <tr key={style} className="hover:bg-gray-50">
                  <td data-label="Style" className="px-6 py-3 font-medium text-gray-900">{style}</td>
                  <td data-label="Jobs" className="px-4 py-3 text-right text-gray-700">{d.jobs}</td>
                  <td data-label="Avg Labor Var" className="px-4 py-3 text-right font-bold text-gray-900">
                    {orNone(d.avgLaborCostVar, n => signed(n, fmt))}
                  </td>
                  <td data-label="Avg Material Var" className={`px-4 py-3 text-right font-bold ${d.avgMatVar === null ? 'text-gray-500' : varianceColor(d.avgMatVar)}`}>
                    {orNone(d.avgMatVar, n => signed(n, fmtPct))}
                  </td>
                  <td data-label="Avg Actual GM" className={`px-4 py-3 text-right font-bold ${gmTone(d.avgActGM)}`}>
                    {orNone(d.avgActGM, fmtPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Costed jobs table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-900">Costed Jobs</h3>
          <span className="text-xs text-gray-400">{costedJobs.length} jobs · {BEFORE_COMMISSION}</span>
        </div>
        <table className="w-full text-sm table-responsive-cards">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Customer</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500">Style</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500">Price</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500">Est COGS</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500">Act COGS</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500">COGS Var</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500">Est GM</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500">Act GM</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {costedJobs.length === 0 ? (
              <tr>
                <td data-label="" colSpan={9} className="px-6 py-12 text-center text-gray-400">
                  <p className="text-lg mb-1">No jobs costed yet</p>
                  <p className="text-sm">Click "Cost a Job" to enter actuals for a completed sold quote</p>
                </td>
              </tr>
            ) : costedJobs.map(j => (
              <tr key={j.entry.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedJob(j)}>
                <td data-label="Customer" className="px-5 py-3 font-medium text-gray-900">{j.quote.customerName}</td>
                <td data-label="Style" className="px-3 py-3 text-gray-600 text-xs">{fenceCategory(j.quote.fenceStyle)}</td>
                <td data-label="Price" className="px-3 py-3 text-right font-semibold text-gray-900">{fmt(j.quote.finalPrice)}</td>
                <td data-label="Est COGS" className="px-3 py-3 text-right text-gray-500">{j.row.estCents === null ? NOT_AVAILABLE : fmt(j.row.estCents / 100)}</td>
                <td data-label="Act COGS" className="px-3 py-3 text-right font-semibold text-gray-900">{j.row.hasActual ? fmt(j.totalActCOGS) : 'Not entered'}</td>
                <td data-label="COGS Var" className={`px-3 py-3 text-right font-bold ${j.row.varianceCents === null ? 'text-gray-500' : varianceColor(j.row.estCents ? j.row.varianceCents / j.row.estCents : 0)}`}>
                  {orNone(j.row.varianceCents === null ? null : j.row.varianceCents / 100, n => signed(n, fmt))}
                </td>
                <td data-label="Est GM" className="px-3 py-3 text-right text-gray-500">{orNone(j.row.estGM, fmtPct)}</td>
                <td data-label="Act GM" className={`px-3 py-3 text-right font-bold ${gmTone(j.row.actGM)}`}>
                  {orNone(j.row.actGM, fmtPct)}
                </td>
                <td data-label="Actions" className="px-2 py-3 text-right">
                  {can('ops.delete') && <button
                    onClick={e => { e.stopPropagation(); handleDelete(j.entry.id) }}
                    className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-200 hover:text-red-400 text-lg leading-none"
                    title="Delete"
                  >×</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <CostAJobModal
          // A saved entry opens even if its quote is no longer Sold (its numbers need the quote).
          soldQuotes={editEntry && !soldQuotes.some(q => q.id === editEntry.quoteId) ? [...soldQuotes, ...quotes.filter(q => q.id === editEntry.quoteId)] : soldQuotes}
          existingIds={existingIds}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditEntry(null) }}
          editEntry={editEntry}
        />
      )}

      {/* Detail drawer */}
      {selectedJob && (
        <JobDetailDrawer job={selectedJob} onClose={() => setSelectedJob(null)}
          onEdit={() => { setEditEntry(selectedJob.entry); setSelectedJob(null); setShowModal(true) }} />
      )}
    </div>
  )
}
