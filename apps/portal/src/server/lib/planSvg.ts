/**
 * The site plan drawing as a picture.
 *
 * The plan is made with React's renderToStaticMarkup, which writes `<svg ...>`
 * with no xmlns. Drawn inline in an HTML page that is fine, but a browser only
 * shows an SVG as a picture (an <img>, a data: URL, the portal's
 * /site-plans/<id>.svg) when the root names the SVG namespace; without it the
 * picture is broken. Every place that turns the plan into a picture goes
 * through here, and so do the plans already saved on quotes and change orders.
 *
 * Pure (no server imports): the web app uses it too.
 */
export const SVG_NS = 'http://www.w3.org/2000/svg'

/** The same drawing with xmlns on its root <svg> (unchanged when it already has one, or is not an SVG). */
export function svgWithNamespace(svg: string): string {
  const m = /^(\s*<svg)([\s>/])/i.exec(svg)
  if (!m) return svg
  const root = svg.slice(0, svg.indexOf('>', m[1].length) + 1)
  if (/\sxmlns\s*=/.test(root)) return svg
  return `${m[1]} xmlns="${SVG_NS}"${svg.slice(m[1].length)}`
}

/** A data: URL for an <img> showing the drawing. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgWithNamespace(svg))}`
}
