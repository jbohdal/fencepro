/**
 * The "Send feedback" button in the top bar (every signed-in page, phone and
 * desktop) and its small form. One tap takes a picture of the screen, then
 * the form opens with it: remove it if you like, write what is wrong, Send.
 * See feedback.ts for how it is sent.
 */

import { useState } from 'react'
import { MessageSquarePlus, X, Loader2 } from 'lucide-react'
import { captureScreen, sendFeedback } from './feedback'
import { BackClose } from './nav'
import { toast } from './toast'

type Stage = { kind: 'idle' } | { kind: 'capturing' } | { kind: 'form'; shot: string | null; failed: boolean; path: string }

export default function FeedbackButton() {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  async function start() {
    if (stage.kind !== 'idle') return
    const path = window.location.pathname + window.location.search
    setStage({ kind: 'capturing' })
    // Let the button show it is working before the page is drawn.
    await new Promise(r => setTimeout(r, 30))
    const shot = await captureScreen()
    setStage({ kind: 'form', shot, failed: !shot, path })
  }

  function close() { setStage({ kind: 'idle' }); setText(''); setSending(false) }

  async function send() {
    if (stage.kind !== 'form' || sending) return
    if (!text.trim() && !stage.shot) return
    setSending(true)
    try {
      const r = await sendFeedback({ text, screenshot: stage.shot, path: stage.path })
      if (r.sent) toast.success('Feedback sent', 'Thanks. Jonathan will see it.')
      else toast.info('Feedback saved on this phone', 'It will send by itself when there is signal.')
      close()
    } catch {
      setSending(false)
      toast.error('Feedback not saved', 'Try again in a moment.')
    }
  }

  const busy = stage.kind === 'capturing'
  return (
    <>
      <button type="button" onClick={start} disabled={busy || stage.kind === 'form'} data-feedback-button data-feedback-skip
        aria-label="Send feedback" title="Send feedback"
        className="flex items-center justify-center gap-1.5 w-11 h-11 md:w-auto md:h-9 md:px-2.5 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-60 text-sm">
        {busy ? <Loader2 size={20} className="animate-spin md:w-4 md:h-4" aria-hidden="true" /> : <MessageSquarePlus size={20} className="md:w-4 md:h-4" aria-hidden="true" />}
        <span className="hidden xl:inline">{busy ? 'Taking picture...' : 'Feedback'}</span>
      </button>

      {stage.kind === 'form' && (
        <div className="fixed inset-0 z-[180] bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4" data-feedback-skip onClick={e => { if (e.target === e.currentTarget && !sending) close() }}>
          <BackClose name="feedback" onClose={close} />
          <div role="dialog" aria-modal="true" aria-labelledby="feedback-title" data-feedback-form
            className="bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] max-h-[92dvh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 id="feedback-title" className="text-base font-bold text-gray-900">Send feedback</h2>
              <button type="button" onClick={close} disabled={sending} aria-label="Close" className="w-11 h-11 -mr-2 grid place-items-center text-gray-500 hover:text-gray-900"><X size={20} aria-hidden="true" /></button>
            </div>

            {stage.shot ? (
              <div className="relative mb-3 w-fit" data-feedback-thumb>
                <img src={stage.shot} alt="Picture of the screen" className="max-h-44 rounded-lg border border-gray-200" />
                <button type="button" onClick={() => setStage({ ...stage, shot: null, failed: false })} disabled={sending}
                  className="absolute -top-2 -right-2 bg-gray-900 text-white rounded-full w-8 h-8 grid place-items-center shadow" aria-label="Remove the picture" data-feedback-remove-shot>
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <p className="text-xs text-gray-500 mb-3" data-feedback-noshot>
                {stage.failed ? 'The picture of the screen could not be made. Your feedback will be sent without it.' : 'No picture of the screen will be sent.'}
              </p>
            )}

            <label htmlFor="feedback-text" className="block text-sm font-medium text-gray-700 mb-1">What's wrong or what should change?</label>
            <textarea id="feedback-text" value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={5000} autoFocus disabled={sending}
              className="w-full border border-gray-300 rounded-lg p-2 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            <p className="text-[11px] text-gray-400 mt-1">Sent with it: your name, this page ({stage.path.split('?')[0]}), the time, and this phone or computer.</p>

            <div className="flex justify-end gap-2 mt-3">
              <button type="button" onClick={close} disabled={sending} className="btn btn-secondary min-h-[44px]">Cancel</button>
              <button type="button" onClick={send} disabled={sending || (!text.trim() && !stage.shot)} data-feedback-send className="btn btn-primary min-h-[44px]">
                {sending ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Sending...</> : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
