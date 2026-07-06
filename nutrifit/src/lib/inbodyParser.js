// InBody extraction (plan §6): pdf.js text layer (primary) or Tesseract.js
// OCR (photo fallback), then per-model regex parsing. InBody270 patterns are
// validated against the real sample PDF; other models get added as samples
// arrive (strategy map keyed on the [InBodyXXX] marker).

export async function extractFromPdf(file) {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const data = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data }).promise
  let text = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
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
  return text
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

// Unified extraction: returns { text, ocr }. PDFs try the fast text layer first;
// if it doesn't yield a plausible sheet (image-label exports), we rasterize and
// OCR instead. Images always go through OCR.
export async function extractInBody(file, onProgress) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!isPdf) return { text: await extractFromImage(file, onProgress), ocr: true }

  const text = await extractFromPdf(file)
  const f = parseInBodyText(text, { ocr: false }).fields
  const plausible = f.weight >= 30 && f.weight <= 300 && f.height >= 100 && f.height <= 250
  if (plausible) return { text, ocr: false }
  return { text: await ocrPdf(file, onProgress), ocr: true }
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

  // Body Fat Mass = Weight − Fat Free Mass (definitional). When both are read
  // (they have strong anchors), derive it — more reliable than the OCR-fragile
  // printed fat-mass value (which can drop a decimal or misread a digit).
  if (out.weight != null && out.lbm != null) {
    out.fatMass = Math.round((out.weight - out.lbm) * 10) / 10
  }
  if (out.pbf == null && out.fatMass != null && out.weight) {
    out.pbf = Math.round((out.fatMass / out.weight) * 1000) / 10
  }
  // BMI = weight / height² — derive it when the printed value (under a bar chart,
  // among scale numbers) didn't survive OCR.
  if (out.bmi == null && out.weight && out.height) {
    const h = out.height / 100
    out.bmi = Math.round((out.weight / (h * h)) * 10) / 10
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
  set('height', grab(/(\d{2,3})\s*[co]m\b/i, 100, 250))
  // Weight/fat rows are "…VALUE ( lo~hi )". Lazy gap tolerates OCR unit junk
  // (e.g. "(kg)" read as "*9)"); the trailing "(" anchors to the composition row.
  set('weight', grab(new RegExp('\\bWeight\\b[^\\n]{0,10}?' + DEC + '\\s*[.\\-—]*\\s*\\(', 'i'), 30, 300))
  // LBM (Fat Free Mass) — label may OCR as "Fat Free Bass"; anchor on the "kg".
  set('lbm', grab(new RegExp('Fat\\s*Free\\s*\\w+[^\\n]{0,8}?' + DEC + '\\s*kg', 'i'), 20, 120))
  set('lbm', grab(new RegExp('Fat\\s*Free\\s*Mass[^0-9]{0,14}' + DEC, 'i'), 20, 120))
  // fatMass is normally DERIVED (weight − lbm); this is only a fallback when one
  // of those is missing. Tight upper bound so a dropped decimal (141→14.1) repairs.
  set('fatMass', grab(new RegExp('Body\\s*Fat\\s*Mass[^\\n]{0,10}?' + DEC + '\\s*[.\\-—]*\\s*\\(', 'i'), 2, 90))
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
  // Then the Research-Parameters "…Muscle Mass NN.N kg" value, then the value
  // printed on the line right after the "SMM … %" scale row.
  set('smm', grab(new RegExp('\\bSMM\\s*\\(kg\\)[^0-9\\n]{0,5}' + DEC + '\\s*(?:\\n|$)', 'im'), 10, 100))
  set('smm', grab(new RegExp('Skeletal\\s*Muscle\\s*Mass\\s*' + DEC + '\\s*kg', 'i'), 10, 100))
  set('smm', grab(/\bSMM\b[^\n]*%[^\n]*\n[^\d\n]*(\d{2,3}\.\d)/i, 10, 100))
  set('bmi', grab(/\bBMI\b[^0-9]{0,4}(\d{1,2}\.\d)/i, 10, 60))
  // Score prints as "NN/100 Points"; OCR often mangles "/1" (→ '"' or merges a
  // digit), so anchor on "…00 Points" and absorb one stray digit after the score.
  set('score', grab(/(\d{2})\d?[^0-9]{0,3}0\s*0\s*Points/i, 1, 100))
  set('score', grab(/(\d{2,3})\s*\/\s*1\s*0\s*0/, 1, 100))
  set('age', grab(/[co]m\s+(\d{1,3})\s+(?:Male|Female)/i, 10, 100))
  if (!out.testDate) {
    const d = text.match(/(\d{2})\.(\d{2})\.(\d{4})/)
    if (d) out.testDate = `${d[3]}-${d[2]}-${d[1]}`
  }
}

const STRATEGIES = { InBody270: parseInBody270 }

/**
 * Parse extracted text → { model, fields, unsupportedModel }.
 * Gender is intentionally NOT extracted (unreliable in the text layer) —
 * it comes from the client record (§6 note).
 */
export function parseInBodyText(text, { ocr = false } = {}) {
  const model = detectModel(text)
  const strategy = STRATEGIES[model] || parseInBody270 // best-effort default
  const fields = strategy(text, { ocr })
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
