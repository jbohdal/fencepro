/**
 * Follow ups: who to call. Overdue (red), Due today, Coming up, and the
 * cards with no follow up set in stages that need one (Settings > Pipeline Stages). Each row:
 * name, stage, price, last answer, days since the last contact, and one tap
 * Call or Text (Text offers the templates). A salesman sees only their own
 * cards (the server decides); the owner and office see everyone and can pick
 * a rep.
 */

import { getPipelineStages } from './pipelineStagesStore'
import { useState } from 'react'
import { Phone, MessageSquare, ClipboardPen, RefreshCw } from 'lucide-react'
import { formatPhone, telHref } from './phoneFormat'
import { navigate } from './nav'
import { useFollowUpList, useFollowUpBoard, startTouch, openLogCall, pendingFor, type ListRow, type OpenedRow } from './followUpStore'
import { agoWords } from './proposalOpened'
import { OUTCOME_LABEL } from './followUpRules'
import { TextTemplatesSheet, dayLabel, kindWord } from './FollowUpPrompt'
import { ServiceNeedsYou } from './ServiceRequests'
import { useOpenTickets } from './serviceStore'

const fmtUSD = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)

export default function FollowUpsPage() {
  useFollowUpBoard()
  const [rep, setRep] = useState('')
  const { list, loading, offline, reload } = useFollowUpList(rep)
  const [texting, setTexting] = useState<ListRow | null>(null)
  const tickets = useOpenTickets()

  const total = list ? list.overdue.length + list.dueToday.length : 0
  return (
    <div className="space-y-4 pb-24" data-follow-ups-page>
      <div className="page-header !mb-0">
        <div className="min-w-0">
          <h1>Follow ups</h1>
          <div className="facts">
            <span><b data-count-overdue>{list?.overdue.length ?? 0}</b> overdue</span>
            <span><b data-count-today>{list?.dueToday.length ?? 0}</b> due today</span>
            {offline && <span className="text-amber-700">No signal: showing the last list</span>}
          </div>
        </div>
        <div className="actions">
          {list?.seesEveryone && (
            <select value={rep} onChange={e => setRep(e.target.value)} aria-label="Rep" data-rep-filter
              className="border border-gray-300 rounded-lg h-12 px-3 text-base bg-white">
              <option value="">Everyone</option>
              {list.reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          <button type="button" className="btn btn-quiet btn-icon" onClick={reload} aria-label="Load again"><RefreshCw size={18} aria-hidden="true" /></button>
        </div>
      </div>

      {loading && !list && <p className="text-sm text-gray-600">Loading follow ups…</p>}
      {list && total === 0 && list.upcoming.length === 0 && list.notSet.length === 0 && !list.opened24h?.length && (
        <p className="panel p-6 text-center text-gray-600" data-follow-ups-empty>Nobody to call. New follow ups appear here as cards move and calls are answered.</p>
      )}
      <ServiceNeedsYou title="Service requests waiting" list={tickets} />
      {list && <Section title="Opened in the last 24h" tone="purple" rows={list.opened24h ?? []} id="opened-24h" onText={setTexting} note="The customer opened the proposal. A good time to call." />}
      {list && <Section title="Overdue" tone="red" rows={list.overdue} id="overdue" onText={setTexting} />}
      {list && <Section title="Due today" tone="orange" rows={list.dueToday} id="today" onText={setTexting} />}
      {list && <Section title="Coming up" tone="gray" rows={list.upcoming} id="upcoming" onText={setTexting} />}
      {list && <Section title="No follow up set" tone="gray" rows={list.notSet} id="not-set" onText={setTexting} note={`${getPipelineStages().filter(x => x.needsFollowUp).map(x => x.name).join(' and ') || 'Cards'} with nothing planned.`} />}

      {texting && <TextTemplatesSheet card={{ cardId: texting.cardId, customerId: texting.customerId, name: texting.name, firstName: texting.firstName, phone: texting.phone }} onClose={() => setTexting(null)} />}
    </div>
  )
}

type Tone = 'red' | 'orange' | 'gray' | 'purple'

function Section({ title, tone, rows, id, onText, note }: { title: string; tone: Tone; rows: ListRow[]; id: string; onText: (r: ListRow) => void; note?: string }) {
  if (!rows.length) return null
  const head = tone === 'red' ? 'text-red-700' : tone === 'orange' ? 'text-orange-700' : tone === 'purple' ? 'text-purple-800' : 'text-gray-800'
  return (
    <section className="space-y-2" data-follow-up-section={id}>
      <h2 className={`text-sm font-bold ${head}`}>{title} <span className="font-semibold text-gray-500">({rows.length})</span></h2>
      {note && <p className="text-xs text-gray-600 -mt-1">{note}</p>}
      <ul className="space-y-2">
        {rows.map(r => <Row key={r.cardId} r={r} tone={tone} onText={() => onText(r)} />)}
      </ul>
    </section>
  )
}

function Row({ r, tone, onText }: { r: ListRow; tone: Tone; onText: () => void }) {
  const border = tone === 'red' ? 'border-l-red-500' : tone === 'orange' ? 'border-l-orange-500' : tone === 'purple' ? 'border-l-purple-500' : 'border-l-gray-300'
  const o = 'openedAt' in r ? (r as OpenedRow) : null
  const since = r.daysSinceContact === null ? 'No contact logged' : r.daysSinceContact === 0 ? 'Contacted today' : `${r.daysSinceContact}d since last contact`
  const due = r.status === 'overdue' ? `Overdue ${r.days}d` : r.dueOn ? `${dayLabel(r.dueOn)} · ${kindWord(r.dueKind)}` : 'None set'
  const touch = { cardId: r.cardId, customerId: r.customerId, name: r.name, firstName: r.firstName, phone: r.phone, stage: r.stage }
  const action = 'flex items-center justify-center gap-1.5 min-h-[48px] min-w-[48px] px-3 rounded-xl border text-sm font-semibold'
  return (
    <li className={`bg-white rounded-xl border border-gray-200 border-l-4 ${border} p-3`} data-follow-up-row={r.cardId} data-status={r.status}>
      <div className="flex items-start gap-3">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => navigate(`/pipeline?card=${encodeURIComponent(r.cardId)}`, { from: 'Follow ups' })} data-follow-up-open>
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-base font-semibold text-gray-900 truncate">{r.name}</span>
            <span className="text-sm font-bold text-emerald-700 shrink-0 tabular-nums">{fmtUSD(r.valueCents)}</span>
          </span>
          <span className="block text-sm text-gray-600 truncate">{r.stage}{r.ownerName ? ` · ${r.ownerName}` : ''}</span>
          <span className="block text-sm text-gray-800 mt-0.5">
            <span className={tone === 'red' ? 'font-semibold text-red-700' : 'font-semibold'} data-follow-up-due>{due}</span>
            {r.lastOutcome ? <> · {OUTCOME_LABEL[r.lastOutcome] ?? r.lastOutcome}</> : null}
          </span>
          {o && (
            <span className="block text-sm text-purple-800 mt-0.5" data-follow-up-opened>
              Opened {agoWords(o.openedAt)}{o.openedDevice ? ` on ${o.openedDevice}` : ''}{o.openedTimes > 1 ? ` (${o.openedTimes}× in 24h)` : ''}{o.openedLongest ? ` · looked longest at ${o.openedLongest}` : ''}
            </span>
          )}
          <span className="block text-xs text-gray-500" data-follow-up-since>{since}{pendingFor(r.cardId) ? ' · Saving…' : ''}</span>
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-2">
        <a href={r.phone ? telHref(r.phone) : undefined} onClick={() => { if (r.phone) startTouch({ ...touch, channel: 'call' }) }} aria-label={r.phone ? `Call ${formatPhone(r.phone)}` : 'No phone number'} data-follow-up-call
          className={`${action} border-green-600 bg-green-600 text-white ${r.phone ? '' : 'opacity-40 pointer-events-none'}`}><Phone size={18} aria-hidden="true" />Call</a>
        <button type="button" onClick={onText} disabled={!r.phone} data-follow-up-text className={`${action} border-gray-300 bg-white text-gray-800 disabled:opacity-40`}><MessageSquare size={18} aria-hidden="true" />Text</button>
        <button type="button" onClick={() => openLogCall({ ...touch, channel: 'call' })} data-follow-up-log className={`${action} border-gray-300 bg-white text-gray-800`}><ClipboardPen size={18} aria-hidden="true" />Log</button>
      </div>
    </li>
  )
}
