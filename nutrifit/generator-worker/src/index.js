// Cloudflare Worker: catalog-based diet-plan generator API.
//
// POST /generate  — body: {
//   dietaryTypeId, secondaryTypeId, goal ('lose'|'gain'|'maintain'),
//   kilocalorieNeeded, allergyNames?, conditionNames?, firstName?, lastName?
// }
// Returns the FIT /v3/generate response shape (foodDishByCategoryMap …) built
// from our curated catalog, so any site that already renders the FIT response
// can use it as a drop-in — same JSON, realistic meals.
//
// Reuses the exact same generator the NutriFIT app runs (single source of truth
// for the meal catalog + scaling), imported from the app source.

import { generateCatalogPlan, toFitDietPlanResponse } from '../../src/lib/catalogGenerator.js'
import { goalAdjustedKcal } from '../../src/lib/planModel.js'

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin')
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })

    const url = new URL(request.url)
    if (request.method !== 'POST' || !url.pathname.endsWith('/generate')) {
      return json({ error: 'Use POST /generate' }, 405, origin)
    }

    let body
    try { body = await request.json() } catch { return json({ error: 'invalid JSON' }, 400, origin) }

    const goal = body.goal || 'maintain'
    const rawKcal = parseFloat(body.kilocalorieNeeded) || 0
    if (!rawKcal) return json({ error: 'kilocalorieNeeded is required' }, 400, origin)

    // The client actually eats the goal-adjusted amount (−500 lose / +500 gain);
    // generate meals at that level but echo back the raw TDEE for header display.
    const dailyKcal = goalAdjustedKcal(rawKcal, goal)

    try {
      const { plan } = await generateCatalogPlan(
        { dietaryTypeId: body.dietaryTypeId || '', secondaryTypeId: body.secondaryTypeId || '' },
        { allergyNames: body.allergyNames || [], conditionNames: body.conditionNames || [] },
        { dailyKcal, fullName: [body.firstName, body.lastName].filter(Boolean).join(' ') },
      )
      return json(toFitDietPlanResponse(plan, { kcalTotalNeeded: rawKcal }), 200, origin)
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500, origin)
    }
  },
}
