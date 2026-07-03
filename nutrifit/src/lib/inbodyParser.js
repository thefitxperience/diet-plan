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

export async function extractFromImage(file, onProgress) {
  const { default: Tesseract } = await import('tesseract.js')
  const result = await Tesseract.recognize(file, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) onProgress(m.progress)
    },
  })
  return result.data.text
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
function parseInBody270(text) {
  const out = {}

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

  // Derivable cross-checks / fallbacks
  if (out.fatMass == null && out.weight != null && out.lbm != null) {
    out.fatMass = Math.round((out.weight - out.lbm) * 10) / 10
  }
  if (out.pbf == null && out.fatMass != null && out.weight) {
    out.pbf = Math.round((out.fatMass / out.weight) * 1000) / 10
  }

  // InBody Score: first standalone 2–3 digit line near the composition block
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\d{2,3})$/)
    if (m) { out.score = parseInt(m[1], 10); break }
  }

  return out
}

const STRATEGIES = { InBody270: parseInBody270 }

/**
 * Parse extracted text → { model, fields, unsupportedModel }.
 * Gender is intentionally NOT extracted (unreliable in the text layer) —
 * it comes from the client record (§6 note).
 */
export function parseInBodyText(text) {
  const model = detectModel(text)
  const strategy = STRATEGIES[model] || parseInBody270 // best-effort default
  const fields = strategy(text)
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
