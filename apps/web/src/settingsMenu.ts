/**
 * The Settings side menu: the groups, each page's one line description, and
 * the words the Settings search finds it by (the page's main fields). The page
 * keys are the ?tab= values other screens and tests link to
 * (/settings?tab=leads, ?tab=deleted, ...); never rename one.
 */

export type SettingsTab = 'company' | 'warranties' | 'contract_templates' | 'email_templates'
  | 'pricing' | 'price_list' | 'styles' | 'tiers' | 'moves' | 'optimizer'
  | 'pipeline' | 'leads' | 'tags' | 'follow_ups' | 'appointments' | 'messages' | 'proposals' | 'portal_quote' | 'voice'
  | 'ops_stages' | 'walkthrough' | 'calendar'
  | 'change_log' | 'deleted'

export interface SettingsPageInfo {
  key: SettingsTab
  label: string
  description: string
  /** Field names and other words on the page, for the search. */
  keywords: string[]
}

export interface SettingsGroup { name: string; pages: SettingsPageInfo[] }

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    name: 'Company',
    pages: [
      { key: 'company', label: 'Company', description: 'Name, phone, address, logo and colors.',
        keywords: ['Company Name', 'Phone', 'Email', 'Street Address', 'City', 'State', 'ZIP', 'Legal Name', 'Logo URL', 'Primary Color', 'Secondary Color', 'Support Email', 'Support Phone', 'Photos and video', 'Make smaller after', 'Branding'] },
      { key: 'warranties', label: 'Warranties', description: 'Each warranty and which install gets it.',
        keywords: ['Warranty', 'How long', 'Years', 'Lifetime', 'Which warranty each install gets', 'The words'] },
      { key: 'contract_templates', label: 'Contract Templates', description: 'The terms printed on every quote.',
        keywords: ['Contract', 'Terms', 'Preview Contract', 'Sections', 'Payment terms'] },
      { key: 'email_templates', label: 'Email Templates', description: 'Subject and wording of each email.',
        keywords: ['Email', 'Subject', 'Body', 'Merge tags', 'Invoice email', 'Quote email'] },
    ],
  },
  {
    name: 'Pricing & Products',
    pages: [
      { key: 'pricing', label: 'Pricing', description: 'Overhead, labor, commission and margins.',
        keywords: ['Overhead', 'Target Margin', 'Live overhead', 'Install labor', 'Customer price', 'Commission', 'Price is old after', 'Invoice price change', 'Subcontractor rates', 'Default rate', 'Per walk gate', 'Per double gate', 'Tear out', 'Man-Hour Rate', 'Men on a crew', 'Hours in a crew day', 'Salesman Commission', 'Non-Salesman Commission', 'Margin Thresholds', 'Good', 'Warning'] },
      { key: 'price_list', label: 'Price List', description: 'Vinyl colors and 8 ft tall vinyl prices.',
        keywords: ['Vinyl Colors', 'Add Color', 'Color name', 'Rivet color', '8 ft tall vinyl', 'Price by the piece'] },
      { key: 'styles', label: 'Fence Styles', description: 'Which fences can be quoted, and their profit.',
        keywords: ['Fence styles', 'Target Profit', 'Quotable', 'Colors', 'Choices', 'Supplier', 'Quote date', 'Other styles'] },
      { key: 'tiers', label: 'Good Better Best', description: 'The three options offered on a quote.',
        keywords: ['Good', 'Better', 'Best', 'Tiers', 'Tier set', 'Price adjustment', 'Why it\'s better', 'Sample yard', 'Popular'] },
      { key: 'moves', label: 'Moves and Repairs', description: 'Moving, repair and wood pricing.',
        keywords: ['Moves', 'Repairs', 'Minimum job price', 'Repair Profit', 'Wood factor', 'Careful removal multiplier', 'Gate removal multiplier', 'Pull labor per post', 'Disposal per post', 'Damage allowance', 'Photos needed'] },
      { key: 'optimizer', label: 'Quote Optimizer', description: '6 ft or 8 ft panels for the lowest price.',
        keywords: ['Smart rail optimization', 'Short-run cutoff', 'Cost preference threshold', 'Optimization details', 'Estimator overrides', '6 ft', '8 ft'] },
    ],
  },
  {
    name: 'Sales',
    pages: [
      { key: 'pipeline', label: 'Pipeline Stages', description: 'The columns of the Sales Pipeline.',
        keywords: ['Pipeline', 'Stages', 'Stage name', 'Columns', 'Reorder'] },
      { key: 'leads', label: 'Lead Sources', description: 'Where customers heard about you.',
        keywords: ['Lead source', 'Where they heard', 'Merge', 'Hidden'] },
      { key: 'tags', label: 'Customer Tags', description: 'Tags to sort customers by.',
        keywords: ['Tags', 'Customer tag', 'Merge'] },
      { key: 'follow_ups', label: 'Follow ups', description: 'Follow up steps and text templates.',
        keywords: ['Follow up steps', 'First follow up', 'Text templates', 'Call or text', 'Day', 'Template name'] },
      { key: 'appointments', label: 'Appointments', description: 'Lengths, work hours and home bases.',
        keywords: ['Appointment lengths', 'Work hours', 'Home base', 'Where each person\'s day starts', 'Gap after each appointment', 'Driving speed', 'Needs outcome'] },
      { key: 'messages', label: 'Messages', description: 'Texts and emails sent after booking.',
        keywords: ['Appointment messages', 'Confirmation', 'On my way', 'Calendar invite', 'Email subject', 'Text'] },
      { key: 'proposals', label: 'Proposals', description: 'What\'s included, deposit and financing.',
        keywords: ['Proposal', 'What\'s included', 'Deposit', 'Financing', 'APR', 'Months', 'Lender', 'Customer links', 'Style photos'] },
      { key: 'portal_quote', label: 'Portal & Quotes', description: 'Customer portal and quote defaults.',
        keywords: ['Portal', 'Welcome Message', 'Support Email', 'Support Phone', 'Accent Color', 'Quote Defaults', 'Validity', 'Intro Text', 'Footer Text', 'Notifications', 'Website quote', 'Show price before contact', 'Price per linear foot', 'Permissions'] },
      { key: 'voice', label: 'Voice', description: 'Talking fences into a quote.',
        keywords: ['Voice', 'Read back', 'Speaking speed', 'Voice check', 'Microphone', 'Practice'] },
    ],
  },
  {
    name: 'Operations',
    pages: [
      { key: 'ops_stages', label: 'Operations Stages', description: 'The columns of the Operations board.',
        keywords: ['Operations', 'Stages', 'Stage name', 'Staging', 'Columns'] },
      { key: 'walkthrough', label: 'Final Walkthrough', description: 'Checklist and the completion warranty.',
        keywords: ['Walkthrough', 'Checklist', 'Certificate of Completion', 'Warranty'] },
      { key: 'calendar', label: 'Google Calendar', description: 'Connect and send jobs to Google.',
        keywords: ['Google', 'Calendar', 'Connect', 'Disconnect', 'Sync'] },
    ],
  },
  {
    name: 'Records',
    pages: [
      { key: 'change_log', label: 'Change log', description: 'Who changed which setting, and when.',
        keywords: ['Change log', 'History', 'Who', 'Audit'] },
      { key: 'deleted', label: 'Deleted Records', description: 'Bring back or empty deleted records.',
        keywords: ['Deleted', 'Restore', 'Trash', 'Imports', 'Undo delete'] },
    ],
  },
]

export const SETTINGS_PAGES: SettingsPageInfo[] = SETTINGS_GROUPS.flatMap(g => g.pages)

export function settingsPage(key: string | null | undefined): SettingsPageInfo | undefined {
  return SETTINGS_PAGES.find(p => p.key === key)
}

export interface SettingsHit { page: SettingsPageInfo; group: string; /** The field matched, or null for the page itself. */ field: string | null }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim()

/** Pages and fields whose name has every word typed. Pages first, then fields. */
export function searchSettings(query: string, allowed: (key: SettingsTab) => boolean = () => true): SettingsHit[] {
  const words = norm(query).split(' ').filter(Boolean)
  if (!words.length) return []
  const has = (text: string) => { const t = norm(text); return words.every(w => t.includes(w)) }
  const pages: SettingsHit[] = []
  const fields: SettingsHit[] = []
  for (const g of SETTINGS_GROUPS) {
    for (const p of g.pages) {
      if (!allowed(p.key)) continue
      if (has(p.label) || has(`${p.label} ${p.description}`)) pages.push({ page: p, group: g.name, field: null })
      for (const k of p.keywords) if (has(k)) fields.push({ page: p, group: g.name, field: k })
    }
  }
  return [...pages, ...fields].slice(0, 12)
}
