// Reads vendor invoices on this Mac, free, with Apple's own frameworks:
// PDFKit for the text of a text PDF, Vision for photos and scanned pages.
//
//   invoice-reader <file> <outDir>
//
// Prints JSON: { pages: [ { source, width, height, image, words: [ { t, x, y, w, h, c } ] } ] }
// Boxes are fractions of the page (0..1, top left origin), so they line up
// with the page picture written to <outDir>/page-N.jpg. `c` is how sure the
// reader is (1 for PDF text). Compiled once by the server (lib/invoiceReader.ts).

import Foundation
import PDFKit
import Vision
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers

struct Word: Codable { let t: String; let x: Double; let y: Double; let w: Double; let h: Double; let c: Double; var l: Int? = nil }
struct Page: Codable { let source: String; let width: Double; let height: Double; let image: String; let words: [Word] }
struct Out: Codable { let pages: [Page] }

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(2)
}

func writeJPEG(_ img: CGImage, _ path: String) {
  let url = URL(fileURLWithPath: path) as CFURL
  guard let dest = CGImageDestinationCreateWithURL(url, UTType.jpeg.identifier as CFString, 1, nil) else { return }
  CGImageDestinationAddImage(dest, img, [kCGImageDestinationLossyCompressionQuality: 0.82] as CFDictionary)
  CGImageDestinationFinalize(dest)
}

/// Draws an image upright (EXIF orientation applied), at most `maxSide` pixels on its long side.
func upright(_ src: CGImageSource, maxSide: Int) -> CGImage? {
  let opts: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: maxSide,
  ]
  return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
}

func ocr(_ img: CGImage) -> [Word] {
  var words: [Word] = []
  let req = VNRecognizeTextRequest { r, _ in
    for (lineNo, obs) in ((r.results as? [VNRecognizedTextObservation]) ?? []).enumerated() {
      guard let cand = obs.topCandidates(1).first else { continue }
      let s = cand.string
      // One box per word, so columns can be told apart.
      var idx = s.startIndex
      while idx < s.endIndex {
        while idx < s.endIndex && s[idx] == " " { idx = s.index(after: idx) }
        if idx >= s.endIndex { break }
        var end = idx
        while end < s.endIndex && s[end] != " " { end = s.index(after: end) }
        let range = idx..<end
        if let box = try? cand.boundingBox(for: range)?.boundingBox {
          words.append(Word(t: String(s[range]), x: box.minX, y: 1 - box.maxY, w: box.width, h: box.height, c: Double(cand.confidence), l: lineNo))
        }
        idx = end
      }
    }
  }
  req.recognitionLevel = .accurate
  // Item numbers and prices are not dictionary words.
  req.usesLanguageCorrection = false
  req.recognitionLanguages = ["en-US"]
  let handler = VNImageRequestHandler(cgImage: img, options: [:])
  try? handler.perform([req])
  return words
}

func renderPDFPage(_ page: PDFPage, scale: CGFloat) -> CGImage? {
  let box = page.bounds(for: .mediaBox)
  let rot = page.rotation % 180 != 0
  let w = Int((rot ? box.height : box.width) * scale), h = Int((rot ? box.width : box.height) * scale)
  guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: ctx)
  return ctx.makeImage()
}

/// Words of a text PDF page, from each character's place on the page.
func pdfWords(_ page: PDFPage) -> [Word] {
  let n = page.numberOfCharacters
  if n == 0 { return [] }
  let box = page.bounds(for: .mediaBox)
  var words: [Word] = []
  var cur = ""
  var rect = CGRect.null
  func flush() {
    if !cur.isEmpty && !rect.isNull {
      // PDF space has its origin bottom left; turn into top-left fractions (rotation 0 pages).
      words.append(Word(t: cur, x: (rect.minX - box.minX) / box.width, y: 1 - (rect.maxY - box.minY) / box.height,
                        w: rect.width / box.width, h: rect.height / box.height, c: 1))
    }
    cur = ""; rect = .null
  }
  var lastRect = CGRect.null
  for i in 0..<n {
    // A selection of one character gives its text and its place together (page.string can be numbered differently).
    guard let sel = page.selection(for: NSRange(location: i, length: 1)), let ch = sel.string else { continue }
    if ch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { flush(); lastRect = .null; continue }
    let r = sel.bounds(for: page)
    // A line break selects the character before it again: skip the repeat.
    if r.isEmpty || r == lastRect { continue }
    // A big jump from the last character starts a new word even without a space.
    if !lastRect.isNull && (abs(r.midY - lastRect.midY) > max(r.height, lastRect.height) * 0.6 || r.minX - lastRect.maxX > max(r.height, 2) * 0.35 || r.maxX < lastRect.minX) { flush() }
    cur += ch
    rect = rect.union(r)
    lastRect = r
  }
  flush()
  return words
}

let args = CommandLine.arguments
if args.count < 3 { fail("usage: invoice-reader <file> <outDir>") }
let file = args[1], outDir = args[2]
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
let url = URL(fileURLWithPath: file)
var pages: [Page] = []

if let doc = PDFDocument(url: url) {
  for i in 0..<doc.pageCount {
    guard let page = doc.page(at: i) else { continue }
    let imgPath = (outDir as NSString).appendingPathComponent("page-\(i + 1).jpg")
    // 150 dpi to look at; 300 dpi to read a scanned page.
    if let img = renderPDFPage(page, scale: 150.0 / 72.0) { writeJPEG(img, imgPath) }
    let words = pdfWords(page)
    let chars = words.reduce(0) { $0 + $1.t.count }
    if chars >= 40 {
      let b = page.bounds(for: .mediaBox)
      pages.append(Page(source: "pdf-text", width: b.width, height: b.height, image: imgPath, words: words))
    } else if let big = renderPDFPage(page, scale: 300.0 / 72.0) {
      pages.append(Page(source: "ocr", width: Double(big.width), height: Double(big.height), image: imgPath, words: ocr(big)))
    }
  }
} else if let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = upright(src, maxSide: 4000) {
  let imgPath = (outDir as NSString).appendingPathComponent("page-1.jpg")
  if let shown = upright(src, maxSide: 2000) { writeJPEG(shown, imgPath) }
  pages.append(Page(source: "ocr", width: Double(img.width), height: Double(img.height), image: imgPath, words: ocr(img)))
} else {
  fail("Not a PDF or a picture this Mac can open")
}

let enc = JSONEncoder()
FileHandle.standardOutput.write(try! enc.encode(Out(pages: pages)))
