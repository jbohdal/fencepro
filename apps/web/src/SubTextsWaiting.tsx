/**
 * Texts to subs waiting to be sent from the phone (Jonathan, Nov 6 2026: "No
 * Twilio for subs ... show a 'Text [sub] now' button with the message ready,
 * on the job and on my Subs dashboard"; portal lib/subAssign.ts tellSub). A
 * tap opens the phone's Messages with the text written (the person presses
 * send) and takes it off the list; "Not needed" takes it off without texting.
 * On the job (jobId) or the Subs dashboard (all jobs).
 */

import { useCallback, useEffect, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { sendJson } from './syncHttp'
import { smsLink } from './appointmentLogic'
import { toast } from './toast'

export interface WaitingSubText { subJobId: string; jobId: string; textId: string; at: string; what: string; text: string; phone: string; subName: string; customerName: string }

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function SubTextsWaiting({ jobId, version, onOpenJob }: { jobId?: string; version?: number; onOpenJob?: (jobId: string) => void }) {
  const [list, setList] = useState<WaitingSubText[] | null>(null)
  const load = useCallback(() => {
    void sendJson('GET', `/api/subcontractors/texts${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ''}`).then(r => { if (r.result.ok) setList((r.result.data as WaitingSubText[]) ?? []) })
  }, [jobId])
  useEffect(() => { load() }, [load, version])
  // Back from the phone's Messages: read again (another person may have sent one meanwhile).
  useEffect(() => {
    const h = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', h)
    return () => document.removeEventListener('visibilitychange', h)
  }, [load])
  const mark = async (t: WaitingSubText, done: 'texted' | 'dismissed') => {
    setList(l => (l ?? []).filter(x => x.textId !== t.textId))
    const r = await sendJson('POST', `/api/subcontractors/texts/${encodeURIComponent(t.textId)}`, { done })
    if (!r.result.ok) { toast.error('Not saved', r.result.error); load() }
  }
  if (!list || !list.length) return null
  return (
    <section className="rounded-2xl border border-orange-300 bg-orange-50 p-3 space-y-2" data-sub-texts-waiting={list.length}>
      <h2 className="text-sm font-semibold text-gray-900">{list.length === 1 ? '1 text to a sub waiting' : `${list.length} texts to subs waiting`}</h2>
      {list.map(t => (
        <div key={t.textId} className="bg-white rounded-xl border border-orange-200 p-3 space-y-2" data-sub-text={t.textId}>
          <p className="text-xs text-gray-600">
            {!jobId && onOpenJob ? <button type="button" className="underline" onClick={() => onOpenJob(t.jobId)}>{t.customerName}</button> : t.customerName} · {t.what} · {when(t.at)}
          </p>
          <p className="text-sm text-gray-800 break-words">{t.text}</p>
          <div className="flex flex-wrap gap-2">
            <a href={smsLink(t.phone, t.text)} className="btn btn-primary !min-h-[44px]" onClick={() => { void mark(t, 'texted') }} data-sub-text-send={t.textId}>
              <MessageSquare size={18} aria-hidden="true" /> Text {t.subName} now
            </a>
            <button type="button" className="btn btn-secondary !min-h-[44px]" onClick={() => void mark(t, 'dismissed')} data-sub-text-dismiss={t.textId}>Not needed</button>
          </div>
        </div>
      ))}
    </section>
  )
}
