/**
 * Settings → Voice: read back on or off, how fast the app speaks, a Practice
 * screen that shows what a phrase is understood as, and the Voice check that
 * records what each phone can do (the "what works where" table).
 */

import { useEffect, useState } from 'react'
import { Mic } from 'lucide-react'
import type { AppConfig } from './configStore'
import { parseUtterance, type VoiceIntent } from './voiceParser'
import { voiceSupport, listenOnce, speak, startRecording, saveVoiceCheck, listVoiceChecks, voiceServerStatus } from './voiceClient'
import { formatFtIn } from './yardLayout'

const PRACTICE_SIDES = ['Left return', 'Left side', 'Back', 'Right side', 'Right return', 'Front']

/** One understood intent in plain words, for the Practice screen. */
export function intentWords(it: VoiceIntent): string {
  switch (it.kind) {
    case 'side': {
      const parts = [it.side]
      if (it.lengthIn !== undefined) parts.push(formatFtIn(it.lengthIn))
      if (it.gate === null) parts.push('no gate')
      else if (it.gate) {
        const where = !it.gate.place ? '' : it.gate.place.at === 'middle' ? ' in the middle' : it.gate.place.at === 'near' ? ` near the ${it.gate.place.toward}` : ` ${formatFtIn(it.gate.place.distanceIn)} from the ${it.gate.place.from}`
        parts.push(`${it.gate.widthIn ? `${it.gate.widthIn / 12} ft ` : ''}${it.gate.type} gate${where}`)
      }
      if (it.finish) parts.push(`${it.finish.end ? `${it.finish.end}: ` : ''}${({ house: 'meets the house', existing: 'ties into existing fence', free: 'stops', corner: 'corner' } as const)[it.finish.finish]}`)
      if (it.skip === null) parts.push('no skip')
      else if (it.skip) parts.push(`skip ${formatFtIn(it.skip.lengthIn)} (${it.skip.kind === 'existing' ? 'existing fence' : 'no fence'})`)
      return parts.join(', ')
    }
    case 'side-off': return `${it.side}: off`
    case 'style': return `Style: ${[it.color, it.install?.replace('-', ' '), it.heightFt && `${it.heightFt} ft tall`, it.widthFt && `${it.widthFt} ft sections`].filter(Boolean).join(', ')}`
    case 'note': return `Crew note: ${it.text}`
    case 'number': return `A length: ${formatFtIn(it.lengthIn)}`
    default: return it.kind === 'readback' ? 'Read it back' : it.kind === 'total' ? 'Say the total' : it.kind.charAt(0).toUpperCase() + it.kind.slice(1)
  }
}

export default function VoiceSettings({ config, onChange }: { config: AppConfig; onChange: (c: AppConfig) => void }) {
  const v = config.voice ?? {}
  const set = (patch: Partial<NonNullable<AppConfig['voice']>>) => onChange({ ...config, voice: { ...v, ...patch } })
  const rate = v.rate ?? 1
  const [phrase, setPhrase] = useState('right return thirty with a four foot gate in the middle')
  const [listening, setListening] = useState(false)
  const [check, setCheck] = useState<string>('')
  const [checks, setChecks] = useState<Array<{ id: string; userAgent: string; results: any; createdAt: string }>>([])
  const [mac, setMac] = useState<{ ready: boolean; missing: string[] } | null>(null)
  useEffect(() => { listVoiceChecks().then(setChecks); voiceServerStatus().then(setMac) }, [])
  const support = voiceSupport()
  const parsed = phrase.trim() ? parseUtterance(phrase, { sideNames: PRACTICE_SIDES }) : null

  async function practiceMic() {
    setListening(true)
    const r = await listenOnce().result
    setListening(false)
    if ('text' in r) setPhrase(r.text)
    else setPhrase(`(${r.error === 'unsupported' ? 'this browser has no live voice' : `voice error: ${r.error}`})`)
  }

  async function runCheck() {
    setCheck('Checking… say "testing one two three" when asked.')
    const s = voiceSupport()
    const results: Record<string, unknown> = { ...s, online: navigator.onLine }
    try {
      const perm = await (navigator as any).permissions?.query?.({ name: 'microphone' })
      results.micPermission = perm?.state ?? 'unknown'
    } catch { results.micPermission = 'unknown' }
    results.voices = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices().length : 0
    if (s.synthesis) { await speak('Say: testing one two three.', rate); results.spoke = true }
    if (s.recognition) {
      const r = await listenOnce(8000).result
      results.liveTest = 'text' in r ? `heard: ${r.text}` : `error: ${r.error}`
    } else results.liveTest = 'no live voice in this browser'
    if (s.recorder) {
      try {
        const rec = await startRecording()
        await new Promise(res => setTimeout(res, 1500))
        const blob = await rec.stop()
        results.recordTest = `${blob.size} bytes, ${rec.mime}`
      } catch (e) { results.recordTest = `error: ${String((e as Error)?.message || e)}` }
    } else results.recordTest = 'no recorder'
    await saveVoiceCheck(results)
    setChecks(await listVoiceChecks())
    setCheck(`Saved. Live voice: ${String(results.liveTest)}. Recording: ${String(results.recordTest)}.`)
  }

  const device = (ua: string, r: any) => `${r?.ios ? 'iPhone' : r?.android ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Other'} · ${/CriOS|Chrome/.test(ua) && !/Edg/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : 'Browser'}${r?.standalone ? ' · home screen app' : ' · browser'}`

  return (
    <div className="space-y-8" data-voice-settings>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" className="w-5 h-5 accent-orange-500" checked={v.readBack !== false} onChange={e => set({ readBack: e.target.checked })} data-voice-readback />
          Read back what it understood ("Left return, 30 feet, 4 foot walk gate in the middle")
        </label>
        <div>
          <label className="text-xs text-gray-600 block mb-1">Speaking speed: {rate.toFixed(1)}×</label>
          <div className="flex items-center gap-3">
            <input type="range" min={0.7} max={1.4} step={0.1} value={rate} onChange={e => set({ rate: Number(e.target.value) })} className="flex-1 accent-orange-500" data-voice-rate />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => speak('Left return, 30 feet, 4 foot walk gate in the middle.', rate)}>Test</button>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Practice</h3>
        <p className="text-sm text-gray-600 mb-2">Say or type a phrase to see what the app understands. Nothing is changed.</p>
        <div className="flex gap-2">
          <input className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 h-11 text-sm" value={phrase} onChange={e => setPhrase(e.target.value)} data-practice-input />
          {support.recognition && <button type="button" className="btn btn-secondary" onClick={practiceMic} disabled={listening} aria-label="Say a phrase"><Mic size={18} aria-hidden="true" />{listening ? ' Listening…' : ''}</button>}
        </div>
        {parsed && (
          <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm space-y-1" data-practice-result>
            {parsed.intents.map((it, i) => <p key={i}>✓ {intentWords(it)}</p>)}
            {parsed.unknown.map((u, i) => <p key={`u${i}`} className="text-amber-800">Did not understand: “{u}”</p>)}
          </div>
        )}
        <p className="text-xs text-gray-500 mt-2">Sides for practice: {PRACTICE_SIDES.join(', ')}. On a quote it uses that quote's sides.</p>
      </div>

      <div data-settings-focus="voice-check" className="scroll-mt-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Voice check</h3>
        <p className="text-sm text-gray-600 mb-2">Run this on each phone, in the browser and from the home screen icon. It saves what works on that phone.</p>
        <button type="button" className="btn btn-primary" onClick={runCheck} data-voice-check>Run voice check on this device</button>
        {check && <p className="text-sm text-gray-700 mt-2" data-voice-check-result>{check}</p>}
        <p className="text-xs text-gray-600 mt-2">Transcribing on the Mac: {mac ? (mac.ready ? 'ready' : `not ready, missing ${mac.missing.join(', ')}`) : 'checking…'}</p>
        {checks.length > 0 && (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-xs" data-voice-checks>
              <thead><tr className="text-left text-gray-600 border-b border-gray-200"><th className="py-1 pr-2">Device</th><th className="pr-2">Live voice</th><th className="pr-2">Speaks</th><th className="pr-2">Records</th><th>When</th></tr></thead>
              <tbody>
                {checks.map(c => (
                  <tr key={c.id} className="border-b border-gray-100 align-top">
                    <td className="py-1 pr-2">{device(c.userAgent, c.results)}</td>
                    <td className="pr-2">{String(c.results?.liveTest ?? '')}</td>
                    <td className="pr-2">{c.results?.synthesis ? `yes (${c.results?.voices} voices)` : 'no'}</td>
                    <td className="pr-2">{String(c.results?.recordTest ?? '')}</td>
                    <td>{new Date(c.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
