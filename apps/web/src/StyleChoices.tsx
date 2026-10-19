/**
 * The quote builder's fence picker: material first, then that material's own
 * choices in order (Vinyl: Style > Height > Color > Install > Panel width).
 * Only combinations that exist can be picked; the rest are greyed. A choice
 * whose fences exist but are not available for quoting is greyed and says
 * "off". The plain name of the fence picked shows underneath.
 */

import { useEffect, useMemo, useState } from 'react'
import type { FenceStyle } from './configStore'
import { pickerState, styleChoicesOf, styleForChoices, type FenceCatalog, type OptionState } from './fenceCatalog'

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
  const fromStyle = () => {
    const sc = current ? styleChoicesOf(current) : null
    return sc ? { material: sc.material, sel: { ...sc.choices } } : null
  }
  const [material, setMaterial] = useState<string>(() => fromStyle()?.material ?? '')
  const [sel, setSel] = useState<Record<string, string>>(() => fromStyle()?.sel ?? {})
  // Picked another way (the list, voice): show its choices.
  useEffect(() => {
    const f = fromStyle()
    if (f) { setMaterial(f.material); setSel(f.sel) }
  }, [value])  // eslint-disable-line react-hooks/exhaustive-deps

  const matOk = useMemo(() => Object.fromEntries(catalog.materials.map(m => [m.key, styles.some(s => styleChoicesOf(s)?.material === m.key && isOk(s))])), [catalog, styles, isOk])
  const rows = useMemo(() => (material ? pickerState(styles, catalog, material, sel, isOk) : []), [styles, catalog, material, sel, isOk])

  /** Fill in the choices after `from` that no longer fit with the first that does, then pick the fence they name. */
  function settle(mat: string, next: Record<string, string>) {
    const m = catalog.materials.find(x => x.key === mat)
    if (!m) return
    const out = { ...next }
    for (let i = 0; i < m.dims.length; i++) {
      const st = pickerState(styles, catalog, mat, out, isOk)[i]
      const have = st.options.find(x => x.opt.key === out[m.dims[i].key])
      if (!have || have.state !== 'ok') {
        const first = st.options.find(x => x.state === 'ok')
        if (first) out[m.dims[i].key] = first.opt.key
        else delete out[m.dims[i].key]
      }
    }
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
      {rows.map(({ dim, options }) => (
        <div key={dim.key}>
          <p className="text-xs font-semibold text-gray-500 mb-2">{dim.label}</p>
          <div className="flex flex-wrap gap-2">
            {options.map(({ opt, state }) => {
              const on = sel[dim.key] === opt.key
              return (
                <button key={opt.key} type="button" disabled={state !== 'ok' && !on} aria-pressed={on}
                  data-choice-dim={dim.key} data-choice-key={opt.key} data-choice-state={state}
                  title={state === 'held' ? 'Not available for quoting (Settings → Fence styles)' : state === 'none' ? 'There is no such fence' : undefined}
                  className={chip(state, on)} onClick={() => settle(material, { ...sel, [dim.key]: opt.key })}>
                  {opt.label}{state === 'held' && !on ? <span className="ml-1 text-[10px] uppercase">off</span> : null}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {current && (
        <p className="text-sm font-semibold text-gray-900" data-style-plain-name>{current.label || current.name}</p>
      )}
    </div>
  )
}
