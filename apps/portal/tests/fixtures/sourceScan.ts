/** Helpers for the tests that read the app's own source (pipelineStageNames, settingsListsConnected). */

/** The source with comments blanked out (strings kept, line numbers kept). */
export function withoutComments(src: string): string {
  let out = ''
  let i = 0
  let quote: string | null = null
  while (i < src.length) {
    const c = src[i], n = src[i + 1]
    if (quote) {
      out += c
      if (c === '\\') { out += n ?? ''; i += 2; continue }
      if (c === quote) quote = null
      i++; continue
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++ } i += 2; continue }
    if (c === "'" || c === '"' || c === '`') quote = c
    out += c; i++
  }
  return out
}
