# FIT Email Worker

Cloudflare Worker that sends diet-plan emails through your SMTP mailbox
(Infomaniak, etc.) with the PDF attached. Free, credentials stay server-side.

## Deploy (one time)

```bash
cd email-worker
npm install
npx wrangler login          # opens the browser to authorize Cloudflare

# Set your mailbox credentials as secrets (NOT in wrangler.toml, NOT in git):
npx wrangler secret put SMTP_USER   # your full mailbox address, e.g. you@yourdomain.com
npx wrangler secret put SMTP_PASS   # the mailbox password
npx wrangler secret put RELAY_TOKEN # any long random string (also set as VITE_EMAIL_RELAY_TOKEN in the app)
# Optional if the "From" differs from SMTP_USER:
npx wrangler secret put SMTP_FROM

npm run deploy
```

`wrangler.toml` holds the non-secret bits (host `mail.infomaniak.com`, port
`587`, STARTTLS). For implicit TLS instead, set `SMTP_PORT=465` and
`SMTP_SECURE=true` there.

After deploy, wrangler prints the URL, e.g.
`https://fit-email.<account>.workers.dev`. Put that + the token into the app's
env (GitHub → Settings → Variables, and local `.env.local`):

```
VITE_EMAIL_WORKER_URL=https://fit-email.<account>.workers.dev
VITE_EMAIL_RELAY_TOKEN=<the RELAY_TOKEN you set>
```

The app's "Send via email" button then routes through this Worker (attaching
the PDF) instead of EmailJS. If `VITE_EMAIL_WORKER_URL` is unset, the app falls
back to EmailJS (or the button stays disabled).

## Test

```bash
curl -X POST https://fit-email.<account>.workers.dev \
  -H "Content-Type: application/json" -H "X-Relay-Token: <token>" \
  -d '{"to":"you@example.com","toName":"Test","subject":"FIT test","message":"Hello from the worker"}'
```
