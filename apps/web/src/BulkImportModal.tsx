/**
 * Bulk Import Modal for Inventory
 *
 * 4-step flow: Upload → Map Columns → Preview → Results
 * Supports CSV upload, column mapping templates, upsert by SKU, partial imports.
 */

import { useState, useRef, useCallback } from 'react'
import { parseFile, autoMapColumns, INVENTORY_FIELDS, getImportTemplates, saveImportTemplate, saveImportLogEntry, getImportLog, type ParsedSheet, type ColumnMappingTemplate, type ImportLogEntry } from './csvParser'
import { getInventory, saveInventory, type InventoryItem } from './inventoryStore'

const uid = () => Math.random().toString(36).slice(2, 10)

type Step = 'upload' | 'map' | 'preview' | 'results'

interface ImportResult {
  imported: number
  updated: number
  skipped: number
  errors: { row: number; field: string; message: string }[]
}

export default function BulkImportModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState<Step>('upload')
  const [sheet, setSheet] = useState<ParsedSheet | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [templateName, setTemplateName] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [processing, setProcessing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const templates = getImportTemplates()
  const importLog = getImportLog()

  // Step 1: Upload
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const parsed = await parseFile(file)
      setSheet(parsed)
      // Auto-map columns
      const autoMap = autoMapColumns(parsed.headers)
      setMapping(autoMap)
      setStep('map')
    } catch (err) {
      alert('Failed to parse file. Please upload a CSV file.')
    }
  }

  function applyTemplate(tpl: ColumnMappingTemplate) {
    setMapping(tpl.mapping)
    setTemplateName(tpl.name)
  }

  // Step 3: Import
  function processImport() {
    if (!sheet) return
    setProcessing(true)

    const inventory = getInventory()
    const skuIndex = new Map<string, number>()
    inventory.forEach((item, idx) => { if (item.sku) skuIndex.set(item.sku, idx) })

    const result: ImportResult = { imported: 0, updated: 0, skipped: 0, errors: [] }

    // Invert mapping: inventoryField → column header
    const fieldToCol: Record<string, string> = {}
    for (const [field, col] of Object.entries(mapping)) {
      if (col) fieldToCol[field] = col
    }

    for (let i = 0; i < sheet.rows.length; i++) {
      const row = sheet.rows[i]
      const rowNum = i + 2 // 1-indexed + header

      try {
        const getValue = (field: string): string => {
          const col = fieldToCol[field]
          if (!col) return ''
          const colIdx = sheet.headers.indexOf(col)
          return colIdx >= 0 ? (row[colIdx] || '').trim() : ''
        }

        const name = getValue('name')
        if (!name) {
          result.errors.push({ row: rowNum, field: 'name', message: 'Item name is required' })
          result.skipped++
          continue
        }

        const sku = getValue('sku')
        const unitCostStr = getValue('unitCost')
        const unitCost = unitCostStr ? parseFloat(unitCostStr.replace(/[$,]/g, '')) : 0
        if (unitCostStr && isNaN(unitCost)) {
          result.errors.push({ row: rowNum, field: 'unitCost', message: `Invalid cost: "${unitCostStr}"` })
          result.skipped++
          continue
        }

        const qtyStr = getValue('qtyOnHand')
        const qtyOnHand = qtyStr ? parseInt(qtyStr.replace(/,/g, '')) : undefined
        const reorderStr = getValue('reorderPoint')
        const reorderPoint = reorderStr ? parseInt(reorderStr) : undefined
        const reorderQtyStr = getValue('reorderQty')
        const reorderQty = reorderQtyStr ? parseInt(reorderQtyStr) : undefined

        // Upsert by SKU
        if (sku && skuIndex.has(sku)) {
          const idx = skuIndex.get(sku)!
          inventory[idx] = {
            ...inventory[idx],
            name,
            unitCost: unitCost || inventory[idx].unitCost,
            category: getValue('category') || inventory[idx].category,
            supplier: getValue('supplier') || inventory[idx].supplier,
            unitOfMeasure: getValue('unitOfMeasure') || inventory[idx].unitOfMeasure,
            ...(qtyOnHand !== undefined ? { qtyOnHand } : {}),
            ...(reorderPoint !== undefined ? { reorderPoint } : {}),
            ...(reorderQty !== undefined ? { reorderQty } : {}),
          }
          result.updated++
        } else {
          // Create new
          const newItem: InventoryItem = {
            id: sku || uid(),
            name,
            sku: sku || undefined,
            unitCost: unitCost || 0,
            category: getValue('category') || 'Misc',
            supplier: getValue('supplier') || undefined,
            unitOfMeasure: getValue('unitOfMeasure') || undefined,
            status: 'active',
            qtyOnHand: qtyOnHand,
            reorderPoint: reorderPoint,
            reorderQty: reorderQty,
          }
          inventory.push(newItem)
          if (sku) skuIndex.set(sku, inventory.length - 1)
          result.imported++
        }
      } catch (err) {
        result.errors.push({ row: rowNum, field: 'general', message: String(err) })
        result.skipped++
      }
    }

    saveInventory(inventory)
    setResult(result)

    // Save import log
    const user = (() => { try { const u = localStorage.getItem('fencepro_user'); return u ? JSON.parse(u).name : 'Unknown' } catch { return 'Unknown' } })()
    saveImportLogEntry({
      id: uid(),
      filename: sheet.filename,
      user,
      totalRows: sheet.rowCount,
      imported: result.imported,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.length,
      errorDetails: result.errors,
      templateUsed: templateName || undefined,
      importedAt: new Date().toISOString(),
    })

    setStep('results')
    setProcessing(false)
  }

  // Save current mapping as template
  function saveAsTemplate() {
    const name = templateName || `Template ${templates.length + 1}`
    saveImportTemplate({
      id: uid(),
      name,
      mapping,
      createdAt: new Date().toISOString(),
    })
    setTemplateName(name)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[800px] max-h-[90vh] mx-4 lg:mx-0 flex flex-col overflow-hidden modal-responsive">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">Bulk Import Inventory</h2>
            <div className="flex gap-2 mt-1">
              {(['upload', 'map', 'preview', 'results'] as Step[]).map((s, i) => (
                <div key={s} className="flex items-center gap-1">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    step === s ? 'bg-orange-500 text-white' :
                    (['upload', 'map', 'preview', 'results'].indexOf(step) > i) ? 'bg-green-500 text-white' :
                    'bg-gray-200 text-gray-500'
                  }`}>{i + 1}</div>
                  <span className="text-xs text-gray-500 capitalize">{s}</span>
                  {i < 3 && <span className="text-gray-300 mx-1">→</span>}
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* STEP 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-6">
              <div
                className="border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center hover:border-orange-400 transition cursor-pointer"
                onClick={() => fileRef.current?.click()}
              >
                <div className="text-4xl mb-3">📁</div>
                <p className="font-medium text-gray-700">Drop a CSV file here or click to browse</p>
                <p className="text-sm text-gray-400 mt-1">Supports .csv and .tsv files</p>
                <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFile} className="hidden" />
              </div>

              {/* Saved templates */}
              {templates.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Saved Mapping Templates</h3>
                  <div className="space-y-1">
                    {templates.map(t => (
                      <div key={t.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                        <span className="text-sm text-gray-700">{t.name}</span>
                        <span className="text-xs text-gray-400">{new Date(t.createdAt).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Import history */}
              {importLog.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Import History</h3>
                  <div className="space-y-1">
                    {importLog.slice(0, 5).map(log => (
                      <div key={log.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm">
                        <div>
                          <span className="font-medium text-gray-700">{log.filename}</span>
                          <span className="text-gray-400 ml-2">by {log.user}</span>
                        </div>
                        <div className="text-xs text-gray-500">
                          <span className="text-green-600">{log.imported} new</span>
                          {log.updated > 0 && <span className="text-blue-600 ml-2">{log.updated} updated</span>}
                          {log.errors > 0 && <span className="text-red-600 ml-2">{log.errors} errors</span>}
                          <span className="ml-2">{new Date(log.importedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: Column Mapping */}
          {step === 'map' && sheet && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Map your file columns to inventory fields. Auto-detected mappings are pre-filled.
                <span className="font-medium text-gray-700 ml-1">{sheet.filename}</span> — {sheet.rowCount} rows
              </p>

              {/* Template selector */}
              {templates.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">Apply template:</label>
                  <select onChange={e => { const t = templates.find(t => t.id === e.target.value); if (t) applyTemplate(t) }}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-sm">
                    <option value="">Select...</option>
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}

              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 grid grid-cols-3 gap-4 text-xs font-medium text-gray-500 uppercase">
                  <div>Inventory Field</div>
                  <div>File Column</div>
                  <div>Sample Value</div>
                </div>
                {INVENTORY_FIELDS.map(field => {
                  const selectedCol = mapping[field.key] || ''
                  const colIdx = selectedCol ? sheet.headers.indexOf(selectedCol) : -1
                  const sample = colIdx >= 0 && sheet.rows[0] ? sheet.rows[0][colIdx] : ''
                  return (
                    <div key={field.key} className="px-4 py-2.5 border-b border-gray-50 grid grid-cols-3 gap-4 items-center">
                      <div className="text-sm">
                        <span className="font-medium text-gray-900">{field.label}</span>
                        {field.required && <span className="text-red-500 ml-1">*</span>}
                      </div>
                      <select
                        value={selectedCol}
                        onChange={e => setMapping({ ...mapping, [field.key]: e.target.value })}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                      >
                        <option value="">— Skip —</option>
                        {sheet.headers.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                      <span className="text-xs text-gray-400 truncate">{sample || '—'}</span>
                    </div>
                  )
                })}
              </div>

              {/* Save as template */}
              <div className="flex items-center gap-2">
                <input type="text" value={templateName} onChange={e => setTemplateName(e.target.value)}
                  placeholder="Template name..." className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm flex-1" />
                <button onClick={saveAsTemplate}
                  className="text-sm text-orange-600 hover:text-orange-700 font-medium whitespace-nowrap">
                  Save Template
                </button>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setStep('upload')} className="border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">← Back</button>
                <button onClick={() => setStep('preview')} disabled={!mapping.name}
                  className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-40">
                  Preview →
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Preview */}
          {step === 'preview' && sheet && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Preview of first 20 rows. Existing items with matching SKUs will be <span className="text-blue-600 font-medium">updated</span>, new items will be <span className="text-green-600 font-medium">created</span>.
              </p>

              <div className="overflow-x-auto border border-gray-200 rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">#</th>
                      {INVENTORY_FIELDS.filter(f => mapping[f.key]).map(f => (
                        <th key={f.key} className="text-left px-3 py-2 text-xs font-medium text-gray-500">{f.label}</th>
                      ))}
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.rows.slice(0, 20).map((row, i) => {
                      const inventory = getInventory()
                      const skuCol = mapping.sku ? sheet.headers.indexOf(mapping.sku) : -1
                      const sku = skuCol >= 0 ? row[skuCol] : ''
                      const exists = sku && inventory.some(item => item.sku === sku)
                      return (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                          {INVENTORY_FIELDS.filter(f => mapping[f.key]).map(f => {
                            const colIdx = sheet.headers.indexOf(mapping[f.key])
                            return <td key={f.key} className="px-3 py-1.5 text-gray-700">{colIdx >= 0 ? row[colIdx] : ''}</td>
                          })}
                          <td className="px-3 py-1.5">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${exists ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                              {exists ? 'Update' : 'Create'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {sheet.rowCount > 20 && (
                <p className="text-xs text-gray-400 text-center">Showing 20 of {sheet.rowCount} rows</p>
              )}

              <div className="flex gap-2">
                <button onClick={() => setStep('map')} className="border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">← Back</button>
                <button onClick={processImport} disabled={processing}
                  className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-40">
                  {processing ? 'Importing...' : `Import ${sheet.rowCount} Rows`}
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Results */}
          {step === 'results' && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-green-50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{result.imported}</p>
                  <p className="text-xs text-green-700 font-medium">New Items</p>
                </div>
                <div className="bg-blue-50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-blue-600">{result.updated}</p>
                  <p className="text-xs text-blue-700 font-medium">Updated</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-gray-600">{result.skipped}</p>
                  <p className="text-xs text-gray-700 font-medium">Skipped</p>
                </div>
                <div className="bg-red-50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-red-600">{result.errors.length}</p>
                  <p className="text-xs text-red-700 font-medium">Errors</p>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="bg-white border border-red-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2 bg-red-50 border-b border-red-100">
                    <h3 className="text-sm font-semibold text-red-700">Errors</h3>
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-red-50">
                    {result.errors.map((err, i) => (
                      <div key={i} className="px-4 py-2 text-sm">
                        <span className="text-red-600 font-medium">Row {err.row}:</span>
                        <span className="text-gray-600 ml-2">{err.field} — {err.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={() => { onComplete(); onClose() }}
                className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded-lg text-sm font-medium">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
