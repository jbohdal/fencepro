/**
 * Quote Template Renderer — renders a SavedQuote in one of four templates.
 *
 * Used by:
 *   - PublicQuotePage (customer-facing hosted page)
 *   - QuoteDetailDrawer "Preview Quote" button
 *   - PDF export (via window.print on the rendered HTML)
 */

import { useState } from 'react'
import type { SavedQuote } from './QuotesPage'
import { getTemplate, type QuoteTemplate, type TemplateKey, type QuotePresentation } from './quoteTemplatesStore'

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
const fmt2 = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

function readCompany() {
  try {
    const r = localStorage.getItem('fencepro_config')
    if (!r) return { name: 'FencePro', phone: '', email: '', address: '' }
    const cfg = JSON.parse(r)
    return cfg.company || { name: 'FencePro' }
  } catch { return { name: 'FencePro' } }
}

function readContract() {
  try {
    const r = localStorage.getItem('fencepro_contract_sections')
    return r ? JSON.parse(r) : []
  } catch { return [] }
}

export interface QuoteWithPresentation extends SavedQuote, QuotePresentation {}

interface RenderProps {
  quote: QuoteWithPresentation
  template: QuoteTemplate
  interactive?: boolean    // Show Accept button & signature form
  onAccept?: (name: string, signature: string) => void
  accepted?: boolean
  expired?: boolean
}

export default function QuoteTemplateRenderer({ quote, template, interactive, onAccept, accepted, expired }: RenderProps) {
  switch (template.key) {
    case 'premium': return <PremiumTemplate {...{ quote, template, interactive, onAccept, accepted, expired }} />
    case 'modern': return <ModernTemplate {...{ quote, template, interactive, onAccept, accepted, expired }} />
    case 'classic': return <ClassicTemplate {...{ quote, template, interactive, onAccept, accepted, expired }} />
    case 'bold': return <BoldTemplate {...{ quote, template, interactive, onAccept, accepted, expired }} />
  }
}

// ─────── Shared building blocks ───────

function useComputedFields(quote: QuoteWithPresentation) {
  const company = readCompany()
  const contractSections = readContract()
  const totalFootage = (quote.runs || []).reduce((s, n) => s + n, 0)
  const gateSummary = [
    quote.walkGates ? `${quote.walkGates} walk gate${quote.walkGates === 1 ? '' : 's'}` : '',
    quote.dblGates ? `${quote.dblGates} double gate${quote.dblGates === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ') || 'No gates'
  const pricePerFoot = totalFootage > 0 ? quote.finalPrice / totalFootage : 0
  const quoteNumber = `#${(quote.id || '').slice(-6).toUpperCase()}`
  const photos = quote.quotePhotos || []
  const introText = (quote.customIntroText || '').trim()
  const scopeText = (quote.customScopeText || '').trim()
  return { company, contractSections, totalFootage, gateSummary, pricePerFoot, quoteNumber, photos, introText, scopeText }
}

function AcceptanceBlock({ template, interactive, onAccept, accepted, expired }: { template: QuoteTemplate; interactive?: boolean; onAccept?: (n: string, s: string) => void; accepted?: boolean; expired?: boolean }) {
  const [name, setName] = useState('')
  const [signature, setSignature] = useState('')
  const [agreed, setAgreed] = useState(false)

  if (expired) {
    return (
      <div style={{ background: '#f3f4f6', border: '1px solid #d1d5db', padding: 24, borderRadius: 12, textAlign: 'center', color: '#374151' }}>
        <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>This quote has expired.</p>
        <p style={{ fontSize: 13, color: '#6b7280' }}>Please contact us for an updated quote.</p>
      </div>
    )
  }
  if (accepted) {
    return (
      <div style={{ background: '#d1fae5', border: '2px solid #10b981', padding: 28, borderRadius: 12, textAlign: 'center' }}>
        <p style={{ fontSize: 40, marginBottom: 4 }}>✓</p>
        <p style={{ fontSize: 18, fontWeight: 700, color: '#065f46' }}>Proposal Accepted</p>
        <p style={{ fontSize: 13, color: '#047857', marginTop: 4 }}>Thank you — we'll be in touch within 24 hours.</p>
      </div>
    )
  }
  if (!interactive) return null

  const canSubmit = name.trim() && signature.trim() && agreed

  return (
    <div style={{ background: '#fff', border: `2px solid ${template.accentColor}`, padding: 28, borderRadius: 12 }}>
      <p style={{ fontSize: 18, fontWeight: 700, color: template.primaryColor, marginBottom: 4 }}>Accept This Proposal</p>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
        To accept simply sign below. We'll contact you within 24 hours to schedule your project.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4 }}>Full Name</label>
          <input value={name} onChange={e => setName(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }} />
        </div>
        <div>
          <label style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4 }}>Signature</label>
          <input value={signature} onChange={e => setSignature(e.target.value)}
            placeholder="Type your signature"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 17, fontStyle: 'italic', fontFamily: 'Dancing Script, cursive' }} />
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#374151', marginBottom: 16 }}>
        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
        <span>I have read and agree to the terms and conditions above.</span>
      </label>
      <button onClick={() => onAccept?.(name.trim(), signature.trim())} disabled={!canSubmit}
        style={{
          width: '100%', background: canSubmit ? template.accentColor : '#d1d5db',
          color: canSubmit ? '#fff' : '#9ca3af',
          border: 'none', padding: '14px 20px', borderRadius: 8,
          fontSize: 15, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed'
        }}>
        Accept and Sign
      </button>
    </div>
  )
}

// ─────── Premium ───────

function PremiumTemplate({ quote, template, interactive, onAccept, accepted, expired }: RenderProps) {
  const { company, contractSections, totalFootage, gateSummary, pricePerFoot, quoteNumber, photos, introText, scopeText } = useComputedFields(quote)
  return (
    <div style={{ fontFamily: template.fontFamily, color: '#1f2937', background: '#fff' }}>
      {/* Cover */}
      <section style={{ background: `linear-gradient(135deg, ${template.primaryColor} 0%, #0a1530 100%)`, color: '#fff', padding: '80px 48px', textAlign: 'center' }}>
        <p style={{ color: template.accentColor, letterSpacing: 5, fontSize: 11, textTransform: 'uppercase', fontWeight: 700, marginBottom: 16 }}>{company.name || 'FencePro'}</p>
        <h1 style={{ fontSize: 42, fontWeight: 400, margin: 0, lineHeight: 1.2 }}>Fencing Proposal</h1>
        <h2 style={{ fontSize: 22, fontWeight: 300, marginTop: 8, color: '#cbd5e1' }}>for {quote.customerName}</h2>
        <div style={{ height: 2, width: 60, background: template.accentColor, margin: '32px auto' }} />
        <p style={{ color: '#cbd5e1', fontSize: 14 }}>{quote.customerAddress || ''}</p>
        <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 24 }}>{quote.date} · Quote {quoteNumber}</p>
      </section>

      <main style={{ maxWidth: 800, margin: '0 auto', padding: '60px 40px' }}>
        {/* Intro */}
        {introText && (
          <section style={{ marginBottom: 48, fontSize: 16, lineHeight: 1.7, color: '#374151' }}>
            <p>{introText}</p>
          </section>
        )}

        {/* About */}
        {template.showAboutSection && (
          <section style={{ marginBottom: 48 }}>
            <SectionHeading color={template.primaryColor} accent={template.accentColor}>About {company.name || 'Us'}</SectionHeading>
            <p style={{ color: '#374151', lineHeight: 1.7, fontSize: 14 }}>
              Licensed and insured fence specialists. We use premium materials and skilled crews to deliver fences that last.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 24 }}>
              {[['🛡', 'Licensed & Insured'], ['⭐', 'Satisfaction Guaranteed'], ['🏆', 'Premium Materials']].map(([icon, label]) => (
                <div key={label as string} style={{ background: '#f9fafb', padding: 16, borderRadius: 8, textAlign: 'center' }}>
                  <p style={{ fontSize: 24, marginBottom: 4 }}>{icon}</p>
                  <p style={{ fontSize: 12, fontWeight: 600, color: template.primaryColor }}>{label}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Project */}
        <section style={{ marginBottom: 48 }}>
          <SectionHeading color={template.primaryColor} accent={template.accentColor}>Your Project</SectionHeading>
          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', padding: 24, borderRadius: 8 }}>
            <p style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 2, fontWeight: 700 }}>Client</p>
            <p style={{ fontSize: 16, fontWeight: 700, color: template.primaryColor }}>{quote.customerName}</p>
            <p style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>{quote.customerAddress || ''}</p>
            <div style={{ height: 1, background: '#e5e7eb', margin: '16px 0' }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, fontSize: 13 }}>
              <div>
                <p style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', fontWeight: 700 }}>Fence Style</p>
                <p style={{ color: template.primaryColor, fontWeight: 600 }}>{quote.fenceStyle}</p>
              </div>
              <div>
                <p style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', fontWeight: 700 }}>Total Footage</p>
                <p style={{ color: template.primaryColor, fontWeight: 600 }}>{totalFootage} ft</p>
              </div>
              <div>
                <p style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', fontWeight: 700 }}>Gates</p>
                <p style={{ color: template.primaryColor, fontWeight: 600 }}>{gateSummary}</p>
              </div>
              <div>
                <p style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', fontWeight: 700 }}>Sections</p>
                <p style={{ color: template.primaryColor, fontWeight: 600 }}>{quote.sections}</p>
              </div>
            </div>
            {scopeText && (
              <>
                <div style={{ height: 1, background: '#e5e7eb', margin: '16px 0' }} />
                <p style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', fontWeight: 700 }}>Scope of Work</p>
                <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.7, marginTop: 6, whiteSpace: 'pre-wrap' }}>{scopeText}</p>
              </>
            )}
          </div>
          {template.showProjectPhotos && photos.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 16 }}>
              {photos.slice(0, 9).map((p, i) => (
                <div key={i} style={{ aspectRatio: '1 / 1', background: `#f3f4f6 url(${p.url}) center/cover`, borderRadius: 6 }} title={p.caption} />
              ))}
            </div>
          )}
        </section>

        {/* Investment */}
        <section style={{ marginBottom: 48 }}>
          <SectionHeading color={template.primaryColor} accent={template.accentColor}>Your Investment</SectionHeading>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${template.primaryColor}` }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: template.primaryColor, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Description</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', color: template.primaryColor, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: '14px 12px' }}>
                  <strong>{quote.fenceStyle} Installation</strong>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{totalFootage} linear feet · {quote.sections} sections</div>
                </td>
                <td style={{ padding: '14px 12px', textAlign: 'right', fontWeight: 600 }}>{fmt(Math.max(0, quote.finalPrice - 0))}</td>
              </tr>
              {(quote.walkGates > 0 || quote.dblGates > 0) && (
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '14px 12px', color: '#6b7280', fontSize: 13 }}>
                    Gates: {gateSummary}
                    <div style={{ fontSize: 12 }}>(included in project total)</div>
                  </td>
                  <td style={{ padding: '14px 12px', textAlign: 'right', color: '#6b7280' }}>—</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${template.primaryColor}` }}>
                <td style={{ padding: '18px 12px' }}>
                  <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, color: template.accentColor, fontWeight: 700 }}>Total Investment</p>
                  <p style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{fmt2(pricePerFoot)} per linear foot</p>
                </td>
                <td style={{ padding: '18px 12px', textAlign: 'right' }}>
                  <p style={{ fontSize: 32, fontWeight: 700, color: template.primaryColor, lineHeight: 1 }}>{fmt(quote.finalPrice)}</p>
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        {/* Terms */}
        {template.showTerms && contractSections.length > 0 && (
          <section style={{ marginBottom: 48 }}>
            <SectionHeading color={template.primaryColor} accent={template.accentColor}>Terms &amp; Warranty</SectionHeading>
            {contractSections.filter((s: any) => s.visible !== false).map((s: any) => (
              <div key={s.key} style={{ marginBottom: 20 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: template.primaryColor, marginBottom: 6 }}>{s.title}</p>
                <div style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.6, whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: s.body || '' }} />
              </div>
            ))}
          </section>
        )}

        {/* Acceptance */}
        {template.showSignature && (
          <section style={{ marginBottom: 48 }}>
            <SectionHeading color={template.primaryColor} accent={template.accentColor}>Ready to Get Started?</SectionHeading>
            <AcceptanceBlock template={template} interactive={interactive} onAccept={onAccept} accepted={accepted} expired={expired} />
          </section>
        )}

        {template.showThankYou && (
          <section style={{ textAlign: 'center', paddingTop: 24, borderTop: `1px solid #e5e7eb` }}>
            <p style={{ color: template.accentColor, letterSpacing: 5, fontSize: 11, textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>Thank You</p>
            <p style={{ color: '#374151', fontSize: 14, lineHeight: 1.6 }}>We appreciate the opportunity to earn your business.</p>
            <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 16 }}>
              {[company.name, company.phone, company.email].filter(Boolean).join(' · ')}
            </p>
          </section>
        )}
      </main>
    </div>
  )
}

function SectionHeading({ children, color, accent }: { children: React.ReactNode; color: string; accent: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ height: 2, width: 40, background: accent, marginBottom: 10 }} />
      <h2 style={{ fontSize: 28, fontWeight: 400, color, margin: 0 }}>{children}</h2>
    </div>
  )
}

// ─────── Modern ───────

function ModernTemplate({ quote, template, interactive, onAccept, accepted, expired }: RenderProps) {
  const { company, contractSections, totalFootage, gateSummary, pricePerFoot, quoteNumber, photos, introText, scopeText } = useComputedFields(quote)
  return (
    <div style={{ fontFamily: template.fontFamily, color: '#111827', background: '#fff' }}>
      <section style={{ position: 'relative', padding: '64px 48px', background: '#fff', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -80, right: -80, width: 400, height: 400, background: template.accentColor, transform: 'rotate(-25deg)', opacity: 0.9 }} />
        <div style={{ position: 'relative' }}>
          <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#6b7280', fontWeight: 700 }}>{company.name || 'FencePro'}</p>
          <h1 style={{ fontSize: 56, fontWeight: 900, lineHeight: 1.05, marginTop: 16, color: template.primaryColor }}>Project Proposal<br /><span style={{ color: template.accentColor }}>for {quote.customerName}</span></h1>
          <p style={{ fontSize: 14, color: '#6b7280', marginTop: 16 }}>{quote.customerAddress || ''}</p>
          <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 24 }}>Quote {quoteNumber} · {quote.date}</p>
        </div>
      </section>

      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '48px', display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 48 }}>
        <div>
          {introText && (
            <section style={{ marginBottom: 40 }}>
              <p style={{ fontSize: 14, lineHeight: 1.8, color: '#374151' }}>{introText}</p>
            </section>
          )}
          <NumberedSection num="01" title="Project Scope" accent={template.accentColor} color={template.primaryColor}>
            <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {scopeText || `${quote.fenceStyle} installation across ${totalFootage} linear feet with ${quote.sections} sections.`}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginTop: 20 }}>
              <Fact label="Fence Style" value={quote.fenceStyle} />
              <Fact label="Footage" value={`${totalFootage} ft`} />
              <Fact label="Gates" value={gateSummary} />
              <Fact label="Sections" value={String(quote.sections)} />
            </div>
          </NumberedSection>

          {template.showProjectPhotos && photos.length > 0 && (
            <NumberedSection num="02" title="Project References" accent={template.accentColor} color={template.primaryColor}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                {photos.slice(0, 6).map((p, i) => (
                  <div key={i} style={{ aspectRatio: '4 / 3', background: `#f3f4f6 url(${p.url}) center/cover`, borderRadius: 12 }} title={p.caption} />
                ))}
              </div>
            </NumberedSection>
          )}

          {template.showTerms && contractSections.length > 0 && (
            <NumberedSection num="03" title="Terms and Warranty" accent={template.accentColor} color={template.primaryColor}>
              {contractSections.filter((s: any) => s.visible !== false).map((s: any) => (
                <div key={s.key} style={{ marginBottom: 16 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: template.primaryColor, marginBottom: 4 }}>{s.title}</p>
                  <div style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.6, whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: s.body || '' }} />
                </div>
              ))}
            </NumberedSection>
          )}

          {template.showSignature && (
            <NumberedSection num="04" title="Accept Your Proposal" accent={template.accentColor} color={template.primaryColor}>
              <AcceptanceBlock template={template} interactive={interactive} onAccept={onAccept} accepted={accepted} expired={expired} />
            </NumberedSection>
          )}
        </div>

        {/* Sidebar pricing */}
        <aside style={{ position: 'sticky', top: 24, alignSelf: 'start', background: '#111827', color: '#fff', padding: 32, borderRadius: 16 }}>
          <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 3, color: template.accentColor, fontWeight: 700 }}>Your Investment</p>
          <p style={{ fontSize: 48, fontWeight: 900, margin: '8px 0', lineHeight: 1 }}>{fmt(quote.finalPrice)}</p>
          <p style={{ fontSize: 12, color: '#9ca3af' }}>{fmt2(pricePerFoot)} per linear foot</p>
          <div style={{ height: 1, background: '#374151', margin: '20px 0' }} />
          <p style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.6 }}>
            All materials, labor, and hardware included. Any necessary permits are the customer's responsibility unless specifically noted.
          </p>
          <div style={{ height: 1, background: '#374151', margin: '20px 0' }} />
          <div style={{ fontSize: 12, color: '#d1d5db' }}>
            <p style={{ marginBottom: 6 }}><strong style={{ color: '#fff' }}>{company.name}</strong></p>
            {company.phone && <p>{company.phone}</p>}
            {company.email && <p>{company.email}</p>}
          </div>
        </aside>
      </main>
    </div>
  )
}

function NumberedSection({ num, title, accent, color, children }: { num: string; title: string; accent: string; color: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 56, fontWeight: 900, color: accent, lineHeight: 1 }}>{num}</span>
        <h2 style={{ fontSize: 26, fontWeight: 800, color, margin: 0 }}>{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#f3f4f6', padding: 12, borderRadius: 8 }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, color: '#6b7280', fontWeight: 700 }}>{label}</p>
      <p style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{value}</p>
    </div>
  )
}

// ─────── Classic ───────

function ClassicTemplate({ quote, template, interactive, onAccept, accepted, expired }: RenderProps) {
  const { company, contractSections, totalFootage, gateSummary, pricePerFoot, quoteNumber, scopeText } = useComputedFields(quote)
  return (
    <div style={{ fontFamily: template.fontFamily, color: '#1f2937', background: '#fff', maxWidth: 800, margin: '0 auto', padding: 48 }}>
      {/* Letterhead */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `3px double ${template.primaryColor}`, paddingBottom: 20, marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 30, fontWeight: 700, color: template.primaryColor, margin: 0, fontFamily: template.fontFamily }}>{company.name || 'FencePro'}</h1>
          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Licensed &amp; Insured Fence Contractors</p>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: '#374151', lineHeight: 1.6 }}>
          {company.phone && <div>{company.phone}</div>}
          {company.email && <div>{company.email}</div>}
          {company.address && <div>{company.address}</div>}
        </div>
      </div>

      <div style={{ marginBottom: 32 }}>
        <p style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 2 }}>Proposal</p>
        <h2 style={{ fontSize: 24, color: template.primaryColor, margin: '6px 0' }}>{quote.customerName}</h2>
        <p style={{ fontSize: 13, color: '#4b5563' }}>{quote.customerAddress || ''}</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 11, color: '#6b7280' }}>
          <span>Quote {quoteNumber}</span>
          <span>Date: {quote.date}</span>
        </div>
      </div>

      <section style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: template.primaryColor, borderBottom: `1px solid ${template.primaryColor}`, paddingBottom: 6, marginBottom: 12 }}>Scope of Work</h3>
        <p style={{ fontSize: 13, lineHeight: 1.7, color: '#374151', whiteSpace: 'pre-wrap' }}>
          {scopeText || `Furnish and install ${quote.fenceStyle} across ${totalFootage} linear feet with ${quote.sections} sections. Gates: ${gateSummary}. All material and labor included.`}
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: template.primaryColor, borderBottom: `1px solid ${template.primaryColor}`, paddingBottom: 6, marginBottom: 12 }}>Pricing</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              <th style={{ textAlign: 'left', padding: 8, borderBottom: `1px solid ${template.primaryColor}` }}>Item</th>
              <th style={{ textAlign: 'right', padding: 8, borderBottom: `1px solid ${template.primaryColor}` }}>Qty</th>
              <th style={{ textAlign: 'right', padding: 8, borderBottom: `1px solid ${template.primaryColor}` }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: 8 }}>{quote.fenceStyle} installation</td>
              <td style={{ padding: 8, textAlign: 'right' }}>{totalFootage} ft</td>
              <td style={{ padding: 8, textAlign: 'right' }}>{fmt(quote.finalPrice)}</td>
            </tr>
            {quote.walkGates > 0 && (
              <tr>
                <td style={{ padding: 8 }}>Walk gate</td>
                <td style={{ padding: 8, textAlign: 'right' }}>{quote.walkGates}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>included</td>
              </tr>
            )}
            {quote.dblGates > 0 && (
              <tr>
                <td style={{ padding: 8 }}>Double drive gate</td>
                <td style={{ padding: 8, textAlign: 'right' }}>{quote.dblGates}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>included</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ padding: 10, textAlign: 'right', fontWeight: 700, borderTop: `2px solid ${template.primaryColor}` }}>Project Total</td>
              <td style={{ padding: 10, textAlign: 'right', fontWeight: 700, borderTop: `2px solid ${template.primaryColor}`, fontSize: 16 }}>{fmt(quote.finalPrice)}</td>
            </tr>
          </tfoot>
        </table>
        <p style={{ fontSize: 11, color: '#6b7280', textAlign: 'right', marginTop: 4 }}>{fmt2(pricePerFoot)} per foot</p>
      </section>

      {template.showTerms && contractSections.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: template.primaryColor, borderBottom: `1px solid ${template.primaryColor}`, paddingBottom: 6, marginBottom: 12 }}>Terms &amp; Warranty</h3>
          {contractSections.filter((s: any) => s.visible !== false).map((s: any) => (
            <div key={s.key} style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: template.primaryColor, marginBottom: 3 }}>{s.title}</p>
              <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: s.body || '' }} />
            </div>
          ))}
        </section>
      )}

      {template.showSignature && (
        <section>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: template.primaryColor, borderBottom: `1px solid ${template.primaryColor}`, paddingBottom: 6, marginBottom: 12 }}>Acceptance</h3>
          <AcceptanceBlock template={template} interactive={interactive} onAccept={onAccept} accepted={accepted} expired={expired} />
        </section>
      )}
    </div>
  )
}

// ─────── Bold ───────

function BoldTemplate({ quote, template, interactive, onAccept, accepted, expired }: RenderProps) {
  const { company, contractSections, totalFootage, gateSummary, pricePerFoot, quoteNumber, photos, introText, scopeText } = useComputedFields(quote)
  const hero = photos[0]?.url
  return (
    <div style={{ fontFamily: template.fontFamily, color: '#111827', background: '#fff' }}>
      {/* Cover */}
      <section style={{
        position: 'relative', minHeight: 400, color: '#fff',
        background: hero
          ? `linear-gradient(0deg, rgba(0,0,0,0.6), rgba(0,0,0,0.3)), url(${hero}) center/cover`
          : `linear-gradient(135deg, ${template.primaryColor}, #7f1d1d)`,
        padding: 64, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}>
        <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 5, color: template.accentColor, fontWeight: 700 }}>{company.name}</p>
        <div>
          <h1 style={{ fontSize: 60, fontWeight: 900, lineHeight: 1.05, margin: 0 }}>We Build Fences<br />That Last.</h1>
        </div>
        <div style={{ background: template.accentColor, color: '#111', padding: '18px 24px', borderRadius: 12, display: 'inline-block', marginTop: 20 }}>
          <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 2, fontWeight: 700 }}>Proposal for</p>
          <p style={{ fontSize: 20, fontWeight: 900, marginTop: 2 }}>{quote.customerName}</p>
          <p style={{ fontSize: 12, marginTop: 2 }}>{quote.customerAddress || ''}</p>
        </div>
      </section>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '48px 32px' }}>
        {introText && (
          <p style={{ fontSize: 15, lineHeight: 1.7, color: '#374151', marginBottom: 40 }}>{introText}</p>
        )}

        <section style={{ marginBottom: 48 }}>
          <h2 style={{ fontSize: 36, fontWeight: 900, color: template.primaryColor, margin: '0 0 20px' }}>The Project</h2>
          <p style={{ fontSize: 15, color: '#374151', lineHeight: 1.7, marginBottom: 20, whiteSpace: 'pre-wrap' }}>
            {scopeText || `Installation of ${quote.fenceStyle}, ${totalFootage} linear feet across ${quote.sections} sections with ${gateSummary.toLowerCase()}.`}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            {[
              ['Footage', `${totalFootage} ft`],
              ['Sections', String(quote.sections)],
              ['Style', quote.fenceStyle],
              ['Gates', gateSummary],
            ].map(([k, v]) => (
              <div key={k} style={{ background: '#fee2e2', padding: 14, borderRadius: 10, borderLeft: `4px solid ${template.primaryColor}` }}>
                <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 2, fontWeight: 700, color: template.primaryColor }}>{k}</p>
                <p style={{ fontSize: 14, fontWeight: 800, marginTop: 4 }}>{v}</p>
              </div>
            ))}
          </div>
        </section>

        {template.showProjectPhotos && photos.length > 1 && (
          <section style={{ marginBottom: 48 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
              {photos.slice(1, 7).map((p, i) => (
                <div key={i} style={{ aspectRatio: '4 / 3', background: `#f3f4f6 url(${p.url}) center/cover`, borderRadius: 10 }} title={p.caption} />
              ))}
            </div>
          </section>
        )}

        <section style={{
          background: `linear-gradient(135deg, ${template.primaryColor}, #7f1d1d)`,
          color: '#fff', padding: '48px 40px', borderRadius: 16, textAlign: 'center', marginBottom: 40,
        }}>
          <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 4, color: template.accentColor, fontWeight: 700 }}>Total Investment</p>
          <p style={{ fontSize: 72, fontWeight: 900, margin: '12px 0', lineHeight: 1 }}>{fmt(quote.finalPrice)}</p>
          <p style={{ fontSize: 14, opacity: 0.85 }}>{fmt2(pricePerFoot)} per linear foot · quote {quoteNumber}</p>
        </section>

        {template.showTerms && contractSections.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 28, fontWeight: 900, color: template.primaryColor, margin: '0 0 16px' }}>Terms &amp; Warranty</h2>
            {contractSections.filter((s: any) => s.visible !== false).map((s: any) => (
              <div key={s.key} style={{ marginBottom: 14 }}>
                <p style={{ fontSize: 13, fontWeight: 800, color: template.primaryColor, marginBottom: 4 }}>{s.title}</p>
                <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: s.body || '' }} />
              </div>
            ))}
          </section>
        )}

        {template.showSignature && (
          <section>
            <h2 style={{ fontSize: 28, fontWeight: 900, color: template.primaryColor, margin: '0 0 16px' }}>Accept the Proposal</h2>
            <AcceptanceBlock template={template} interactive={interactive} onAccept={onAccept} accepted={accepted} expired={expired} />
          </section>
        )}
      </main>
    </div>
  )
}
