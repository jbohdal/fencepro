/**
 * The quote builder's fence picker: material first, then that material's own
 * choices in order (Vinyl: Style > Height > Color > Install > Panel width).
 * Only combinations that exist can be picked; the rest are greyed. A choice
 * whose fences exist but are not available for quoting is greyed and says
 * "off". The plain name of the fence picked shows underneath.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FenceStyle } from './configStore'
import { offWords, pickerState, styleChoicesOf, styleForChoices, type FenceCatalog, type OptionState } from './fenceCatalog'
import { roleCan, signedInRole } from './permissions'

export default function StyleChoices({ styles, catalog, value, onChange, isOk }: {
  /** Every style turned on (the picker greys the ones not available for quoting). */
  styles: FenceStyle[]
  catalog: FenceCatalog
  /** The style id picked, or ''. */
  value: string
  onChange: (id: string) => void
  /** Whether a style can be picked: available for quoting, or the quote's own. */
  isOk: (s: FenceStyle) => boolean
}) {
  const current = styles.find(s => s.id === value)
  // Who can enter prices reads where; anyone else is told to ask Jonathan.
  const canPrice = roleCan(signedInRole(), 'prices.change')
  const fromStyle = () => {
    const sc = current ? styleChoicesOf(current) : null
    return sc ? { material: sc.material, sel: { ...sc.choices } } : null
  }
  const [material, setMaterial] = useState<string>(() => fromStyle()?.material ?? '')
  const [sel, setSel] = useState<Record<string, string>>(() => fromStyle()?.sel ?? {})
  // A choice changed by itself because the one just tapped is not made with it (review Oct 28 2026: Green chain link,
  // then 5 ft, went to Galvanized without a word; green is made only at 4 ft). Said under the choice that changed, close to
  // the tap that changed it (on a phone the bottom of the picker is off screen), until the next tap.
  const [changedNote, setChangedNote] = useState<{ dim: string; text: string } | null>(null)
  // On a phone the quote builder's bar is fixed over the bottom of the screen and can cover the note (review Oct 28
  // 2026, C7: Green then 5 ft at 390 x 844). Once it shows, it is scrolled up to sit just above the bar.
  const noteRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (!changedNote) return
    const id = requestAnimationFrame(() => { if (noteRef.current) showAboveFixedBar(noteRef.current) })
    return () => cancelAnimationFrame(id)
  }, [changedNote])
  // Picked another way (the list, voice): show its choices.
  useEffect(() => {
    const f = fromStyle()
    if (f) {
      // Picked another way (not the tap that wrote the note): the note no longer applies.
      const same = (a: Record<string, string>, b: Record<string, string>) => Object.keys({ ...a, ...b }).every(k => a[k] === b[k])
      if (f.material !== material || !same(f.sel, sel)) setChangedNote(null)
      setMaterial(f.material); setSel(f.sel)
    }
  }, [value])  // eslint-disable-line react-hooks/exhaustive-deps

  const matOk = useMemo(() => Object.fromEntries(catalog.materials.map(m => [m.key, styles.some(s => styleChoicesOf(s)?.material === m.key && isOk(s))])), [catalog, styles, isOk])
  const rows = useMemo(() => (material ? pickerState(styles, catalog, material, sel, isOk) : []), [styles, catalog, material, sel, isOk])

  /** Fill in the choices after `from` that no longer fit with the first that does, then pick the fence they name. */
  function settle(mat: string, next: Record<string, string>, tapped?: { dim: string; label: string }) {
    const m = catalog.materials.find(x => x.key === mat)
    if (!m) return
    const out = { ...next }
    const notes: Array<{ dim: string; text: string }> = []
    for (let i = 0; i < m.dims.length; i++) {
      const st = pickerState(styles, catalog, mat, out, isOk)[i]
      const have = st.options.find(x => x.opt.key === out[m.dims[i].key])
      if (!have || have.state !== 'ok') {
        const first = st.options.find(x => x.state === 'ok')
        if (first) out[m.dims[i].key] = first.opt.key
        else delete out[m.dims[i].key]
        // A choice made before (not the one just tapped) that changed: say so.
        if (tapped && have && m.dims[i].key !== tapped.dim && first && first.opt.key !== have.opt.key) {
          notes.push({ dim: m.dims[i].key, text: `${have.opt.label} is not offered ${tapped.dim === 'height' ? 'at' : 'with'} ${tapped.label}, so the ${m.dims[i].label.toLowerCase()} changed to ${first.opt.label}.` })
        }
      }
    }
    setChangedNote(notes.length ? { dim: notes[0].dim, text: notes.map(n => n.text).join(' ') } : null)
    setSel(out)
    const s = styleForChoices(styles, catalog, mat, out)
    if (s && isOk(s)) onChange(s.id)
  }

  const chip = (state: OptionState, on: boolean) =>
    `min-h-[44px] px-3 rounded-lg border text-sm font-medium transition-colors ${on
      ? 'bg-orange-500 border-orange-500 text-white'
      : state === 'ok' ? 'bg-white border-gray-300 text-gray-800 hover:border-orange-400'
        : state === 'held' ? 'bg-gray-50 border-gray-200 text-gray-400' : 'bg-gray-50 border-dashed border-gray-200 text-gray-300'}`

  return (
    <div className="space-y-4" data-style-choices>
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-2">Material</p>
        <div className="flex flex-wrap gap-2">
          {catalog.materials.map(m => (
            <button key={m.key} type="button" disabled={!matOk[m.key] && material !== m.key} aria-pressed={material === m.key}
              data-choice-material={m.key} className={chip(matOk[m.key] ? 'ok' : 'none', material === m.key)}
              onClick={() => { setMaterial(m.key); settle(m.key, material === m.key ? sel : {}) }}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {rows.map(({ dim, options }) => {
        // Choices that are off say why, in sight (a phone has no hover): "8 ft is off: 8 ft tall needs our post cost in Settings → …".
        const offLines = options.filter(o => o.state === 'held' && o.why?.length).map(o => ({ key: o.opt.key, text: offWords(o.opt.label, o.why!, canPrice) }))
        return (
        <div key={dim.key}>
          <p className="text-xs font-semibold text-gray-500 mb-2">{dim.label}</p>
          <div className="flex flex-wrap gap-2">
            {options.map(({ opt, state, why }) => {
              const on = sel[dim.key] === opt.key
              return (
                <button key={opt.key} type="button" disabled={state !== 'ok' && !on} aria-pressed={on}
                  data-choice-dim={dim.key} data-choice-key={opt.key} data-choice-state={state}
                  title={state === 'held' ? (why?.length ? offWords(opt.label, why, canPrice) : 'Not available for quoting (Settings → Fence styles)') : state === 'none' ? 'There is no such fence' : undefined}
                  className={chip(state, on)} onClick={() => settle(material, { ...sel, [dim.key]: opt.key }, { dim: dim.key, label: opt.label })}>
                  {opt.label}{state === 'held' && !on ? <span className="ml-1 text-[10px] uppercase">off</span> : null}
                </button>
              )
            })}
          </div>
          {offLines.map(l => <p key={l.key} className="mt-1.5 text-xs text-amber-800" data-choice-off-why={`${dim.key}:${l.key}`}>{l.text}</p>)}
          {changedNote?.dim === dim.key && (
            <p ref={noteRef} className="mt-2 text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2" role="status" data-style-changed-note>{changedNote.text}</p>
          )}
        </div>
        )
      })}
      {current && (
        <p className="text-sm font-semibold text-gray-900" data-style-plain-name>{current.label || current.name}</p>
      )}
    </div>
  )
}

/**
 * Scroll `el` into sight above the quote builder's fixed bottom bar (the
 * phone's; on a computer the bar is not fixed and the screen's bottom is the
 * limit). Left alone when it is already in sight.
 */
function showAboveFixedBar(el: HTMLElement) {
  const bar = [...document.querySelectorAll<HTMLElement>('[data-quote-bar]')].find(b => getComputedStyle(b).position === 'fixed' && b.getBoundingClientRect().height > 0)
  const r = el.getBoundingClientRect()
  const gap = 12
  const limit = (bar ? bar.getBoundingClientRect().top : window.innerHeight) - gap
  const by = r.bottom > limit ? Math.min(r.bottom - limit, r.top - gap) : r.top < gap ? r.top - gap : 0
  if (!by) return
  let box: HTMLElement | null = el.parentElement
  while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) box = box.parentElement
  if (box) box.scrollBy({ top: by, behavior: 'smooth' })
  else window.scrollBy({ top: by, behavior: 'smooth' })
}
