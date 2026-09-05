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
      /\b(board game|jigsaw|puzzles?|action figure|dollhouses?|plush toys?|stuffed animal)\b/i,
      /\b(play ?set|play ?doh|magna[- ]?tiles|building blocks|toys?)\b/i,
      /\b(squishmallow|funko|hatchimals|l\.?o\.?l\.? surprise)\b/i,
    ],
  },
  {
    category: 'baby-kids',
    weight: 11,
    patterns: [
      /\b(strollers?|car seat|bassinets?|cribs?|high ?chair|playpens?|baby monitors?)\b/i,
      /\b(diapers?|pampers|huggies|formula|nursing|breast pump|swaddles?|onesies?)\b/i,
      /\b(toddler|infant|newborn|baby|b[eé]b[eé])\b/i,
    ],
  },
  {
    category: 'gaming',
    weight: 11,
    patterns: [
      /\b(playstation|ps5|ps4|xbox|nintendo|switch|steam deck)\b/i,
      /\b(gaming (?:chair|headset|mouses?|keyboards?|monitors?)|controller|dualsense)\b/i,
      /\b(video game|gpu|geforce|radeon|rtx \d{4})\b/i,
    ],
  },
  {
    category: 'computers',
    weight: 10,
    patterns: [
      /\b(laptops?|notebooks?|macbook|chromebooks?|ultrabooks?|desktop pc|all[- ]in[- ]one pc)\b/i,
      /\b(ssd|nvme|hard drive|hdd|ram|ddr[45]|motherboard|cpu|processor|ryzen|intel core)\b/i,
      /\b(monitors?|printers?|routers?|modems?|keyboards?|mouses?|webcams?|docking station)\b/i,
      /\b(ipads?|tablets?|surface pro|thinkpad|inspiron|xps)\b/i,
    ],
  },
  {
    category: 'electronics',
    weight: 9,
    patterns: [
      /\b(tv|oled|qled|4k|8k|smart tv|soundbar|home theatre|home theater)\b/i,
      /\b(headphones?|earbuds?|airpods?|speakers?|bluetooth speakers?|turntables?|receivers?)\b/i,
      /\b(iphones?|galaxy|pixel|smartphones?|smart ?watch|apple watch|fitbit|garmin)\b/i,
      /\b(cameras?|dslr|mirrorless|gopro|drones?|projectors?|kindle|e-?reader)\b/i,
    ],
  },
  {
    category: 'appliances',
    weight: 9,
    patterns: [
      /\b(refrigerators?|fridges?|freezers?|dishwashers?|washers?|dryers?|washing machine)\b/i,
      /\b(range hood|cooktop|wall oven|stoves?|microwaves?|air conditioners?|dehumidifiers?)\b/i,
      /\b(vacuums?|dyson|roomba|robot vacuums?|steam mop)\b/i,
    ],
  },
  {
    category: 'kitchen',
    weight: 8,
    patterns: [
      /\b(air fryer|instant pot|slow cooker|pressure cooker|blenders?|food processor)\b/i,
      /\b(coffee ?maker|espresso|keurig|nespresso|kettles?|toasters?|waffle maker)\b/i,
      /\b(cookware|frying pan|saucepans?|dutch oven|knife set|cutting board|bakeware)\b/i,
      /\b(dinnerware|mixing bowl|stand mixer|kitchenaid)\b/i,
    ],
  },
  {
    category: 'shoes-accessories',
    weight: 8,
    patterns: [
      /\b(sneakers?|running shoes?|boots?|sandals?|loafers?|heels?|slippers?)\b/i,
      /\b(handbags?|purses?|backpacks?|wallets?|belts?|sunglasses|watch band|jewellery|jewelry)\b/i,
      /\b(nike|adidas|new balance|skechers|birkenstock|blundstone|converse|vans)\b/i,
    ],
  },
  {
    category: 'clothing',
    weight: 7,
    patterns: [
      /\b(jackets?|coats?|parkas?|hoodies?|sweaters?|cardigans?|fleeces?|vests?)\b/i,
      /\b(jeans|pants|chinos|leggings|joggers|shorts|skirt|dress|blouse|shirt|tee|t-shirt)\b/i,
      /\b(pyjamas|pajamas|underwear|socks|bra|swimsuit|activewear|outerwear)\b/i,
      /\b(sweatshirts?|blazers?|suits?|tank top|polo)\b/i,
    ],
  },
  {
    category: 'sports-outdoors',
    weight: 8,
    patterns: [
      /\b(bikes?|bicycles?|kayaks?|canoes?|paddle ?board|camping|tents?|sleeping bag|backpacking)\b/i,
      /\b(treadmills?|dumbbells?|kettlebells?|yoga mat|exercise bikes?|home gym|weights?)\b/i,
      /\b(skis?|snowboards?|hockey|golf|fishing|hiking|climbing|coolers?)\b/i,
    ],
  },
  {
    category: 'tools-auto',
    weight: 8,
    patterns: [
      /\b(drills?|impact driver|circular saw|mitre saw|miter saw|sanders?|tool ?set|socket set)\b/i,
      /\b(dewalt|milwaukee|makita|ryobi|mastercraft|bosch tool)\b/i,
      /\b(tires?|tyres?|motor oil|wiper blade|car battery|jack stand|snow brush)\b/i,
      /\b(lawn ?mower|snow ?blower|pressure washers?|generators?|ladders?)\b/i,
    ],
  },
  {
    category: 'beauty-health',
    weight: 8,
    patterns: [
      /\b(shampoos?|conditioners?|moisturizers?|serums?|sunscreen|cleansers?|makeup|mascaras?)\b/i,
      /\b(lipsticks?|foundation|perfumes?|colognes?|fragrance|skincare|face mask)\b/i,
      /\b(electric (?:razor|toothbrush)|hair dryers?|straightener|curling iron|trimmer)\b/i,
      /\b(vitamins?|supplements?|protein powder|first aid|thermometers?)\b/i,
    ],
  },
  {
    category: 'grocery',
    weight: 7,
    patterns: [
      /\b(coffee beans|ground coffee|tea bags|cereal|pasta|olive oil|snacks?|chocolate bar)\b/i,
      /\b(grocery|produce|frozen (?:pizza|food)|canned|granola|chips|candy)\b/i,
    ],
  },
  {
    category: 'home',
    weight: 6,
    patterns: [
      /\b(sofas?|couchs?|sectionals?|armchairs?|dining table|bed frame|mattresss?|dressers?|nightstands?)\b/i,
      /\b(bedding|duvets?|comforters?|sheet set|pillows?|towels?|curtains?|rugs?|blankets?)\b/i,
      /\b(lamps?|lighting|shelfs?|bookcases?|storage bin|organizers?|d[eé]cor|mirrors?)\b/i,
      /\b(patio|outdoor furniture|bbq|barbecue|grills?)\b/i,
    ],
  },
  {
    category: 'travel',
    weight: 7,
    patterns: [
      /\b(flights?|airfare|hotels?|resorts?|all[- ]inclusive|vacation package|cruises?)\b/i,
      /\b(luggages?|suitcases?|carry[- ]on|travel adapter)\b/i,
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
