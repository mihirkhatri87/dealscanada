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
      // Not bare "runner" (a rug is one too, and "table runner" is not
      // footwear) and not bare "flat" (which is usually "flat screen").
      /\b(?:shoes?|sneakers?|trainers?|loafers?|sandals?|heels?|moccasins?)\b/i,
      /\b(?:ballet flats?|running shoes?)\b/i,
      /\b(?:chaussures?|espadrilles?)\b/i,
    ],
  },

  // Accessories and jewellery. These earn their place more than most: a listing
  // called "Hoops with Sardine and Freshwater Pearls" never says "earrings",
  // and "Raffia Tote" never says "bag".
  {
    term: 'earrings',
    patterns: [/\b(?:earrings?|hoops?|studs?|boucles d'oreilles)\b/i],
  },
  {
    term: 'necklace',
    patterns: [/\b(?:necklaces?|pendants?|chokers?|collier)\b/i],
  },
  {
    term: 'jewellery',
    patterns: [
      /\b(?:jewell?ery|bijoux)\b/i,
      /\b(?:earrings?|hoops?|necklaces?|pendants?|bracelets?|bangles?|brooch(?:es)?|anklets?)\b/i,
      // "Ring" on its own is inside "earring", "spring" and "string"; the
      // boundary handles those, but it is still worth pinning to jewellery
      // words rather than accepting any ring at all.
      /\b(?:signet|stacking|cocktail|engagement|eternity) ring\b/i,
    ],
  },
  {
    term: 'bag',
    patterns: [
      /\b(?:bags?|handbags?|purses?|totes?|clutch(?:es)?|satchels?|crossbody|cross-body)\b/i,
      /\b(?:backpacks?|knapsacks?|duffels?|duffles?|sacs?)\b/i,
    ],
  },
  {
    term: 'wallet',
    patterns: [/\b(?:wallets?|cardholders?|card holders?|portefeuilles?)\b/i],
  },
  {
    term: 'watch',
    patterns: [/\b(?:watch(?:es)?|smartwatch(?:es)?|montres?)\b/i],
  },

  // Clothing. The shopper's noun is usually in the title already, so these
  // matter most where the retailer uses a trade word - "romper", "bodysuit".
  {
    term: 'dress',
    patterns: [/\b(?:dress(?:es)?|gowns?|sundress(?:es)?|robes?)\b/i],
  },
  {
    term: 'shirt',
    patterns: [
      /\b(?:shirts?|blouses?|tees?|t-shirts?|polos?|tunics?|camisoles?|tank tops?)\b/i,
      /\b(?:bodysuits?|chemisiers?)\b/i,
    ],
  },
  {
    term: 'sweater',
    patterns: [
      /\b(?:sweaters?|cardigans?|pullovers?|jumpers?|hoodies?|sweatshirts?|crewnecks?)\b/i,
      /\b(?:chandails?|tricots?)\b/i,
    ],
  },
  {
    term: 'pants',
    patterns: [
      /\b(?:pants?|trousers?|chinos?|leggings?|joggers?|sweatpants?|pantalons?)\b/i,
      /\b(?:jeans|denim)\b/i,
    ],
  },
  {
    term: 'skirt',
    patterns: [/\b(?:skirts?|jupes?)\b/i],
  },

  // Baby and toys.
  {
    term: 'toy',
    patterns: [
      /\b(?:toys?|plush(?:ies)?|stuffed animals?|figurines?|action figures?|dolls?)\b/i,
      /\b(?:puzzles?|board games?|play ?sets?|building blocks?|jouets?)\b/i,
    ],
  },
  {
    term: 'stroller',
    patterns: [/\b(?:strollers?|pushchairs?|prams?|travel systems?|poussettes?)\b/i],
  },
  {
    term: 'car seat',
    patterns: [/\b(?:car ?seats?|booster seats?|infant seats?)\b/i],
  },
  {
    term: 'diapers',
    patterns: [/\b(?:diapers?|nappies|couches jetables)\b/i],
  },

  // Kitchen and appliances.
  {
    term: 'cookware',
    patterns: [
      /\b(?:cookware|skillets?|saucepans?|frying pans?|dutch ovens?|stockpots?|casseroles?)\b/i,
      /\b(?:bakeware|roasting pans?|sheet pans?)\b/i,
    ],
  },
  {
    term: 'vacuum',
    patterns: [/\b(?:vacuums?|vacuum cleaners?|aspirateurs?)\b/i],
  },
  {
    term: 'kettle',
    patterns: [/\b(?:kettles?|bouilloires?)\b/i],
  },
  {
    term: 'towel',
    patterns: [/\b(?:towels?|bath sheets?|serviettes?|washcloths?)\b/i],
  },

  // Electronics beyond the three already covered.
  {
    term: 'phone',
    patterns: [
      /\b(?:smartphones?|cell ?phones?|iphones?|t[ée]l[ée]phones?)\b/i,
      /\b(?:galaxy s\d+|pixel \d+)\b/i,
    ],
  },
  {
    term: 'tablet',
    patterns: [/\b(?:tablets?|ipads?|tablettes?)\b/i],
  },
  {
    term: 'monitor',
    patterns: [/\b(?:monitors?|[ée]crans?)\b/i],
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
/**
 * Longest description still treated as a statement of what the product is.
 *
 * A retailer's description is one of two things. Structube writes "rectangular
 * coffee table" — a definition, and the only place that product's type appears
 * at all. Everyone else writes marketing prose: "pairs perfectly with a sweater
 * and ankle boots". Reading the second kind gave "Straight-Leg Jeans" the
 * keywords dress, pants and sweater, and put jeans in front of anyone searching
 * for a sweater.
 *
 * Length separates them cleanly in the live data. Structube's descriptions run
 * 9 to 45 characters; every prose-writing source in the catalogue has a median
 * between 135 and 218. Anything past this cutoff is styling advice, and styling
 * advice is about other products by definition.
 */
const DEFINITIONAL_DESCRIPTION_LIMIT = 80;

export function deriveKeywords(input: KeywordInput): string[] {
  // The first sentence, not the whole description. A description that opens by
  // saying what the thing is and then advises what to wear it with is the
  // common shape — "Our best-selling straight-leg jeans in a mid-rise fit.
  // Pairs perfectly with an oversized sweater and ankle boots." — so the useful
  // half is reachable without reading the half that is about other products.
  const description = (input.description ?? '').trim();
  const firstSentence = description.split(/(?<=[.!?])\s+/)[0] ?? description;
  const definitional =
    firstSentence.length > 0 && firstSentence.length <= DEFINITIONAL_DESCRIPTION_LIMIT
      ? firstSentence
      : '';

  // The title and the retailer's own category are always statements about what
  // the thing is. A long description is prose about how to wear it.
  const haystack = [input.title, definitional, input.sourceHint ?? ''].join(' ');
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
