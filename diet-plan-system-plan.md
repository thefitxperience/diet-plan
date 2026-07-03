# NutriFIT Workflow Platform — System Plan (v2)

A gym-facing platform wrapping the existing FIT diet plan generation engine (fit-demo questionnaire, generation API, deepFIT PDF template) in a complete workflow: client management, InBody ingestion, plan editing, dual approval (nutritionist → gym), and delivery to the client.

**Context for this version:** solo developer, zero-budget Phase 1, frontend hosted on GitHub Pages. Decisions from the demo repo (`thefitxperience/fit-demo`) and the sample InBody270 PDF are baked in below.

---

## 0. Locked Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Gym editing rights | **Approve / Reject only** (comment required on reject). All edits belong to the nutritionist. |
| 2 | WhatsApp sender | One platform number — **deferred** (not verified yet). Phase 1 uses free interim delivery (see §7). |
| 3 | Nutritionist ↔ gym | Undecided. **Design choice:** `users.gym_id` (one gym per nutritionist) for Phase 1; if multi-gym is needed later, add a `user_gyms` junction table — cheap migration, don't over-build now. |
| 4 | Generation API | Documented from the repo — full contract in §4. |
| 5 | InBody extraction | InBody270 PDFs have an **embedded text layer**. Extraction = free client-side text parsing (validated against the real sample, see §6). Tesseract.js fallback for photos. No LLM, no cost. |
| 6 | Branding | **Co-branded** PDFs: deepFIT/platform brand + gym logo. |
| 7 | Language | **Arabic + English** for both the plans AND the entire system UI (RTL support). The repo already contains the plan-translation mechanism (§8). |

---

## 1. The Core Workflow (End to End)

1. **Client visits gym**, does an InBody test → gets a PDF or printout photo.
2. **Nutritionist creates the client** (personal details + contact info for later delivery).
3. **Nutritionist uploads the InBody PDF/image.** System parses body composition (weight, SMM, fat mass, LBM/FFM, BMR, PBF, BMI, height, age, test date) and pre-fills the Body Composition step. **Nutritionist confirms/corrects every value** side-by-side with the document preview — extraction is never trusted blindly.
4. **Questionnaire** — the existing 3 steps: Personal Details (goal, activity level, dietary type, plan style), Body Composition (pre-filled), Medical Conditions & Allergies. Daily calories auto-calculated from BMR × activity, manual override allowed (as in the demo).
5. **Generate** — `POST /v3/generate` (§4) → plan data → renders in the existing deepFIT HTML template.
6. **Edit** — nutritionist edits the plan on a visual canvas of the actual PDF pages (§5).
7. **Nutritionist approval** → plan locks and enters the gym's queue.
8. **Gym approval** — approve, or reject with a mandatory comment (goes back to the nutritionist, who edits and re-submits).
9. **Delivery** — final PDF generated and sent/handed to client; delivery recorded.

### Plan Status Lifecycle

```
DRAFT → GENERATED → IN_REVIEW → NUTRITIONIST_APPROVED → GYM_APPROVED → SENT
                        ↑                                     |
                        └───────── CHANGES_REQUESTED ←────────┘
```

Every transition is logged: who, when, optional comment (audit trail — this is health-adjacent advice with two professional sign-offs).

---

## 2. Roles & Permissions

| Capability | Nutritionist | Gym Admin | Platform Admin |
|---|---|---|---|
| Create/edit clients | ✓ | view only | ✓ |
| Upload InBody & generate | ✓ | — | ✓ |
| Edit plans | ✓ | — | ✓ |
| Approve stage 1 | ✓ | — | — |
| Approve/reject stage 2 | — | ✓ | — |
| Send to client | — | ✓ | ✓ |
| Manage nutritionists | — | ✓ | ✓ |
| Manage gyms/branding/templates | — | own branding | ✓ |

Client has **no login** in Phase 1 — they just receive the PDF.

---

## 3. App Structure (role-aware sidebar, single web app)

**Nutritionist:** Dashboard (in-progress, returned-with-comments, recently sent) · Clients (table + profile with InBody/plan history timeline) · Plans (status-filtered, entry to editor) · Approvals (rejections to fix).

**Gym Admin:** Dashboard (pending count, activity) · Approvals (read-only full preview + Approve / Request Changes) · Clients (read-only) · Team · Settings (logo, colors, sender identity).

**Platform Admin:** Gyms · Users · Templates · API config · global activity log.

Design language: reuse the demo's teal-to-navy gradient branding; clean, functional, RTL-ready from day one (see §8 — retrofitting RTL is painful).

---

## 4. Generation API Contract (documented from the repo)

**Base:** `http://185.143.103.106:8080/rest/s1/fit/dietPlan`
**Proxy (required for GitHub Pages — API is HTTP, pages are HTTPS):** existing Cloudflare Worker `https://fit-proxy.andyayas27.workers.dev` (free tier, adds CORS, forwards to `ov-9a74e5.infomaniak.ch:8080`). Keep using it.
**Auth:** `Authorization: Basic base64("fit:Fit@2024")` — ⚠️ currently hardcoded in client JS. Acceptable for now; §10 notes the fix (move auth into the Worker).

**Lookup endpoints (GET):** `/dietaryType`, `/activity`, `/condition`, `/allergy`, `/planType`, `/planSecondaryType` → populate dropdowns (dietary types, activity levels, conditions, allergies, goals, plan styles).

**Generate:** `POST /v3/generate`

```json
{
  "firstName": "…", "lastName": "…",
  "gender": "M" | "F",
  "dateOfBirth": "YYYY-MM-DD", "age": 26,
  "activityLevelTypeEnumId": "<from /activity>",
  "dietaryTypeId": "<from /dietaryType>",
  "typeId": "<goal id>", "secondaryTypeId": "<plan style id>",
  "height": 175, "weight": 76.2,
  "muscleMass": 35.2, "fatMass": 14.6,
  "bmr": "1700", "lbm": "61.6",
  "kilocalorieNeeded": 2400,
  "conditionIdSet": ["…"], "conditionNote": "",
  "allergyIdSet": ["…"]
}
```

**Response shape (what the editor's data model must wrap):**

```
{
  fullName, testDate,
  foodDishByCategoryMap: {
    Breakfast | Lunch | Dinner | Snack: {
      <groupId>: {                      // e.g. "100000", "LeanProtein", "HealthyFat"
        <classification>: [             // e.g. "HighProtein", "HighFiber"
          {
            foodDishName, description,
            kilocaloriePerServe,
            ingredientList: [{ ingredientName, quantity, quantityUomId /* "WT_g" */ }],
            macronutrientList: [{ macronutrientId /* Protein | Carbohydrates | Healthy_Fats */, quantityPerServe }]
          }
        ]
      }
    }
  }
}
```

The demo flattens this into ≤7 rows per meal table. The editor should normalize it into a flat editable structure (§5) and keep the original response for reference/regeneration diffing.

---

## 5. Plan Editor (the centerpiece)

- **Center canvas:** plan rendered with the existing deepFIT template HTML/CSS at true page proportions — what you edit is exactly what ships.
- **Left panel:** page thumbnails (cover/breakfast, lunch, dinner, snacks, guidelines ×2).
- **Right panel:** contextual inspector — click a meal option to edit name, description, ingredients (+ grams), macros; header fields (name, date, next check-up, daily calories, diet type) editable too.
- **Structured editing, not contenteditable.** Internal model:

```
plan = {
  header: { fullName, dob, testDate, nextCheckup, dailyKcal, dietType },
  meals: [{ id: "breakfast", targetKcal, options: [{
      name_en, name_ar, desc_en, desc_ar,
      ingredients: [{ name_en, name_ar, grams }],
      macros: { protein, carbs, fats }, kcal
  }]}],
  guidelines: { … static template content, per language … }
}
```

  Edits mutate this object; the template re-renders. Enables kcal auto-recalc warnings, allergen flags, and clean PDF output.
- **Meal option actions:** edit, remove, reorder, add (blank or duplicated). A meal library sourced from regeneration results can come later.
- **Actions:** Save draft · Regenerate (confirm — discards edits) · Preview PDF · Submit for Gym Approval.
- **Bilingual editing:** the option edit form shows EN and AR fields side by side. Auto-fill AR from the existing dictionary (§8) when a match exists; highlight untranslated fields. (Dictionary lookup only works on known names — free-text English edits won't magically translate.)

---

## 6. InBody Extraction — Validated Spec (free, client-side)

**Finding:** the sample InBody270 PDF has an embedded text layer. So:

1. **PDF path (primary):** extract text client-side with **pdf.js** → regex/anchor parsing. Free, instant, exact.
2. **Image path (fallback):** photo of printout → **Tesseract.js** in-browser OCR → same parsing. Free; lower confidence → UI flags low-confidence fields.
3. **Always** show extracted values in an editable review panel next to the document preview; nutritionist confirms before values enter the questionnaire. Manual entry always available.

**Field mapping (validated against Test_inbody_01.pdf — all values matched):**

| Field | Anchor / pattern (on extracted text) | Sample |
|---|---|---|
| ID, height, age, test date/time | `(\d+)\s+(\d{2,3}(?:\.\d)?)cm\s+(\d{1,3})\s+(\d{2}\.\d{2}\.\d{4})\.?\s+(\d{2}:\d{2})` | 0537951117 / 175 / 26 / 19.07.2023 21:41 |
| Weight & Body Fat Mass | Composition rows in fixed order — `\((?:L|kg)\)\s*(\d+\.?\d*)\(` → [TBW, Protein, Minerals, **FatMass**, **Weight**] | 14.6 / 76.2 |
| SMM (→ "Muscle Mass" in the form) | value on line after the **2nd** `(kg) <scale> %` bar row | 35.2 |
| LBM (Fat Free Mass) | `(\d+\.?\d*)kg\s+\d+\.?\d*~\d+\.?\d*` | 61.6 |
| BMR | `(\d{3,4})kcal\s+\d+~\d+` | 1700 |
| PBF % | value preceding obesity degree `…\s+\d+%\s+90~110` | 19.2 |
| BMI | line pattern `(\d+\.?\d*)\s+\d+\.?\d*kg\s+…` | 24.9 |
| InBody Score | standalone 2–3 digit line near composition block | 81 |

Notes: **gender is not reliably in the text layer — take it from the client record**, and cross-check the InBody age/height against the client profile, warning on mismatch (wrong client's file is a real failure mode). Store the original file with the extraction result. Other InBody models (570/970) have different layouts — the parser should be a per-model strategy map keyed on the `[InBody270]` marker in the text; add models as real samples arrive.

---

## 7. Phase 1 Architecture — Free Stack, Solo Dev

GitHub Pages only hosts static files, but the workflow needs auth, a database, and file storage. The free solution:

| Concern | Choice | Why |
|---|---|---|
| Frontend | Static SPA on **GitHub Pages** (React + Vite recommended; the 6,700-line single index.html will not survive an editor + approvals + i18n — componentize) | Your chosen host, free |
| DB + Auth + File storage | **Supabase free tier** | Postgres, email/password auth, storage buckets, and **Row Level Security** — callable directly from a static frontend, no server needed. 500 MB DB / 1 GB storage free |
| Generation API access | Existing **Cloudflare Worker** proxy | Already built, free tier |
| InBody parsing | **pdf.js** + **Tesseract.js**, in-browser | Free, no server |
| PDF output | **html2canvas + jsPDF** client-side (already in the demo's Download button) | Free, reuses existing code |
| Delivery (interim) | ① Download PDF + **wa.me deep link** with pre-filled message (nutritionist/gym attaches the PDF manually in WhatsApp) ② **EmailJS** free tier (~200 emails/mo) with a plan link or attachment ③ record delivery in DB regardless | Zero cost until the WhatsApp Business number is verified |

**Security model without a backend:** all authorization lives in Supabase **RLS policies** — e.g. nutritionists can only read/write rows where `gym_id` matches their profile; only `status = NUTRITIONIST_APPROVED` rows are updatable by gym admins, and only to `GYM_APPROVED`/`CHANGES_REQUESTED`. Status transitions enforced with a Postgres trigger or an RPC function, not client code. This matters: with no server, RLS *is* the security.

**Multi-tenancy:** single DB, `gym_id` on every table, enforced by RLS.

---

## 8. Bilingual System (EN + AR)

**System UI:** i18n from day one — `en.json` / `ar.json` dictionaries, a language switcher, and `dir="rtl"` + logical CSS properties (`margin-inline-start`, not `margin-left`). Retrofitting RTL later is the single most expensive mistake available here.

**Plan content:** the repo already solves this — reuse it:
- `assets/translations-ar.json` with `ui` (41), `food` (70), `descriptions` (70), `ingredients` (97), `paragraphs` (7), `listItems` (50) — dictionary EN→AR for template UI text, dish names, descriptions, ingredients, and guideline text.
- Existing RTL CSS overrides + Arabic-Indic numeral conversion (incl. the html2canvas `arabic-indic` list workaround) in index.html — port these into the new template component.
- `fill_translations.py` maintains the dictionary from translation template spreadsheets — keep as the translation upkeep workflow.

**In the new system:** plan data stores `_en`/`_ar` per text field (§5). On generation, auto-fill AR via dictionary; the editor flags missing translations; the send panel lets you output the PDF in EN, AR, or both. The language toggle from the demo becomes an editor/preview control.

---

## 9. Data Model (Supabase tables)

- **gyms** — name, logo_url, brand_colors, contact
- **profiles** — auth user id, role (`nutritionist` | `gym_admin` | `platform_admin`), gym_id, name
- **clients** — gym_id, created_by, first/last name, dob, gender, phone, email, notes, consent flag
- **inbody_results** — client_id, file (storage path), source_type (`pdf_text` | `ocr`), extracted JSON, confirmed JSON, model (`InBody270`…), test_date
- **plans** — client_id, inbody_result_id, questionnaire JSON, plan_data JSON (§5 model, both languages), status, version, api_response JSON (raw)
- **plan_events** — plan_id, actor, action (`generated` | `edited` | `submitted` | `approved_gym` | `rejected` | `sent`), comment, timestamp
- **deliveries** — plan_id, channel (`download` | `whatsapp_link` | `email`), recipient, language, pdf storage path (immutable snapshot of what was sent), status

---

## 10. Build Order (Phase 1 — what you're building now)

1. **Scaffold:** Vite + React, GitHub Pages deploy (gh-pages action), Supabase project, auth + role-based routing, i18n skeleton (EN/AR + RTL).
2. **Clients:** CRUD + profile page with history timeline.
3. **InBody:** upload to Supabase storage → pdf.js/Tesseract parse → confirmation panel → save `inbody_results`.
4. **Questionnaire + generation:** port the 3 steps from the demo (pre-filled from client + InBody), lookups + `/v3/generate` via the Worker, save plan.
5. **Template component:** port the deepFIT HTML/CSS into a React component rendering from the structured plan model (both languages) — this single component powers the editor canvas, approval preview, and PDF export.
6. **Editor:** thumbnails, inspector, kcal/allergen warnings, save/submit.
7. **Approvals:** gym queue, preview, approve/reject with comment, RLS-enforced transitions, event log.
8. **Delivery:** client-side PDF export (immutable copy to storage), wa.me link + EmailJS, delivery record.
9. **Dashboards** last — they're just queries over the above.

**Phase 2 (when budget/verification exists):** WhatsApp Business API via the verified platform number (start Meta verification early — it takes weeks), server-side PDF (Puppeteer) for pixel-perfect output, notifications, meal library, InBody progress comparisons, client read-only plan links, analytics.

## 11. Known Debts to Track (fine for now, don't forget)

- API Basic-auth credentials visible in client JS → move the `Authorization` header injection into the Cloudflare Worker and remove it from the frontend.
- html2canvas PDFs are rasterized (bigger files, text not selectable) → Puppeteer in Phase 2.
- EmailJS exposes its public key client-side and has monthly caps → transactional provider in Phase 2.
- Health data on free tiers: add the consent checkbox at client creation, and keep the audit log from day one.
- Only InBody270 parsing is validated — collect samples of any other machines gyms use before promising support.
