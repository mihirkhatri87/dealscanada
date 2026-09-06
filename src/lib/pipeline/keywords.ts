/**
 * Shopper vocabulary for products retailers name differently.
 *
 * Search matches the words a merchant chose. Shoppers type the words they use,
 * and the two are routinely not the same: Structube sells a table called a
 * "MARCO Console", so a search for "table" returns nothing and the deal may as
 * well not be in the database. The retailer is not being obtuse — "console" is
 * the trade term — but nobody furnishing a room searches for one.
 *
 * So each deal carries the plain words for what it actually is, derived once at
 * ingest and matched at query time alongside the title.
 *
 * Rule-based for the same reasons `classify.ts` is: deterministic, instant,
 * inspectable, and fixed by editing a list rather than retraining anything. A
 * wrong keyword is a line someone can delete.
 *
 * The rule for adding an entry: the term must be what a shopper would *type*,
 * and the patterns must be things that genuinely are one. "Console" is a table.
 * A "console" is also a games machine, which is why the furniture patterns
 * require furniture context rather than the bare word.
 */

export interface KeywordRule {
  /** The plain word a shopper searches for. */
  term: string;
  patterns: RegExp[];
}

export const KEYWORD_RULES: KeywordRule[] = [
  {
    term: 'table',
    patterns: [
      // Console tables, sideboards and buffets are tables to everyone but a
      // furniture catalogue. "Console" alone is ambiguous with games hardware,
      // so it has to look like furniture.
      /\bconsole\s+(?:table|desk)\b/i,
      /\bconsole\b(?=.*\b(?:wood|oak|walnut|marble|drawer|shelf|entryway|hallway|living)\b)/i,
      /\b(?:sideboard|buffet|credenza|bureau)\b/i,
      /\b(?:nightstand|night stand|bedside)\b/i,
      /\b(?:coffee|dining|dinette|bistro|accent|end|side|coctail|cocktail)\s+table\b/i,
      /\btables?\b/i,
      /\bdesks?\b/i,
    ],
  },
  {
    term: 'sofa',
    patterns: [
      /\b(?:sofa|couch|settee|davenport|chesterfield)\b/i,
      /\b(?:sectional|loveseat|love seat|futon|divan)\b/i,
    ],
  },
  {
    term: 'chair',
    patterns: [
      /\bchairs?\b/i,
      /\b(?:stool|bar ?stool|counter ?stool|recliner|armchair|arm chair)\b/i,
      /\b(?:ottoman|pouf|poof|footstool)\b/i,
      /\bbenche?s?\b/i,
    ],
  },
  {
    term: 'storage',
    patterns: [
      /\b(?:dresser|chest of drawers|armoire|wardrobe|chiffonier)\b/i,
      /\b(?:bookcase|bookshel(?:f|ves)|shelving|cabinet|cupboard)\b/i,
      // No \b: JavaScript word boundaries are ASCII-only, so \bétagère can
      // never match — the boundary needs a word character and "é" is not one.
      // These words are distinctive enough not to need the anchor.
      /[eé]tag[eè]re/i,
      /\b(?:tv stand|media (?:unit|console|centre|center)|entertainment (?:unit|centre|center))\b/i,
    ],
  },
  {
    term: 'bed',
    patterns: [
      /\b(?:bed ?frame|headboard|bunk bed|daybed|day bed|platform bed)\b/i,
      /\b(?:mattress|box ?spring)\b/i,
      /\bbeds?\b/i,
    ],
  },
  {
    term: 'bedding',
    patterns: [
      /\b(?:duvet|douillette|comforter|coverlet|quilt|sham|pillowcase)\b/i,
      /\b(?:sheet set|fitted sheet|flat sheet|bedding|bed linen)\b/i,
    ],
  },
  {
    term: 'lamp',
    patterns: [
      /\b(?:lamps?|sconce|chandelier|pendant light|floor lamp|table lamp)\b/i,
      /\b(?:luminaire|light fixture|lighting)\b/i,
    ],
  },
  {
    term: 'rug',
    patterns: [/\b(?:rugs?|carpet|runner|broadloom|tapis)\b/i, /\b(?:doormat|door mat)\b/i],
  },
  {
    term: 'curtains',
    patterns: [/\b(?:curtains?|drapes?|drapery|blinds?|valance|sheers?)\b/i],
  },
  {
    term: 'mirror',
    patterns: [/\bmirrors?\b/i, /\bmiroirs?\b/i],
  },
  {
    term: 'laptop',
    patterns: [/\b(?:laptops?|notebook computer|macbook|chromebook|ultrabook)\b/i],
  },
  {
    term: 'tv',
    patterns: [/\b(?:televisions?|smart tv|\btvs?\b|oled|qled|t[ée]l[ée]viseur)\b/i],
  },
  {
    term: 'headphones',
    patterns: [
      /\b(?:headphones?|earbuds?|earphones?|headsets?)\b/i,
      // Accent-initial, so no \b — see the étagère note above.
      /[eé]couteurs/i,
    ],
  },
  {
    term: 'coat',
    patterns: [
      /\b(?:coats?|jackets?|parkas?|anoraks?|windbreakers?|manteaux?)\b/i,
      /\b(?:puffer|shell|softshell|raincoat)\b/i,
    ],
  },
  {
    term: 'boots',
    patterns: [/\b(?:boots?|bottes?|booties|chelsea|wellington)\b/i],
  },
  {
    term: 'shoes',
    patterns: [
      /\b(?:shoes?|sneakers?|runners?|trainers?|loafers?|sandals?|flats?|heels?)\b/i,
      /\b(?:chaussures?|espadrilles?)\b/i,
    ],
  },
];

export interface KeywordInput {
  title: string;
  description?: string | null;
  /** A category label the source itself supplied. */
  sourceHint?: string | null;
}

/**
 * The plain words that describe this product.
 *
 * Returns them sorted so the stored string is stable: an unchanged product must
 * not look changed to the upsert just because a rule was reordered.
 */
export function deriveKeywords(input: KeywordInput): string[] {
  const haystack = [input.title, input.description ?? '', input.sourceHint ?? ''].join(' ');
  const found = new Set<string>();

  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) found.add(rule.term);
  }

  return [...found].sort();
}

/**
 * The stored form: space-separated, space-padded.
 *
 * Padding is what keeps a LIKE '%table%' from matching the middle of another
 * word. Searching "able" should not return every table in the catalogue, and
 * `% table %` cannot match inside `comfortable`.
 */
export function serializeKeywords(keywords: string[]): string | null {
  if (keywords.length === 0) return null;
  return ` ${keywords.join(' ')} `;
}
