// NutriFIT email relay — sends plan emails through an SMTP mailbox
// (e.g. Infomaniak) with the PDF attached. Runs on Cloudflare Workers via
// worker-mailer (Cloudflare TCP Sockets; needs nodejs_compat).
//
// Frontend POSTs JSON:
//   { to, toName, subject, message, pdfBase64, filename }
// SMTP credentials come from Worker vars/secrets (never from the client):
//   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS,
//   SMTP_FROM (defaults to SMTP_USER), SMTP_FROM_NAME, RELAY_TOKEN (optional)

import { WorkerMailer } from 'worker-mailer'

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Relay-Token',
    'Access-Control-Max-Age': '86400',
  }
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin')
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, origin)

    // Optional shared-token gate to stop the endpoint being an open relay.
    if (env.RELAY_TOKEN && request.headers.get('X-Relay-Token') !== env.RELAY_TOKEN) {
      return json({ error: 'unauthorized' }, 401, origin)
    }
    if (!env.SMTP_USER || !env.SMTP_PASS) {
      return json({ error: 'SMTP credentials not configured on the worker' }, 500, origin)
    }

    let body
    try { body = await request.json() } catch { return json({ error: 'invalid JSON' }, 400, origin) }
    const { to, toName, subject, message, pdfBase64, filename } = body || {}
    if (!to || !subject) return json({ error: 'missing "to" or "subject"' }, 400, origin)

    const secure = String(env.SMTP_SECURE) === 'true'
    try {
      const mailer = await WorkerMailer.connect({
        host: env.SMTP_HOST || 'mail.infomaniak.com',
        port: Number(env.SMTP_PORT || 587),
        secure,                 // true = implicit TLS (465)
        startTls: !secure,      // false + startTls = STARTTLS (587)
        credentials: { username: env.SMTP_USER, password: env.SMTP_PASS },
        authType: ['login', 'plain'],
      })

      await mailer.send({
        from: { name: env.SMTP_FROM_NAME || 'NutriFIT', email: env.SMTP_FROM || env.SMTP_USER },
        to: toName ? { name: toName, email: to } : to,
        subject,
        text: message || '',
        html: message ? `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>` : undefined,
        attachments: pdfBase64
          ? [{ filename: filename || 'diet-plan.pdf', content: pdfBase64, mimeType: 'application/pdf' }]
          : [],
      })

      return json({ ok: true }, 200, origin)
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 502, origin)
    }
  },
}
