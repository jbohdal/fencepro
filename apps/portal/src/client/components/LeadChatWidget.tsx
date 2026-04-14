import { useState, useEffect, useRef, useCallback } from 'react'

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

const API_BASE = '/api/lead-chat'

function generateSessionId(): string {
  return 'lc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
}

export default function LeadChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sessionId] = useState(() => {
    const stored = sessionStorage.getItem('lead_chat_session')
    if (stored) return stored
    const id = generateSessionId()
    sessionStorage.setItem('lead_chat_session', id)
    return id
  })
  const [hasAutoOpened, setHasAutoOpened] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-open after 5 seconds on first visit
  useEffect(() => {
    if (hasAutoOpened) return
    const opened = sessionStorage.getItem('lead_chat_opened')
    if (opened) { setHasAutoOpened(true); return }
    const timer = setTimeout(() => {
      setOpen(true)
      setHasAutoOpened(true)
      sessionStorage.setItem('lead_chat_opened', 'true')
    }, 5000)
    return () => clearTimeout(timer)
  }, [hasAutoOpened])

  // Load existing session on first open
  useEffect(() => {
    if (!open || messages.length > 0) return
    fetch(`${API_BASE}/session/${sessionId}`)
      .then(r => r.json())
      .then(data => {
        if (data.data?.messages?.length > 0) {
          setMessages(data.data.messages)
        }
      })
      .catch(() => {})
  }, [open, sessionId, messages.length])

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  // Focus input
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return
    const msg = input.trim()
    setInput('')
    setSending(true)

    // Show user message immediately
    setMessages(prev => [...prev, { role: 'user', content: msg }])

    try {
      const res = await fetch(`${API_BASE}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: msg }),
      })
      const data = await res.json()
      if (data.success && data.data?.reply) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.data.reply }])
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: "I'm having a little trouble right now. You can call us directly or try again in a moment!",
        }])
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Sorry, I couldn't connect. Please try again or call us directly!",
      }])
    } finally {
      setSending(false)
    }
  }, [input, sending, sessionId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const startNewChat = () => {
    const id = generateSessionId()
    sessionStorage.setItem('lead_chat_session', id)
    setMessages([])
    window.location.reload()
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
            width: 60, height: 60, borderRadius: '50%',
            background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
            color: '#fff', border: 'none', cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(37, 99, 235, 0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'transform 0.2s, box-shadow 0.2s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'scale(1.1)'
            e.currentTarget.style.boxShadow = '0 6px 25px rgba(37, 99, 235, 0.5)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'scale(1)'
            e.currentTarget.style.boxShadow = '0 4px 20px rgba(37, 99, 235, 0.4)'
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {/* Notification badge */}
      {!open && messages.length === 0 && (
        <div style={{
          position: 'fixed', bottom: 88, right: 24, zIndex: 9999,
          background: '#fff', borderRadius: 12, padding: '10px 16px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)', maxWidth: 240,
          fontSize: 14, color: '#1e293b',
          animation: 'slideIn 0.3s ease-out',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Need a fence quote? 🏡</div>
          <div style={{ color: '#64748b', fontSize: 13 }}>Chat with us for instant pricing</div>
          <button
            onClick={() => setOpen(true)}
            style={{
              background: 'none', border: 'none', color: '#2563eb',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0, marginTop: 4,
            }}
          >
            Start chatting →
          </button>
        </div>
      )}

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          width: 380, height: 520, borderRadius: 16,
          background: '#fff', boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'slideUp 0.3s ease-out',
        }}>
          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
            color: '#fff', padding: '16px 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>GD Fence Pro</div>
              <div style={{ fontSize: 12, opacity: 0.85, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
                Online — Get instant pricing
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={startNewChat}
                title="New conversation"
                style={{
                  background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 6,
                  color: '#fff', cursor: 'pointer', padding: '4px 8px', fontSize: 12,
                }}
              >
                New
              </button>
              <button
                onClick={() => setOpen(false)}
                style={{
                  background: 'none', border: 'none', color: '#fff',
                  cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px',
                }}
              >
                ×
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            style={{
              flex: 1, overflowY: 'auto', padding: '16px',
              display: 'flex', flexDirection: 'column', gap: 12,
              background: '#f8fafc',
            }}
          >
            {messages.length === 0 && (
              <div style={{
                background: '#e0e7ff', borderRadius: '12px 12px 12px 4px',
                padding: '12px 16px', fontSize: 14, color: '#1e293b',
                maxWidth: '85%',
              }}>
                Hey! 👋 Looking to get a fence quote or have questions? I can give you instant pricing based on your project details!
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                }}
              >
                <div style={{
                  background: msg.role === 'user' ? '#2563eb' : '#e0e7ff',
                  color: msg.role === 'user' ? '#fff' : '#1e293b',
                  borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                  padding: '10px 14px', fontSize: 14, lineHeight: 1.5,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {msg.content}
                </div>
              </div>
            ))}

            {sending && (
              <div style={{
                alignSelf: 'flex-start', maxWidth: '85%',
              }}>
                <div style={{
                  background: '#e0e7ff', borderRadius: '12px 12px 12px 4px',
                  padding: '10px 14px', fontSize: 14, color: '#94a3b8',
                  display: 'flex', gap: 4,
                }}>
                  <span style={{ animation: 'bounce 1s infinite 0s' }}>●</span>
                  <span style={{ animation: 'bounce 1s infinite 0.2s' }}>●</span>
                  <span style={{ animation: 'bounce 1s infinite 0.4s' }}>●</span>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{
            padding: '12px 16px', borderTop: '1px solid #e2e8f0',
            background: '#fff', display: 'flex', gap: 8,
          }}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={sending}
              style={{
                flex: 1, border: '1px solid #e2e8f0', borderRadius: 8,
                padding: '10px 12px', fontSize: 14, outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={e => e.target.style.borderColor = '#2563eb'}
              onBlur={e => e.target.style.borderColor = '#e2e8f0'}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              style={{
                background: input.trim() && !sending ? '#2563eb' : '#94a3b8',
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '0 16px', cursor: input.trim() && !sending ? 'pointer' : 'default',
                transition: 'background 0.2s',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Animations */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
      `}</style>
    </>
  )
}
