// Client-side PDF export (plan §7): html2canvas captures each rendered
// .deepfit-page, jsPDF assembles an A4 document. Ported from the demo's
// downloadDietPlanPDF. Returns a Blob so delivery can also upload the
// immutable snapshot to storage.

import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

export async function renderPlanPdf(containerEl, { scale = 3 } = {}) {
  const pages = containerEl.querySelectorAll('.deepfit-page')
  if (!pages.length) throw new Error('No pages found to export')

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })

  const originalHeights = []
  pages.forEach((page, idx) => {
    originalHeights[idx] = page.style.height
    page.style.height = '842px'
  })
  await new Promise((r) => setTimeout(r, 300))

  try {
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], {
        scale,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: '#ffffff',
        imageTimeout: 0,
      })
      const imgData = canvas.toDataURL('image/jpeg', 0.95)
      const imgWidth = 210
      const imgHeight = Math.min((canvas.height * imgWidth) / canvas.width, 297)
      if (i > 0) pdf.addPage('a4')
      pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight, undefined, 'FAST')
    }
  } finally {
    pages.forEach((page, idx) => { page.style.height = originalHeights[idx] })
  }

  return pdf.output('blob')
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
