/**
 * Settings > Follow ups: the steps for each stage (call or text on day N
 * after the card entered the stage; after the last one, "Going cold, keep or
 * close?"), the text templates ({first name}, {my name}, {company} are filled
 * in), and the one-time "first follow up" for open cards that have none.
 * Saved on the server (/api/follow-ups/settings); only roles that may change
 * settings can save.
 */

import { usePipelineStages, followUpStages, stageName, getPipelineStages } from './pipelineStagesStore'

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useCan } from './permissions'
import { toast } from './toast'
import { sendJson } from './syncHttp'
import { loadPipeline } from './JobsPage'
import { loadConfig, saveConfig, refreshBoard, myName } from './followUpStore'
import { fillTemplate, stopsSteps, type FollowUpConfig, type Step, type Template } from './followUpRules'
import { dayLabel } from './FollowUpPrompt'
import { getConfig as getAppConfig } from './configStore'

/** "A", "A and B", "A, B and C". */
const stageList = (names: string[]) => names.length <= 1 ? (names[0] ?? 'stages that need a follow up') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

export default function FollowUpSettings() {
  const allowed = useCan('settings.change')
  const [cfg, setCfg] = useState<FollowUpConfig | null>(null)
  const [version, setVersion] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { loadConfig().then(r => { if (r) { setCfg(r.config); setVersion(r.version) } else setError('Could not load the follow up settings. Check the connection.') }) }, [])
  // Open stages only (Settings > Pipeline Stages): steps stop on the Sold stages and Lost.
  usePipelineStages()
  const stages = loadPipeline().stages.filter(s => !stopsSteps(s, followUpStages()))

  const edit = (f: (c: FollowUpConfig) => FollowUpConfig) => { setCfg(c => (c ? f(c) : c)); setDirty(true) }
  const setSteps = (stage: string, steps: Step[]) => edit(c => ({ ...c, steps: { ...c.steps, [stage]: steps } }))
  const setTemplates = (templates: Template[]) => edit(c => ({ ...c, templates }))

  async function save() {
    if (!cfg) return
    setSaving(true); setError('')
    const r = await saveConfig(cfg, version)
    setSaving(false)
    if (r.ok) { setVersion(r.version); setDirty(false); toast.success('Follow ups saved'); return }
    setError(r.error)
    if (r.stale) { const again = await loadConfig(); if (again) { setCfg(again.config); setVersion(again.version); setDirty(false) } }
  }

  if (!cfg) return <p className="text-sm text-gray-600">{error || 'Loading…'}</p>
  const sample = { firstName: 'Sarah', myName: myName(), company: getAppConfig().company?.name || 'Getter Done Fence' }
  return (
    <div className="space-y-6" data-follow-up-settings>
      <div>
        <h2 className="text-lg font-bold text-gray-900">Follow up steps</h2>
        <p className="text-sm text-gray-600">Counted in days from the day a card enters the stage. A call's answer sets its own next date (No answer tomorrow, Voicemail 2 days, Still deciding 3 days, Not now the day picked); a step that comes sooner comes first. After the last step: "Going cold, keep or close?". The steps stop on Signed or Lost and start again when the card changes stage.</p>
      </div>
      {stages.map(stage => {
        const steps = cfg.steps[stage] ?? []
        return (
          <section key={stage} className="bg-white rounded-2xl border border-gray-200 p-4" data-steps-stage={stage}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-gray-900">{stageName(stage)}</h3>
              <span className="text-xs text-gray-500">{steps.length ? `${steps.length} step${steps.length === 1 ? '' : 's'}` : 'No steps'}</span>
            </div>
            <ol className="mt-2 space-y-2">
              {steps.map((s, i) => (
                <li key={i} className="flex items-center gap-2" data-step={i}>
                  <span className="text-sm text-gray-600 w-6">{i + 1}.</span>
                  <select value={s.kind} disabled={!allowed} aria-label="Call or text" data-step-kind
                    onChange={e => setSteps(stage, steps.map((x, j) => (j === i ? { ...x, kind: e.target.value as Step['kind'] } : x)))}
                    className="border border-gray-300 rounded-lg h-11 px-2 text-base bg-white">
                    <option value="call">Call</option>
                    <option value="text">Text</option>
                  </select>
                  <span className="text-sm text-gray-700">on day</span>
                  <input type="number" min={0} max={365} value={s.day} disabled={!allowed} aria-label="Day" data-step-day
                    onChange={e => setSteps(stage, steps.map((x, j) => (j === i ? { ...x, day: Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0))) } : x)))}
                    className="w-20 border border-gray-300 rounded-lg h-11 px-2 text-base" />
                  {allowed && <button type="button" className="btn btn-quiet btn-icon" aria-label={`Remove step ${i + 1}`} onClick={() => setSteps(stage, steps.filter((_, j) => j !== i))}><Trash2 size={18} aria-hidden="true" /></button>}
                </li>
              ))}
            </ol>
            {steps.length > 0 && <p className="text-sm text-gray-600 mt-2">Then: Going cold, keep or close?</p>}
            {allowed && steps.length < 12 && (
              <button type="button" className="btn btn-quiet btn-sm mt-2" data-add-step onClick={() => setSteps(stage, [...steps, { day: (steps[steps.length - 1]?.day ?? 0) + 3, kind: 'call' }])}><Plus size={16} aria-hidden="true" /> Add a step</button>
            )}
          </section>
        )
      })}

      <div>
        <h2 className="text-lg font-bold text-gray-900">Text templates</h2>
        <p className="text-sm text-gray-600">Tapping one opens the phone's own texting app with the message ready; the salesman sends it. {'{first name}'} is the customer's first name, {'{my name}'} the salesman's, {'{company}'} the company.</p>
      </div>
      <ul className="space-y-3">
        {cfg.templates.map((t, i) => (
          <li key={i} className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2" data-template-edit={t.id}>
            <div className="flex items-center gap-2">
              <input value={t.name} disabled={!allowed} onChange={e => setTemplates(cfg.templates.map((x, j) => (j === i ? { ...x, name: e.target.value.slice(0, 60) } : x)))} aria-label="Template name"
                className="flex-1 border border-gray-300 rounded-lg h-11 px-3 text-base font-semibold" />
              {allowed && <button type="button" className="btn btn-quiet btn-icon" aria-label={`Remove ${t.name}`} onClick={() => setTemplates(cfg.templates.filter((_, j) => j !== i))}><Trash2 size={18} aria-hidden="true" /></button>}
            </div>
            <textarea value={t.body} disabled={!allowed} rows={3} onChange={e => setTemplates(cfg.templates.map((x, j) => (j === i ? { ...x, body: e.target.value.slice(0, 600) } : x)))} aria-label="Message"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base" data-template-body-edit />
            <p className="text-sm text-gray-600" data-template-preview><span className="font-semibold">Sarah sees:</span> {fillTemplate(t.body, sample)}</p>
          </li>
        ))}
      </ul>
      {allowed && cfg.templates.length < 20 && (
        <button type="button" className="btn btn-quiet btn-sm" data-add-template onClick={() => setTemplates([...cfg.templates, { id: `t-${Date.now().toString(36)}`, name: 'New template', body: 'Hi {first name}, this is {my name} with {company}. ' }])}><Plus size={16} aria-hidden="true" /> Add a template</button>
      )}

      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      {allowed ? (
        <div className="sticky bottom-0 bg-gray-50/90 py-3 flex justify-end">
          <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save} data-save-follow-ups>{saving ? 'Saving…' : dirty ? 'Save follow ups' : 'Saved'}</button>
        </div>
      ) : <p className="text-sm text-gray-600">Only the owner can change these.</p>}

      <FirstFollowUp allowed={allowed} />
    </div>
  )
}

/** Item j: a first follow up, due tomorrow, on every open card in a stage that needs one and has none. Shows the count and asks first. */
function FirstFollowUp({ allowed }: { allowed: boolean }) {
  const [p, setP] = useState<{ count: number; dueOn: string; byOwner: Array<{ name: string; count: number }> } | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => sendJson('GET', '/api/follow-ups/first-follow-up').then(r => { if (r.result.ok) setP(r.json.data) })
  useEffect(() => { void load() }, [])
  async function run() {
    if (!p || !p.count) return
    if (!window.confirm(`Set a first follow up, due ${dayLabel(p.dueOn)}, on ${p.count} open card${p.count === 1 ? '' : 's'}? Each one goes to the card's salesman (${p.byOwner.map(o => `${o.name} ${o.count}`).join(', ')}).`)) return
    setBusy(true)
    const r = await sendJson('POST', '/api/follow-ups/first-follow-up', { confirmCount: p.count })
    setBusy(false)
    if (r.result.ok) { toast.success(`First follow up set on ${r.json.data.set} cards`, `Due ${dayLabel(r.json.data.dueOn)}.`); void refreshBoard(); void load(); return }
    if (r.status === 409 && r.json?.data) { setP(r.json.data); toast.info('The count changed', r.json.error); return }
    toast.error('Could not set them', (r.result as any).error || 'Try again.')
  }
  if (!p) return null
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2" data-first-follow-up>
      <h2 className="text-lg font-bold text-gray-900">First follow up for open cards</h2>
      <p className="text-sm text-gray-700"><b data-first-count>{p.count}</b> open card{p.count === 1 ? '' : 's'} in {stageList(getPipelineStages().filter(x => x.needsFollowUp).map(x => x.name))} {p.count === 1 ? 'has' : 'have'} no follow up set{p.byOwner.length ? ` (${p.byOwner.map(o => `${o.name}: ${o.count}`).join(', ')})` : ''}.</p>
      {allowed && p.count > 0 && (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={run} data-first-run>Set a first follow up on {p.count} open card{p.count === 1 ? '' : 's'}</button>
      )}
    </section>
  )
}
