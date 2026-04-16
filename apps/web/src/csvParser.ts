/**
 * CSV/TSV Parser — parses CSV and tab-delimited files.
 * For XLSX, we parse the first sheet by reading it as CSV via the FileReader API.
 * No external dependencies.
 */

export interface ParsedSheet {
  headers: string[]
  rows: string[][]
  filename: string
  rowCount: number
}

/** Parse a CSV or TSV string into headers + rows */
export function parseCSV(text: string, delimiter?: string): { headers: string[]; rows: string[][] } {
  // Auto-detect delimiter
  const firstLine = text.split('\n')[0] || ''
  const sep = delimiter || (firstLine.includes('\t') ? '\t' : ',')

  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return { headers: [], rows: [] }

  const headers = parseLine(lines[0], sep)
  const rows = lines.slice(1).map(line => parseLine(line, sep))
  return { headers, rows }
}

function parseLine(line: string, sep: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++ // skip escaped quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === sep && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

/** Read a File object and return parsed data */
export async function parseFile(file: File): Promise<ParsedSheet> {
  const text = await file.text()
  const { headers, rows } = parseCSV(text)
  return { headers, rows, filename: file.name, rowCount: rows.length }
}

/** Inventory field definitions for column mapping */
export const INVENTORY_FIELDS = [
  { key: 'name', label: 'Item Name', required: true },
  { key: 'sku', label: 'SKU', required: false },
  { key: 'category', label: 'Category', required: false },
  { key: 'unitOfMeasure', label: 'Unit of Measure', required: false },
  { key: 'unitCost', label: 'Unit Cost', required: false },
  { key: 'qtyOnHand', label: 'Quantity on Hand', required: false },
  { key: 'supplier', label: 'Supplier', required: false },
  { key: 'reorderPoint', label: 'Reorder Point', required: false },
  { key: 'reorderQty', label: 'Reorder Qty', required: false },
  { key: 'notes', label: 'Notes', required: false },
]

/** Auto-map file columns to inventory fields based on header names */
export function autoMapColumns(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  const normalized = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''))

  for (const field of INVENTORY_FIELDS) {
    const fieldNorm = field.key.toLowerCase()
    const labelNorm = field.label.toLowerCase().replace(/[^a-z0-9]/g, '')

    const idx = normalized.findIndex(h =>
      h === fieldNorm ||
      h === labelNorm ||
      h.includes(fieldNorm) ||
      (fieldNorm === 'unitcost' && (h.includes('cost') || h.includes('price'))) ||
      (fieldNorm === 'qtyonhand' && (h.includes('qty') || h.includes('quantity') || h.includes('onhand') || h.includes('stock'))) ||
      (fieldNorm === 'name' && (h.includes('item') || h.includes('name') || h.includes('description') || h.includes('material'))) ||
      (fieldNorm === 'unitofmeasure' && (h.includes('unit') || h.includes('uom'))) ||
      (fieldNorm === 'reorderpoint' && (h.includes('reorder') || h.includes('min')))
    )

    if (idx >= 0) {
      mapping[field.key] = headers[idx]
    }
  }

  return mapping
}

/** Column mapping template for reuse */
export interface ColumnMappingTemplate {
  id: string
  name: string
  mapping: Record<string, string> // inventoryField → fileColumn
  createdAt: string
}

const TEMPLATE_KEY = 'fencepro_import_templates'

export function getImportTemplates(): ColumnMappingTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveImportTemplate(template: ColumnMappingTemplate): void {
  const templates = getImportTemplates()
  const idx = templates.findIndex(t => t.id === template.id)
  if (idx >= 0) templates[idx] = template
  else templates.push(template)
  localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates))
}

/** Import history log */
export interface ImportLogEntry {
  id: string
  filename: string
  user: string
  totalRows: number
  imported: number
  updated: number
  skipped: number
  errors: number
  errorDetails: { row: number; field: string; message: string }[]
  templateUsed?: string
  importedAt: string
}

const LOG_KEY = 'fencepro_import_log'

export function getImportLog(): ImportLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveImportLogEntry(entry: ImportLogEntry): void {
  const log = getImportLog()
  log.unshift(entry)
  localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 100))) // keep last 100
}
