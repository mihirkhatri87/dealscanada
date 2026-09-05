import type { MerchantInput } from '../db/repository';

/**
 * Seed merchant registry.
 *
 * Domains are the join key between a scraped URL and a merchant, and `family`
 * is what makes /family/canadian-tire show all nine banners as one group.
 *
 * This is a seed, not a closed list: an unknown domain auto-creates a merchant
 * during normalization, so a new retailer never silently loses its deals.
 */

export interface MerchantSeed {
  slug: string;
  name: string;
  domain: string;
  family?: string;
  vertical: string;
  engine: string;
  /** Extra-conservative rate for small independent sites. */
  rateLimitRps?: number;
}

export const MERCHANT_SEEDS: MerchantSeed[] = [
  // --- Canadian Tire family (nine banners, one platform) -------------------
  {
    slug: 'canadian-tire',
    name: 'Canadian Tire',
    domain: 'canadiantire.ca',
    family: 'canadian-tire',
    vertical: 'general',
    engine: 'hybris',
  },
  {
    slug: 'sportchek',
    name: 'SportChek',
    domain: 'sportchek.ca',
    family: 'canadian-tire',
    vertical: 'sports',
    engine: 'hybris',
  },
  {
    slug: 'marks',
    name: "Mark's",
    domain: 'marks.com',
    family: 'canadian-tire',
    vertical: 'apparel',
    engine: 'hybris',
  },
  {
    slug: 'atmosphere',
    name: 'Atmosphere',
    domain: 'atmosphere.ca',
    family: 'canadian-tire',
    vertical: 'sports',
    engine: 'hybris',
  },
  {
    slug: 'sports-experts',
    name: 'Sports Experts',
    domain: 'sportsexperts.ca',
    family: 'canadian-tire',
    vertical: 'sports',
    engine: 'hybris',
  },
  {
    slug: 'lequipeur',
    name: "L'Équipeur",
    domain: 'lequipeur.com',
    family: 'canadian-tire',
    vertical: 'apparel',
    engine: 'hybris',
  },
  {
    slug: 'pro-hockey-life',
    name: 'Pro Hockey Life',
    domain: 'prohockeylife.com',
    family: 'canadian-tire',
    vertical: 'sports',
    engine: 'hybris',
  },
  {
    slug: 'partsource',
    name: 'PartSource',
    domain: 'partsource.ca',
    family: 'canadian-tire',
    vertical: 'auto',
    engine: 'hybris',
  },
  {
    slug: 'party-city',
    name: 'Party City Canada',
    domain: 'partycity.ca',
    family: 'canadian-tire',
    vertical: 'general',
    engine: 'jsonld',
  },

  // --- Gap Inc. Canada -----------------------------------------------------
  {
    slug: 'gap',
    name: 'Gap Canada',
    domain: 'gapcanada.ca',
    family: 'gap-inc',
    vertical: 'apparel',
    engine: 'gapinc',
  },
  {
    slug: 'gap-factory',
    name: 'Gap Factory',
    domain: 'gapfactory.ca',
    family: 'gap-inc',
    vertical: 'apparel',
    engine: 'gapinc',
  },
  {
    slug: 'old-navy',
    name: 'Old Navy Canada',
    domain: 'oldnavy.ca',
    family: 'gap-inc',
    vertical: 'apparel',
    engine: 'gapinc',
  },
  {
    slug: 'banana-republic',
    name: 'Banana Republic Canada',
    domain: 'bananarepublic.ca',
    family: 'gap-inc',
    vertical: 'apparel',
    engine: 'gapinc',
  },
  {
    slug: 'banana-republic-factory',
    name: 'Banana Republic Factory',
    domain: 'brfactory.ca',
    family: 'gap-inc',
    vertical: 'apparel',
    engine: 'gapinc',
  },
  {
    slug: 'athleta',
    name: 'Athleta Canada',
    domain: 'athleta.ca',
    family: 'gap-inc',
    vertical: 'apparel',
    engine: 'gapinc',
  },

  // --- Reitmans Group ------------------------------------------------------
  {
    slug: 'reitmans',
    name: 'Reitmans',
    domain: 'reitmans.com',
    family: 'reitmans',
    vertical: 'apparel',
    engine: 'shopify',
  },
  {
    slug: 'rw-co',
    name: 'RW&CO.',
    domain: 'rw-co.com',
    family: 'reitmans',
    vertical: 'apparel',
    engine: 'shopify',
  },
  {
    slug: 'penningtons',
    name: 'Penningtons',
    domain: 'penningtons.com',
    family: 'reitmans',
    vertical: 'apparel',
    engine: 'shopify',
  },

  // --- Mass market ---------------------------------------------------------
  {
    slug: 'walmart',
    name: 'Walmart Canada',
    domain: 'walmart.ca',
    vertical: 'general',
    engine: 'native',
  },
  {
    slug: 'costco',
    name: 'Costco Canada',
    domain: 'costco.ca',
    vertical: 'general',
    engine: 'native',
  },
  { slug: 'amazon', name: 'Amazon.ca', domain: 'amazon.ca', vertical: 'general', engine: 'native' },
  {
    slug: 'giant-tiger',
    name: 'Giant Tiger',
    domain: 'gianttiger.com',
    vertical: 'general',
    engine: 'jsonld',
  },
  {
    slug: 'hudsons-bay',
    name: "Hudson's Bay",
    domain: 'thebay.com',
    vertical: 'general',
    engine: 'sfcc',
  },
  { slug: 'simons', name: 'Simons', domain: 'simons.ca', vertical: 'apparel', engine: 'jsonld' },

  // --- Electronics and computers ------------------------------------------
  {
    slug: 'best-buy',
    name: 'Best Buy Canada',
    domain: 'bestbuy.ca',
    vertical: 'electronics',
    engine: 'native',
  },
  {
    slug: 'newegg',
    name: 'Newegg Canada',
    domain: 'newegg.ca',
    vertical: 'electronics',
    engine: 'jsonld',
  },
  {
    slug: 'canada-computers',
    name: 'Canada Computers',
    domain: 'canadacomputers.com',
    vertical: 'electronics',
    engine: 'jsonld',
  },
  {
    slug: 'memory-express',
    name: 'Memory Express',
    domain: 'memoryexpress.com',
    vertical: 'electronics',
    engine: 'jsonld',
  },
  {
    slug: 'staples',
    name: 'Staples Canada',
    domain: 'staples.ca',
    vertical: 'electronics',
    engine: 'jsonld',
  },
  {
    slug: 'visions-electronics',
    name: 'Visions Electronics',
    domain: 'visions.ca',
    vertical: 'electronics',
    engine: 'jsonld',
  },
  {
    slug: 'the-source',
    name: 'The Source',
    domain: 'thesource.ca',
    vertical: 'electronics',
    engine: 'jsonld',
  },
  {
    slug: 'dell',
    name: 'Dell Canada',
    domain: 'dell.ca',
    vertical: 'electronics',
    engine: 'jsonld',
  },
  {
    slug: 'lenovo',
    name: 'Lenovo Canada',
    domain: 'lenovo.com',
    vertical: 'electronics',
    engine: 'jsonld',
  },

  // --- Apparel and footwear ------------------------------------------------
  { slug: 'roots', name: 'Roots', domain: 'roots.com', vertical: 'apparel', engine: 'shopify' },
  {
    slug: 'aritzia',
    name: 'Aritzia',
    domain: 'aritzia.com',
    vertical: 'apparel',
    engine: 'jsonld',
  },
  {
    slug: 'uniqlo',
    name: 'Uniqlo Canada',
    domain: 'uniqlo.com',
    vertical: 'apparel',
    engine: 'jsonld',
  },
  { slug: 'hm', name: 'H&M Canada', domain: 'hm.com', vertical: 'apparel', engine: 'jsonld' },
  {
    slug: 'lululemon',
    name: 'lululemon',
    domain: 'lululemon.com',
    vertical: 'apparel',
    engine: 'jsonld',
  },
  {
    slug: 'altitude-sports',
    name: 'Altitude Sports',
    domain: 'altitude-sports.com',
    vertical: 'apparel',
    engine: 'shopify',
  },
  {
    slug: 'the-last-hunt',
    name: 'The Last Hunt',
    domain: 'thelasthunt.com',
    vertical: 'apparel',
    engine: 'shopify',
  },
  {
    slug: 'sporting-life',
    name: 'Sporting Life',
    domain: 'sportinglife.ca',
    vertical: 'sports',
    engine: 'shopify',
  },
  {
    slug: 'frank-and-oak',
    name: 'Frank And Oak',
    domain: 'frankandoak.com',
    vertical: 'apparel',
    engine: 'shopify',
  },
  {
    slug: 'kit-and-ace',
    name: 'Kit and Ace',
    domain: 'kitandace.com',
    vertical: 'apparel',
    engine: 'shopify',
  },
  {
    slug: 'softmoc',
    name: 'SoftMoc',
    domain: 'softmoc.com',
    vertical: 'footwear',
    engine: 'shopify',
  },
  {
    slug: 'dsw-canada',
    name: 'DSW Canada',
    domain: 'dsw.ca',
    vertical: 'footwear',
    engine: 'jsonld',
  },
  { slug: 'aldo', name: 'Aldo', domain: 'aldoshoes.com', vertical: 'footwear', engine: 'sfcc' },
  {
    slug: 'call-it-spring',
    name: 'Call It Spring',
    domain: 'callitspring.com',
    vertical: 'footwear',
    engine: 'sfcc',
  },
  {
    slug: 'little-burgundy',
    name: 'Little Burgundy',
    domain: 'littleburgundyshoes.com',
    vertical: 'footwear',
    engine: 'sfcc',
  },
  {
    slug: 'browns-shoes',
    name: 'Browns Shoes',
    domain: 'brownsshoes.com',
    vertical: 'footwear',
    engine: 'shopify',
  },
  {
    slug: 'urban-planet',
    name: 'Urban Planet',
    domain: 'urbanplanet.com',
    vertical: 'apparel',
    engine: 'shopify',
  },
  {
    slug: 'bootlegger',
    name: 'Bootlegger',
    domain: 'bootlegger.com',
    vertical: 'apparel',
    engine: 'shopify',
  },
  { slug: 'rickis', name: "Ricki's", domain: 'rickis.com', vertical: 'apparel', engine: 'shopify' },
  { slug: 'cleo', name: 'Cleo', domain: 'cleo.ca', vertical: 'apparel', engine: 'shopify' },
  {
    slug: 'suzy-shier',
    name: 'Suzy Shier',
    domain: 'suzyshier.com',
    vertical: 'apparel',
    engine: 'shopify',
  },
  {
    slug: 'northern-reflections',
    name: 'Northern Reflections',
    domain: 'northernreflections.com',
    vertical: 'apparel',
    engine: 'shopify',
  },
  {
    slug: 'tip-top-tailors',
    name: 'Tip Top Tailors',
    domain: 'tiptop.ca',
    vertical: 'apparel',
    engine: 'shopify',
  },
  {
    slug: 'moores',
    name: 'Moores',
    domain: 'mooresclothing.ca',
    vertical: 'apparel',
    engine: 'jsonld',
  },

  // --- Kids, baby and toys -------------------------------------------------
  {
    slug: 'toys-r-us',
    name: 'Toys "R" Us Canada',
    domain: 'toysrus.ca',
    vertical: 'toys',
    engine: 'jsonld',
  },
  {
    slug: 'babies-r-us',
    name: 'Babies "R" Us Canada',
    domain: 'babiesrus.ca',
    vertical: 'baby',
    engine: 'jsonld',
  },
  {
    slug: 'mastermind-toys',
    name: 'Mastermind Toys',
    domain: 'mastermindtoys.com',
    vertical: 'toys',
    engine: 'shopify',
  },
  { slug: 'lego', name: 'LEGO Canada', domain: 'lego.com', vertical: 'toys', engine: 'jsonld' },
  {
    slug: 'shopdisney',
    name: 'shopDisney Canada',
    domain: 'shopdisney.ca',
    vertical: 'toys',
    engine: 'sfcc',
  },
  {
    slug: 'carters-oshkosh',
    name: "Carter's OshKosh Canada",
    domain: 'cartersoshkosh.ca',
    vertical: 'baby',
    engine: 'jsonld',
  },
  {
    slug: 'childrens-place',
    name: "The Children's Place Canada",
    domain: 'childrensplace.com',
    vertical: 'apparel',
    engine: 'sfcc',
  },
  {
    slug: 'joe-fresh',
    name: 'Joe Fresh',
    domain: 'joefresh.com',
    vertical: 'apparel',
    engine: 'shopify',
  },
  {
    slug: 'snuggle-bugz',
    name: 'Snuggle Bugz',
    domain: 'snugglebugz.ca',
    vertical: 'baby',
    engine: 'shopify',
  },
  {
    slug: 'west-coast-kids',
    name: 'West Coast Kids',
    domain: 'westcoastkids.ca',
    vertical: 'baby',
    engine: 'shopify',
  },
  {
    slug: 'scholars-choice',
    name: "Scholar's Choice",
    domain: 'scholarschoice.ca',
    vertical: 'toys',
    engine: 'shopify',
  },
  { slug: 'indigo', name: 'Indigo', domain: 'indigo.ca', vertical: 'books', engine: 'jsonld' },

  // --- Home and hardware ---------------------------------------------------
  {
    slug: 'home-depot',
    name: 'Home Depot Canada',
    domain: 'homedepot.ca',
    vertical: 'home',
    engine: 'jsonld',
  },
  { slug: 'rona', name: 'RONA', domain: 'rona.ca', vertical: 'home', engine: 'jsonld' },
  {
    slug: 'home-hardware',
    name: 'Home Hardware',
    domain: 'homehardware.ca',
    vertical: 'home',
    engine: 'jsonld',
  },
  { slug: 'ikea', name: 'IKEA Canada', domain: 'ikea.com', vertical: 'home', engine: 'jsonld' },
  {
    slug: 'wayfair',
    name: 'Wayfair Canada',
    domain: 'wayfair.ca',
    vertical: 'home',
    engine: 'jsonld',
  },
  {
    slug: 'structube',
    name: 'Structube',
    domain: 'structube.com',
    vertical: 'home',
    engine: 'jsonld',
  },
  { slug: 'leons', name: "Leon's", domain: 'leons.ca', vertical: 'home', engine: 'jsonld' },
  {
    slug: 'the-brick',
    name: 'The Brick',
    domain: 'thebrick.com',
    vertical: 'home',
    engine: 'jsonld',
  },
  {
    slug: 'linen-chest',
    name: 'Linen Chest',
    domain: 'linenchest.com',
    vertical: 'home',
    engine: 'shopify',
  },

  // --- Sports and outdoors -------------------------------------------------
  { slug: 'mec', name: 'MEC', domain: 'mec.ca', vertical: 'sports', engine: 'jsonld' },
  { slug: 'sail', name: 'SAIL', domain: 'sail.ca', vertical: 'sports', engine: 'jsonld' },
  {
    slug: 'decathlon',
    name: 'Decathlon Canada',
    domain: 'decathlon.ca',
    vertical: 'sports',
    engine: 'jsonld',
  },
  {
    slug: 'golf-town',
    name: 'Golf Town',
    domain: 'golftown.com',
    vertical: 'sports',
    engine: 'jsonld',
  },
  {
    slug: 'cabelas',
    name: "Cabela's Canada",
    domain: 'cabelas.ca',
    vertical: 'sports',
    engine: 'jsonld',
  },

  // --- Beauty and health ---------------------------------------------------
  {
    slug: 'sephora',
    name: 'Sephora Canada',
    domain: 'sephora.com',
    vertical: 'beauty',
    engine: 'jsonld',
  },
  {
    slug: 'the-body-shop',
    name: 'The Body Shop Canada',
    domain: 'thebodyshop.com',
    vertical: 'beauty',
    engine: 'jsonld',
  },
  { slug: 'lush', name: 'Lush Canada', domain: 'lush.com', vertical: 'beauty', engine: 'jsonld' },
  {
    slug: 'bath-body-works',
    name: 'Bath & Body Works Canada',
    domain: 'bathandbodyworks.ca',
    vertical: 'beauty',
    engine: 'jsonld',
  },
  { slug: 'well-ca', name: 'Well.ca', domain: 'well.ca', vertical: 'beauty', engine: 'jsonld' },
  {
    slug: 'shoppers-drug-mart',
    name: 'Shoppers Drug Mart',
    domain: 'shoppersdrugmart.ca',
    vertical: 'beauty',
    engine: 'jsonld',
  },

  // --- Grocery and pharmacy ------------------------------------------------
  { slug: 'loblaws', name: 'Loblaws', domain: 'loblaws.ca', vertical: 'grocery', engine: 'jsonld' },
  {
    slug: 'real-canadian-superstore',
    name: 'Real Canadian Superstore',
    domain: 'realcanadiansuperstore.ca',
    vertical: 'grocery',
    engine: 'jsonld',
  },
  {
    slug: 'no-frills',
    name: 'No Frills',
    domain: 'nofrills.ca',
    vertical: 'grocery',
    engine: 'jsonld',
  },
  { slug: 'metro', name: 'Metro', domain: 'metro.ca', vertical: 'grocery', engine: 'jsonld' },
  { slug: 'sobeys', name: 'Sobeys', domain: 'sobeys.com', vertical: 'grocery', engine: 'jsonld' },
  {
    slug: 'london-drugs',
    name: 'London Drugs',
    domain: 'londondrugs.com',
    vertical: 'grocery',
    engine: 'jsonld',
  },
  { slug: 'rexall', name: 'Rexall', domain: 'rexall.ca', vertical: 'grocery', engine: 'jsonld' },
];

/** Deal platforms, which are not retailers but still need a merchant record. */
export const PLATFORM_SEEDS: MerchantSeed[] = [
  {
    slug: 'redflagdeals',
    name: 'RedFlagDeals',
    domain: 'redflagdeals.com',
    vertical: 'platform',
    engine: 'platform',
  },
  {
    slug: 'smartcanucks',
    name: 'Smart Canucks',
    domain: 'smartcanucks.ca',
    vertical: 'platform',
    engine: 'platform',
  },
  {
    slug: 'cocowest',
    name: 'Costco West Fan Blog',
    domain: 'cocowest.ca',
    vertical: 'platform',
    engine: 'platform',
    rateLimitRps: 0.5,
  },
  {
    slug: 'camelcamelcamel',
    name: 'camelcamelcamel',
    domain: 'camelcamelcamel.com',
    vertical: 'platform',
    engine: 'platform',
    rateLimitRps: 0.5,
  },
  {
    slug: 'stocktrack',
    name: 'stocktrack.ca',
    domain: 'stocktrack.ca',
    vertical: 'platform',
    engine: 'platform',
    rateLimitRps: 0.3,
  },
];

export const ALL_MERCHANT_SEEDS = [...MERCHANT_SEEDS, ...PLATFORM_SEEDS];

/** Deterministic id from the domain, so seeding twice cannot duplicate a merchant. */
export function merchantIdForDomain(domain: string): string {
  return `merchant:${domain.toLowerCase().replace(/^www\./, '')}`;
}

export function seedToMerchantInput(seed: MerchantSeed): MerchantInput {
  return {
    id: merchantIdForDomain(seed.domain),
    slug: seed.slug,
    name: seed.name,
    domain: seed.domain.toLowerCase(),
    logoUrl: null,
    affiliateUrlTemplate: null,
    family: seed.family ?? null,
    vertical: seed.vertical,
    engine: seed.engine,
    status: 'unverified',
    rateLimitRps: seed.rateLimitRps ?? null,
  };
}

/** Slug for an auto-created merchant, derived from an unseen domain. */
export function slugForDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.(ca|com|net|org|co\.uk)$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
