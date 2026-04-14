import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'

interface KnowledgeEntry {
  id: string
  category: string
  title: string
  content: string
  keywords: string[]
  active: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

const SUGGESTED_CATEGORIES = [
  'faq', 'materials', 'process', 'warranty', 'financing',
  'permits', 'maintenance', 'policy', 'pricing', 'scheduling',
]

export default function KnowledgeBasePage() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [filterCat, setFilterCat] = useState('')
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form state
  const [form, setForm] = useState({
    category: '',
    title: '',
    content: '',
    keywords: '',
    active: true,
    sortOrder: 0,
  })

  const loadEntries = useCallback(async () => {
    try {
      const url = filterCat ? `/knowledge?category=${filterCat}` : '/knowledge'
      const data = await api.get<{ entries: KnowledgeEntry[]; categories: string[] }>(url)
      setEntries(data.entries)
      setCategories(data.categories)
    } catch { /* ignore */ }
  }, [filterCat])

  useEffect(() => { loadEntries() }, [loadEntries])

  function openCreate() {
    setEditing(null)
    setForm({ category: '', title: '', content: '', keywords: '', active: true, sortOrder: 0 })
    setCreating(true)
  }

  function openEdit(entry: KnowledgeEntry) {
    setCreating(false)
    setEditing(entry)
    setForm({
      category: entry.category,
      title: entry.title,
      content: entry.content,
      keywords: entry.keywords.join(', '),
      active: entry.active,
      sortOrder: entry.sortOrder,
    })
  }

  function closeForm() {
    setEditing(null)
    setCreating(false)
  }

  async function handleSave() {
    if (!form.category || !form.title || !form.content) return
    setSaving(true)
    try {
      const payload = {
        category: form.category.toLowerCase().trim(),
        title: form.title.trim(),
        content: form.content.trim(),
        keywords: form.keywords.split(',').map(k => k.trim()).filter(Boolean),
        active: form.active,
        sortOrder: form.sortOrder,
      }

      if (editing) {
        await api.patch(`/knowledge/${editing.id}`, payload)
      } else {
        await api.post('/knowledge', payload)
      }
      closeForm()
      loadEntries()
    } catch { /* ignore */ }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this knowledge entry?')) return
    try {
      await api.delete(`/knowledge/${id}`)
      loadEntries()
    } catch { /* ignore */ }
  }

  async function handleToggle(entry: KnowledgeEntry) {
    try {
      await api.patch(`/knowledge/${entry.id}`, { active: !entry.active })
      loadEntries()
    } catch { /* ignore */ }
  }

  const allCategories = [...new Set([...categories, ...SUGGESTED_CATEGORIES])].sort()
  const showForm = creating || editing !== null

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: 0 }}>Chatbot Knowledge Base</h1>
          <p style={{ color: '#64748b', fontSize: 14, margin: '4px 0 0' }}>
            Add information the chatbot can reference when talking to customers.
            {entries.length > 0 && ` ${entries.filter(e => e.active).length} active entries.`}
          </p>
        </div>
        <button
          onClick={openCreate}
          style={{
            background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8,
            padding: '10px 20px', fontWeight: 600, cursor: 'pointer', fontSize: 14,
          }}
        >
          + Add Entry
        </button>
      </div>

      {/* Category filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <button
          onClick={() => setFilterCat('')}
          style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: 'pointer',
            border: filterCat === '' ? '2px solid #2563eb' : '1px solid #e2e8f0',
            background: filterCat === '' ? '#eff6ff' : '#fff',
            color: filterCat === '' ? '#2563eb' : '#64748b',
          }}
        >
          All ({entries.length})
        </button>
        {categories.map(cat => {
          const count = entries.filter(e => e.category === cat).length
          return (
            <button
              key={cat}
              onClick={() => setFilterCat(cat)}
              style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                border: filterCat === cat ? '2px solid #2563eb' : '1px solid #e2e8f0',
                background: filterCat === cat ? '#eff6ff' : '#fff',
                color: filterCat === cat ? '#2563eb' : '#64748b',
                textTransform: 'capitalize',
              }}
            >
              {cat} ({count})
            </button>
          )
        })}
      </div>

      {/* Entry list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {entries.length === 0 && (
          <div style={{
            textAlign: 'center', padding: 48, background: '#f8fafc', borderRadius: 12,
            border: '2px dashed #e2e8f0', color: '#94a3b8',
          }}>
            <p style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>No knowledge entries yet</p>
            <p style={{ fontSize: 14, margin: '0 0 16px' }}>
              Add FAQs, policies, material info, and more. The chatbot will reference these when talking to customers.
            </p>
            <button
              onClick={openCreate}
              style={{
                background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8,
                padding: '10px 20px', fontWeight: 600, cursor: 'pointer', fontSize: 14,
              }}
            >
              Add Your First Entry
            </button>
          </div>
        )}

        {entries.map(entry => (
          <div
            key={entry.id}
            style={{
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
              padding: 16, opacity: entry.active ? 1 : 0.5,
              cursor: 'pointer',
            }}
            onClick={() => openEdit(entry)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    background: '#eff6ff', color: '#2563eb', padding: '2px 10px',
                    borderRadius: 12, fontSize: 12, fontWeight: 600, textTransform: 'capitalize',
                  }}>
                    {entry.category}
                  </span>
                  {!entry.active && (
                    <span style={{
                      background: '#fef2f2', color: '#ef4444', padding: '2px 10px',
                      borderRadius: 12, fontSize: 12, fontWeight: 600,
                    }}>
                      Inactive
                    </span>
                  )}
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', margin: '4px 0' }}>
                  {entry.title}
                </h3>
                <p style={{
                  fontSize: 13, color: '#64748b', margin: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any,
                }}>
                  {entry.content}
                </p>
                {entry.keywords.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                    {entry.keywords.map(kw => (
                      <span key={kw} style={{
                        background: '#f1f5f9', color: '#64748b', padding: '1px 8px',
                        borderRadius: 8, fontSize: 11,
                      }}>
                        {kw}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => handleToggle(entry)}
                  title={entry.active ? 'Deactivate' : 'Activate'}
                  style={{
                    background: 'none', border: '1px solid #e2e8f0', borderRadius: 6,
                    padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: '#64748b',
                  }}
                >
                  {entry.active ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => handleDelete(entry.id)}
                  title="Delete"
                  style={{
                    background: 'none', border: '1px solid #fecaca', borderRadius: 6,
                    padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: '#ef4444',
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create/Edit Modal */}
      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, width: 640, maxHeight: '85vh',
            overflow: 'auto', padding: 32, boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 20px', color: '#1e293b' }}>
              {editing ? 'Edit Entry' : 'New Knowledge Entry'}
            </h2>

            {/* Category */}
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
              Category
            </label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                style={{
                  flex: 1, padding: '8px 12px', border: '1px solid #e2e8f0',
                  borderRadius: 8, fontSize: 14,
                }}
              >
                <option value="">Select or type below...</option>
                {allCategories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Or type new..."
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                style={{
                  flex: 1, padding: '8px 12px', border: '1px solid #e2e8f0',
                  borderRadius: 8, fontSize: 14,
                }}
              />
            </div>

            {/* Title */}
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
              Title
            </label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g., What is your warranty policy?"
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid #e2e8f0',
                borderRadius: 8, fontSize: 14, marginBottom: 16, boxSizing: 'border-box',
              }}
            />

            {/* Content */}
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
              Content <span style={{ fontWeight: 400, color: '#94a3b8' }}>— what the bot should know/say</span>
            </label>
            <textarea
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              placeholder="Write the information the chatbot should reference when this topic comes up. Be specific and factual."
              rows={8}
              style={{
                width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0',
                borderRadius: 8, fontSize: 14, marginBottom: 16, resize: 'vertical',
                fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box',
              }}
            />

            {/* Keywords */}
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
              Keywords <span style={{ fontWeight: 400, color: '#94a3b8' }}>— comma separated, helps the bot match this entry</span>
            </label>
            <input
              type="text"
              value={form.keywords}
              onChange={e => setForm(f => ({ ...f, keywords: e.target.value }))}
              placeholder="e.g., warranty, guarantee, coverage, defect"
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid #e2e8f0',
                borderRadius: 8, fontSize: 14, marginBottom: 16, boxSizing: 'border-box',
              }}
            />

            {/* Active toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 20, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                style={{ width: 18, height: 18 }}
              />
              Active — bot can reference this entry
            </label>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={closeForm}
                style={{
                  padding: '10px 20px', border: '1px solid #e2e8f0', borderRadius: 8,
                  background: '#fff', cursor: 'pointer', fontSize: 14, color: '#64748b',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.category || !form.title || !form.content}
                style={{
                  padding: '10px 24px', border: 'none', borderRadius: 8,
                  background: form.category && form.title && form.content ? '#2563eb' : '#94a3b8',
                  color: '#fff', cursor: form.category && form.title && form.content ? 'pointer' : 'default',
                  fontWeight: 600, fontSize: 14,
                }}
              >
                {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Entry'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
