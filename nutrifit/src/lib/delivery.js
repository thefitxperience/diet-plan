// Interim free delivery channels (plan §7): download + wa.me deep link,
// EmailJS, and a delivery record in the DB regardless of channel.

import emailjs from '@emailjs/browser'
import { supabase } from './supabase'

const EMAILJS = {
  serviceId: import.meta.env.VITE_EMAILJS_SERVICE_ID,
  templateId: import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
  publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY,
}

export const emailConfigured = Boolean(EMAILJS.serviceId && EMAILJS.templateId && EMAILJS.publicKey)

export function waLink(phone, message) {
  const digits = (phone || '').replace(/[^\d]/g, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

export async function sendEmail({ toEmail, toName, message, pdfUrl }) {
  if (!emailConfigured) throw new Error('EmailJS is not configured')
  return emailjs.send(EMAILJS.serviceId, EMAILJS.templateId, {
    to_email: toEmail,
    to_name: toName,
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
