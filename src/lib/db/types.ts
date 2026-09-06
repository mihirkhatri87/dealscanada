/** Shared row and query types. Money is always integer cents. */

import type { DealVerdict, EvidenceLevel } from '../pipeline/deal-quality';
import type { IdentityStrength } from '../pipeline/product-key';

export type { DealVerdict, EvidenceLevel, IdentityStrength };

export type DealStatus = 'active' | 'expired' | 'dead';
export type MerchantStatus = 'verified' | 'unverified' | 'blocked';
export type RunOutcome = 'ok' | 'failed' | 'skipped';

export const CATEGORIES = [
  'electronics',
  'computers',
  'gaming',
  'clothing',
  'shoes-accessories',
  'toys-games',
  'baby-kids',
  'home',
  'kitchen',
  'appliances',
  'grocery',
  'beauty-health',
  'sports-outdoors',
  'tools-auto',
  'travel',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const DEPARTMENTS = ['women', 'men', 'girls', 'boys', 'baby', 'unisex', 'na'] as const;
export type Department = (typeof DEPARTMENTS)[number];

export interface Merchant {
  id: string;
  slug: string;
  name: string;
  domain: string;
  logoUrl: string | null;
  affiliateUrlTemplate: string | null;
  family: string | null;
  vertical: string | null;
  engine: string | null;
  status: MerchantStatus;
  rateLimitRps: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Store {
  id: string;
  chain: string;
  sourceStoreId: string;
  name: string;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Deal {
  id: string;
  source: string;
  sourceId: string;
  slug: string;
  url: string;
  canonicalUrl: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  merchantId: string | null;
  storeId: string | null;
  category: Category;
  department: Department;
  brand: string | null;
  /** Plain shopper words for what this is; see pipeline/keywords.ts. */
  keywords: string | null;
  sizesAvailable: string[] | null;
  /** Cross-merchant product identity; null when nothing reliable was available. */
  productKey: string | null;
  productKeyStrength: IdentityStrength | null;
  gtin: string | null;
  mpn: string | null;
  asin: string | null;
  /** Integer cents. */
  priceNow: number | null;
  /** Integer cents. NULL unless a source actually supplied a before price. */
  priceWas: number | null;
  currency: string;
  /** The RETAILER'S CLAIMED discount. Not evidence. See verdict below. */
  discountPct: number | null;
  discountAbs: number | null;

  /** What we can actually corroborate — see src/lib/pipeline/deal-quality.ts. */
  marketPrice: number | null;
  marketDiscountPct: number | null;
  observedLow: number | null;
  priceRankPct: number | null;
  verdict: DealVerdict;
  evidence: EvidenceLevel;
  claimSuspect: boolean;
  qualityNote: string | null;
  couponCode: string | null;
  couponNote: string | null;
  shippingNote: string | null;
  inStock: boolean;
  stockNote: string | null;
  postedAt: string | null;
  expiresAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  votes: number;
  heat: number;
  status: DealStatus;
  locale: string;
  alsoSeenOn: string[] | null;
  sourcePath: string | null;
}

/** A deal joined with the display fields the UI and assistant both need. */
export interface DealWithRelations extends Deal {
  merchant: Pick<Merchant, 'id' | 'slug' | 'name' | 'domain' | 'logoUrl' | 'family'> | null;
  store: Pick<Store, 'id' | 'name' | 'chain' | 'city' | 'province' | 'lat' | 'lng'> | null;
  /** Present only on proximity queries. */
  distanceKm?: number;
}

export interface PricePoint {
  price: number;
  observedAt: string;
}

export interface SourceRun {
  id: string;
  source: string;
  startedAt: string;
  finishedAt: string | null;
  outcome: RunOutcome;
  itemsFound: number;
  itemsNew: number;
  itemsUpdated: number;
  itemsDropped: number;
  latencyMs: number | null;
  httpStatus: number | null;
  sourcePath: string | null;
  error: string | null;
}

export type DealSort =
  | 'hottest'
  | 'newest'
  | 'biggest-drop'
  /** Corroborated bargains first — see pipeline/deal-quality.ts. */
  | 'best-verified'
  | 'price-asc'
  | 'price-desc'
  | 'expiring';

/**
 * The single query shape.
 *
 * This is the load-bearing type of the whole product: the FilterBar produces it,
 * the API validates it, the repository consumes it — and the shopping assistant's
 * tools emit exactly this and nothing else. One query layer, two drivers.
 */
export interface DealQuery {
  search?: string;
  categories?: Category[];
  departments?: Department[];
  merchantSlugs?: string[];
  families?: string[];
  brands?: string[];
  /** Integer cents. */
  minPrice?: number;
  maxPrice?: number;
  minDiscountPct?: number;
  couponOnly?: boolean;
  inStockOnly?: boolean;
  /** Only deals corroborated by cross-merchant or historical evidence. */
  verifiedOnly?: boolean;
  /** Exclude deals whose claimed "was" price we believe is inflated. */
  excludeSuspect?: boolean;
  verdicts?: DealVerdict[];
  storeIds?: string[];
  /** Filter by ingesting source, e.g. ['seed'] to count sample rows. */
  sources?: string[];
  statuses?: DealStatus[];
  sort?: DealSort;
  limit?: number;
  offset?: number;
}

export interface DealQueryResult {
  deals: DealWithRelations[];
  total: number;
}

export interface FacetValue {
  value: string;
  label: string;
  count: number;
}
