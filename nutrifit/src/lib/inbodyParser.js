// InBody extraction (plan §6): pdf.js text layer (primary) or Tesseract.js
// OCR (photo fallback), then per-model regex parsing. InBody270 patterns are
// validated against the real sample PDF; other models get added as samples
// arrive (strategy map keyed on the [InBodyXXX] marker).

export async function extractFromPdf(file) {
  return (await readPdfText(file)).text
}

// The text layer as line-grouped text (for the label/regex parsers) plus the
// first page's text items with their positions (for parseInBody270SLayout).
async function readPdfText(file) {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const data = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data }).promise
  let text = ''
  let positioned = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    if (i === 1) {
      positioned = content.items
        .filter((it) => it.str && it.str.trim())
        .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0 }))
    }
    // Group items by line (y coordinate) so anchors read like the printed page.
    const lines = new Map()
    for (const item of content.items) {
      const y = Math.round(item.transform[5])
      if (!lines.has(y)) lines.set(y, [])
      lines.get(y).push({ x: item.transform[4], str: item.str })
    }
    const sorted = [...lines.entries()].sort((a, b) => b[0] - a[0])
    for (const [, items] of sorted) {
      text += items.sort((a, b) => a.x - b.x).map((i) => i.str).join(' ') + '\n'
    }
  }
  return { text, items: positioned }
}

// Render a PDF's first page to a PNG data URL — a clean preview image with no
// browser PDF-viewer chrome (toolbar/thumbnails/print). Returns null on failure
// (the preview is optional; extraction is what matters).
export async function renderPdfFirstPage(file, targetWidth = 1000) {
  try {
    const pdfjs = await import('pdfjs-dist')
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

    const data = await file.arrayBuffer()
    const doc = await pdfjs.getDocument({ data }).promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: targetWidth / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

// Upscale a small image onto a white canvas before OCR. tesseract.js is far more
// accurate on ~2000px-wide input than on small phone/export images (a 900px sheet
// loses weight/SMM/BMI). Returns a canvas, or the original file if it's already
// large enough or can't be decoded.
async function upscaleForOcr(file, targetWidth = 2000) {
  try {
    const bitmap = await createImageBitmap(file)
    if (bitmap.width >= targetWidth) { bitmap.close?.(); return file }
    const scale = targetWidth / bitmap.width
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    return canvas
  } catch {
    return file // e.g. HEIC that can't be decoded — let Tesseract try the raw file
  }
}

export async function extractFromImage(file, onProgress) {
  const source = await upscaleForOcr(file)
  const { createWorker, PSM } = await import('tesseract.js')
  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) onProgress(m.progress)
    },
  })
  try {
    // InBody sheets are a structured single block; PSM 6 reads the label/value
    // rows far better than the default (which tries to flow across columns).
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
    const { data } = await worker.recognize(source)
    return data.text
  } finally {
    await worker.terminate()
  }
}

// OCR a PDF by rasterizing each page and running Tesseract on it. Newer InBody
// exports (270/270S) render the field LABELS as images/vectors, so the pdf.js
// text layer only yields bare numbers — OCR of the rendered page is the only way
// to recover the label/value pairing the parser needs.
export async function ocrPdf(file, onProgress) {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const { createWorker, PSM } = await import('tesseract.js')

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const worker = await createWorker('eng', 1, {
    logger: (m) => { if (m.status === 'recognizing text' && onProgress) onProgress(m.progress) },
  })
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
    let text = ''
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: 2000 / base.width }) // ~2000px wide → crisp OCR
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff' // PDFs render on transparent → white bg for OCR
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      const { data } = await worker.recognize(canvas)
      text += data.text + '\n'
    }
    return text
  } finally {
    await worker.terminate()
  }
}

// Unified extraction: returns { text, ocr, layoutFields }. PDFs try the text
// layer first: read by position when the page has the InBody270S layout (exact,
// and cross-checked), otherwise by the label/regex parsers. If neither yields a
// plausible sheet (image-label exports), we rasterize and OCR instead. Images
// always go through OCR.
export async function extractInBody(file, onProgress) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!isPdf) return { text: await extractFromImage(file, onProgress), ocr: true }

  const { text, items } = await readPdfText(file)
  const layoutFields = parseInBody270SLayout(items)
  if (layoutFields) return { text, ocr: false, layoutFields }
  // The label/regex text parser was built for the InBody270's text layer. On a
  // 270S page (numbers only) it reads plausible-looking but wrong values — a
  // 52.7 kg weight as 38 — so a 270S the layout reader couldn't confirm goes
  // to OCR instead.
  if (!/InBody\s*270S/i.test(text)) {
    const f = parseInBodyText(text, { ocr: false }).fields
    const plausible = f.weight >= 30 && f.weight <= 300 && f.height >= 100 && f.height <= 250
    if (plausible) return { text, ocr: false }
  }
  return { text: await ocrPdf(file, onProgress), ocr: true }
}

// ── InBody270S, read by position ────────────────────────────────────────────
// The 270S exports ("Microsoft: Print To PDF") draw every label as an image, so
// the text layer holds only the numbers — but all of them, exactly as printed,
// at fixed places on the page. Reading them by position is exact where OCR of
// the rendered page drops decimals and misreads digits. The adult and child
// (Growth Score) layouts differ slightly, so values are found by their
// neighbours rather than fixed coordinates:
//   composition table  "value ( lo~hi )" ×5, left half: water, protein,
//                      minerals, body fat mass, weight (top to bottom)
//   bar charts         the lone decimal under each scale row: weight, SMM,
//                      body fat mass, BMI, PBF (top to bottom)
//   right column       "value kg lo~hi" (SMM, then fat-free mass; adult only)
//                      and "value kcal lo~hi" (BMR)
// The page must add up — the four parts sum to the weight, and the bar chart
// repeats the table's weight and fat — or this returns null and the sheet goes
// through the other parsers instead. pdf.js y grows upwards (top = larger y).
//
// Other PDF writers can cut the same text differently ("59.9 (" as one piece, a
// number in single characters) or scale and shift the page, so the items are
// first normalised: touching pieces joined, decimal commas read as points,
// pieces split at spaces, brackets and units, and positions mapped onto the reference page through
// two fixed header anchors.
const REF_CM = { x: 122, y: 718 } // the header's "162cm" on a Print-To-PDF Letter page
const REF_MARKER_DX = 173 // from that to the "[InBody270S]" model marker

function normaliseItems(raw) {
  const rows = [...raw].sort((a, b) => b.y - a.y || a.x - b.x)
  const joined = []
  for (const it of rows) {
    const prev = joined[joined.length - 1]
    if (prev && Math.abs(prev.y - it.y) < 1 && it.x - (prev.x + prev.w) < 0.8 && it.x >= prev.x) {
      prev.s += it.s
      prev.w = it.x + it.w - prev.x
    } else joined.push({ ...it })
  }
  const split = []
  for (const it of joined) {
    // Decimal commas ("59,9", "46,8~63,4") become points; a comma before exactly
    // three digits is a thousands separator ("1,254" kcal) and is dropped.
    it.s = it.s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2').replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2')
    // A value glued to its bracket or unit ("59.9(", "22.0kg") is split from it.
    const text = it.s.replace(/(\d)(?=[()])|([()])(?=\d)/g, '$1$2 ').replace(/(\d)(kg|kcal)\b/g, '$1 $2')
    const parts = text.split(/(\s+)/)
    const perChar = text.length ? it.w / text.length : 0
    let at = 0
    for (const part of parts) {
      if (part.trim()) split.push({ s: part, x: it.x + at * perChar, y: it.y, w: part.length * perChar })
      at += part.length
    }
  }
  const cm = split.find((i) => /^\d{2,3}(?:\.\d)?cm$/.test(i.s))
  const marker = split.find((i) => /^\[InBody/i.test(i.s))
  if (!cm) return split
  const scale = marker && marker.x - cm.x > 50 ? (marker.x - cm.x) / REF_MARKER_DX : 1
  return split.map((i) => ({ ...i, x: REF_CM.x + (i.x - cm.x) / scale, y: REF_CM.y + (i.y - cm.y) / scale }))
}

export function parseInBody270SLayout(rawItems = []) {
  if (!rawItems.length) return null
  const items = normaliseItems(rawItems)
  const NUM = /^\d+(?:\.\d+)?$/
  const RANGE = /^\d+(?:\.\d+)?~\d+(?:\.\d+)?$/
  // Rows on the sheet are 10pt+ apart; pieces of one printed line can sit 1–3pt off.
  const sameRow = (a, b, tol = 4) => Math.abs(a.y - b.y) <= tol
  const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol
  const out = {}

  // Header row: "<id>  162cm  36  17.09.2026. 18:53" (a child's age has a decimal)
  const h = items.find((i) => /^\d{2,3}(?:\.\d)?cm$/.test(i.s))
  if (!h) return null
  out.height = parseFloat(h.s)
  const header = items.filter((i) => sameRow(i, h)).sort((a, b) => a.x - b.x)
  const age = header.find((i) => NUM.test(i.s) && i.x > h.x + 30 && i.x < h.x + 100)
  if (age) out.age = parseFloat(age.s)
  // Test date: the only date on the page with a four-digit year; time beside it.
  const dateItem = items.find((i) => /^\d{2}\.\d{2}\.\d{4}/.test(i.s))
  const when = dateItem?.s.match(/^(\d{2})\.(\d{2})\.(\d{4})\.?\s*(\d{2}:\d{2})?/)
  if (when) out.testDate = `${when[3]}-${when[2]}-${when[1]}`
  const time = when?.[4] || items.find((i) => /^\d{2}:\d{2}$/.test(i.s) && sameRow(i, dateItem) && i.x > dateItem.x)?.s
  if (time) out.testTime = time
  const id = header.find((i) => i.x < h.x && /^\d+$/.test(i.s))
  if (id) out.memberId = id.s

  // Composition table
  const comp = []
  for (const p of items) {
    if (p.s !== '(' || p.x > 330) continue
    if (!items.some((r) => RANGE.test(r.s) && sameRow(r, p) && r.x > p.x && r.x - p.x < 30)) continue
    const v = items.filter((i) => NUM.test(i.s) && sameRow(i, p) && i.x < p.x && p.x - i.x < 40)
      .sort((a, b) => b.x - a.x)[0]
    if (v) comp.push({ y: p.y, v: parseFloat(v.s) })
  }
  comp.sort((a, b) => b.y - a.y)
  if (comp.length !== 5) return null
  const [water, protein, mineral, fat, weight] = comp.map((c) => c.v)
  if (!near(water + protein + mineral + fat, weight, 0.3)) return null
  out.weight = weight
  out.fatMass = fat

  // Bar charts: below the table, the one decimal on its row in the chart area
  // (scale rows carry ten or more numbers; the history table comes later).
  const inBand = (i) => i.x > 80 && i.x < 345
  const bars = items
    .filter((i) => /^\d+\.\d$/.test(i.s) && inBand(i) && i.y < comp[4].y - 5)
    .filter((d) => !items.some((o) => o !== d && NUM.test(o.s) && inBand(o) && sameRow(o, d)))
    .sort((a, b) => b.y - a.y)
    .slice(0, 5)
    .map((i) => parseFloat(i.s))
  if (bars.length === 5 && near(bars[0], weight, 0.05) && near(bars[2], fat, 0.05)) {
    out.smm = bars[1]
    out.bmi = bars[3]
    out.pbf = bars[4]
  }

  // Right column: "value kg lo~hi" / "value kcal lo~hi"
  const right = []
  for (const r of items) {
    if (!RANGE.test(r.s) || r.x < 470) continue
    const unit = items.find((u) => /^(kg|kcal)$/.test(u.s) && sameRow(u, r) && u.x < r.x && r.x - u.x < 40)
    if (!unit) continue
    const v = items.filter((i) => NUM.test(i.s) && sameRow(i, r) && i.x < unit.x && unit.x - i.x < 40)
      .sort((a, b) => b.x - a.x)[0]
    if (v) right.push({ y: r.y, unit: unit.s, v: parseFloat(v.s) })
  }
  right.sort((a, b) => b.y - a.y)
  const kg = right.filter((r) => r.unit === 'kg')
  const kcal = right.find((r) => r.unit === 'kcal')
  if (kcal) out.bmr = kcal.v
  if (out.smm == null && kg[0]) out.smm = kg[0].v
  // Fat-free mass is printed on adult sheets; it is weight − fat by definition.
  out.lbm = kg[1] && near(kg[1].v + fat, weight, 0.2) ? kg[1].v : Math.round((weight - fat) * 10) / 10
  if (out.bmi == null) out.bmi = Math.round((weight / (out.height / 100) ** 2) * 10) / 10
  if (out.pbf == null) out.pbf = Math.round((fat / weight) * 1000) / 10
  if (out.bmr == null) out.bmr = Math.round(370 + 21.6 * out.lbm) // Katch–McArdle, as in finalize

  // InBody / Growth Score: the 2–3 digit number at the top of the right column
  const score = items.find((i) => /^\d{2,3}$/.test(i.s) && i.x > 400 && i.x < 480 && i.y > comp[4].y)
  if (score) out.score = parseInt(score.s, 10)
  return out
}

function detectModel(text) {
  const m = text.match(/\[?\s*InBody\s*(\d{3})\s*\]?/i)
  return m ? `InBody${m[1]}` : null
}

// ── InBody270 strategy ────────────────────────────────────────────────
// Anchors validated against the real sample (Test inbody 01.pdf) via the
// pdf.js line-grouped extraction above. Layout facts used:
//   header row:      "0537951117   175cm   26 19.07.2023. 21:41"
//   weight row:      "(kg)   76.2   (   57.3~77.5 )"   (value between unit & range)
//   fat mass row:    "(kg)   (   8.1~16.2 )" ↵ "14.6"  (last such row = fat)
//   LBM row:         "kg" ↵ "61.6   51.5~63.0" ↵ "24.9" (BMI) ↵ "kcal" ↵ "1700   1629~1909" (BMR)
//   summary block:   "76.2 ↵ (kg) ↵ 35.2 ↵ (kg) ↵ 19.2 ↵ (%)" → weight/SMM/PBF
function parseInBody270(text, { ocr = false } = {}) {
  const out = {}

  // The strict anchors below depend on the PDF text layer's exact line grouping,
  // which OCR doesn't reproduce (and would misfire on — e.g. reading the Body Fat
  // Mass row as Weight). For image/OCR input we skip straight to the robust
  // label-anchored parser (finalize handles it).
  if (ocr) return finalize(text, out)

  // ID, height, age, test date/time
  const idLine = text.match(/(\d+)\s+(\d{2,3}(?:\.\d)?)\s*cm\s+(\d{1,3})\s+(\d{2}\.\d{2}\.\d{4})\.?\s+(\d{2}:\d{2})/)
  if (idLine) {
    out.memberId = idLine[1]
    out.height = parseFloat(idLine[2])
    out.age = parseInt(idLine[3], 10)
    const [d, mo, y] = idLine[4].split('.')
    out.testDate = `${y}-${mo}-${d}`
    out.testTime = idLine[5]
  }

  // Summary block at the sheet's edge: weight, SMM, PBF in fixed order
  const summary = text.match(/(\d+\.?\d*)\s*\n\s*\(kg\)\s*\n\s*(\d+\.?\d*)\s*\n\s*\(kg\)\s*\n\s*(\d+\.?\d*)\s*\n\s*\(%\)/)
  if (summary) {
    out.weight = parseFloat(summary[1])
    out.smm = parseFloat(summary[2])
    out.pbf = parseFloat(summary[3])
  }

  // Weight (composition row) — fallback / cross-check for the summary block
  if (out.weight == null) {
    const w = text.match(/\(kg\)\s+(\d+\.?\d*)\s+\(\s*\d/)
    if (w) out.weight = parseFloat(w[1])
  }

  // Fat mass: last "(kg) ( range )" row with its value on the next line
  const fatRows = [...text.matchAll(/\(kg\)\s+\(\s*[\d.]+\s*~\s*[\d.]+\s*\)\s*\n\s*(\d+\.?\d*)/g)]
  if (fatRows.length) out.fatMass = parseFloat(fatRows[fatRows.length - 1][1])

  // LBM (Fat Free Mass): decimal value + normal range after a bare "kg" line,
  // followed by BMI on the next line, then "kcal" + BMR row
  const lbmBlock = text.match(/\bkg\s*\n\s*(\d+\.\d)\s+[\d.]+\s*~\s*[\d.]+\s*\n\s*(\d+\.?\d*)\s*\n\s*kcal\s*\n\s*(\d{3,4})\s+\d+\s*~\s*\d+/)
  if (lbmBlock) {
    out.lbm = parseFloat(lbmBlock[1])
    out.bmi = parseFloat(lbmBlock[2])
    out.bmr = parseInt(lbmBlock[3], 10)
  } else {
    const lbm = text.match(/\bkg\s*\n\s*(\d+\.\d)\s+[\d.]+\s*~\s*[\d.]+/)
    if (lbm) out.lbm = parseFloat(lbm[1])
    const bmr = text.match(/kcal\s*\n\s*(\d{3,4})\s+\d+\s*~\s*\d+/)
    if (bmr) out.bmr = parseInt(bmr[1], 10)
  }

  return finalize(text, out)
}

// Shared tail for both PDF and OCR paths: label-anchored fill for any missing
// field, then derivable cross-checks, then a last-resort InBody-score scan.
function finalize(text, out) {
  labelAnchoredFill(text, out)
  compositionCheck(text, out)
  reconcileWeight(text, out)

  // Body fat can't be most of the body: a reading over 70% of the weight lost
  // its decimal point ("8.9" read as "89"), and is dropped if a tenth won't fit.
  if (out.fatMass != null && out.weight && out.fatMass > out.weight * 0.7) {
    const tenth = Math.round(out.fatMass) / 10
    if (Number.isInteger(out.fatMass) && tenth >= 1 && tenth <= out.weight * 0.7) out.fatMass = tenth
    else delete out.fatMass
  }
  if (out.lbm != null && out.weight && (out.lbm <= 0 || out.lbm >= out.weight)) delete out.lbm

  // Body Fat Mass = Weight − Fat Free Mass (definitional). When both are read
  // (they have strong anchors), derive it — more reliable than the OCR-fragile
  // printed fat-mass value (which can drop a decimal or misread a digit).
  if (out.weight != null && out.lbm != null) {
    out.fatMass = Math.round((out.weight - out.lbm) * 10) / 10
  }
  // Reverse of the above: some sheets (e.g. InBody380) print Body Fat Mass in a
  // clean cell but the Fat Free Mass value is buried in a column table OCR can't
  // anchor — recover LBM = Weight − Body Fat Mass.
  if (out.lbm == null && out.weight != null && out.fatMass != null) {
    out.lbm = Math.round((out.weight - out.fatMass) * 10) / 10
  }
  // PBF = fat / weight (to within rounding, ~0.15). A printed PBF further off is a
  // misread: OCR picks up the bar-chart scale ("8.0" for 31.7%) or an earlier
  // visit's value in the history table.
  if (out.fatMass != null && out.weight) {
    const derived = Math.round((out.fatMass / out.weight) * 1000) / 10
    if (out.pbf == null || Math.abs(out.pbf - derived) > 0.25) out.pbf = derived
  }
  // BMI = weight / height² — derive it when the printed value (under a bar chart,
  // among scale numbers) didn't survive OCR, or disagrees with it by more than
  // rounding can explain (OCR read one client's 19.1 as 10.1, another's 23.2 as 24).
  if (out.weight && out.height) {
    const h = out.height / 100
    const derived = Math.round((out.weight / (h * h)) * 10) / 10
    if (out.bmi == null || Math.abs(out.bmi - derived) > 0.4) out.bmi = derived
  }
  // BMR: the InBody380 sheet doesn't print Basal Metabolic Rate, but it's needed
  // for the daily-calorie target. Estimate it from lean mass via Katch–McArdle
  // (BMR = 370 + 21.6 × Fat-Free Mass kg) whenever the sheet didn't provide one.
  // Sheets that print BMR (e.g. InBody270) keep their own value. On those,
  // Katch–McArdle lands within ~1 kcal of the printed figure, so it's a safe
  // fallback for any BMR-missing sheet too.
  if (out.bmr == null && out.lbm != null) {
    out.bmr = Math.round(370 + 21.6 * out.lbm)
  }

  // InBody Score fallback: first standalone 2–3 digit line (label fill handles
  // the reliable "NN/100" form; this only runs if that didn't match).
  if (out.score == null) {
    for (const line of text.split('\n')) {
      const m = line.trim().match(/^(\d{2,3})$/)
      if (m) { out.score = parseInt(m[1], 10); break }
    }
  }
  return out
}

// The composition table ("Total Body Water 29.9 ( 28.1~34.3 )" … "Weight 59.9 (")
// is a sum: water + protein + minerals + body fat mass = weight. When OCR reads
// all four parts and they add up to a weight printed on the page, that weight
// and fat mass are confirmed, overriding a misread one. OCR often drops a
// decimal point ("8.7" → "87", minerals' "3.24" → "324"), so a whole-number
// part may also be read as a tenth or a hundredth of itself; a reading is used
// only if exactly one combination adds up.
const PART_RANGE = { water: [8, 90], protein: [2, 30], mineral: [0.5, 8], fat: [1, 150] }

function compositionCheck(text, out) {
  // label, its unit ("(kg)", "L"), then the first number followed by "(": the value
  const part = (label) => {
    const m = text.match(new RegExp(label + '[^\\n]{0,16}?(\\d{1,3}(?:\\.\\d+)?)\\s*\\(', 'i'))
    return m ? parseFloat(m[1]) : null
  }
  const read = {
    water: part('Total\\s*Body\\s*Water'),
    protein: part('Protein'),
    mineral: part('Minerals?'),
    fat: part('Body\\s*Fat\\s*Mass'),
  }
  if (Object.values(read).some((v) => v == null)) return
  const options = Object.entries(read).map(([k, v]) => {
    const [lo, hi] = PART_RANGE[k]
    const tenths = Number.isInteger(v) ? [v / 10, v / 100] : []
    return [v, ...tenths].filter((n) => n >= lo && n <= hi)
  })
  if (options.some((o) => !o.length)) return
  // Rounding puts the true weight within ~0.2 of the sum; of the printed weights
  // that close, the nearest wins (a misread "71.4" loses to the history's 71.1).
  // Target weight − weight control is the weight too: it stands in when OCR lost
  // the weight row itself.
  const printed = [out.weight, ...weightCandidates(text), weightFromControl(text)].filter((n) => n != null)
  const matches = []
  for (const w of options[0]) for (const p of options[1]) for (const m of options[2]) for (const f of options[3]) {
    const sum = w + p + m + f
    const weight = printed.filter((n) => Math.abs(n - sum) <= 0.25)
      .sort((a, b) => Math.abs(a - sum) - Math.abs(b - sum))[0]
    if (weight != null && !matches.some((x) => x.weight === weight && x.fat === f)) matches.push({ weight, fat: f })
  }
  if (matches.length !== 1) return
  const { weight, fat } = matches[0]
  out.weight = weight
  out.fatMass = fat
  // Fat-free mass is weight − fat to the printed decimal; a reading that isn't
  // ("71 3 kg" read as 71) would otherwise drag the fat mass off with it.
  if (out.lbm == null || Math.abs(out.lbm + fat - weight) > 0.15) out.lbm = Math.round((weight - fat) * 10) / 10
}

// Weight is printed several times on the sheet, and OCR noise sitting next to it
// (e.g. the phase angle's "50 kHz" on the 270S) can be read instead — one
// client's 59.9 kg arrived as 50. The sheet also prints two figures that pin
// weight down: Fat Free Mass + Body Fat Mass (equal by definition), Target
// Weight − Weight Control (the Weight Control section), and BMI × height². A
// weight that agrees with any of them is kept. One that agrees with none is
// replaced by the printed weight that agrees best; if none does, by the checks'
// own value — but only when two of them agree, so a single misread check can't
// overrule a correct weight.
const WEIGHT_TOLERANCE = 1.5 // kg

function weightCandidates(text) {
  const found = []
  for (const line of text.split('\n')) {
    if (!/weight|\(kg\)/i.test(line)) continue
    for (const m of line.matchAll(/(\d{2,4}(?:\.\d)?)(?!\s*(?:k\s*h?z|%|\d))/gi)) {
      let n = parseFloat(m[1])
      if (n > 300 && n / 10 <= 300) n = n / 10 // dropped decimal: "599" → 59.9
      if (n >= 30 && n <= 300) found.push(n)
    }
  }
  return found
}

// "Target Weight 55.1 kg" and "Weight Control -4.8 kg": current = target − control.
function weightFromControl(text) {
  const target = text.match(/Target\s*Weight[^0-9\n]{0,6}(\d{2,3}(?:\.\d)?)/i)
  // The unit is optional: OCR reads "kg" as "xg", "ko", "kq"…
  const control = text.match(/Weight\s*Control[^0-9+\-\n]{0,6}([+\-−–]?)\s*(\d{1,2}(?:\.\d)?)(?![\d.])/i)
  if (!target || !control) return null
  const delta = parseFloat(control[2]) * (control[1] && control[1] !== '+' ? -1 : 1)
  return parseFloat(target[1]) - delta
}

function reconcileWeight(text, out) {
  const refs = []
  if (out.lbm != null && out.fatMass != null) refs.push(out.lbm + out.fatMass)
  const fromControl = weightFromControl(text)
  if (fromControl != null && fromControl >= 30 && fromControl <= 300) refs.push(fromControl)
  if (out.bmi != null && out.height) refs.push(out.bmi * (out.height / 100) ** 2)
  const near = (n, r) => Math.abs(n - r) <= WEIGHT_TOLERANCE
  if (!refs.length || (out.weight != null && refs.some((r) => near(out.weight, r)))) return
  const score = (n) => refs.filter((r) => near(n, r)).length
  const best = weightCandidates(text)
    .filter((n) => score(n) > 0)
    .sort((a, b) => score(b) - score(a) || Math.abs(a - refs[0]) - Math.abs(b - refs[0]))[0]
  if (best != null) { out.weight = best; return }
  // No printed weight agrees: use a check's value, if another check confirms it.
  const agreed = refs.find((r, i) => refs.some((q, j) => j !== i && near(r, q)))
  if (agreed != null) out.weight = Math.round(agreed * 10) / 10
}

// OCR-tolerant fallback: pull each metric by its printed label + the nearest
// number, guarded by a plausibility range so OCR noise can't inject garbage.
// Fills only fields left empty by the strict parser, so PDF results are intact.
// SMM and BMI print under bar charts (surrounded by scale numbers) and rarely
// survive OCR — they're left for the nutritionist to confirm in the review step.
function labelAnchoredFill(text, out) {
  // grab() also repairs a dropped decimal point: tesseract sometimes reads
  // "71.1" as "711" or "35.5" as "355". If the raw number is out of the field's
  // plausible range but value/10 lands inside it, we treat the decimal as lost.
  const grab = (re, lo, hi) => {
    const m = text.match(re)
    if (!m) return null
    let n = parseFloat(m[1])
    if ((n < lo || n > hi) && n / 10 >= lo && n / 10 <= hi) n = n / 10
    return n >= lo && n <= hi ? n : null
  }
  const set = (k, v) => { if (out[k] == null && v != null) out[k] = v }
  const DEC = '(\\d{2,4}(?:\\.\\d)?)' // 2–4 digits, decimal optional (may be dropped by OCR)
  // "166.5cm" has a decimal; OCR can put a stray glyph before the unit ("166¢cm").
  set('height', grab(/(\d{2,3}(?:\.\d)?)\s*[¢©]?\s*[co]m\b/i, 100, 250))
  // Weight/fat rows are "…VALUE ( lo~hi )". Lazy gap tolerates OCR unit junk
  // (e.g. "(kg)" read as "*9)"); the trailing "(" anchors to the composition row.
  set('weight', grab(new RegExp('\\bWeight\\b[^\\n]{0,10}?' + DEC + '\\s*[.\\-—]*\\s*\\(', 'i'), 30, 300))
  // InBody380 layout: the composition-table Weight value has no trailing
  // "(range)". The Muscle-Fat "Weight (kg)" bar value instead sits right before
  // the fixed "Weight Control" section label; its bar scale tops out at "205 %".
  set('weight', grab(new RegExp(DEC + '\\s*Weight\\s*Control', 'i'), 30, 300))
  set('weight', grab(new RegExp('205\\s*%[^0-9]{0,15}' + DEC, 'i'), 30, 300))
  // LBM (Fat Free Mass) — label may OCR as "Fat Free Bass"; anchor on the "kg".
  set('lbm', grab(new RegExp('Fat\\s*Free\\s*\\w+[^\\n]{0,8}?' + DEC + '\\s*kg', 'i'), 20, 120))
  set('lbm', grab(new RegExp('Fat\\s*Free\\s*Mass[^0-9]{0,14}' + DEC, 'i'), 20, 120))
  // fatMass is normally DERIVED (weight − lbm); this is only a fallback when one
  // of those is missing. Tight upper bound so a dropped decimal (141→14.1) repairs.
  set('fatMass', grab(new RegExp('Body\\s*Fat\\s*Mass[^\\n]{0,10}?' + DEC + '\\s*[.\\-—]*\\s*\\(', 'i'), 2, 90))
  // InBody380: "Body Fat Mass (kg) 30.8" printed with no trailing range (label
  // often OCRs as "BodyFathass (a)"). The lookahead rejects the Muscle-Fat
  // bar-scale row "Body Fat Mass (kg) 40 60 80…" (value followed by more numbers).
  set('fatMass', grab(new RegExp('Body\\s*Fat\\s*\\w+\\s*\\(\\s*[a-z]+\\s*\\)\\s*' + DEC + '(?!\\s*[\\d.])', 'i'), 2, 90))
  // BMR: the only "NNNN kcal ( lo~hi )" — robust to the label mis-OCR'ing
  // (e.g. "Basal MetebolicRete"). Recommended-intake kcal has no range, so it's ignored.
  set('bmr', grab(/(\d{3,4})\s*kcal\s*[^0-9]{0,4}\d{3,4}\s*[~\-]/i, 700, 5000))
  set('bmr', grab(/Basal\s*Metabolic\s*Rate[^0-9]{0,14}(\d{3,4})/i, 700, 5000))
  // PBF is normally DERIVED (fat/weight); direct read requires a decimal so it
  // can't grab bar-chart scale numbers.
  set('pbf', grab(/(?:Percent\s*Body\s*Fat|\bPBF\b)[^0-9]{0,24}(\d{1,2}\.\d)/i, 3, 70))
  // SMM is the trickiest (it lives next to bar-chart scale numbers). Try the
  // most specific forms first: the Body-Composition-History row "SMM (kg) | NNN"
  // — a SINGLE value at end of line (a dropped decimal 355→35.5 is repaired by
  // grab). The end-of-line anchor rejects the bar-chart scale row "SMM (kg) 70
  // 80 90…", whose first number is followed by more numbers, not a line break.
  // OCR may mangle the unit's brackets ("SMM kg)| 32.1"). Then the Research-
  // Parameters "…Muscle Mass NN.N kg" value, then the value printed on the line
  // right after the "SMM … %" scale row.
  set('smm', grab(new RegExp('\\bSMM\\s*\\(?\\s*kg\\s*\\)?[^0-9\\n]{0,5}' + DEC + '\\s*(?:\\n|$)', 'im'), 10, 100))
  set('smm', grab(new RegExp('Skeletal\\s*Muscle\\s*Mass\\s*' + DEC + '\\s*k', 'i'), 10, 100)) // "kg" may OCR as "ks", "k"
  set('smm', grab(/\bSMM\b[^\n]*%[^\n]*\n[^\d\n]*(\d{2,3}\.\d)/i, 10, 100))
  set('bmi', grab(/\bBMI\b[^0-9]{0,4}(\d{1,2}\.\d)/i, 10, 60))
  // 270S: the BMI value sits on the line after the "BMI (kg/m²) 10.0 15.0 …" scale
  // row, as its first decimal (same layout as SMM above).
  set('bmi', grab(/\bBMI\b[^\n]*\n[^\d\n]*(\d{1,2}\.\d)/i, 10, 60))
  // Score prints as "NN/100 Points"; OCR often mangles "/1" (→ '"' or merges a
  // digit), so anchor on "…00 Points" and absorb one stray digit after the score.
  set('score', grab(/(\d{2})\d?[^0-9]{0,3}0\s*0\s*Points/i, 1, 100))
  set('score', grab(/(\d{2,3})\s*\/\s*1\s*0\s*0/, 1, 100))
  // A child's age has a decimal; OCR may add the table's rules ("173cm | 42 Female").
  set('age', grab(/[co]m\s*\|?\s*(\d{1,3}(?:\.\d)?)\s*\|?\s*(?:Male|Female)/i, 5, 100))
  // Child sheets (a Growth Score; "water in my body") are for under-18s: "96"
  // there is a dropped "9.6".
  const childSheet = /Growth\s*Sco|water\s*in\s*my\s*body|Child\s*Obesity/i.test(text)
  if (out.age > 18 && childSheet && Number.isInteger(out.age)) out.age /= 10
  if (!out.testDate) {
    const d = text.match(/(\d{2})\.(\d{2})\.(\d{4})/) // DD.MM.YYYY (InBody270)
    if (d) out.testDate = `${d[3]}-${d[2]}-${d[1]}`
  }
  if (!out.testDate) {
    const d = text.match(/(\d{4})\.(\d{2})\.(\d{2})/) // YYYY.MM.DD (InBody380)
    if (d) out.testDate = `${d[1]}-${d[2]}-${d[3]}`
  }
}

// InBody380 is image-only (empty text layer) so it always takes the OCR path,
// where parseInBody270 skips its strict PDF anchors and runs the shared
// label-anchored/derived finalize — which now handles the 380 layout too.
const STRATEGIES = { InBody270: parseInBody270, InBody380: parseInBody270 }

/**
 * Parse extracted text → { model, fields, unsupportedModel }.
 * Gender is intentionally NOT extracted (unreliable in the text layer) —
 * it comes from the client record (§6 note).
 */
export function parseInBodyText(text, { ocr = false, layoutFields = null } = {}) {
  const model = detectModel(text)
  const strategy = STRATEGIES[model] || parseInBody270 // best-effort default
  // Values read by position (extractInBody) are exact and already cross-checked.
  const fields = layoutFields ? { ...layoutFields } : strategy(text, { ocr })
  return {
    model: model || 'unknown',
    unsupportedModel: model !== null && !STRATEGIES[model],
    fields,
  }
}

/**
 * Cross-check extracted values against the client profile — the wrong
 * client's file is a real failure mode (§6). Returns field → message.
 */
export function crossCheckClient(fields, client) {
  const issues = {}
  if (client?.dob && fields.age != null) {
    const age = Math.floor((Date.now() - new Date(client.dob).getTime()) / 31557600000)
    if (Math.abs(age - fields.age) > 1) {
      issues.age = `Client profile age is ${age}`
    }
  }
  return issues
}
