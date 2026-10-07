// Keeps a dish's name and description true after the condition/allergy rules
// change its ingredients (dietaryRules → processOption). Without this a dish
// could list feta while its description still says "with cheddar cheese", or
// be called "Cottage Cheese with Apple and Honey" after the apple was swapped
// and the honey removed.
//
// Each rule pairs an ingredient change with how that ingredient is worded in
// dish text, in English and Arabic. Three kinds of edit:
//   word    a different food: replace the word (cheddar → feta)
//   adj     a variant of the same food: qualify it (lactose-free cheddar)
//   remove  the ingredient was taken out: drop the word, tidy the sentence
// Names are title case ("Lactose-Free Cottage Cheese"), descriptions sentence
// case. Arabic nouns are matched with an attached و/ب/ل/ف and ال, which are
// kept; Arabic adjectives come in a definite and an indefinite form to agree
// with their noun, and go after a following definite word so a construct
// phrase ("باستا الدجاج") isn't split.

// Arabic letters and diacritics only — not Arabic punctuation such as "،".
const AR_LETTER = 'ء-ْٱ-ۓ'

// ── English ──────────────────────────────────────────────────────────────────
const titleCase = (t) => t.replace(/(^|[\s-])([a-z])/g, (m, sep, c) => sep + c.toUpperCase())
const sentenceStart = (s, offset) => offset === 0 || /[.!?]\s*$/.test(s.slice(0, offset))

// Replace with a different word (string or function of the match).
function enWord(re, replacement) {
  return (s, { title }) => s.replace(re, (m, ...rest) => {
    const offset = rest[rest.length - 2]
    let r = typeof replacement === 'function' ? replacement(m) : replacement
    if (title) r = titleCase(r)
    else if (sentenceStart(s, offset) || /^[A-Z]/.test(m)) r = r.charAt(0).toUpperCase() + r.slice(1)
    return r
  })
}

// Put an adjective in front of the match ("feta" → "low-salt feta"). In a name
// the adjective leads the whole noun phrase the match ends, so "Avocado Toast"
// becomes "Gluten-Free Avocado Toast" rather than "Avocado Gluten-Free Toast".
function enAdj(re, adj) {
  return (s, { title }) => {
    if (s.toLowerCase().includes(adj.toLowerCase())) return s
    if (title) {
      const at = new Set()
      for (const m of s.matchAll(re)) {
        const head = s.slice(0, m.index)
        const sep = /(?:^|\s(?:with|and|in|of|&)\s|,\s)(?!.*(?:\s(?:with|and|in|of|&)\s|,\s))/i.exec(head)
        at.add(sep ? sep.index + sep[0].length : 0)
      }
      return [...at].sort((a, b) => b - a)
        .reduce((out, i) => `${out.slice(0, i)}${titleCase(adj)} ${out.slice(i)}`, s)
    }
    return s.replace(re, (m, ...rest) => {
      const offset = rest[rest.length - 2]
      if (sentenceStart(s, offset)) {
        const rest0 = /^Greek/.test(m) ? m : m.charAt(0).toLowerCase() + m.slice(1)
        return `${adj.charAt(0).toUpperCase()}${adj.slice(1)} ${rest0}`
      }
      return `${adj} ${m}`
    })
  }
}

// Remove an item (with optional words like "a drizzle of" before it) from a
// list, keeping the list grammatical:
//   "spinach, tomato and onion"  → "spinach and tomato"
//   "in tomato sauce with onions" → "in tomato sauce"
//   "onions and olive oil"        → "olive oil"
function enRemove(word, qualifiers = '') {
  const item = `(?:${qualifiers})?${word}\\b`
  return (s) => {
    // A later list item: drop it with its separator; the item now last gets "and".
    let m = new RegExp(`(\\s*,\\s*|\\s+and\\s+)${item}`, 'i').exec(s)
    if (m) {
      let before = s.slice(0, m.index)
      const after = s.slice(m.index + m[0].length)
      if (/and/i.test(m[1])) {
        const clauseStart = Math.max(before.lastIndexOf(' with '), before.lastIndexOf('. '), 0)
        const comma = before.lastIndexOf(', ')
        if (comma > clauseStart) before = `${before.slice(0, comma)} and ${before.slice(comma + 2)}`
      }
      return before + after
    }
    // The only item after "with": drop "with" too.
    // A comma before a new clause ("with onions, served with rice") still counts.
    m = new RegExp(`\\s+(?:topped |served |cooked )?with\\s+${item}(?!\\s*(?:,(?!\\s*(?:served|finished|topped|cooked|with)\\b)|and\\b))`, 'i').exec(s)
    if (m) return s.slice(0, m.index) + s.slice(m.index + m[0].length)
    // A first list item: drop it with the separator after it.
    return s.replace(new RegExp(`${item}(?:\\s*,\\s*|\\s+and\\s+)?`, 'i'), '')
  }
}

function enTidy(s) {
  return s
    .replace(/\s+,/g, ',').replace(/,(\s*,)+/g, ',')
    .replace(/,?\s+(?:and|with)\s*([.,]|$)/gi, '$1')
    .replace(/,\s*\./g, '.').replace(/,\s*$/, '')
    .replace(/\s{2,}/g, ' ').trim()
}

// ── Arabic ───────────────────────────────────────────────────────────────────
const arNoun = (word) => new RegExp(`(?<![${AR_LETTER}])([وبلف]?)(ال)?(${word})(?![${AR_LETTER}])`, 'g')

function arWord(word, replacement) {
  return (s) => s.replace(arNoun(word), (m, pre, al, w) =>
    `${pre}${al || ''}${typeof replacement === 'function' ? replacement(w) : replacement}`)
}

// Add an adjective after the noun — after the next word instead if that word
// is definite (a construct partner or a definite adjective), so
// "باستا الدجاج" → "باستا الدجاج الخالية…" and "الشوفان المطحون" → "الشوفان المطحون الخالي…".
// A following descriptive adjective is skipped the same way: "لبن يوناني كريمي خالٍ…".
const AR_DESCRIPTIVE = 'محمص|محمّص|كريمي|دافئ'
function arAdj(word, [definite, indefinite]) {
  const re = new RegExp(`(?<![${AR_LETTER}])([وبلف]?)(ال)?(${word})(?![${AR_LETTER}])( ال[${AR_LETTER}]+| (?:${AR_DESCRIPTIVE})(?![${AR_LETTER}]))?`, 'g')
  return (s) => {
    if (s.includes(definite) || s.includes(indefinite)) return s
    return s.replace(re, (m, pre, al, w, next) =>
      `${m} ${al || /^ ال/.test(next || '') || /(^|\s)ال/.test(w) ? definite : indefinite}`)
  }
}

// A definite noun goes with the definite adjectives after it ("الفطر المقلي").
function arRemove(word, qualifiers = '') {
  const noun = `(?:ال(?:${word})(?![${AR_LETTER}])(?:\\s+ال[${AR_LETTER}]+)*|(?:${word})(?![${AR_LETTER}]))`
  const later = new RegExp(`\\s+و(?:${qualifiers})?${noun}`)
  const first = new RegExp(`(?:${qualifiers})?${noun}\\s*و?`)
  return (s) => {
    const out = s.replace(later, '')
    return out !== s ? out : s.replace(first, '')
  }
}

function arTidy(s) {
  return s
    .replace(/مع\s+و/g, 'مع ')
    .replace(/\s+و\s*([،.]|$)/g, '$1')
    .replace(/(?:،\s*)+،/g, '،').replace(/\s+([،.])/g, '$1')
    .replace(/\s+(?:مع|مقدمة مع|مقدم مع)\s*([،.]|$)/g, '$1')
    .replace(/،\s*\./g, '.').replace(/\s{2,}/g, ' ').trim()
}

// ── The rules: [from ingredient, to ingredient (null = removed), en, ar] ──────
const NOT_PLANT = '(?<!almond )(?<!coconut )(?<!cashew )(?<!oat )'
const GF = ['الخالي من الغلوتين', 'خالٍ من الغلوتين']
const GF_F = ['الخالية من الغلوتين', 'خالية من الغلوتين']
const LF_F = ['الخالية من اللاكتوز', 'خالية من اللاكتوز']
const LF = ['الخالي من اللاكتوز', 'خالٍ من اللاكتوز']
const RULES = [
  // Different foods
  [/^cheddar$/, /^cheese feta$/, [enWord(/cheddar/gi, 'feta')], [arWord('شيدر', 'فيتا')]],
  [/^cheddar$/, /^cheese mozzarella$/, [enWord(/cheddar(?: cheese)?/gi, 'mozzarella')], [arWord('شيدر', 'موزاريلا')]],
  [/^bulgur/, /^quinoa/, [enWord(/bulgur/gi, 'quinoa')], [arWord('برغل', 'كينوا')]],
  [/^apple/, /^strawberries$/, [enWord(/apple slices|apples?/gi, 'strawberries')],
    [(s) => s.replace(/شرائح\s+(ال)?تفاح/g, (m, al) => `${al || ''}فراولة`), arWord('تفاح', 'فراولة')]],
  [/^cooked noodles$/, /^rice noodles/, [enWord(/(?<!rice )noodles?/gi, (m) => `rice ${m.toLowerCase()}`)],
    [(s) => s.replace(arNoun('نودلز'), (m, pre) => `${pre}نودلز الأرز`)]],
  // Lower-fat versions
  [/^(greek yogurt full fat|plain greek yogurt)$/, /^greek yogurt 0% fat$/, [enAdj(/greek yogurt/gi, 'fat-free')],
    [arAdj('(?:لبن|زبادي) (?:ال)?يوناني', ['الخالي من الدسم', 'خالي الدسم'])]],
  [/^milk, full fat$/, /^milk, half skimmed$/, [enAdj(new RegExp(`${NOT_PLANT}\\bmilk\\b`, 'gi'), 'low-fat')],
    [arAdj('حليب(?! (?:ال)?لوز)', ['قليل الدسم', 'قليل الدسم'])]],
  [/^butter$/, /^butter, reduced-fat$/, [enAdj(/(?<!peanut )(?<!almond )\bbutter\b(?!ed)/gi, 'reduced-fat')],
    [arAdj('زبدة(?! (?:ال)?(?:فول|لوز))', ['قليلة الدسم', 'قليلة الدسم'])]],
  // Lactose-free, low-salt and gluten-free versions
  [/^cheddar$/, /^cheddar, lactose-free$/, [enAdj(/cheddar/gi, 'lactose-free')],
    [arAdj('جبنة (?:ال)?شيدر', LF_F), arAdj('(?<!جبنة (?:ال)?)شيدر', LF)]],
  [/^cheese feta$/, /^cheese feta, low-salt$/, [enAdj(/feta/gi, 'low-salt')], [arAdj('فيتا', ['قليلة الملح', 'قليلة الملح'])]],
  [/^cheese feta$/, /^cheese feta, lactose-free$/, [enAdj(/feta/gi, 'lactose-free')], [arAdj('فيتا', LF_F)]],
  [/^cheese mozzarella$/, /^cheese mozzarella, lactose-free$/, [enAdj(/mozzarella/gi, 'lactose-free')], [arAdj('موزاريلا', LF_F)]],
  [/^labneh$/, /^labneh, lactose-free$/, [enAdj(/labneh/gi, 'lactose-free')], [arAdj('لبنة', LF_F)]],
  [/^cottage cheese/, /^cottage cheese, lactose-free$/, [enAdj(/cottage cheese/gi, 'lactose-free')], [arAdj('جبنة (?:ال)?قريش', LF_F)]],
  [/^milk/, /^milk, lactose free/, [enAdj(new RegExp(`${NOT_PLANT}\\b(?:low-fat |skim )?milk\\b`, 'gi'), 'lactose-free')],
    [arAdj('حليب(?! (?:ال)?لوز)', LF)]],
  [/yogurt/, /^yogurt, lactose free$/, [enAdj(/(?:fat-free )?(?:greek )?yogurt/gi, 'lactose-free')],
    [arAdj('(?:لبن|زبادي)(?: (?:ال)?يوناني)?', LF)]],
  [/pita/, /^gluten-free pita bread$/, [enWord(/whole[- ]?wheat pita/gi, 'gluten-free pita'), enAdj(/pita/gi, 'gluten-free')],
    [arWord('خبز (?:ال)?قمح الكامل', `خبز ${GF[1]}`), arAdj('خبز (?:ال)?بيتا', GF)]],
  [/bread/, /^gluten-free bread$/, [enWord(/whole[- ]?wheat (?:bread|toast)/gi, (m) => `gluten-free ${m.split(/\s+/).pop().toLowerCase()}`), enAdj(/\b(?:bread|toast)\b/gi, 'gluten-free')],
    [arWord('(?:خبز|توست) (?:ال)?قمح الكامل', (w) => `${w.split(' ')[0]} ${GF[1]}`), arAdj('توست|خبز', GF)]],
  [/oats/, /^oats, dry gluten free$/, [enAdj(/(?:rolled )?oat(?:s|meal)\b/gi, 'gluten-free')], [arAdj('شوفان', GF)]],
  [/pasta/, /^pasta, gluten free/, [enAdj(/pasta/gi, 'gluten-free')], [arAdj('باستا|معكرونة|مكرونة', GF_F)]],
  // Removed ingredients
  [/^honey$/, null, [enRemove('honey', 'a (?:small )?(?:drizzle|touch|bit) of |a little ')],
    [arRemove('عسل', 'رشة(?: من)? |قليل من |لمسة من ')]],
  [/onions?|red onion/, null, [enRemove('onions?', 'caramelized |chopped ')], [arRemove('بصل(?: مكرمل)?')]],
  [/^olives/, null, [enRemove('olives', 'green |black ')], [arRemove('زيتون(?: (?:ال)?أخضر)?(?<!زيت (?:ال)?زيتون)')]],
  [/^mushrooms/, null, [enRemove('mushrooms', '(?:butter-)?sautéed ')], [arRemove('فطر(?: مقلي بالزبدة)?')]],
]

/**
 * Rewrite a dish's name and description (EN + AR) for the ingredient changes
 * processOption made. `swaps` is processOption's list: { from, to, removed }.
 * Mutates and returns the option.
 */
export function rewriteDishText(opt, swaps = []) {
  if (!swaps.length) return opt
  const lower = (v) => String(v || '').trim().toLowerCase()
  for (const sw of swaps) {
    const from = lower(sw.from)
    const to = sw.removed ? null : lower(sw.to)
    const rule = RULES.find(([f, t]) => f.test(from) && (t === null ? to === null : to !== null && t.test(to)))
    if (!rule) continue
    const [, , en, ar] = rule
    for (const [k, title] of [['name_en', true], ['desc_en', false]]) {
      if (opt[k]) opt[k] = enTidy(en.reduce((s, edit) => edit(s, { title }), opt[k]))
    }
    for (const k of ['name_ar', 'desc_ar']) if (opt[k]) opt[k] = arTidy(ar.reduce((s, edit) => edit(s), opt[k]))
  }
  return opt
}
