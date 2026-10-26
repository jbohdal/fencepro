/**
 * Which requests the general API limit (index.ts, 600 a minute) leaves to the
 * media limit instead.
 *
 * Photos and video are many small requests: opening a customer's Photos tab
 * asks for about 60 thumbnails, and uploading 110 photos sends at least three
 * requests each (start, chunks, finish). Counted with everything else they used
 * up the minute and the rest of the app answered 429 "Too many requests"
 * (review of the customer page, Oct 26 2026). They get their own, much larger
 * limit; sign in, password and portal sign in keep their own strict limits.
 *
 *   GET  /api/media/f/<id>/<variant>?e=&s=   a signed photo, thumbnail or video link
 *   PUT  /api/media/uploads/<clientId>       a chunk of an upload (a signed in staff route)
 *
 * Starting and finishing an upload, and every other media route, stay under
 * the general limit.
 */
export function isMediaTraffic(method: string, url: string): boolean {
  const path = String(url || '').split('?')[0]
  const m = String(method || '').toUpperCase()
  if ((m === 'GET' || m === 'HEAD') && /^\/api\/media\/f\/[^/]+\/[^/]+\/?$/.test(path)) return true
  if (m === 'PUT' && /^\/api\/media\/uploads\/[^/]+\/?$/.test(path)) return true
  return false
}
