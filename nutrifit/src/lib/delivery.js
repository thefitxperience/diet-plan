// Interim free delivery channels (plan §7): download + wa.me deep link,
// EmailJS, and a delivery record in the DB regardless of channel.

import emailjs from '@emailjs/browser'
import { supabase } from './supabase'

const EMAILJS = {
  serviceId: import.meta.env.VITE_EMAILJS_SERVICE_ID,
  templateId: import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
  publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY,
}

// Preferred: our own SMTP relay Worker (sends from your mailbox, attaches the
// PDF). Falls back to EmailJS (link only) when the Worker URL isn't set.
const EMAIL_WORKER_URL = import.meta.env.VITE_EMAIL_WORKER_URL
const EMAIL_RELAY_TOKEN = import.meta.env.VITE_EMAIL_RELAY_TOKEN

const emailjsConfigured = Boolean(EMAILJS.serviceId && EMAILJS.templateId && EMAILJS.publicKey)
export const emailConfigured = Boolean(EMAIL_WORKER_URL) || emailjsConfigured

export function waLink(phone, message) {
  const digits = (phone || '').replace(/[^\d]/g, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

// Blob → bare base64 (no data: prefix) for the SMTP attachment.
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export async function sendEmail({ toEmail, toName, subject, message, pdfBase64, filename, pdfUrl }) {
  if (EMAIL_WORKER_URL) {
    const res = await fetch(EMAIL_WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(EMAIL_RELAY_TOKEN ? { 'X-Relay-Token': EMAIL_RELAY_TOKEN } : {}),
      },
      body: JSON.stringify({ to: toEmail, toName, subject, message, pdfBase64, filename }),
    })
    if (!res.ok) throw new Error(`Email failed: ${res.status} — ${(await res.text()).slice(0, 200)}`)
    return res.json()
  }
  if (!emailjsConfigured) throw new Error('Email is not configured')
  return emailjs.send(EMAILJS.serviceId, EMAILJS.templateId, {
    to_email: toEmail,
    to_name: toName,
    subject: subject || '',
    message,
    pdf_url: pdfUrl || '',
  }, { publicKey: EMAILJS.publicKey })
}

// Upload the exact PDF that was sent — immutable snapshot (plan §9 deliveries).
export async function uploadPdfSnapshot(gymId, planId, blob, language) {
  const path = `${gymId}/${planId}/${Date.now()}-${language}.pdf`
  const { error } = await supabase.storage.from('plan-pdfs').upload(path, blob, { contentType: 'application/pdf' })
  if (error) throw error
  return path
}

export async function signedPdfUrl(path, expiresIn = 60 * 60 * 24 * 7) {
  const { data, error } = await supabase.storage.from('plan-pdfs').createSignedUrl(path, expiresIn)
  if (error) throw error
  return data.signedUrl
}

export async function recordDelivery({ gymId, planId, actorId, channel, recipient, language, pdfPath }) {
  const { error } = await supabase.from('deliveries').insert({
    gym_id: gymId, plan_id: planId, actor: actorId,
    channel, recipient: recipient || '', language, pdf_path: pdfPath,
  })
  if (error) throw error
}
