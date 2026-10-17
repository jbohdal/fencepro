/**
 * The website widget's choices: every material / style / height / color is
 * exactly one app style, read from the style names; styles the builder cannot
 * price from a parts list (Durafence) and the auto mix styles are left out.
 */

import { describe, test, expect } from 'vitest'
import { widgetCatalog } from '../src/server/lib/estimates'

const styles = [
  "WV-Auto ND Privacy", "WV-ND 6'x6' Privacy", "TV-ND 6'x6' Privacy", "WV-ND 8'x6' Privacy", "WV-ND 6'x8' Privacy", "WV-DS 6'x6' Privacy",
  "WV-ND Bell 4'x6'", "CL - 4' Galv", "CL - 6' Galv", "CL - 5' Black", "CL - Com 6'", "CL - Com 6'+1' Black",
  'Alum - ND - Emily - 48', 'Alum - DS - Ind Abigail', 'Durafence',
].map(name => ({ name, category: '' }))

describe('widget catalog', () => {
  const cat = widgetCatalog(styles)
  const all = cat.flatMap(m => m.styles.flatMap(s => Object.values(s.crm).flatMap(c => Object.values(c))))

  test('every app style with a parts list appears exactly once; auto mix and Durafence do not', () => {
    expect(all.sort()).toEqual(styles.map(s => s.name).filter(n => n !== 'Durafence' && !n.includes('Auto')).sort())
  })

  test('height and color pick the style', () => {
    const vinyl = cat.find(m => m.material === 'vinyl')!.styles.find(s => s.name === 'Privacy, 6 ft sections, no dig')!
    expect(vinyl.crm['6ft']).toEqual({ White: "WV-ND 6'x6' Privacy", Tan: "TV-ND 6'x6' Privacy" })
    expect(vinyl.crm['8ft']).toEqual({ White: "WV-ND 8'x6' Privacy" })
    const galv = cat.find(m => m.material === 'chain-link-galvanized')!.styles[0]
    expect(Object.keys(galv.crm).sort()).toEqual(['4ft', '6ft'])
  })
})
