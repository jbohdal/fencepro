// The aerial photo's tile requests, for the tests that paint a made-up yard
// photo instead: our own /p/tiles/<source>/z/x/y.jpg (apps/portal
// routes/aerialTiles.ts) and the soft USGS tiles (z/y/x) under it.

/** Every photo request the app makes (sharp and soft). */
export const PHOTO_TILES = /\/p\/tiles\/(naip|esri|aerial)\/\d+\/\d+\/\d+\.jpg|USGSImageryOnly\/MapServer\/tile/
/** The sharp photo only. */
export const SHARP_TILES = /\/p\/tiles\/(naip|esri|aerial)\/\d+\/\d+\/\d+\.jpg/

const WORLD = 2 * Math.PI * 6378137

/** The tile a photo request is for: zoom, its Web Mercator box [x0, y0, x1, y1] and its pixel size. */
export function tileBox(url) {
  const u = new URL(url)
  let z, x, y
  const own = /\/p\/tiles\/(?:naip|esri|aerial)\/(\d+)\/(\d+)\/(\d+)\.jpg$/.exec(u.pathname)
  if (own) [z, x, y] = own.slice(1).map(Number)
  else [z, y, x] = u.pathname.split('/').slice(-3).map(Number)
  const span = WORLD / 2 ** z
  return { z, x, y, size: 256, bbox: [-WORLD / 2 + x * span, WORLD / 2 - (y + 1) * span, -WORLD / 2 + (x + 1) * span, WORLD / 2 - y * span] }
}
