# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

The git repo root holds source spreadsheets, sample InBody PDFs and `diet-plan-system-plan.md` (the
spec the app implements). **All application work happens in `nutrifit/`** — `cd nutrifit` first.

## Commands

```bash
cd nutrifit
npm install
npm run dev              # Vite dev server
npm run build            # production build → dist/
npm run preview          # serve dist/
```

There is **no test suite and no linter configured**. `npm run build` only catches syntax errors —
Vite does not type-check, so an undefined component or a bad prop builds cleanly and fails at
runtime. Verify UI changes by actually rendering them.

### The `VITE_BASE` trap

`vite.config.js` reads `process.env.VITE_BASE` — **Vite does not populate `process.env` from `.env`
files**, so the `VITE_BASE=/` line in `.env.local` is inert. A plain `npm run build` silently emits
`/nutrifit/` asset paths (the GitHub Pages default).

The live deployment is an Apache host serving from the domain root (`public/.htaccess` does the SPA
fallback). Build it with:

```bash
VITE_BASE=/ npm run build
```

GitHub Actions (`.github/workflows/deploy.yml`) passes `VITE_BASE` as a real env var, so that path
is fine.

### Database

Migrations in `nutrifit/supabase/migrations/` are **pasted by hand into the Supabase SQL editor**, in
filename order. There is no migration runner. Write them to be safely re-runnable — an unguarded
backfill will clobber settings an admin has since changed.

`nutrifit/supabase/maintenance/` holds one-off operational scripts (e.g. reverting an automatic
approval) for the same SQL-editor workflow.

To validate SQL before handing it over, run the migrations against a throwaway Postgres in Docker.
They need stubs for `auth.users` / `auth.uid()` / `storage.*` and the `anon`, `authenticated`,
`service_role` roles; with those in place every migration applies except `005`/`006` (demo data,
which needs real auth users) and the storage policy at the end of `002`.

### Cloudflare Workers

`email-worker/` and `generator-worker/` are separate npm projects: `npm run dev` (wrangler dev) and
`npm run deploy` in each.

## Architecture

### There is no backend — RLS is the security model

The SPA talks to Supabase directly with the anon key. Every `VITE_*` value ships to the browser by
design. All authorization lives in row-level security policies plus `SECURITY DEFINER` functions.
When adding a capability, the question is always "what does RLS allow", not "what does the UI call".

**RLS is row-level, not column-level.** `gyms_own_update` (migration 002) lets a gym admin update
their own gym row, so a new sensitive column on `gyms` is writable by them unless a trigger guards
it — see `guard_gym_auto_approve()` in `017`.

### The plan status machine is enforced in the database

```
DRAFT → GENERATED → IN_REVIEW → NUTRITIONIST_APPROVED → SENT
            ↑                            |
            └──── CHANGES_REQUESTED ←────┘
```

`transition_plan()` (current version in `013_security_fixes.sql`) is the only sanctioned way to move
status; the `plans_status_guard` trigger rejects any direct `UPDATE plans SET status` that is not
wrapped in `set_config('nutrifit.allow_transition', 'on', true)`.

**The machine only moves forward.** Nothing leaves `NUTRITIONIST_APPROVED` except `sent`, so
un-approving a plan is impossible from the app and requires SQL. `GYM_APPROVED` still exists in the
enum but the gym-approval step was removed in `008` — it is kept only so legacy rows stay
deliverable.

Every transition writes to `plan_events`. **`plan_events.actor IS NULL` means the system acted**, not
that a user is missing: `action='generated'` is a public intake submission, `action='submitted'` is
the auto-approval job. `src/lib/planEvents.js` centralises that interpretation — all four timelines
(Activity log, Dashboard, PlanView, ClientProfile) must go through it.

### Auto-approval

`auto_approve_stale_plans()` (`016`, superseded by `017`) runs hourly under pg_cron and releases
plans that are clean and stale. It fails closed: no `plan_data.checks` stamp means never released.
`017` adds a per-gym `gyms.auto_approve_enabled` switch, toggled by platform admins on the Gyms page.

### One component renders the client PDF

`src/components/DeepFitTemplate.jsx` (+ `deepfit.css`) powers the editor canvas, the approval
preview, and the exported PDF. There is no separate print path — change it once and all three move.

- **Page box: 794 × 1123 px = A4 at 96 dpi.** `min-height`, not `height`: a page is exactly A4 when
  its content fits and **grows instead of clipping** when it does not. The cover is the page that
  overruns, since it carries the identity row, target panels, assessment summary *and* the first meal
  table. `pdfExport.js` sizes each PDF page to its captured canvas, so a grown page exports taller
  than A4 rather than being scaled down.
- `densityFor()` steps a crowded meal page tighter (airy → normal → compact) before that happens.
- A dev-only console warning reports any page that runs past A4.

### html2canvas 1.4.1 constrains what CSS the PDF template may use

The delivered PDF is rasterised by html2canvas, whose CSS parser is old and throws on syntax the
browser handles fine. **Four-value `background-position` (`right -260px bottom -300px`) crashes the
export** with `Cannot read properties of undefined (reading 'type')`. That is why the page watermark
is an absolutely positioned `<img>` rather than a background image.

After any change to `deepfit.css`, actually run an export — a change can look perfect on screen and
break PDF generation entirely.

### Two separate i18n systems

| | File | Read via |
|---|---|---|
| App UI | `src/i18n/en.json`, `ar.json` | `useI18n()` → `t('key')` |
| Plan content (the PDF) | `src/i18n/plan-ar.json` | `makeT(lang)` inside `DeepFitTemplate` |

**`plan-ar.json` is keyed on the English string itself.** Editing an English string in
`deepfitGuidelines.js` silently drops its Arabic translation. Content entries therefore carry
`{ key, en }`: `key` is the dictionary lookup and must stay byte-identical; `en` is what prints in
English. Never "tidy" a `key` — change `en`.

Both languages are fully RTL-capable; use logical properties (`border-inline-start`,
`inset-inline-end`) rather than physical ones.

### Plan model

`src/lib/planModel.js` owns the structured plan and all nutrition maths (`scaleOptionToKcal`,
`validatePlan`, `buildAssessment`, meal shares).

**`meal.targetKcal` is PER OPTION, not per meal-slot.** Snacks are eaten twice (`mealServings()`), so
a 120 kcal snack takes 240 kcal out of the day. `setMealShare()` re-splits shares so they always
total 100% and clamps each meal to `MIN_MEAL_SHARE`.

### Editor

`src/pages/PlanEditor.jsx` is the largest file. Its model: **the rendered page is the editing
surface** — clicking a meal option in the preview selects it and switches the inspector to its
Editing tab. The inspector is one tabbed pane (Client / Plan / Editing) with a review panel pinned
above it; every review item links to the option or meal it is about.

## Known stale documentation

`nutrifit/README.md` is accurate on setup and deployment but out of date on workflow: it describes a
gym-approval step removed in migration `008`, pages that no longer exist (`Approvals`,
`ApprovalDetail`), and `public/assets/deep-fit/` (the PDF artwork now lives in `public/assets/plan/`).
Trust the code and migrations over the README on anything workflow-related.
