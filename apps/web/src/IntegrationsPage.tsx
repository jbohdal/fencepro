/**
 * Integrations Settings Page
 *
 * Grid of available integrations with connect/disconnect/test.
 * API Keys management section.
 */

import { useState, useEffect, useCallback } from 'react'
import { fetchWithAuth } from './crmAuth'

const API = (window.location.hostname === 'localhost' ? 'http://localhost:4000' : '') + '/api/integrations'
const hdrs: Record<string, string> = { 'Content-Type': 'application/json' }

async function api(path: string, opts?: RequestInit) {
  // fetchWithAuth adds the current login token and refreshes it when it has expired.
  const res = await fetchWithAuth(`${API}${path}`, { headers: hdrs, ...opts })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'API error')
  return data.data
}

type View = 'integrations' | 'api-keys' | 'webhooks'

interface IntegrationCard {
  slug: string; name: string; category: string; description: string
  capabilities: string[]; configFields: any[]; isActive: boolean
  status: string; connectedAt?: string; lastSyncedAt?: string; comingSoon?: boolean
}

export default function IntegrationsPage() {
  const [view, setView] = useState<View>('integrations')
  const [integrations, setIntegrations] = useState<IntegrationCard[]>([])
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [configForm, setConfigForm] = useState<Record<string, string>>({})
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api('/').then(setIntegrations).catch(console.error).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function handleConnect(slug: string) {
    setTestResult(null)
    try {
      const result = await api(`/${slug}/connect`, { method: 'POST', body: JSON.stringify({ config: configForm }) })
      setTestResult({ success: true, message: result.message })
      setConnecting(null)
      setConfigForm({})
      load()
    } catch (err: any) { setTestResult({ success: false, message: err.message }) }
  }

  async function handleTest(slug: string) {
    setTestResult(null)
    try {
      const result = await api(`/${slug}/test`, { method: 'POST', body: JSON.stringify({ config: configForm }) })
      setTestResult(result)
    } catch (err: any) { setTestResult({ success: false, message: err.message }) }
  }

  async function handleDisconnect(slug: string) {
    if (!confirm('Disconnect this integration?')) return
    await api(`/${slug}/disconnect`, { method: 'POST' }).catch(() => {})
    load()
  }

  async function handleSync(slug: string) {
    try {
      const result = await api(`/${slug}/sync`, { method: 'POST' })
      alert(`Sync: ${result.message}`)
      load()
    } catch (err: any) { alert(err.message) }
  }

  const categories = [...new Set(integrations.map(i => i.category))].sort()

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
          <p className="text-sm text-gray-500 mt-1">Connect third-party services to your CRM.</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
          {([['integrations', 'Integrations'], ['api-keys', 'API Keys'], ['webhooks', 'Webhooks']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${view === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'integrations' && (
        <div className="space-y-8">
          {loading ? <p className="text-gray-400 text-center py-12">Loading...</p> :
            categories.map(cat => {
              const items = integrations.filter(i => i.category === cat)
              return (
                <div key={cat}>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{cat}</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.map(integ => (
                      <div key={integ.slug} className={`bg-white rounded-2xl border ${integ.isActive ? 'border-green-200' : 'border-gray-200'} p-5 relative`}>
                        {integ.comingSoon && (
                          <span className="absolute top-3 right-3 px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-xs font-medium">Coming Soon</span>
                        )}
                        <div className="flex items-start gap-3 mb-3">
                          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-lg">
                            {integ.slug === 'twilio' ? '📱' : integ.slug === 'openweathermap' ? '🌤' : integ.slug === 'zapier' ? '⚡' :
                             integ.slug === 'quickbooks' ? '📒' : integ.slug === 'stripe' ? '💳' : integ.slug === 'google_calendar' ? '📅' :
                             integ.slug === 'companycam' ? '📸' : integ.slug === 'connecteam' ? '👷' : integ.slug === 'google_maps' ? '🗺' :
                             integ.slug === 'sendgrid' ? '📧' : '🔌'}
                          </div>
                          <div className="flex-1">
                            <h3 className="font-semibold text-gray-900">{integ.name}</h3>
                            <p className="text-xs text-gray-500 mt-0.5">{integ.description}</p>
                          </div>
                        </div>

                        {integ.isActive && (
                          <div className="flex items-center gap-2 mb-3">
                            <span className="w-2 h-2 rounded-full bg-green-500" />
                            <span className="text-xs text-green-700 font-medium">Connected</span>
                            {integ.lastSyncedAt && <span className="text-xs text-gray-400 ml-auto">Synced {new Date(integ.lastSyncedAt).toLocaleDateString()}</span>}
                          </div>
                        )}

                        <div className="flex gap-2">
                          {integ.comingSoon ? (
                            <span className="text-xs text-gray-400">Available in a future update</span>
                          ) : integ.isActive ? (
                            <>
                              <button onClick={() => handleSync(integ.slug)} className="text-xs text-blue-600 border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50">Sync</button>
                              <button onClick={() => handleDisconnect(integ.slug)} className="text-xs text-red-600 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50">Disconnect</button>
                            </>
                          ) : (
                            <button onClick={() => { setConnecting(integ.slug); setConfigForm({}); setTestResult(null) }}
                              className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium px-4 py-1.5 rounded-lg">
                              Connect
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          }
        </div>
      )}

      {view === 'api-keys' && <ApiKeysSection />}
      {view === 'webhooks' && <WebhookLogsSection />}

      {/* Connect Modal */}
      {connecting && (() => {
        const integ = integrations.find(i => i.slug === connecting)
        if (!integ) return null
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px] max-h-[90vh] overflow-y-auto p-4 lg:p-6 mx-4 lg:mx-0 space-y-4 modal-responsive">
              <h2 className="font-bold text-gray-900 text-lg">Connect {integ.name}</h2>
              {integ.configFields?.map((field: any) => (
                <div key={field.key}>
                  <label className="block text-xs text-gray-500 mb-1">{field.label} {field.required && <span className="text-red-500">*</span>}</label>
                  <input
                    type={field.type === 'password' ? 'password' : 'text'}
                    placeholder={field.placeholder || ''}
                    value={configForm[field.key] || ''}
                    onChange={e => setConfigForm({ ...configForm, [field.key]: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 outline-none"
                  />
                  {field.helpText && <p className="text-xs text-gray-400 mt-0.5">{field.helpText}</p>}
                </div>
              ))}
              {testResult && (
                <div className={`rounded-lg p-3 text-sm ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {testResult.success ? '✓' : '✗'} {testResult.message}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button onClick={() => { setConnecting(null); setTestResult(null) }}
                  className="flex-1 border border-gray-200 text-gray-600 text-sm py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
                <button onClick={() => handleTest(connecting)}
                  className="border border-blue-200 text-blue-600 text-sm py-2.5 px-4 rounded-xl hover:bg-blue-50">Test</button>
                <button onClick={() => handleConnect(connecting)}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2.5 rounded-xl">Connect</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ── API Keys Section ──

function ApiKeysSection() {
  const [keys, setKeys] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyScope, setNewKeyScope] = useState('read')
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api('/api-keys').then(setKeys).catch(console.error).finally(() => setLoading(false))
  }, [])

  async function generate() {
    try {
      const result = await api('/api-keys', { method: 'POST', body: JSON.stringify({ name: newKeyName, scope: newKeyScope }) })
      setGeneratedKey(result.key)
      setCreating(false)
      setNewKeyName('')
      // Reload
      api('/api-keys').then(setKeys).catch(() => {})
    } catch (err: any) { alert(err.message) }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this API key? This cannot be undone.')) return
    await api(`/api-keys/${id}`, { method: 'DELETE' }).catch(() => {})
    api('/api-keys').then(setKeys).catch(() => {})
  }

  function copyKey() {
    if (generatedKey) { navigator.clipboard.writeText(generatedKey); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <p className="text-sm text-gray-500">Manage API keys for external integrations and developer access.</p>
        <button onClick={() => setCreating(true)} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium self-start lg:self-auto">+ Generate Key</button>
      </div>

      {/* Generated key alert (show once) */}
      {generatedKey && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-green-800 mb-2">API Key Generated — copy it now, it won't be shown again!</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-green-300 rounded-lg px-3 py-2 text-sm font-mono text-green-900 select-all">{generatedKey}</code>
            <button onClick={copyKey} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <button onClick={() => setGeneratedKey(null)} className="text-xs text-green-600 mt-2">Dismiss</button>
        </div>
      )}

      {/* Keys table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden overflow-x-auto">
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase min-w-[640px]">
          <div className="col-span-3">Name</div><div className="col-span-2">Key</div><div className="col-span-2">Scope</div>
          <div className="col-span-2">Created</div><div className="col-span-1">Requests</div><div className="col-span-2 text-right">Actions</div>
        </div>
        {loading ? <p className="text-gray-400 text-center py-8">Loading...</p> : keys.length === 0 ? (
          <p className="text-gray-400 text-center py-8 text-sm">No API keys generated yet</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {keys.map((k: any) => (
              <div key={k.id} className={`px-6 py-3 grid grid-cols-12 gap-4 items-center text-sm min-w-[640px] ${k.isActive ? '' : 'opacity-50'}`}>
                <div className="col-span-3 font-medium text-gray-900">{k.name}</div>
                <div className="col-span-2 font-mono text-xs text-gray-500">{k.keyPrefix}</div>
                <div className="col-span-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    k.scope === 'admin' ? 'bg-red-100 text-red-700' : k.scope === 'read_write' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                  }`}>{k.scope}</span>
                </div>
                <div className="col-span-2 text-gray-500 text-xs">{new Date(k.createdAt).toLocaleDateString()}</div>
                <div className="col-span-1 text-gray-500 text-xs">{k.requestCount}</div>
                <div className="col-span-2 text-right">
                  {k.isActive ? (
                    <button onClick={() => revoke(k.id)} className="text-xs text-red-600 hover:text-red-700">Revoke</button>
                  ) : (
                    <span className="text-xs text-gray-400">Revoked</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create modal */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[400px] max-h-[90vh] overflow-y-auto p-4 lg:p-6 mx-4 lg:mx-0 space-y-4 modal-responsive">
            <h2 className="font-bold text-gray-900">Generate API Key</h2>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Key Name</label>
              <input type="text" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} placeholder="e.g., Zapier Integration"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Permission Scope</label>
              <select value={newKeyScope} onChange={e => setNewKeyScope(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="read">Read Only</option>
                <option value="read_write">Read & Write</option>
                <option value="admin">Admin (full access)</option>
              </select>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setCreating(false)} className="flex-1 border border-gray-200 text-gray-600 text-sm py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
              <button onClick={generate} disabled={!newKeyName.trim()} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-40">Generate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Webhook Logs Section ──

function WebhookLogsSection() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('/webhook-logs').then(setLogs).catch(console.error).finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Inbound webhook events from external services.</p>
      <p className="text-xs text-gray-400">Endpoint: <code className="bg-gray-100 px-1.5 py-0.5 rounded">POST /api/integrations/webhooks/inbound/{'{'}<span className="text-orange-600">source</span>{'}'}</code></p>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? <p className="text-gray-400 text-center py-8">Loading...</p> : logs.length === 0 ? (
          <p className="text-gray-400 text-center py-8 text-sm">No webhook events received yet</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {logs.map((log: any) => (
              <div key={log.id} className="px-4 lg:px-6 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">{log.source}</p>
                  <p className="text-xs text-gray-400">{log.endpoint}</p>
                </div>
                <div className="text-right">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    log.status === 'processed' ? 'bg-green-100 text-green-700' :
                    log.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>{log.status}</span>
                  <p className="text-xs text-gray-400 mt-0.5">{new Date(log.createdAt).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
