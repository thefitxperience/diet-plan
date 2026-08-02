// Client-side PDF export (plan §7): html2canvas captures each rendered
// .deepfit-page, jsPDF assembles the document. Returns a Blob so delivery can
// also upload the immutable snapshot to storage.
//
// The PDF is a 1:1 copy of the on-screen preview: each PDF page is sized to
// match its captured .deepfit-page (not forced to A4), so a page never gets
// scaled/shrunk to fit — a taller meal simply yields a taller page, exactly
// like the preview.

import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

export async function renderPlanPdf(containerEl, { scale = 3 } = {}) {
  const pages = containerEl.querySelectorAll('.deepfit-page')
  if (!pages.length) throw new Error('No pages found to export')

  // let fonts / background images settle before capture
  await new Promise((r) => setTimeout(r, 200))

  let pdf = null
  for (const page of pages) {
    const canvas = await html2canvas(page, {
      scale,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
      imageTimeout: 0,
    })

    // Page size in CSS pixels (canvas is `scale`× that for crisp text).
    const w = canvas.width / scale
    const h = canvas.height / scale
    const orientation = w > h ? 'landscape' : 'portrait'

    if (!pdf) {
      pdf = new jsPDF({ orientation, unit: 'px', format: [w, h], compress: true, hotfixes: ['px_scaling'] })
    } else {
      pdf.addPage([w, h], orientation)
    }
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, w, h, undefined, 'FAST')
  }

  return pdf.output('blob')
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  // Firefox ignores a click on an anchor that isn't in the document, and
  // revoking the URL synchronously can cut the transfer short — so attach it,
  // click, then revoke on a delay (same pattern as PlanShare.download).
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
