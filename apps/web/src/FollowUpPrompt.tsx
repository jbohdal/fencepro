/**
 * "How'd it go?": asked when the person comes back to the app after tapping
 * Call or Text (or the phone number) on a card, and by Log a call for a call
 * made outside the app. One tap answers:
 *
 *   No answer · Left voicemail · Talked, still deciding · Talked, not now (pick
 *   a date) · Booked appointment (opens Book appointment) · Signed (moves the
 *   card to the Signed stage) · Lost (pick why)
 *
 * with an optional short note, typed or spoken. The answer is a call log entry
 * (not a note) and sets the next follow up, shown at once with one tap to
 * change it. With no signal it waits in the outbox and saves when signal
 * returns. Also here: the text templates sheet (opens the phone's own texting
 * app with the message ready; nothing is ever sent by the app).
 */

import { customerText, customerTextStart } from '../../portal/src/server/lib/customerText'
import { stageHasRole, stageName, roleId, getPipelineStages } from './pipelineStagesStore'
import { bookingTypeFor } from './pipelineStageModel'
import { useEffect, useRef, useState } from 'react'
import { X, Mic, MessageSquare } from 'lucide-react'
import { useBackLayer } from './nav'
import { toast } from './toast'
import { openBooking } from './BookingDialog'
import { getPipeline, savePipeline } from './pipelineStore'
import { applySignedContractTransition } from './signedContractFlow'
import { businessDate } from './businessDate'
import { smsLink } from './appointmentLogic'
import { getConfig as getAppConfig } from './configStore'
import { listenOnce, voiceSupport } from './voiceClient'
import {
  usePrompt, closePrompt, logAnswer, changeNext, getConfig, startTouch, myName, checkServerPending, today as todayFL,
  type Touch,
} from './followUpStore'
import {
  OUTCOMES, LOST_REASONS, addDays, fillTemplate,
  type Outcome, type LostReason, type FollowUpState, type Template,
} from './followUpRules'

/** "Tue, Oct 21" (and "Today", "Tomorrow"). */
export function dayLabel(day: string | null | undefined, today = todayFL()): string {
  if (!day) return 'None set'
  if (day === today) return 'Today'
  if (day === addDays(today, 1)) return 'Tomorrow'
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const KIND_WORD: Record<string, string> = { call: 'Call', text: 'Text', decide: 'Going cold: keep or close?' }
export const kindWord = (k: string) => KIND_WORD[k] ?? 'Call'

/** Move a card (and, for the Signed stage, make its job), the same way a drop on the board does. */
export function moveCardTo(cardId: string, stage: string, extra: Record<string, unknown> = {}): boolean {
  const { leads } = getPipeline()
  const card = (leads || []).find((l: any) => l?.id === cardId)
  if (!card) return false
  if (card.stage === stage && !Object.keys(extra).length) return false
  const from = card.stage
  savePipeline(leads.map((l: any) => (l === card ? { ...l, ...extra, stage, lastMoved: stage === from ? l.lastMoved : businessDate(new Date()) } : l)))
  if (stageHasRole(stage, 'signed') && !stageHasRole(from, 'signed')) {
    try {
      const r = applySignedContractTransition({ id: card.id, customerId: card.customerId, quoteId: card.quoteId, firstName: card.firstName, lastName: card.lastName, phone: card.phone, email: card.email, address: card.address, stage, fromStage: from })
      if (r) toast.success('Deal closed — job created', `${r.job.customerName} · job on Operations board`)
      else toast.info(`Moved to ${stageName(stage)}`, 'No quote linked yet: make a quote to make the job.')
    } catch { /* the card moved; the job can be made from the quote */ }
  }
  return true
}

/** One tap date changes. */
export function DateChips({ value, onPick, today = todayFL() }: { value: string | null; onPick: (day: string | null) => void; today?: string }) {
  const chips: Array<[string, string]> = [['Tomorrow', addDays(today, 1)], ['2 days', addDays(today, 2)], ['3 days', addDays(today, 3)], ['1 week', addDays(today, 7)], ['2 weeks', addDays(today, 14)], ['1 month', addDays(today, 30)]]
  return (
    <div className="flex flex-wrap gap-2" data-date-chips>
      {chips.map(([label, day]) => (
        <button key={label} type="button" onClick={() => onPick(day)} aria-pressed={value === day} data-date-chip={label}
          className={`min-h-[44px] px-3 rounded-full border text-sm font-semibold ${value === day ? 'bg-orange-500 border-orange-500 text-white' : 'bg-white border-gray-300 text-gray-800'}`}>{label}</button>
      ))}
      <label className="min-h-[44px] px-3 rounded-full border border-gray-300 bg-white text-sm font-semibold text-gray-800 inline-flex items-center gap-2">
        Pick a day
        <input type="date" min={addDays(today, 1)} value={value && value > today ? value : ''} onChange={e => { if (e.target.value) onPick(e.target.value) }} className="text-sm bg-transparent" data-date-pick aria-label="Pick a day" />
      </label>
    </div>
  )
}

/** Mounted once: shows "How'd it go?" when there is a call to ask about. */
export function FollowUpPromptHost() {
  const touch = usePrompt()
  // Opening the app: a call started before a reload still asks.
  useEffect(() => { const t = setTimeout(() => void checkServerPending(), 2500); return () => clearTimeout(t) }, [])
  if (!touch) return null
  return <AnswerDialog key={`${touch.cardId}:${touch.startedAt}`} touch={touch} />
}

type Step = 'pick' | 'not_now' | 'lost' | 'signed' | 'done'

function AnswerDialog({ touch }: { touch: Touch }) {
  const [step, setStep] = useState<Step>('pick')
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState<string | null>(addDays(todayFL(), 7))
  const [next, setNext] = useState<FollowUpState | null>(null)
  const [answer, setAnswer] = useState<Outcome | null>(null)
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)
  const answered = useRef(false)
  const close = () => { stopRef.current?.(); closePrompt(answered.current) }
  useBackLayer(close, { key: 'how-did-it-go' })
  const canListen = voiceSupport().recognition

  async function save(outcome: Outcome, extra: { lostReason?: LostReason; pickedOn?: string | null } = {}) {
    if (busy) return
    setBusy(true)
    const st = await logAnswer({ cardId: touch.cardId, customerId: touch.customerId, name: touch.name, channel: touch.channel, outcome, note, ...extra })
    answered.current = true
    setBusy(false)
    setAnswer(outcome)
    if (outcome === 'signed') { moveCardTo(touch.cardId, roleId('signed')); close(); return }
    if (outcome === 'lost') { moveCardTo(touch.cardId, roleId('lost'), { lostReason: extra.lostReason ?? 'other' }); toast.info(`Moved to ${stageName(roleId('lost'))}`, touch.name); close(); return }
    if (outcome === 'booked') {
      close()
      const card = (getPipeline().leads || []).find((l: any) => l?.id === touch.cardId)
      if (touch.customerId) openBooking({ customerId: touch.customerId, type: bookingTypeFor(getPipelineStages(), card?.stage) })
      else toast.info('Answer saved', 'This card has no customer record, so book from the customer page.')
      return
    }
    setNext(st)
    setStep('done')
  }

  async function listen() {
    if (listening) { stopRef.current?.(); return }
    setListening(true)
    const l = listenOnce(15000)
    stopRef.current = l.stop
    const r = await l.result
    setListening(false); stopRef.current = null
    if ('text' in r && r.text) setNote(n => (n ? `${n} ${r.text}` : r.text).slice(0, 1000))
    else if ('error' in r && r.error === 'not-allowed') toast.error('The microphone is off for this app', 'Type the note instead.')
  }

  async function change(day: string | null) {
    const st = await changeNext(touch.cardId, touch.name, { dueOn: day })
    setNext(st)
  }

  const big = 'w-full min-h-[52px] px-4 rounded-xl border border-gray-200 bg-white text-left text-base font-semibold text-gray-900 active:bg-orange-50 hover:bg-gray-50 disabled:opacity-50'
  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/40" onClick={close} data-howd-it-go={touch.cardId}>
      <div role="dialog" aria-modal="true" aria-label="How'd it go?" onClick={e => e.stopPropagation()}
        className="bg-gray-50 w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto pb-[calc(16px+env(safe-area-inset-bottom))]">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-gray-900">{step === 'done' ? 'Saved' : touch.manual ? 'Log a call' : touch.channel === 'text' ? 'Did you send the text?' : "How'd it go?"}</h2>
            <p className="text-sm text-gray-600 truncate">{touch.name}{touch.channel === 'text' ? ' · text' : ' · call'}</p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="btn btn-quiet btn-icon shrink-0"><X size={22} aria-hidden="true" /></button>
        </div>

        {step === 'pick' && (
          <div className="px-4 pt-3 space-y-2" data-answers>
            {OUTCOMES.map(o => (
              <button key={o.key} type="button" disabled={busy} className={`${big} ${o.key === 'lost' ? 'text-red-700' : o.key === 'signed' ? 'text-green-800' : ''}`} data-answer={o.key}
                onClick={() => {
                  if (o.key === 'not_now') setStep('not_now')
                  else if (o.key === 'lost') setStep('lost')
                  else if (o.key === 'signed') setStep('signed')
                  else void save(o.key)
                }}>
                {o.key === 'not_now' ? 'Talked, not now (pick a date)' : o.key === 'lost' ? 'Lost (pick why)' : o.label}
              </button>
            ))}
          </div>
        )}

        {step === 'not_now' && (
          <div className="px-4 pt-3 space-y-3" data-not-now>
            <p className="text-sm font-semibold text-gray-900">When should you call back?</p>
            <DateChips value={picked} onPick={setPicked} />
            <p className="text-sm text-gray-700">Next follow up: <b data-picked>{dayLabel(picked)}</b></p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-quiet flex-1" onClick={() => setStep('pick')}>Back</button>
              <button type="button" className="btn btn-primary flex-1" disabled={!picked || busy} onClick={() => save('not_now', { pickedOn: picked })} data-save-not-now>Save</button>
            </div>
          </div>
        )}

        {step === 'lost' && (
          <div className="px-4 pt-3 space-y-2" data-lost>
            <p className="text-sm font-semibold text-gray-900">Why was it lost? The card moves to {stageName(roleId('lost'))}.</p>
            {LOST_REASONS.map(r => (
              <button key={r.key} type="button" disabled={busy} className={big} data-lost-reason={r.key} onClick={() => save('lost', { lostReason: r.key })}>{r.label}</button>
            ))}
            <button type="button" className="btn btn-quiet w-full" onClick={() => setStep('pick')}>Back</button>
          </div>
        )}

        {step === 'signed' && (
          <div className="px-4 pt-3 space-y-3" data-signed>
            <p className="text-sm text-gray-800">This moves {touch.name} to {stageName(roleId('signed'))} and makes the job on the Operations board. The follow ups stop.</p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-quiet flex-1" onClick={() => setStep('pick')}>Back</button>
              <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={() => save('signed')} data-save-signed>Signed</button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="px-4 pt-3 space-y-3" data-answer-saved={answer ?? ''}>
            <p className="text-base text-gray-900">Next follow up: <b data-next-due={next?.dueOn ?? ''}>{dayLabel(next?.dueOn)}</b>{next?.dueOn ? <span className="text-gray-600"> · {kindWord(next.dueKind)}</span> : null}</p>
            <p className="text-sm text-gray-600">Tap to change it:</p>
            <DateChips value={next?.dueOn ?? null} onPick={change} />
            <button type="button" className="btn btn-primary w-full h-12" onClick={close} data-answer-done>Done</button>
          </div>
        )}

        {step !== 'done' && (
          <div className="px-4 pt-4">
            <label className="block text-sm font-semibold text-gray-900" htmlFor="followup-note">Note (optional)</label>
            <div className="mt-1 flex gap-2 items-start">
              <textarea id="followup-note" value={note} onChange={e => setNote(e.target.value.slice(0, 1000))} rows={2} placeholder="A few words"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-orange-400" data-answer-note />
              {canListen && (
                <button type="button" onClick={listen} aria-label={listening ? 'Stop listening' : 'Say the note'} aria-pressed={listening} data-answer-mic
                  className={`w-12 h-12 grid place-items-center rounded-lg border ${listening ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-gray-300 text-gray-700'}`}><Mic size={20} aria-hidden="true" /></button>
              )}
            </div>
            {!touch.manual && step === 'pick' && <button type="button" className="mt-3 text-sm text-gray-600 underline min-h-[44px]" onClick={close} data-answer-skip>{touch.channel === 'text' ? 'Skip: I did not send it' : 'Skip: the call did not happen'}</button>}
          </div>
        )}
      </div>
    </div>
  )
}

/** The text templates for a card, each opening the phone's texting app with the message ready. */
export function TextTemplatesSheet({ card, onClose }: { card: { cardId: string; customerId: string | null; name: string; firstName: string; phone: string }; onClose: () => void }) {
  useBackLayer(onClose, { key: 'text-templates' })
  const templates: Template[] = getConfig().templates
  const company = getAppConfig().company?.name || 'Getter Done Fence'
  const me = myName()
  // Opens for any customer with a phone: the person sends it from their own phone (no yes to texts needed).
  const tap = () => {
    startTouch({ cardId: card.cardId, customerId: card.customerId, name: card.name, firstName: card.firstName, phone: card.phone, channel: 'text' }); setTimeout(onClose, 50)
  }
  return (
    <div className="fixed inset-0 z-[65] flex items-end md:items-center justify-center bg-black/40" onClick={onClose} data-text-templates>
      <div role="dialog" aria-modal="true" aria-label="Text templates" onClick={e => e.stopPropagation()} className="bg-gray-50 w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto pb-[calc(16px+env(safe-area-inset-bottom))]">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-gray-900">Text {card.name}</h2>
            <p className="text-sm text-gray-600">Opens your phone's texting app with the message ready. You send it.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-quiet btn-icon shrink-0"><X size={22} aria-hidden="true" /></button>
        </div>
        <ul className="px-4 pt-3 space-y-2">
          {templates.map(t => {
            // "Company: ... Reply STOP to opt out." around the template (lib/customerText.ts).
            const body = customerText(fillTemplate(t.body, { firstName: card.firstName, myName: me, company }), company)
            return (
              <li key={t.id}>
                <a href={smsLink(card.phone, body)} onClick={tap} data-template={t.id}
                  className="block rounded-xl border border-gray-200 bg-white px-4 py-3 min-h-[52px] active:bg-orange-50 hover:bg-gray-50">
                  <span className="block text-sm font-semibold text-gray-900">{t.name}</span>
                  <span className="block text-sm text-gray-700 mt-0.5" data-template-body>{body}</span>
                </a>
              </li>
            )
          })}
          <li>
            <a href={smsLink(card.phone, customerTextStart(card.firstName, company))} onClick={tap} data-template="blank" className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 min-h-[52px] text-sm font-semibold text-gray-900">
              <MessageSquare size={18} aria-hidden="true" /> A blank text
            </a>
          </li>
        </ul>
      </div>
    </div>
  )
}
