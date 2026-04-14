import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'

interface ChatMsg {
  id: string
  role: 'customer' | 'assistant' | 'agent'
  body: string
  createdAt: string
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load conversation when opened
  useEffect(() => {
    if (!open) return
    api.get<{ id: string; messages: ChatMsg[] }>('/chat/conversation').then(data => {
      setConversationId(data.id)
      setMessages(data.messages)
    }).catch(() => {})
  }, [open])

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  async function handleSend() {
    if (!input.trim() || sending) return
    const msg = input.trim()
    setInput('')
    setSending(true)

    // Optimistic: show customer message immediately
    const tempId = `temp-${Date.now()}`
    setMessages(prev => [...prev, { id: tempId, role: 'customer', body: msg, createdAt: new Date().toISOString() }])

    try {
      const data = await api.post<{
        customerMessage: ChatMsg
        assistantMessage: ChatMsg
        escalated: boolean
        ticketId?: string
      }>('/chat/message', { body: msg })

      // Replace temp message with real one + add assistant response
      setMessages(prev => [
        ...prev.filter(m => m.id !== tempId),
        data.customerMessage,
        data.assistantMessage,
      ])

      if (data.escalated) {
        // After escalation, the conversation is closed — next message starts a new one
        setConversationId(null)
      }
    } catch {
      setMessages(prev => [
        ...prev,
        { id: `err-${Date.now()}`, role: 'assistant', body: 'Sorry, I had trouble responding. Please try again.', createdAt: new Date().toISOString() },
      ])
    } finally {
      setSending(false)
    }
  }

  async function handleNewChat() {
    await api.post('/chat/new').catch(() => {})
    setConversationId(null)
    setMessages([])
    // Re-fetch will create new conversation
    api.get<{ id: string; messages: ChatMsg[] }>('/chat/conversation').then(data => {
      setConversationId(data.id)
      setMessages(data.messages)
    }).catch(() => {})
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-orange-500 hover:bg-orange-600 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105"
        >
          <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-96 h-[540px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-gray-900 px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-white text-sm font-semibold">Support Chat</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleNewChat} className="text-gray-400 hover:text-white text-xs" title="New conversation">
                New
              </button>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white text-lg leading-none">×</button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'customer' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                  msg.role === 'customer'
                    ? 'bg-orange-500 text-white rounded-br-md'
                    : msg.role === 'agent'
                    ? 'bg-blue-100 text-blue-900 rounded-bl-md'
                    : 'bg-gray-100 text-gray-800 rounded-bl-md'
                }`}>
                  {msg.role === 'agent' && <p className="text-[10px] text-blue-500 font-semibold mb-0.5">Support Agent</p>}
                  <p className="whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                  <p className={`text-[10px] mt-1 ${msg.role === 'customer' ? 'text-orange-200' : 'text-gray-400'}`}>
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-gray-200 px-3 py-2 shrink-0">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                className="flex-1 border border-gray-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="Type a message..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                disabled={sending}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className="w-9 h-9 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 text-white rounded-full flex items-center justify-center shrink-0 transition-colors"
              >
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
