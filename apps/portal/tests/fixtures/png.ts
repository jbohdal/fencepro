/** A small real PNG (solid color with a stripe), made in code: for tests that need a photo file. */
import zlib from 'zlib'

export function makePng(w = 64, h = 48, rgb: [number, number, number] = [94, 40, 161]): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3
      const stripe = Math.abs(x - y) < 3
      raw[o] = stripe ? 255 : rgb[0]; raw[o + 1] = stripe ? 255 : rgb[1]; raw[o + 2] = stripe ? 255 : rgb[2]
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export const pngDataUrl = (w = 300, h = 100) => 'data:image/png;base64,' + makePng(w, h, [255, 255, 255]).toString('base64')
