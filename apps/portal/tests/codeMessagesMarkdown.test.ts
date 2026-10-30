/**
 * Messages from Code: the details are drawn as simple markdown with React
 * elements (apps/web/src/codeMessageText.ts mdBlocks, mdSpans), never as HTML.
 * Headings, lists, code, quotes and paragraphs (line breaks kept); bold, code
 * and only http(s) links inline. Anything that looks like HTML stays text.
 */

import { describe, test, expect } from 'vitest'
import { mdBlocks, mdSpans } from '../../web/src/codeMessageText'

describe('Messages from Code details', () => {
  test('blocks: headings, lists, code, quotes, paragraphs with their line breaks', () => {
    const b = mdBlocks('# Live\nFirst line\nsecond line\n\n- one\n- two\n  more of two\n1. a\n2. b\n\n```\npnpm test\n```\n> quoted\n> again')
    expect(b).toEqual([
      { type: 'heading', level: 1, text: 'Live' },
      { type: 'para', text: 'First line\nsecond line' },
      { type: 'list', ordered: false, items: ['one', 'two\nmore of two'] },
      { type: 'list', ordered: true, items: ['a', 'b'] },
      { type: 'code', text: 'pnpm test' },
      { type: 'quote', text: 'quoted\nagain' },
    ])
  })

  test('inline: bold, code, links; a javascript: link and HTML stay text', () => {
    expect(mdSpans('**Yes** run `x` see [the job](https://ezbiz.example/job?id=1) or https://a.example/b')).toEqual([
      { type: 'bold', text: 'Yes' }, { type: 'text', text: ' run ' }, { type: 'code', text: 'x' }, { type: 'text', text: ' see ' },
      { type: 'link', text: 'the job', href: 'https://ezbiz.example/job?id=1' }, { type: 'text', text: ' or ' },
      { type: 'link', text: 'https://a.example/b', href: 'https://a.example/b' },
    ])
    expect(mdSpans('[x](javascript:alert(1)) <img src=x onerror=alert(1)>').every(s => s.type === 'text')).toBe(true)
  })
})
