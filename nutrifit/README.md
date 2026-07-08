# NutriFIT Workflow Platform

Gym-facing platform wrapping the FIT diet-plan generation engine in a complete
workflow: client management → InBody ingestion → questionnaire → generation →
visual plan editing → dual approval (nutritionist → gym) → delivery to the
client. Bilingual (EN/AR, full RTL). Phase 1 runs entirely on free tiers:
GitHub Pages (static SPA) + Supabase (auth/DB/storage/RLS) + the existing
Cloudflare Worker proxy.

Implements `../diet-plan-system-plan.md` (v2).

## Stack

| Concern | Choice |
|---|---|
| Frontend | React + Vite SPA, HashRouter (GitHub Pages-safe deep links) |
| DB / Auth / Files | Supabase free tier — **RLS is the security model** (no backend) |
| Generation API | `POST /v3/generate` via Cloudflare Worker |
| InBody parsing | pdf.js text layer (validated on the real InBody270 sample) + Tesseract.js OCR fallback |
| PDF output | html2canvas + jsPDF, client-side; snapshot uploaded to storage on delivery |
| Delivery (interim) | Download + wa.me deep link · EmailJS (optional) · recorded in `deliveries` |

## Setup (one-time, ~15 minutes)

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com) (free tier).
2. SQL Editor → run, in order:
   - `supabase/migrations/001_schema.sql` (tables, enums, storage buckets)
   - `supabase/migrations/002_rls.sql` (row-level security policies)
   - `supabase/migrations/003_functions.sql` (status-transition RPC, profile bootstrap)
   - `supabase/migrations/004_self_signup.sql` (self-service signup + approval)
3. Authentication → Providers → Email: enable. (Disable "Confirm email" for
   the fastest start, or keep it on — both work.)

### 2. Local env

```bash
cp .env.example .env.local 
npm install
npm run dev
```

### 3. First user & self-service signup

No manual SQL to add people — everyone signs up and picks a role:

1. **First user:** sign up in the app. The very first account is bootstrapped
   to **`platform_admin`** automatically (onboarding detects an empty system).
2. As platform admin you can create gyms up front (**Gyms**), or let gym
   owners create their own on signup.
3. **Everyone after that**, on first login, chooses a role in the onboarding
   screen:
   - **Nutritionist** → picks their gym → account is **pending** until that
     **gym's admin** approves them (gym admin's **Team** page).
   - **Gym owner/admin** → creates a new gym (or joins an existing one) →
     account is **pending** until the **platform admin** approves them
     (platform admin's **Users** page). Approving a gym owner who requested a
     new gym creates that gym automatically.

Pending users see a "waiting for approval" screen and have no data access
(enforced by RLS — `pending` accounts have no effective role). Approvers see a
**Pending approval** section on their Team / Users page with Approve / Reject.

### 4. GitHub Pages deploy

1. Push this folder to a GitHub repo (`main` branch).
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. Repo → Settings → Secrets and variables → Actions → **Variables**: add
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_FIT_PROXY_URL`,
   `VITE_FIT_API_USER`, `VITE_FIT_API_PASS` (+ `VITE_EMAILJS_*` if used).
4. Push — `.github/workflows/deploy.yml` builds and publishes automatically.

All `VITE_*` values ship to the browser by design; authorization lives in
Supabase RLS, not in secrecy of these values.

### 5. EmailJS (optional email delivery)

Create a service + template at [emailjs.com](https://www.emailjs.com) with
template variables `to_email`, `to_name`, `message`, `pdf_url`, then set the
three `VITE_EMAILJS_*` vars. Without them the email button stays disabled;
WhatsApp + download delivery work regardless.

## The workflow

```
DRAFT → GENERATED → IN_REVIEW → NUTRITIONIST_APPROVED → GYM_APPROVED → SENT
            ↑                                  |
            └───────── CHANGES_REQUESTED ←─────┘
```

1. Nutritionist creates the client (consent checkbox required).
2. Uploads InBody PDF/photo → values extracted client-side → **confirms every
   value** side-by-side with the document (age cross-checked against profile).
3. Questionnaire (3 steps, pre-filled from client + InBody; calories =
   BMR × activity, override allowed) → Generate.
4. Editor: true-proportion deepFIT pages, click any meal option to edit
   (EN/AR side-by-side, ingredients, macros), kcal-deviation + allergen
   warnings, missing-AR highlighting with dictionary autofill.
5. Submit → gym admin's Approvals queue → approve or reject (comment
   mandatory; plan returns to the nutritionist).
6. Gym admin delivers: PDF rendered client-side, immutable copy stored in the
   `plan-pdfs` bucket, wa.me/EmailJS/download, delivery recorded.

Status transitions are enforced **server-side** by the `transition_plan()`
RPC — a trigger blocks direct status updates — and every transition is logged
to `plan_events` (who, when, comment).

## Notes & known debts (plan §11)

- FIT API basic-auth is still injected from client JS → move the header into
  the Cloudflare Worker and strip `VITE_FIT_API_*`.
- html2canvas PDFs are rasterized → server-side Puppeteer in Phase 2.
- EmailJS public key is client-side with monthly caps → transactional provider later.
- **InBody270** and **InBody380** parsing are validated against real samples,
  from both PDFs and phone photos (JPEG/PNG). Extraction tries the pdf.js text
  layer first, then falls back to Tesseract.js OCR (image files, and newer
  image-label PDF exports whose text layer is empty). The 380 sheet has no
  printed BMR, so it's estimated via Katch–McArdle (370 + 21.6 × fat-free mass).
  Other models: the parser dispatches on the `[InBodyXXX]` marker — add a
  strategy in `src/lib/inbodyParser.js` when samples arrive.
- WhatsApp Business API (verified platform number) is Phase 2 — start Meta
  verification early.
- Plan-content AR dictionary lives in `src/i18n/plan-ar.json` (English→Arabic
  for meal names, descriptions, and ingredients); maintain it by hand-editing
  the JSON as new catalog meals are added.

## Project layout

```
supabase/migrations/   schema, RLS, RPC functions (run in Supabase SQL editor)
src/lib/               supabase, fitApi (lookups+generate), planModel (§5 model),
                       inbodyParser (§6), pdfExport, delivery, i18n
src/components/        DeepFitTemplate (+ deepfit.css) — editor/preview/PDF all
                       render through this one component; Layout; ui primitives
src/pages/             Dashboard, Clients, ClientProfile, InBodyUpload, NewPlan,
                       Plans, PlanEditor, PlanView, Approvals, ApprovalDetail,
                       Team, GymSettings, AdminGyms, AdminUsers, ActivityLog
src/i18n/              en.json / ar.json (system UI), plan-ar.json (plan content)
public/assets/deep-fit deepFIT template artwork (from the demo)
```