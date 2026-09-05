import type { Category, Department } from '../db/types';

/**
 * Keyword classification.
 *
 * Deliberately rule-based rather than learned: it is deterministic, sub-millisecond,
 * inspectable, and fixable by editing a list when it gets something wrong. The
 * labelled fixture in tests holds it to an accuracy floor, so regressions surface
 * as test failures rather than as a quietly worsening front page.
 */

interface Rule {
  category: Category;
  /** Higher wins when several rules match. */
  weight: number;
  patterns: RegExp[];
}

const RULES: Rule[] = [
  {
    category: 'toys-games',
    weight: 12,
    patterns: [
      /\b(lego|playmobil|duplo|hot wheels|barbie|nerf|paw patrol|bluey|pokemon|pok[eé]mon)\b/i,
      /\b(board game|jigsaw|puzzle|action figure|dollhouse|plush toy|stuffed animal)\b/i,
      /\b(play ?set|play ?doh|magna[- ]?tiles|building blocks|toy)\b/i,
      /\b(squishmallow|funko|hatchimals|l\.?o\.?l\.? surprise)\b/i,
    ],
  },
  {
    category: 'baby-kids',
    weight: 11,
    patterns: [
      /\b(stroller|car seat|bassinet|crib|high ?chair|playpen|baby monitor)\b/i,
      /\b(diaper|pampers|huggies|formula|nursing|breast pump|swaddle|onesie)\b/i,
      /\b(toddler|infant|newborn|baby|b[eé]b[eé])\b/i,
    ],
  },
  {
    category: 'gaming',
    weight: 11,
    patterns: [
      /\b(playstation|ps5|ps4|xbox|nintendo|switch|steam deck)\b/i,
      /\b(gaming (?:chair|headset|mouse|keyboard|monitor)|controller|dualsense)\b/i,
      /\b(video game|gpu|geforce|radeon|rtx \d{4})\b/i,
    ],
  },
  {
    category: 'computers',
    weight: 10,
    patterns: [
      /\b(laptop|notebook|macbook|chromebook|ultrabook|desktop pc|all[- ]in[- ]one pc)\b/i,
      /\b(ssd|nvme|hard drive|hdd|ram|ddr[45]|motherboard|cpu|processor|ryzen|intel core)\b/i,
      /\b(monitor|printer|router|modem|keyboard|mouse|webcam|docking station)\b/i,
      /\b(ipad|tablet|surface pro|thinkpad|inspiron|xps)\b/i,
    ],
  },
  {
    category: 'electronics',
    weight: 9,
    patterns: [
      /\b(tv|oled|qled|4k|8k|smart tv|soundbar|home theatre|home theater)\b/i,
      /\b(headphone|earbud|airpod|speaker|bluetooth speaker|turntable|receiver)\b/i,
      /\b(iphone|galaxy|pixel|smartphone|smart ?watch|apple watch|fitbit|garmin)\b/i,
      /\b(camera|dslr|mirrorless|gopro|drone|projector|kindle|e-?reader)\b/i,
    ],
  },
  {
    category: 'appliances',
    weight: 9,
    patterns: [
      /\b(refrigerator|fridge|freezer|dishwasher|washer|dryer|washing machine)\b/i,
      /\b(range hood|cooktop|wall oven|stove|microwave|air conditioner|dehumidifier)\b/i,
      /\b(vacuum|dyson|roomba|robot vacuum|steam mop)\b/i,
    ],
  },
  {
    category: 'kitchen',
    weight: 8,
    patterns: [
      /\b(air fryer|instant pot|slow cooker|pressure cooker|blender|food processor)\b/i,
      /\b(coffee ?maker|espresso|keurig|nespresso|kettle|toaster|waffle maker)\b/i,
      /\b(cookware|frying pan|saucepan|dutch oven|knife set|cutting board|bakeware)\b/i,
      /\b(dinnerware|mixing bowl|stand mixer|kitchenaid)\b/i,
    ],
  },
  {
    category: 'shoes-accessories',
    weight: 8,
    patterns: [
      /\b(sneakers?|running shoes?|boots?|sandals?|loafers?|heels?|slippers?)\b/i,
      /\b(handbag|purse|backpack|wallet|belt|sunglasses|watch band|jewellery|jewelry)\b/i,
      /\b(nike|adidas|new balance|skechers|birkenstock|blundstone|converse|vans)\b/i,
    ],
  },
  {
    category: 'clothing',
    weight: 7,
    patterns: [
      /\b(jacket|coat|parka|hoodie|sweater|cardigan|fleece|vest)\b/i,
      /\b(jeans|pants|chinos|leggings|joggers|shorts|skirt|dress|blouse|shirt|tee|t-shirt)\b/i,
      /\b(pyjamas|pajamas|underwear|socks|bra|swimsuit|activewear|outerwear)\b/i,
      /\b(sweatshirt|blazer|suit|tank top|polo)\b/i,
    ],
  },
  {
    category: 'sports-outdoors',
    weight: 8,
    patterns: [
      /\b(bike|bicycle|kayak|canoe|paddle ?board|camping|tent|sleeping bag|backpacking)\b/i,
      /\b(treadmill|dumbbell|kettlebell|yoga mat|exercise bike|home gym|weights?)\b/i,
      /\b(ski|snowboard|hockey|golf|fishing|hiking|climbing|cooler)\b/i,
    ],
  },
  {
    category: 'tools-auto',
    weight: 8,
    patterns: [
      /\b(drill|impact driver|circular saw|mitre saw|miter saw|sander|tool ?set|socket set)\b/i,
      /\b(dewalt|milwaukee|makita|ryobi|mastercraft|bosch tool)\b/i,
      /\b(tire|tyre|motor oil|wiper blade|car battery|jack stand|snow brush)\b/i,
      /\b(lawn ?mower|snow ?blower|pressure washer|generator|ladder)\b/i,
    ],
  },
  {
    category: 'beauty-health',
    weight: 8,
    patterns: [
      /\b(shampoo|conditioner|moisturizer|serum|sunscreen|cleanser|makeup|mascara)\b/i,
      /\b(lipstick|foundation|perfume|cologne|fragrance|skincare|face mask)\b/i,
      /\b(electric (?:razor|toothbrush)|hair dryer|straightener|curling iron|trimmer)\b/i,
      /\b(vitamin|supplement|protein powder|first aid|thermometer)\b/i,
    ],
  },
  {
    category: 'grocery',
    weight: 7,
    patterns: [
      /\b(coffee beans|ground coffee|tea bags|cereal|pasta|olive oil|snack|chocolate bar)\b/i,
      /\b(grocery|produce|frozen (?:pizza|food)|canned|granola|chips|candy)\b/i,
    ],
  },
  {
    category: 'home',
    weight: 6,
    patterns: [
      /\b(sofa|couch|sectional|armchair|dining table|bed frame|mattress|dresser|nightstand)\b/i,
      /\b(bedding|duvet|comforter|sheet set|pillow|towel|curtain|rug|blanket)\b/i,
      /\b(lamp|lighting|shelf|bookcase|storage bin|organizer|d[eé]cor|mirror)\b/i,
      /\b(patio|outdoor furniture|bbq|barbecue|grill)\b/i,
    ],
  },
  {
    category: 'travel',
    weight: 7,
    patterns: [
      /\b(flight|airfare|hotel|resort|all[- ]inclusive|vacation package|cruise)\b/i,
      /\b(luggage|suitcase|carry[- ]on|travel adapter)\b/i,
    ],
  },
];

/** Merchant hints break ties when the title alone is ambiguous. */
const MERCHANT_HINTS: Record<string, Category> = {
  'canada-computers': 'computers',
  'memory-express': 'computers',
  newegg: 'computers',
  'best-buy': 'electronics',
  'the-source': 'electronics',
  'visions-electronics': 'electronics',
  staples: 'computers',
  'toys-r-us': 'toys-games',
  'mastermind-toys': 'toys-games',
  lego: 'toys-games',
  shopdisney: 'toys-games',
  'snuggle-bugz': 'baby-kids',
  'west-coast-kids': 'baby-kids',
  'babies-r-us': 'baby-kids',
  'carters-oshkosh': 'baby-kids',
  'childrens-place': 'clothing',
  'old-navy': 'clothing',
  gap: 'clothing',
  'gap-factory': 'clothing',
  'banana-republic': 'clothing',
  athleta: 'clothing',
  reitmans: 'clothing',
  'rw-co': 'clothing',
  penningtons: 'clothing',
  roots: 'clothing',
  aritzia: 'clothing',
  uniqlo: 'clothing',
  marks: 'clothing',
  softmoc: 'shoes-accessories',
  'dsw-canada': 'shoes-accessories',
  aldo: 'shoes-accessories',
  'little-burgundy': 'shoes-accessories',
  sportchek: 'sports-outdoors',
  atmosphere: 'sports-outdoors',
  mec: 'sports-outdoors',
  sail: 'sports-outdoors',
  'golf-town': 'sports-outdoors',
  decathlon: 'sports-outdoors',
  'canadian-tire': 'tools-auto',
  partsource: 'tools-auto',
  'home-depot': 'home',
  rona: 'home',
  'home-hardware': 'home',
  ikea: 'home',
  wayfair: 'home',
  structube: 'home',
  leons: 'home',
  'the-brick': 'home',
  sephora: 'beauty-health',
  'the-body-shop': 'beauty-health',
  lush: 'beauty-health',
  'bath-body-works': 'beauty-health',
  'well-ca': 'beauty-health',
  'shoppers-drug-mart': 'beauty-health',
  loblaws: 'grocery',
  'real-canadian-superstore': 'grocery',
  'no-frills': 'grocery',
  metro: 'grocery',
  sobeys: 'grocery',
  'giant-tiger': 'grocery',
};

export interface ClassifyInput {
  title: string;
  description?: string | null;
  merchantSlug?: string | null;
  /** A category the source itself supplied, e.g. a Shopify product_type. */
  sourceHint?: string | null;
}

/**
 * Assigns a category. Never throws; falls back to `other`.
 */
export function classifyCategory(input: ClassifyInput): Category {
  const haystack = [input.title, input.description ?? '', input.sourceHint ?? ''].join(' ');

  let best: { category: Category; score: number } | null = null;

  for (const rule of RULES) {
    let matches = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(haystack)) matches += 1;
    }
    if (matches === 0) continue;

    // More distinct pattern hits is stronger evidence than a single keyword.
    const score = rule.weight + (matches - 1) * 2;
    if (!best || score > best.score) best = { category: rule.category, score };
  }

  const merchantHint = input.merchantSlug ? MERCHANT_HINTS[input.merchantSlug] : undefined;

  // A merchant hint decides only when the title gave weak or no evidence — a LEGO
  // set sold at Canadian Tire is still a toy.
  if (!best) return merchantHint ?? 'other';
  if (merchantHint && best.score <= 7) return merchantHint;

  return best.category;
}

const DEPARTMENT_RULES: Array<{ department: Department; patterns: RegExp[] }> = [
  {
    department: 'baby',
    patterns: [/\b(baby|infant|newborn|0-24 months|preemie|b[eé]b[eé])\b/i],
  },
  {
    department: 'girls',
    patterns: [/\b(girls?'?s?|toddler girl|junior girls?)\b/i],
  },
  {
    department: 'boys',
    patterns: [/\b(boys?'?s?|toddler boy|junior boys?)\b/i],
  },
  {
    department: 'women',
    patterns: [/\b(women'?s?|ladies|womens|female|maternity)\b/i],
  },
  {
    department: 'men',
    patterns: [/\b(men'?s?|mens|male)\b/i],
  },
];

export interface DepartmentInput {
  title: string;
  description?: string | null;
  /** Department the engine itself supplied — always preferred when present. */
  sourceHint?: string | null;
  category?: Category;
}

/**
 * Assigns a department for apparel and kids' goods.
 *
 * An engine-supplied hint always wins: Gap's own navigation knows whether a coat
 * is in Girls or Boys far better than a regex over the title does.
 */
export function classifyDepartment(input: DepartmentInput): Department {
  const hint = normalizeDepartmentHint(input.sourceHint);
  if (hint) return hint;

  const haystack = `${input.title} ${input.description ?? ''}`;

  for (const rule of DEPARTMENT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) return rule.department;
  }

  // Only apparel-ish categories carry a meaningful department.
  const apparelCategories: Category[] = ['clothing', 'shoes-accessories', 'baby-kids'];
  if (input.category && apparelCategories.includes(input.category)) return 'unisex';

  return 'na';
}

function normalizeDepartmentHint(hint: string | null | undefined): Department | null {
  if (!hint) return null;
  const value = hint.toLowerCase();

  if (/\b(baby|infant|newborn)\b/.test(value)) return 'baby';
  if (/\b(girl)/.test(value)) return 'girls';
  if (/\b(boy)/.test(value)) return 'boys';
  if (/\b(women|ladies|female)/.test(value)) return 'women';
  if (/\b(men|male)/.test(value)) return 'men';
  if (/\b(unisex|all)\b/.test(value)) return 'unisex';

  return null;
}
