/**
 * Automations — Visual Automation Builder
 *
 * List view with create/edit builder. Run log viewer.
 * All data via /api/automations/ endpoints.
 */

import { useState, useEffect, useCallback } from 'react'

const API = (window.location.hostname === 'localhost' ? 'http://localhost:4000' : '') + '/api/automations'
const hdrs: Record<string, string> = (() => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = localStorage.getItem('crm_access_token')
  if (token) h['Authorization'] = `Bearer ${token}`
  else h['X-API-Key'] = 'dev-sync-key'
  return h
})()

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${API}${path}`, { headers: hdrs, ...opts })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'API error')
  return data.data
}

// ── Trigger & Action Definitions ──

const TRIGGER_GROUPS = [
  {
    label: 'Sales',
    triggers: [
      { value: 'sales_stage_change', label: 'Deal moves to a sales stage' },
    ],
  },
  {
    label: 'Operations',
    triggers: [
      { value: 'ops_stage_change', label: 'Job moves to an operations stage' },
      { value: 'job_created', label: 'Job is created' },
      { value: 'job_assigned', label: 'Job is assigned to a crew' },
      { value: 'job_scheduled', label: 'Job is scheduled' },
      { value: 'job_rescheduled', label: 'Job is rescheduled' },
      { value: 'rain_day_flagged', label: 'Job is flagged as rain day' },
    ],
  },
  {
    label: 'Time-Based',
    triggers: [
      { value: 'stale_job', label: 'No status update for X days' },
      { value: 'deadline_approaching', label: 'Due date approaching in X days' },
      { value: 'customer_no_response', label: 'Customer has not responded in X days' },
    ],
  },
  {
    label: 'Events',
    triggers: [
      { value: 'payment_received', label: 'Payment is received' },
      { value: 'form_submitted', label: 'Form or document is submitted' },
    ],
  },
]

const SALES_STAGES = [
  'First Contact', 'Appointment', 'Estimating', 'Pending Signature',
  'Signed Contract', 'Job Prep', 'Pending Start', 'Jobs In Progress',
  'Job Complete', 'Pending Payment', 'Paid & Closed',
]

const OPS_STAGES = [
  'staging', 'scheduled', 'in_progress', 'completed', 'invoiced', 'paid',
  'Awaiting Locates', 'Need Drawing', 'Materials Ordered', 'Ready to Pull',
  'Customer Delay', 'Hold (HOA)', 'Deed Restricted', 'Backorder',
]

const ACTION_TYPES = [
  { value: 'send_email', label: 'Send Email', icon: '📧' },
  { value: 'send_notification', label: 'Send Notification', icon: '🔔' },
  { value: 'create_task', label: 'Create Task', icon: '✅' },
  { value: 'move_ops_stage', label: 'Move Operations Stage', icon: '➡️' },
  { value: 'move_sales_stage', label: 'Move Sales Stage', icon: '📊' },
  { value: 'post_activity_note', label: 'Post Activity Note', icon: '📝' },
  { value: 'schedule_reminder', label: 'Schedule Reminder', icon: '⏰' },
  { value: 'fire_webhook', label: 'Fire Webhook', icon: '🔗' },
  { value: 'require_checklist_gate', label: 'Require Checklist Gate', icon: '🚧' },
]

type View = 'list' | 'builder' | 'logs'

// ── Main Page ──

export default function AutomationsPage() {
  const [view, setView] = useState<View>('list')
  const [automations, setAutomations] = useState<any[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    api('/').then(setAutomations).catch(console.error).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  function startCreate() { setEditingId(null); setView('builder') }
  function startEdit(id: string) { setEditingId(id); setView('builder') }
  function onSaved() { setView('list'); load() }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Automations</h1>
          <p className="text-sm text-gray-500 mt-1">Build triggers that fire actions automatically when events happen.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setView('logs')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${view === 'logs' ? 'bg-gray-900 text-white' : 'border border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
            Run Log
          </button>
          <button onClick={startCreate}
            className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
            + New Automation
          </button>
        </div>
      </div>

      {view === 'list' && <AutomationList automations={automations} loading={loading} onEdit={startEdit} onReload={load} />}
      {view === 'builder' && <AutomationBuilder editingId={editingId} onSaved={onSaved} onCancel={() => setView('list')} />}
      {view === 'logs' && <RunLogViewer onBack={() => setView('list')} />}
    </div>
  )
}

// ── List View ──

function AutomationList({ automations, loading, onEdit, onReload }: { automations: any[]; loading: boolean; onEdit: (id: string) => void; onReload: () => void }) {
  async function toggle(id: string) {
    await api(`/${id}/toggle`, { method: 'PATCH' })
    onReload()
  }

  async function del(id: string) {
    if (!confirm('Delete this automation?')) return
    await api(`/${id}`, { method: 'DELETE' })
    onReload()
  }

  if (loading) return <p className="text-gray-400 text-center py-12">Loading...</p>

  if (automations.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
        <div className="text-4xl mb-3">⚡</div>
        <p className="text-lg font-medium text-gray-600">No automations yet</p>
        <p className="text-sm text-gray-400 mt-1 max-w-md mx-auto">
          Create your first automation to trigger actions when jobs move through stages, payments come in, or deadlines approach.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="divide-y divide-gray-50">
        {automations.map(a => (
          <div key={a.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition group">
            <div className="flex items-center gap-4 flex-1 cursor-pointer" onClick={() => onEdit(a.id)}>
              <div className={`w-3 h-3 rounded-full ${a.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
              <div className="flex-1">
                <p className="font-medium text-gray-900">{a.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-xs font-medium">{triggerLabel(a.triggerType)}</span>
                  {' → '}
                  {(a.actions as any[]).map((act: any, i: number) => (
                    <span key={i} className="px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded text-xs font-medium ml-1">
                      {actionLabel(act.type)}
                    </span>
                  ))}
                </p>
              </div>
              <div className="text-right text-xs text-gray-400">
                <p>Fired {a.fireCount}x</p>
                {a.lastFiredAt && <p>{new Date(a.lastFiredAt).toLocaleDateString()}</p>}
              </div>
            </div>
            <div className="flex gap-1 ml-4 opacity-0 group-hover:opacity-100 transition">
              <button onClick={() => toggle(a.id)} className={`text-xs px-2 py-1 rounded ${a.isActive ? 'text-yellow-600 hover:bg-yellow-50' : 'text-green-600 hover:bg-green-50'}`}>
                {a.isActive ? 'Disable' : 'Enable'}
              </button>
              <button onClick={() => del(a.id)} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Builder ──

const emptyAction = () => ({ type: 'send_notification', notifyTo: 'role:admin', notifyTitle: '', notifyBody: '' })

function AutomationBuilder({ editingId, onSaved, onCancel }: { editingId: string | null; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [triggerType, setTriggerType] = useState('ops_stage_change')
  const [triggerConfig, setTriggerConfig] = useState<any>({})
  const [actions, setActions] = useState<any[]>([emptyAction()])
  const [conditions, setConditions] = useState<any>({})
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [step, setStep] = useState(1)

  // Load existing automation for edit
  useEffect(() => {
    if (!editingId) return
    api(`/${editingId}`).then(a => {
      setName(a.name)
      setDescription(a.description || '')
      setTriggerType(a.triggerType)
      setTriggerConfig(a.triggerConfig || {})
      setActions(a.actions as any[] || [emptyAction()])
      setConditions(a.conditions || {})
      setIsActive(a.isActive)
    }).catch(console.error)
  }, [editingId])

  async function save() {
    if (!name.trim()) { alert('Name is required'); return }
    setSaving(true)
    try {
      const body = { name, description, triggerType, triggerConfig, actions, conditions, isActive }
      if (editingId) {
        await api(`/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) })
      } else {
        await api('/', { method: 'POST', body: JSON.stringify(body) })
      }
      onSaved()
    } catch (err: any) { alert(err.message) }
    setSaving(false)
  }

  function addAction() { setActions([...actions, emptyAction()]) }
  function removeAction(i: number) { setActions(actions.filter((_, idx) => idx !== i)) }
  function updateAction(i: number, updates: any) {
    setActions(actions.map((a, idx) => idx === i ? { ...a, ...updates } : a))
  }

  const needsStage = triggerType === 'sales_stage_change' || triggerType === 'ops_stage_change'
  const needsDays = triggerType === 'stale_job' || triggerType === 'deadline_approaching' || triggerType === 'customer_no_response'
  const stageList = triggerType === 'sales_stage_change' ? SALES_STAGES : OPS_STAGES

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">{editingId ? 'Edit' : 'New'} Automation</h2>
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
      </div>

      {/* Step indicators */}
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map(s => (
          <button key={s} onClick={() => setStep(s)}
            className={`flex-1 h-1.5 rounded-full transition ${step >= s ? 'bg-orange-500' : 'bg-gray-200'}`} />
        ))}
      </div>

      {/* Step 1: Name */}
      {step === 1 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900">Step 1: Name your automation</h3>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Signed Contract → Create Job"
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-orange-300 outline-none" />
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description..." rows={2}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-orange-300 outline-none" />
          <button onClick={() => setStep(2)} disabled={!name.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-40">
            Next →
          </button>
        </div>
      )}

      {/* Step 2: Trigger */}
      {step === 2 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900">Step 2: Choose trigger</h3>
          <p className="text-sm text-gray-500">When should this automation fire?</p>
          {TRIGGER_GROUPS.map(g => (
            <div key={g.label}>
              <p className="text-xs font-semibold text-gray-400 uppercase mb-2">{g.label}</p>
              <div className="grid grid-cols-2 gap-2">
                {g.triggers.map(t => (
                  <button key={t.value} onClick={() => setTriggerType(t.value)}
                    className={`text-left px-4 py-3 rounded-lg border text-sm transition ${triggerType === t.value ? 'border-orange-500 bg-orange-50 text-orange-700 font-medium' : 'border-gray-200 hover:bg-gray-50 text-gray-700'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="border border-gray-200 text-gray-700 px-6 py-2 rounded-lg text-sm hover:bg-gray-50">← Back</button>
            <button onClick={() => setStep(3)} className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded-lg text-sm font-medium">Next →</button>
          </div>
        </div>
      )}

      {/* Step 3: Configure trigger */}
      {step === 3 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900">Step 3: Configure trigger</h3>
          <p className="text-sm text-gray-500">Trigger: {triggerLabel(triggerType)}</p>

          {needsStage && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">When stage changes TO:</label>
                <select value={triggerConfig.toStage || ''} onChange={e => setTriggerConfig({ ...triggerConfig, toStage: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">Any stage</option>
                  {stageList.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">From stage (optional):</label>
                <select value={triggerConfig.fromStage || ''} onChange={e => setTriggerConfig({ ...triggerConfig, fromStage: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">Any stage</option>
                  {stageList.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          )}

          {needsDays && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Number of days:</label>
              <input type="number" value={triggerConfig.daysOffset || 3} onChange={e => setTriggerConfig({ ...triggerConfig, daysOffset: parseInt(e.target.value) || 3 })}
                className="w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          )}

          {!needsStage && !needsDays && (
            <p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-4">No additional configuration needed. This trigger fires whenever the event occurs.</p>
          )}

          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="border border-gray-200 text-gray-700 px-6 py-2 rounded-lg text-sm hover:bg-gray-50">← Back</button>
            <button onClick={() => setStep(4)} className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded-lg text-sm font-medium">Next →</button>
          </div>
        </div>
      )}

      {/* Step 4: Actions */}
      {step === 4 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900">Step 4: Add actions</h3>
          <p className="text-sm text-gray-500">What should happen when the trigger fires? Add one or more actions.</p>

          {actions.map((action, i) => (
            <div key={i} className="border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-400">Action {i + 1}</span>
                {actions.length > 1 && (
                  <button onClick={() => removeAction(i)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                )}
              </div>

              {/* Action type selector */}
              <select value={action.type} onChange={e => updateAction(i, { type: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.icon} {a.label}</option>)}
              </select>

              {/* Action-specific config */}
              {action.type === 'send_email' && (
                <div className="space-y-2">
                  <select value={action.emailTo || 'customer'} onChange={e => updateAction(i, { emailTo: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option value="customer">Customer</option>
                    <option value="rep">Assigned Rep</option>
                    <option value="role:admin">All Admins</option>
                    <option value="role:ops_manager">Ops Managers</option>
                  </select>
                  <input type="text" placeholder="Subject — use {{customer_name}}, {{job_stage}}, etc." value={action.emailSubject || ''} onChange={e => updateAction(i, { emailSubject: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  <textarea placeholder="Email body — merge tags: {{customer_name}}, {{job_address}}, {{scheduled_date}}, {{rep_name}}, {{job_stage}}, {{company_name}}" value={action.emailBody || ''} onChange={e => updateAction(i, { emailBody: e.target.value })} rows={3}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
              )}

              {action.type === 'send_notification' && (
                <div className="space-y-2">
                  <select value={action.notifyTo || 'role:admin'} onChange={e => updateAction(i, { notifyTo: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option value="rep">Assigned Rep</option>
                    <option value="role:owner">Owner</option>
                    <option value="role:admin">Admins</option>
                    <option value="role:ops_manager">Ops Managers</option>
                    <option value="role:salesman">Salesmen</option>
                  </select>
                  <input type="text" placeholder="Notification title" value={action.notifyTitle || ''} onChange={e => updateAction(i, { notifyTitle: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  <textarea placeholder="Notification body" value={action.notifyBody || ''} onChange={e => updateAction(i, { notifyBody: e.target.value })} rows={2}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
              )}

              {action.type === 'create_task' && (
                <div className="space-y-2">
                  <input type="text" placeholder="Task title" value={action.taskTitle || ''} onChange={e => updateAction(i, { taskTitle: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  <textarea placeholder="Task description" value={action.taskDescription || ''} onChange={e => updateAction(i, { taskDescription: e.target.value })} rows={2}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  <div className="grid grid-cols-2 gap-2">
                    <select value={action.taskAssignTo || 'role:ops_manager'} onChange={e => updateAction(i, { taskAssignTo: e.target.value })}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
                      <option value="role:owner">Owner</option>
                      <option value="role:admin">Admin</option>
                      <option value="role:ops_manager">Ops Manager</option>
                      <option value="role:salesman">Salesman</option>
                    </select>
                    <div className="flex items-center gap-2">
                      <input type="number" placeholder="3" value={action.taskDueDaysOffset || ''} onChange={e => updateAction(i, { taskDueDaysOffset: parseInt(e.target.value) || undefined })}
                        className="w-20 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                      <span className="text-xs text-gray-500">days after trigger</span>
                    </div>
                  </div>
                </div>
              )}

              {(action.type === 'move_ops_stage' || action.type === 'move_sales_stage') && (
                <select value={action.targetStage || ''} onChange={e => updateAction(i, { targetStage: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">Select target stage...</option>
                  {(action.type === 'move_sales_stage' ? SALES_STAGES : OPS_STAGES).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}

              {action.type === 'post_activity_note' && (
                <textarea placeholder="Note text — merge tags supported" value={action.noteText || ''} onChange={e => updateAction(i, { noteText: e.target.value })} rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              )}

              {action.type === 'fire_webhook' && (
                <div className="space-y-2">
                  <input type="url" placeholder="https://hooks.zapier.com/..." value={action.webhookUrl || ''} onChange={e => updateAction(i, { webhookUrl: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  <select value={action.webhookMethod || 'POST'} onChange={e => updateAction(i, { webhookMethod: e.target.value })}
                    className="w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option>POST</option><option>GET</option><option>PUT</option>
                  </select>
                </div>
              )}

              {action.type === 'schedule_reminder' && (
                <div className="space-y-2">
                  <textarea placeholder="Reminder message" value={action.reminderMessage || ''} onChange={e => updateAction(i, { reminderMessage: e.target.value })} rows={2}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  <div className="flex items-center gap-2">
                    <input type="number" placeholder="1" value={action.reminderDaysOffset || ''} onChange={e => updateAction(i, { reminderDaysOffset: parseInt(e.target.value) || undefined })}
                      className="w-20 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                    <span className="text-xs text-gray-500">days after trigger</span>
                  </div>
                </div>
              )}

              {action.type === 'require_checklist_gate' && (
                <input type="text" placeholder="Checklist item name (must be completed before stage change)" value={action.checklistItem || ''} onChange={e => updateAction(i, { checklistItem: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              )}
            </div>
          ))}

          <button onClick={addAction} className="text-sm text-orange-600 hover:text-orange-700 font-medium">+ Add another action</button>

          <div className="flex gap-2">
            <button onClick={() => setStep(3)} className="border border-gray-200 text-gray-700 px-6 py-2 rounded-lg text-sm hover:bg-gray-50">← Back</button>
            <button onClick={() => setStep(5)} className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded-lg text-sm font-medium">Next →</button>
          </div>
        </div>
      )}

      {/* Step 5: Conditions + Save */}
      {step === 5 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900">Step 5: Optional conditions & save</h3>
          <p className="text-sm text-gray-500">Add conditions to narrow when this automation fires (leave blank to fire always).</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Only for assigned rep:</label>
              <input type="text" placeholder="Any rep" value={conditions.assignedRep || ''} onChange={e => setConditions({ ...conditions, assignedRep: e.target.value || undefined })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Only for fence type:</label>
              <input type="text" placeholder="Any type" value={conditions.fenceType || ''} onChange={e => setConditions({ ...conditions, fenceType: e.target.value || undefined })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={conditions.businessHoursOnly || false} onChange={e => setConditions({ ...conditions, businessHoursOnly: e.target.checked })} className="w-4 h-4" />
            Only fire during business hours (8 AM — 6 PM)
          </label>

          <div className="border-t border-gray-100 pt-4 flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="w-4 h-4 accent-orange-500" />
              Active
            </label>
            <div className="flex gap-2">
              <button onClick={() => setStep(4)} className="border border-gray-200 text-gray-700 px-6 py-2 rounded-lg text-sm hover:bg-gray-50">← Back</button>
              <button onClick={save} disabled={saving}
                className="bg-orange-500 hover:bg-orange-600 text-white px-8 py-2 rounded-lg text-sm font-medium disabled:opacity-40">
                {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Automation'}
              </button>
            </div>
          </div>

          {/* Preview */}
          <div className="bg-gray-50 rounded-xl p-4 mt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Preview</p>
            <p className="text-sm text-gray-700">
              <span className="font-medium">When</span> {triggerLabel(triggerType)}
              {triggerConfig.toStage && <> → <span className="font-medium text-blue-600">{triggerConfig.toStage}</span></>}
              {triggerConfig.daysOffset && <> ({triggerConfig.daysOffset} days)</>}
              <span className="font-medium">, then:</span>
            </p>
            <ul className="mt-1 space-y-0.5">
              {actions.map((a, i) => (
                <li key={i} className="text-sm text-gray-600">
                  {i + 1}. {actionLabel(a.type)}{a.emailTo ? ` → ${a.emailTo}` : ''}{a.notifyTo ? ` → ${a.notifyTo}` : ''}{a.targetStage ? ` → ${a.targetStage}` : ''}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Run Log Viewer ──

function RunLogViewer({ onBack }: { onBack: () => void }) {
  const [logs, setLogs] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api(`/logs/all?page=${page}`).then(d => { setLogs(d.items); setTotal(d.total) }).catch(console.error).finally(() => setLoading(false))
  }, [page])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Automation Run Log</h2>
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700">← Back to list</button>
      </div>

      {loading ? <p className="text-gray-400 text-center py-8">Loading...</p> : logs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-400">No automation runs yet</div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="divide-y divide-gray-50">
            {logs.map(log => (
              <div key={log.id} className="px-6 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{log.automationName}</p>
                    <p className="text-xs text-gray-400">
                      Job: {log.jobName || log.jobId || 'N/A'} • {log.triggerType}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      log.status === 'success' ? 'bg-green-100 text-green-700' :
                      log.status === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>{log.status}</span>
                    <p className="text-xs text-gray-400 mt-0.5">{new Date(log.firedAt).toLocaleString()}</p>
                  </div>
                </div>
                {log.errorMessage && <p className="text-xs text-red-500 mt-1">{log.errorMessage}</p>}
                <div className="flex gap-1 mt-1.5">
                  {(log.actionsExecuted as any[]).map((a: any, i: number) => (
                    <span key={i} className={`px-1.5 py-0.5 rounded text-xs ${a.success ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                      {actionLabel(a.type)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {total > 25 && (
            <div className="px-6 py-3 border-t border-gray-100 flex justify-between">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="text-sm text-gray-500 disabled:opacity-30">Prev</button>
              <span className="text-xs text-gray-400">Page {page} of {Math.ceil(total / 25)}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={logs.length < 25} className="text-sm text-gray-500 disabled:opacity-30">Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Helpers ──

function triggerLabel(type: string): string {
  for (const g of TRIGGER_GROUPS) for (const t of g.triggers) if (t.value === type) return t.label
  return type
}

function actionLabel(type: string): string {
  return ACTION_TYPES.find(a => a.value === type)?.label || type
}
