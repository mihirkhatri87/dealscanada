import { randomUUID } from 'node:crypto';
import type { DealInput, StoreInput } from '../db/repository';
import type { Category, Department } from '../db/types';
import { classifyCategory, classifyDepartment } from '../pipeline/classify';
import { computeDiscount } from '../util/money';
import { computeHeat } from '../pipeline/score';
import { resolveProductIdentity } from '../pipeline/product-key';
import { slugify } from '../pipeline/normalize';
import { assessDealQuality, trustedDiscountPct } from '../pipeline/deal-quality';

/**
 * Realistic offline seed data.
 *
 * Built to exercise every state the UI has to render, not just the happy one:
 * deals with and without a before price, with and without an image, coupon
 * codes, expiring soon, sold out, store-local clearance, and one product priced
 * at four different merchants so cross-merchant verification produces genuine
 * verified / market-price / above-market / inflated-anchor verdicts rather than
 * hard-coded labels.
 */

interface SeedSpec {
  title: string;
  domain: string;
  price: number;
  priceWas?: number | null;
  image?: string | null;
  description?: string;
  brand?: string;
  gtin?: string;
  mpn?: string;
  coupon?: string;
  votes?: number;
  hoursAgo?: number;
  expiresInHours?: number;
  inStock?: boolean;
  shipping?: string;
  category?: Category;
  department?: Department;
  storeChain?: string;
  sizes?: string[];
}

/** Stable placeholder imagery: deterministic, offline-safe, no external calls. */
function placeholder(seed: string): string {
  return `https://placehold.co/600x450/1e2330/a3acbd?text=${encodeURIComponent(seed.slice(0, 24))}`;
}

const CROSS_MERCHANT_GTIN = '4006381333931';

const SPECS: SeedSpec[] = [
  // --- One product at four merchants: drives real verification verdicts -----
  {
    title: 'Samsung 65" QN90D Neo QLED 4K Smart TV (2024)',
    domain: 'bestbuy.ca',
    price: 129999,
    priceWas: 159999,
    gtin: CROSS_MERCHANT_GTIN,
    brand: 'Samsung',
    mpn: 'QN65QN90DAFXZC',
    votes: 142,
    hoursAgo: 3,
    shipping: 'Free shipping',
  },
  {
    title: 'Samsung 65" QN90D Neo QLED 4K Smart TV',
    domain: 'costco.ca',
    price: 149999,
    priceWas: null,
    gtin: CROSS_MERCHANT_GTIN,
    brand: 'Samsung',
    mpn: 'QN65QN90DAFXZC',
    hoursAgo: 9,
  },
  {
    title: 'Samsung QN90D 65 inch Neo QLED Television',
    domain: 'visions.ca',
    price: 152999,
    priceWas: null,
    gtin: CROSS_MERCHANT_GTIN,
    brand: 'Samsung',
    mpn: 'QN65QN90DAFXZC',
    hoursAgo: 20,
  },
  {
    // Deliberately dishonest: a $2,499 "was" on a TV the market sells at ~$1,500.
    // The verification pass should flag this and demote it.
    title: 'Samsung 65" QN90D Neo QLED TV - HUGE SAVINGS',
    domain: 'thesource.ca',
    price: 149999,
    priceWas: 249999,
    gtin: CROSS_MERCHANT_GTIN,
    brand: 'Samsung',
    mpn: 'QN65QN90DAFXZC',
    votes: 8,
    hoursAgo: 5,
  },

  // --- Electronics ---------------------------------------------------------
  { title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones', domain: 'bestbuy.ca', price: 32800, priceWas: 49999, brand: 'Sony', mpn: 'WH1000XM5B', votes: 210, hoursAgo: 2, shipping: 'Free shipping' },
  { title: 'Apple AirPods Pro (2nd generation) with USB-C', domain: 'bestbuy.ca', price: 27999, priceWas: 32900, brand: 'Apple', votes: 96, hoursAgo: 6 },
  { title: 'Google Pixel 9 Pro 256GB - Unlocked', domain: 'bestbuy.ca', price: 109999, priceWas: 139999, brand: 'Google', votes: 54, hoursAgo: 14 },
  { title: 'Bose SoundLink Flex Portable Bluetooth Speaker', domain: 'thesource.ca', price: 11999, priceWas: 17999, brand: 'Bose', votes: 33, hoursAgo: 26 },
  { title: 'GoPro HERO12 Black Action Camera Bundle', domain: 'bestbuy.ca', price: 39999, priceWas: 54999, brand: 'GoPro', votes: 71, hoursAgo: 30 },
  { title: 'Kindle Paperwhite 16GB - Ad-Supported', domain: 'amazon.ca', price: 14999, priceWas: 19499, brand: 'Amazon', votes: 88, hoursAgo: 11 },

  // --- Computers -----------------------------------------------------------
  { title: 'Dell XPS 15 Laptop - Intel Core i7, 16GB RAM, 512GB SSD', domain: 'dell.ca', price: 179999, priceWas: 229999, brand: 'Dell', votes: 44, hoursAgo: 18 },
  { title: 'Samsung 990 PRO 2TB NVMe PCIe 4.0 SSD', domain: 'canadacomputers.com', price: 19999, priceWas: 29999, brand: 'Samsung', mpn: 'MZ-V9P2T0BW', votes: 152, hoursAgo: 4 },
  { title: 'Logitech MX Master 3S Wireless Mouse', domain: 'staples.ca', price: 9999, priceWas: 13999, brand: 'Logitech', votes: 27, hoursAgo: 22 },
  { title: 'LG 27" UltraGear QHD 165Hz Gaming Monitor', domain: 'memoryexpress.com', price: 29999, priceWas: 44999, brand: 'LG', votes: 63, hoursAgo: 7 },
  { title: 'Corsair Vengeance 32GB (2x16GB) DDR5-6000 RAM', domain: 'newegg.ca', price: 12999, priceWas: 18999, brand: 'Corsair', votes: 39, hoursAgo: 33 },

  // --- Gaming --------------------------------------------------------------
  { title: 'PlayStation 5 Slim Digital Edition Console', domain: 'bestbuy.ca', price: 49999, priceWas: 62999, brand: 'Sony', votes: 302, hoursAgo: 1, shipping: 'Free shipping' },
  { title: 'Nintendo Switch OLED Model - White Joy-Con', domain: 'walmart.ca', price: 39999, priceWas: 44999, brand: 'Nintendo', votes: 118, hoursAgo: 16 },
  { title: 'Secretlab TITAN Evo Gaming Chair - Black', domain: 'bestbuy.ca', price: 54900, priceWas: 68900, brand: 'Secretlab', votes: 22, hoursAgo: 40 },

  // --- Toys and games ------------------------------------------------------
  { title: 'LEGO Star Wars Millennium Falcon 75375', domain: 'toysrus.ca', price: 8499, priceWas: 10999, brand: 'LEGO', mpn: '75375', votes: 74, hoursAgo: 5 },
  { title: 'Hot Wheels 20-Car Gift Pack', domain: 'walmart.ca', price: 2497, priceWas: 3497, brand: 'Hot Wheels', votes: 19, hoursAgo: 28 },
  { title: 'Paw Patrol Big Truck Pups Toy Vehicle Set', domain: 'toysrus.ca', price: 3999, priceWas: 5999, brand: 'Paw Patrol', votes: 12, hoursAgo: 44 },
  { title: 'Ravensburger 1000 Piece Jigsaw Puzzle - Mountain Vista', domain: 'mastermindtoys.com', price: 1799, priceWas: 2499, brand: 'Ravensburger', votes: 8, hoursAgo: 50 },
  { title: 'Magna-Tiles Clear Colors 100 Piece Set', domain: 'mastermindtoys.com', price: 12999, priceWas: 17999, brand: 'Magna-Tiles', votes: 41, hoursAgo: 12 },
  { title: 'Squishmallows 16" Plush - Assorted', domain: 'walmart.ca', price: 1997, priceWas: 2997, votes: 15, hoursAgo: 36 },

  // --- Baby and kids -------------------------------------------------------
  { title: 'Graco Modes Pramette Travel System Stroller', domain: 'snugglebugz.ca', price: 39999, priceWas: 54999, brand: 'Graco', votes: 29, hoursAgo: 20, department: 'baby' },
  { title: 'Britax One4Life Convertible Car Seat', domain: 'westcoastkids.ca', price: 44999, priceWas: 59999, brand: 'Britax', votes: 34, hoursAgo: 25, department: 'baby' },
  { title: 'Pampers Baby Dry Diapers Size 4 - 174 Count', domain: 'well.ca', price: 4499, priceWas: 5999, brand: 'Pampers', coupon: 'BABY15', votes: 47, hoursAgo: 8, department: 'baby' },

  // --- Clothing: Gap Inc. family -------------------------------------------
  { title: "Old Navy Girls' Frost-Free Puffer Jacket", domain: 'oldnavy.ca', price: 2999, priceWas: 7999, brand: 'Old Navy', coupon: 'WARM20', votes: 61, hoursAgo: 3, department: 'girls', sizes: ['XS', 'S', 'M', 'L'] },
  { title: "Old Navy Boys' Sherpa-Lined Hoodie", domain: 'oldnavy.ca', price: 2199, priceWas: 4499, brand: 'Old Navy', coupon: 'WARM20', votes: 23, hoursAgo: 10, department: 'boys', sizes: ['S', 'M', 'L'] },
  { title: "Gap Men's Vintage Soft Arch Logo Hoodie", domain: 'gapcanada.ca', price: 3499, priceWas: 6995, brand: 'Gap', votes: 18, hoursAgo: 15, department: 'men', sizes: ['S', 'M', 'L', 'XL'] },
  { title: "Banana Republic Merino Wool Crew Sweater", domain: 'bananarepublic.ca', price: 5999, priceWas: 12000, brand: 'Banana Republic', votes: 26, hoursAgo: 21, department: 'men' },
  { title: "Athleta Women's Ultimate Stash Pocket 7/8 Tight", domain: 'athleta.ca', price: 4999, priceWas: 10900, brand: 'Athleta', votes: 52, hoursAgo: 6, department: 'women', sizes: ['XS', 'S', 'M'] },
  { title: "Gap Factory Women's Cropped Denim Jacket", domain: 'gapfactory.ca', price: 2999, priceWas: 7995, brand: 'Gap Factory', votes: 14, hoursAgo: 34, department: 'women' },

  // --- Clothing: Reitmans family -------------------------------------------
  { title: "Reitmans Women's Slim Leg Comfort Pant", domain: 'reitmans.com', price: 2499, priceWas: 5990, brand: 'Reitmans', votes: 11, hoursAgo: 27, department: 'women', sizes: ['4', '6', '8', '10'] },
  { title: 'RW&CO. Tailored Blazer - Navy', domain: 'rw-co.com', price: 6999, priceWas: 14900, brand: 'RW&CO.', votes: 9, hoursAgo: 38, department: 'women' },
  { title: 'Penningtons Plus Size Winter Parka', domain: 'penningtons.com', price: 8999, priceWas: 19900, brand: 'Penningtons', votes: 17, hoursAgo: 13, department: 'women', sizes: ['1X', '2X', '3X'] },

  // --- Clothing and footwear: other ----------------------------------------
  { title: 'Roots Original Kanga Sweatpant', domain: 'roots.com', price: 4999, priceWas: 8800, brand: 'Roots', votes: 38, hoursAgo: 9, department: 'unisex', sizes: ['S', 'M', 'L'] },
  { title: 'Nike Air Max 90 - Men’s Sneakers', domain: 'softmoc.com', price: 10999, priceWas: 16000, brand: 'Nike', votes: 45, hoursAgo: 17, department: 'men', sizes: ['9', '10', '11'] },
  { title: 'Blundstone 550 Chelsea Boots - Walnut', domain: 'softmoc.com', price: 18999, priceWas: 24995, brand: 'Blundstone', votes: 31, hoursAgo: 23, department: 'unisex' },
  { title: 'Columbia Powder Lite Insulated Jacket', domain: 'altitude-sports.com', price: 8999, priceWas: 16999, brand: 'Columbia', votes: 42, hoursAgo: 4, department: 'men' },
  { title: 'Uniqlo Ultra Light Down Vest', domain: 'uniqlo.com', price: 3990, priceWas: 6990, brand: 'Uniqlo', votes: 20, hoursAgo: 31, department: 'unisex' },

  // --- Kitchen and appliances ----------------------------------------------
  { title: 'Ninja Foodi 6-in-1 8QT 2-Basket Air Fryer', domain: 'canadiantire.ca', price: 17999, priceWas: 27999, brand: 'Ninja', votes: 133, hoursAgo: 2 },
  { title: 'Instant Pot Duo Plus 6QT Pressure Cooker', domain: 'walmart.ca', price: 8999, priceWas: 14999, brand: 'Instant Pot', votes: 87, hoursAgo: 19 },
  { title: 'Nespresso Vertuo Next Coffee and Espresso Maker', domain: 'bestbuy.ca', price: 12999, priceWas: 21999, brand: 'Nespresso', coupon: 'BREW25', votes: 58, hoursAgo: 7 },
  { title: 'KitchenAid Artisan 5QT Stand Mixer - Empire Red', domain: 'thebay.com', price: 39999, priceWas: 64999, brand: 'KitchenAid', votes: 94, hoursAgo: 12 },
  { title: 'Dyson V15 Detect Cordless Stick Vacuum', domain: 'costco.ca', price: 59999, priceWas: 89999, brand: 'Dyson', votes: 201, hoursAgo: 5 },
  { title: 'LG WashTower Stacked Washer and Dryer', domain: 'leons.ca', price: 219999, priceWas: 299999, brand: 'LG', votes: 24, hoursAgo: 29 },

  // --- Home ----------------------------------------------------------------
  { title: 'IKEA MALM 6-Drawer Dresser - White', domain: 'ikea.com', price: 22900, priceWas: 29900, brand: 'IKEA', votes: 16, hoursAgo: 41 },
  { title: 'Endy Original Mattress - Queen', domain: 'wayfair.ca', price: 89500, priceWas: 122500, brand: 'Endy', coupon: 'SLEEP150', votes: 49, hoursAgo: 8 },
  { title: 'Weber Spirit II E-310 3-Burner Propane BBQ', domain: 'canadiantire.ca', price: 64999, priceWas: 79999, brand: 'Weber', votes: 37, hoursAgo: 46 },
  { title: 'Philips Hue White and Colour Starter Kit', domain: 'bestbuy.ca', price: 17999, priceWas: 25999, brand: 'Philips', votes: 55, hoursAgo: 15 },

  // --- Tools and auto ------------------------------------------------------
  { title: 'DEWALT 20V MAX Cordless Drill and Impact Driver Combo Kit', domain: 'homedepot.ca', price: 24999, priceWas: 39999, brand: 'DEWALT', mpn: 'DCK240C2', votes: 167, hoursAgo: 3 },
  { title: 'Mastercraft 200-Piece Socket Set', domain: 'canadiantire.ca', price: 8999, priceWas: 19999, brand: 'Mastercraft', votes: 78, hoursAgo: 11 },
  { title: 'Michelin X-Ice Snow Winter Tire 205/55R16', domain: 'canadiantire.ca', price: 15999, priceWas: 21999, brand: 'Michelin', votes: 43, hoursAgo: 24 },

  // --- Sports and outdoors -------------------------------------------------
  { title: 'MEC Volt 20L Hiking Backpack', domain: 'mec.ca', price: 5999, priceWas: 9500, brand: 'MEC', votes: 21, hoursAgo: 32 },
  { title: 'Bauer Vapor X3.7 Senior Hockey Skates', domain: 'sportchek.ca', price: 24999, priceWas: 39999, brand: 'Bauer', votes: 36, hoursAgo: 18 },
  { title: 'Coleman Sundome 4-Person Camping Tent', domain: 'atmosphere.ca', price: 7999, priceWas: 12999, brand: 'Coleman', votes: 25, hoursAgo: 37 },
  { title: 'YETI Tundra 45 Hard Cooler', domain: 'sail.ca', price: 34999, priceWas: 44999, brand: 'YETI', votes: 29, hoursAgo: 43 },

  // --- Beauty and health ---------------------------------------------------
  { title: 'CeraVe Moisturizing Cream 454g', domain: 'well.ca', price: 1799, priceWas: 2499, brand: 'CeraVe', votes: 62, hoursAgo: 6 },
  { title: 'Philips Sonicare 4100 Electric Toothbrush', domain: 'shoppersdrugmart.ca', price: 3999, priceWas: 6999, brand: 'Philips', coupon: 'SMILE20', votes: 40, hoursAgo: 14 },
  { title: 'Dyson Airwrap Multi-Styler Complete Long', domain: 'sephora.com', price: 62999, priceWas: 74999, brand: 'Dyson', votes: 111, hoursAgo: 4 },
  { title: 'La Roche-Posay Anthelios Sunscreen SPF 60', domain: 'well.ca', price: 2299, priceWas: 3299, brand: 'La Roche-Posay', votes: 18, hoursAgo: 39 },

  // --- Grocery -------------------------------------------------------------
  { title: 'Lavazza Super Crema Whole Bean Coffee 1kg', domain: 'amazon.ca', price: 2499, priceWas: 3499, brand: 'Lavazza', votes: 53, hoursAgo: 10 },
  { title: 'Kirkland Signature Granola Bars 64 Pack', domain: 'costco.ca', price: 1799, priceWas: 2299, brand: 'Kirkland', votes: 22, hoursAgo: 47 },

  // --- Deliberate edge cases the UI must handle ----------------------------
  { title: 'Sitewide: Extra 40% off all clearance', domain: 'gapcanada.ca', price: 0, priceWas: null, coupon: 'EXTRA40', votes: 88, hoursAgo: 2, image: null, description: 'Storewide promotion, discount applied at checkout.' },
  { title: 'Mystery Box Electronics Bundle', domain: 'newegg.ca', price: 4999, priceWas: null, votes: 5, hoursAgo: 21, image: null },
  { title: 'Sold Out: Nintendo Switch Pro Controller', domain: 'bestbuy.ca', price: 6999, priceWas: 8999, brand: 'Nintendo', inStock: false, votes: 30, hoursAgo: 16 },
  { title: 'Ends Tonight: Roots Sweatshirt Doorcrasher', domain: 'roots.com', price: 2999, priceWas: 7800, brand: 'Roots', expiresInHours: 6, votes: 66, hoursAgo: 9, department: 'unisex' },

  // --- Store-local clearance (drives /near-me) ------------------------------
  { title: 'In-store clearance: Mastercraft Cordless Drill', domain: 'canadiantire.ca', price: 4999, priceWas: 12999, storeChain: 'canadian-tire', votes: 0, hoursAgo: 5 },
  { title: 'In-store clearance: Woods Winter Sleeping Bag', domain: 'canadiantire.ca', price: 2999, priceWas: 8999, storeChain: 'canadian-tire', votes: 0, hoursAgo: 8 },
  { title: 'Red-tag clearance: NordicTrack Exercise Bike', domain: 'canadiantire.ca', price: 29999, priceWas: 79999, storeChain: 'canadian-tire', votes: 0, hoursAgo: 12 },
  { title: 'In-store clearance: Bauer Youth Hockey Helmet', domain: 'sportchek.ca', price: 3499, priceWas: 8999, storeChain: 'sportchek', votes: 0, hoursAgo: 14 },
  { title: 'In-store clearance: Under Armour Training Shorts', domain: 'sportchek.ca', price: 1499, priceWas: 4499, storeChain: 'sportchek', votes: 0, hoursAgo: 18, department: 'men' },
  { title: 'Clearance: Instant Pot Air Fryer Lid', domain: 'walmart.ca', price: 3900, priceWas: 9900, storeChain: 'walmart', votes: 0, hoursAgo: 22 },
  { title: 'Clearance: Graco Baby Swing (floor model)', domain: 'walmart.ca', price: 5900, priceWas: 14900, storeChain: 'walmart', votes: 0, hoursAgo: 26, department: 'baby' },
];

/** Stores near downtown Toronto, so /near-me has something to show. */
export function buildSeedStores(): StoreInput[] {
  return [
    { id: 'store-ct-yonge', chain: 'canadian-tire', sourceStoreId: 'CT-0042', name: 'Canadian Tire — Yonge & Davenport', address: '839 Yonge St', city: 'Toronto', province: 'ON', postalCode: 'M4W 2H1', lat: 43.6757, lng: -79.3885 },
    { id: 'store-ct-leaside', chain: 'canadian-tire', sourceStoreId: 'CT-0117', name: 'Canadian Tire — Leaside', address: '66 Overlea Blvd', city: 'Toronto', province: 'ON', postalCode: 'M4H 1C4', lat: 43.7043, lng: -79.3487 },
    { id: 'store-sc-eaton', chain: 'sportchek', sourceStoreId: 'SC-0210', name: 'SportChek — CF Toronto Eaton Centre', address: '220 Yonge St', city: 'Toronto', province: 'ON', postalCode: 'M5B 2H1', lat: 43.6544, lng: -79.3807 },
    { id: 'store-wm-dufferin', chain: 'walmart', sourceStoreId: 'WM-3106', name: 'Walmart — Dufferin Mall', address: '900 Dufferin St', city: 'Toronto', province: 'ON', postalCode: 'M6H 4A9', lat: 43.6555, lng: -79.4356 },
    { id: 'store-ct-vaughan', chain: 'canadian-tire', sourceStoreId: 'CT-0388', name: 'Canadian Tire — Vaughan Mills', address: '1 Bass Pro Mills Dr', city: 'Vaughan', province: 'ON', postalCode: 'L4K 5W4', lat: 43.8256, lng: -79.5385 },
  ];
}

export interface SeedPricePoint {
  dealId: string;
  price: number;
  observedAt: string;
}

export function buildSeedDeals(
  merchantId: (domain: string) => string,
  stores: StoreInput[],
): { deals: DealInput[]; priceHistory: SeedPricePoint[] } {
  const now = new Date();
  const deals: DealInput[] = [];
  const priceHistory: SeedPricePoint[] = [];

  const storesByChain = new Map<string, StoreInput[]>();
  for (const store of stores) {
    storesByChain.set(store.chain, [...(storesByChain.get(store.chain) ?? []), store]);
  }

  for (const [index, spec] of SPECS.entries()) {
    const id = `seed-${String(index).padStart(3, '0')}-${randomUUID().slice(0, 8)}`;
    const postedAt = new Date(now.getTime() - (spec.hoursAgo ?? 12) * 3_600_000).toISOString();

    const { discountPct, discountAbs, priceWas } = computeDiscount(
      spec.price,
      spec.priceWas ?? null,
    );

    const category = spec.category ?? classifyCategory({ title: spec.title });
    const department =
      spec.department ?? classifyDepartment({ title: spec.title, category });

    const identity = resolveProductIdentity({
      title: spec.title,
      brand: spec.brand ?? null,
      gtin: spec.gtin ?? null,
      mpn: spec.mpn ?? null,
    });

    const chainStores = spec.storeChain ? (storesByChain.get(spec.storeChain) ?? []) : [];
    const store = chainStores[index % Math.max(1, chainStores.length)];

    deals.push({
      id,
      source: spec.storeChain ? 'stocktrack' : 'seed',
      sourceId: `seed-${index}`,
      slug: slugify(spec.title, id),
      url: `https://www.${spec.domain}/product/seed-${index}`,
      canonicalUrl: `https://${spec.domain}/product/seed-${index}`,
      title: spec.title,
      description:
        spec.description ??
        `${spec.brand ? `${spec.brand}. ` : ''}Seeded sample deal used to exercise the interface offline.`,
      imageUrl: spec.image === null ? null : placeholder(spec.brand ?? spec.title),
      merchantId: merchantId(spec.domain),
      storeId: spec.storeChain ? (store?.id ?? null) : null,
      category,
      department,
      brand: spec.brand ?? null,
      sizesAvailable: spec.sizes ?? null,
      productKey: identity.key,
      productKeyStrength: identity.strength,
      gtin: spec.gtin ?? null,
      mpn: spec.mpn ?? null,
      asin: null,
      priceNow: spec.price,
      priceWas,
      currency: 'CAD',
      discountPct,
      discountAbs,
      marketPrice: null,
      marketDiscountPct: null,
      observedLow: null,
      priceRankPct: null,
      verdict: 'unverified',
      evidence: 'none',
      claimSuspect: false,
      qualityNote: null,
      couponCode: spec.coupon ?? null,
      couponNote: spec.coupon ? 'Use code at checkout' : null,
      shippingNote: spec.shipping ?? null,
      inStock: spec.inStock ?? true,
      stockNote: spec.storeChain ? 'Limited stock in store' : null,
      postedAt,
      expiresAt: spec.expiresInHours
        ? new Date(now.getTime() + spec.expiresInHours * 3_600_000).toISOString()
        : null,
      votes: spec.votes ?? 0,
      heat: computeHeat({
        votes: spec.votes ?? 0,
        discountPct,
        postedAt,
        source: spec.storeChain ? 'stocktrack' : 'bestbuy',
        now,
      }),
      status: 'active',
      locale: 'en-CA',
      alsoSeenOn: null,
      sourcePath: null,
    });

    // A declining price series on the better-discounted deals, so the detail
    // page chart and the "lowest in N days" verdict have real data behind them.
    if (discountPct !== null && discountPct > 25) {
      const steps = 5;
      for (let step = 0; step < steps; step += 1) {
        const daysAgo = (steps - step) * 14;
        const drift = 1 + (steps - step) * 0.08;
        priceHistory.push({
          dealId: id,
          price: Math.round(spec.price * drift),
          observedAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
        });
      }
    }
  }

  // Run the real verification pass over the seed set so verdicts are computed
  // from the data rather than hard-coded. The four Samsung listings produce a
  // genuine verified-good, a market-price, an above-market and an
  // inflated-anchor between them.
  applyVerification(deals, priceHistory, now);

  return { deals, priceHistory };
}

function applyVerification(
  deals: DealInput[],
  priceHistory: SeedPricePoint[],
  now: Date,
): void {
  const historyByProductKey = new Map<
    string,
    Array<{ price: number; observedAt: string; merchantId: string | null }>
  >();

  const dealsById = new Map(deals.map((deal) => [deal.id, deal]));
  for (const point of priceHistory) {
    const deal = dealsById.get(point.dealId);
    if (!deal?.productKey) continue;

    const bucket = historyByProductKey.get(deal.productKey) ?? [];
    bucket.push({
      price: point.price,
      observedAt: point.observedAt,
      merchantId: deal.merchantId,
    });
    historyByProductKey.set(deal.productKey, bucket);
  }

  const byProductKey = new Map<string, DealInput[]>();
  for (const deal of deals) {
    if (!deal.productKey) continue;
    byProductKey.set(deal.productKey, [...(byProductKey.get(deal.productKey) ?? []), deal]);
  }

  for (const deal of deals) {
    const siblings = deal.productKey ? (byProductKey.get(deal.productKey) ?? []) : [];

    const perMerchant = new Map<string, number>();
    for (const sibling of siblings) {
      if (sibling.id === deal.id) continue;
      if (!sibling.merchantId || sibling.merchantId === deal.merchantId) continue;
      if (sibling.priceNow === null) continue;
      const existing = perMerchant.get(sibling.merchantId);
      if (existing === undefined || sibling.priceNow < existing) {
        perMerchant.set(sibling.merchantId, sibling.priceNow);
      }
    }

    const history = deal.productKey ? (historyByProductKey.get(deal.productKey) ?? []) : [];
    // Prior observations only - see assessDealQuality's observedHistory contract.
    const observed = history.map((point) => point.price);

    const historyDays =
      history.length > 0
        ? Math.max(
            ...history.map(
              (point) => (now.getTime() - Date.parse(point.observedAt)) / 86_400_000,
            ),
          )
        : 0;

    const quality = assessDealQuality({
      priceNow: deal.priceNow,
      claimedPriceWas: deal.priceWas,
      identityStrength: deal.productKeyStrength ?? 'none',
      competitorPrices: [...perMerchant.values()],
      observedHistory: observed,
      historyDays,
    });

    deal.marketPrice = quality.marketPrice;
    deal.marketDiscountPct = quality.marketDiscountPct;
    deal.observedLow = quality.observedLow;
    deal.priceRankPct = quality.priceRankPct;
    deal.verdict = quality.verdict;
    deal.evidence = quality.evidence;
    deal.claimSuspect = quality.claimSuspect;
    deal.qualityNote = quality.explanation;

    deal.heat = computeHeat({
      votes: deal.votes,
      discountPct: trustedDiscountPct(quality, deal.discountPct),
      postedAt: deal.postedAt,
      source: deal.source,
      now,
    });

    if (quality.verdict === 'inflated-anchor') {
      deal.heat = Math.min(deal.heat ?? 0, 25);
    }
  }
}
