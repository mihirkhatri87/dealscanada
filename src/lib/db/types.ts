/** Shared row and query types. Money is always integer cents. */

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
  sizesAvailable: string[] | null;
  /** Integer cents. */
  priceNow: number | null;
  /** Integer cents. NULL unless a source actually supplied a before price. */
  priceWas: number | null;
  currency: string;
  discountPct: number | null;
  discountAbs: number | null;
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
  storeIds?: string[];
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
