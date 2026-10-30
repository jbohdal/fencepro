/**
 * Messages from Code (the owner's alone, codeMessages.ts): what Code sent,
 * newest first. Unread ones are bold with an orange dot, and the menu line
 * shows how many are unread. Tap one to read all of it (its details drawn as
 * simple markdown, line breaks kept); opening it marks it read. A message that
 * needs his answer has "I answered this" (and "Not answered yet" to undo).
 *
 * The push about a message opens it here (/messages-from-code?msg=<id>).
 * Anyone but the owner sees only "for the owner only" (the server answers
 * 403, and the menu line is not shown to them).
 */

import { Fragment, useEffect, useState } from 'react'
import { X, RefreshCw, CheckCircle2, AlertTriangle, Rocket, HelpCircle, Info } from 'lucide-react'
import { useBackLayer, useNav, takeOpenedParam } from './nav'
import { toast } from './toast'
import {
  loadCodeMessages, loadCodeMessage, markCodeMessageRead, markCodeMessageAnswered, refreshCodeMessageStatus,
  CODE_MESSAGE_KIND_LABEL, type CodeMessage, type CodeMessageKind,
} from './codeMessages'
import { mdBlocks, mdSpans } from './codeMessageText'

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const KIND_STYLE: Record<CodeMessageKind, { chip: string; Icon: typeof Info }> = {
  live: { chip: 'bg-green-100 text-green-800', Icon: Rocket },
  needs_answer: { chip: 'bg-purple-100 text-purple-800', Icon: HelpCircle },
  failed: { chip: 'bg-red-100 text-red-800', Icon: AlertTriangle },
  info: { chip: 'bg-gray-100 text-gray-700', Icon: Info },
}

function KindChip({ kind }: { kind: CodeMessageKind }) {
  const { chip, Icon } = KIND_STYLE[kind] ?? KIND_STYLE.info
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${chip}`} data-code-kind={kind}><Icon size={12} aria-hidden="true" />{CODE_MESSAGE_KIND_LABEL[kind] ?? kind}</span>
}

function Spans({ text }: { text: string }) {
  return <>{mdSpans(text).map((s, i) =>
    s.type === 'bold' ? <strong key={i}>{s.text}</strong>
      : s.type === 'code' ? <code key={i} className="px-1 py-0.5 rounded bg-gray-100 text-[0.9em] break-words">{s.text}</code>
        : s.type === 'link' ? <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" className="text-orange-600 underline break-all">{s.text}</a>
          : <Fragment key={i}>{s.text}</Fragment>)}</>
}

/** The details, as simple markdown drawn with React elements (nothing in it is run or treated as HTML). */
export function MessageBody({ text }: { text: string }) {
  if (!text.trim()) return <p className="text-sm text-gray-500" data-code-body>No more details: the title says it all.</p>
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-gray-900 break-words" data-code-body>
      {mdBlocks(text).map((b, i) => {
        if (b.type === 'heading') {
          const cls = b.level === 1 ? 'text-lg font-bold' : b.level === 2 ? 'text-base font-bold' : 'text-[15px] font-semibold'
          return <p key={i} role="heading" aria-level={b.level + 1} className={`${cls} pt-1`}><Spans text={b.text} /></p>
        }
        if (b.type === 'list') {
          const List = b.ordered ? 'ol' : 'ul'
          return <List key={i} className={`${b.ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-1`}>{b.items.map((it, j) => <li key={j} className="whitespace-pre-wrap"><Spans text={it} /></li>)}</List>
        }
        if (b.type === 'code') return <pre key={i} className="text-xs bg-gray-900 text-gray-100 rounded-lg p-3 overflow-x-auto whitespace-pre">{b.text}</pre>
        if (b.type === 'quote') return <blockquote key={i} className="border-l-4 border-gray-300 pl-3 text-gray-700 whitespace-pre-wrap"><Spans text={b.text} /></blockquote>
        return <p key={i} className="whitespace-pre-wrap"><Spans text={b.text} /></p>
      })}
    </div>
  )
}

/** One message, full screen on a phone and a window on a computer. Opening it marks it read. */
function MessageWindow({ id, first, onClose, onChanged }: { id: string; first: CodeMessage | null; onClose: () => void; onChanged: (m: CodeMessage) => void }) {
  useBackLayer(onClose, { key: 'msg', params: { msg: id } })
  const [m, setM] = useState<CodeMessage | null>(first && first.body.length < 200 ? first : null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void (async () => {
      // Opening it marks it read and answers with all of it.
      const r = await markCodeMessageRead(id)
      if (!live) return
      if (r.ok) { setM(r.data); onChanged(r.data); setError(null) }
      else {
        const again = r.status === 0 ? r : await loadCodeMessage(id)
        if (!live) return
        if (again.ok) setM(again.data); else setError(again.error)
      }
    })()
    return () => { live = false }
  }, [id])  // eslint-disable-line react-hooks/exhaustive-deps

  async function answered(v: boolean) {
    if (!m || busy) return
    setBusy(true)
    const r = await markCodeMessageAnswered(m.id, v)
    setBusy(false)
    if (!r.ok) { toast.error('Not changed', r.error); return }
    setM(r.data); onChanged(r.data)
  }

  const shown = m ?? first
  return (
    <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center bg-black/40 md:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={shown?.title || 'Message from Code'} onClick={e => e.stopPropagation()} data-code-window={id}
        className="bg-white w-full md:max-w-2xl md:rounded-2xl shadow-2xl flex flex-col max-h-full md:max-h-[90vh] overflow-hidden">
        <div className="border-b border-gray-200 px-4 pt-[calc(12px+env(safe-area-inset-top))] md:pt-4 pb-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {shown && <div className="flex items-center gap-2 flex-wrap mb-1"><KindChip kind={shown.kind} /><span className="text-xs text-gray-500">{when(shown.createdAt)}</span></div>}
            <h2 className="text-base md:text-lg font-bold text-gray-900 break-words">{shown?.title ?? 'Message from Code'}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 -mt-1 grid place-items-center rounded-full text-gray-500 hover:bg-gray-100 shrink-0"><X size={22} aria-hidden="true" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!m && !error && <p className="text-sm text-gray-500">Loading the message...</p>}
          {m && <MessageBody text={m.body} />}
        </div>
        {m?.kind === 'needs_answer' && (
          <div className="border-t border-gray-200 px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] flex items-center gap-2 flex-wrap">
            {m.answeredAt
              ? <>
                <span className="text-sm text-green-700 font-semibold flex items-center gap-1" data-code-answered><CheckCircle2 size={16} aria-hidden="true" /> Answered {when(m.answeredAt)}</span>
                <button type="button" className="btn btn-secondary btn-sm min-h-[44px] ml-auto" disabled={busy} onClick={() => void answered(false)}>Not answered yet</button>
              </>
              : <>
                <span className="text-sm text-gray-600">Answer Code in your chat with it, then tap:</span>
                <button type="button" className="btn btn-primary btn-sm min-h-[44px] ml-auto" disabled={busy} onClick={() => void answered(true)} data-code-answer>I answered this</button>
              </>}
          </div>
        )}
      </div>
    </div>
  )
}

export default function CodeMessagesPage() {
  const nav = useNav()
  const [items, setItems] = useState<CodeMessage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  async function load() {
    const r = await loadCodeMessages()
    if (r.ok) { setItems(r.data); setError(null); setDenied(false) }
    else if (r.status === 403) setDenied(true)
    else setError(r.error)
    void refreshCodeMessageStatus()
  }
  useEffect(() => { void load() }, [])
  // A message named in the address (?msg=<id>: the push, a reload, a link).
  useEffect(() => {
    const id = nav.params.get('msg') ?? takeOpenedParam('msg')
    if (id && id !== openId) setOpenId(id)
  }, [nav])  // eslint-disable-line react-hooks/exhaustive-deps

  const changed = (m: CodeMessage) => setItems(cur => (cur ?? []).map(x => (x.id === m.id ? { ...m, body: x.body } : x)))

  if (denied) return <p className="max-w-2xl mx-auto text-sm text-gray-600 bg-white border border-gray-200 rounded-xl p-6 text-center" data-code-denied>Messages from Code are for the owner only.</p>

  const unread = (items ?? []).filter(m => !m.readAt).length
  return (
    <div className="max-w-3xl mx-auto" data-code-messages-page>
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-sm text-gray-600">{items ? (unread ? `${unread} unread of ${items.length}` : `${items.length} message${items.length === 1 ? '' : 's'}, all read`) : ''}</p>
        <button type="button" onClick={() => void load()} className="btn btn-secondary btn-sm min-h-[40px]"><RefreshCw size={14} aria-hidden="true" /> Refresh</button>
      </div>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {items === null && !error && <p className="text-sm text-gray-500">Loading Messages from Code...</p>}
      {items && items.length === 0 && <p className="text-sm text-gray-500 bg-white border border-gray-200 rounded-xl p-6 text-center">No messages yet. When a deploy goes live, something needs your answer, or something fails, Code leaves the details here and sends a push to your phone.</p>}
      <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
        {(items ?? []).map(m => (
          <li key={m.id}>
            <button type="button" onClick={() => setOpenId(m.id)} data-code-item={m.id} data-unread={m.readAt ? undefined : ''}
              className="w-full text-left px-4 py-3 min-h-[64px] flex items-start gap-3 hover:bg-gray-50 active:bg-gray-100">
              <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${m.readAt ? 'bg-transparent' : 'bg-orange-500'}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 flex-wrap">
                  <KindChip kind={m.kind} />
                  <span className="text-xs text-gray-500">{when(m.createdAt)}</span>
                  {!m.readAt && <span className="sr-only">Unread</span>}
                  {m.kind === 'needs_answer' && m.answeredAt && <span className="text-[11px] text-green-700 font-semibold">Answered</span>}
                </span>
                <span className={`block mt-1 text-[15px] break-words ${m.readAt ? 'text-gray-700' : 'text-gray-900 font-semibold'}`}>{m.title}</span>
                {m.body.trim() && <span className="block text-xs text-gray-500 mt-0.5 line-clamp-2 break-words">{m.body.replace(/[#*`>]/g, '').replace(/\s+/g, ' ').trim()}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {openId && <MessageWindow key={openId} id={openId} first={(items ?? []).find(x => x.id === openId) ?? null} onClose={() => setOpenId(null)} onChanged={changed} />}
    </div>
  )
}
