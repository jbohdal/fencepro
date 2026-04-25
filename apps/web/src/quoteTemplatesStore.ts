/**
 * Quote Templates — 4 built-in presentation templates (Premium, Modern,
 * Classic, Bold) plus per-quote customization fields (intro text, scope text,
 * photos, contract body, validity days, selected template key).
 */

export type TemplateKey = 'premium' | 'modern' | 'classic' | 'bold'

export interface QuoteTemplate {
  key: TemplateKey
  name: string
  description: string
  primaryColor: string
  accentColor: string
  fontFamily: string
  showCoverPage: boolean
  showAboutSection: boolean
  showProjectPhotos: boolean
  showScopeOfWork: boolean
  showPricingTable: boolean
  showGoodBetterBest: boolean
  showTerms: boolean
  showSignature: boolean
  showNextSteps: boolean
  showThankYou: boolean
}

export const TEMPLATES: Record<TemplateKey, QuoteTemplate> = {
  premium: {
    key: 'premium',
    name: 'Premium',
    description: 'High-end luxury contractor feel. Dark navy with gold accents.',
    primaryColor: '#0f1e3a',
    accentColor: '#c8a85a',
    fontFamily: `'Playfair Display', Georgia, serif`,
    showCoverPage: true,
    showAboutSection: true,
    showProjectPhotos: true,
    showScopeOfWork: true,
    showPricingTable: true,
    showGoodBetterBest: true,
    showTerms: true,
    showSignature: true,
    showNextSteps: true,
    showThankYou: true,
  },
  modern: {
    key: 'modern',
    name: 'Modern',
    description: 'Clean, contemporary, minimalist. Strong typography.',
    primaryColor: '#111827',
    accentColor: '#f97316',
    fontFamily: `'Inter', -apple-system, BlinkMacSystemFont, sans-serif`,
    showCoverPage: true,
    showAboutSection: true,
    showProjectPhotos: true,
    showScopeOfWork: true,
    showPricingTable: true,
    showGoodBetterBest: true,
    showTerms: true,
    showSignature: true,
    showNextSteps: true,
    showThankYou: true,
  },
  classic: {
    key: 'classic',
    name: 'Classic',
    description: 'Traditional letterhead. Conservative, trustworthy, table-based.',
    primaryColor: '#1f2937',
    accentColor: '#0f766e',
    fontFamily: `Georgia, 'Times New Roman', serif`,
    showCoverPage: false,
    showAboutSection: true,
    showProjectPhotos: false,
    showScopeOfWork: true,
    showPricingTable: true,
    showGoodBetterBest: false,
    showTerms: true,
    showSignature: true,
    showNextSteps: true,
    showThankYou: false,
  },
  bold: {
    key: 'bold',
    name: 'Bold',
    description: 'High-impact visual. Large photos, strong color blocks.',
    primaryColor: '#b91c1c',
    accentColor: '#fbbf24',
    fontFamily: `'Inter', -apple-system, BlinkMacSystemFont, sans-serif`,
    showCoverPage: true,
    showAboutSection: false,
    showProjectPhotos: true,
    showScopeOfWork: true,
    showPricingTable: true,
    showGoodBetterBest: true,
    showTerms: true,
    showSignature: true,
    showNextSteps: true,
    showThankYou: true,
  },
}

export function getTemplate(key: string): QuoteTemplate {
  return TEMPLATES[(key as TemplateKey)] || TEMPLATES.premium
}

export function getDefaultTemplateKey(): TemplateKey {
  try {
    const r = localStorage.getItem('fencepro_config')
    if (r) {
      const cfg = JSON.parse(r)
      const k = cfg.quote?.defaultTemplate
      if (k && TEMPLATES[k as TemplateKey]) return k as TemplateKey
    }
  } catch {}
  return 'premium'
}

export function setDefaultTemplateKey(key: TemplateKey): void {
  try {
    const r = localStorage.getItem('fencepro_config')
    const cfg = r ? JSON.parse(r) : {}
    cfg.quote = { ...(cfg.quote || {}), defaultTemplate: key }
    localStorage.setItem('fencepro_config', JSON.stringify(cfg))
    window.dispatchEvent(new CustomEvent('fencepro:settings:updated'))
  } catch {}
}

/** Per-quote extension fields stored alongside SavedQuote. */
export interface QuotePresentation {
  templateKey?: TemplateKey
  customIntroText?: string
  customScopeText?: string
  quotePhotos?: { url: string; caption?: string }[]
  contractBody?: string
  validityDays?: number
  viewedAt?: string
  viewCount?: number
  lastViewedAt?: string
  acceptedAt?: string
  acceptedBy?: string
  acceptedSignature?: string
  declinedAt?: string
}
