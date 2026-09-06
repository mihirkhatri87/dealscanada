import type { Dialect } from './dialect';
import type { DealQuery, DealSort } from './types';

/**
 * Builds the deal query once, for both dialects.
 *
 * The filter logic is subtle enough (nullable prices, tie-break stability, coupon
 * semantics) that having two copies would guarantee divergence between SQLite and
 * Postgres. Instead this emits SQL with dialect-appropriate placeholders and a
 * positional parameter array both drivers accept.
 */

export interface BuiltQuery {
  where: string;
  params: unknown[];
  orderBy: string;
}

const SORTS: Record<DealSort, string> = {
  // NULLS LAST is spelled differently per dialect, so sorts are written to avoid
  // needing it: coalesce to a value that sorts last for the direction in use.
  hottest: 'd.heat DESC',
  newest: 'COALESCE(d.posted_at, d.first_seen_at) DESC',
  // Ranks on the discount we can corroborate, falling back to the claim only
  // where nothing contradicts it.
  'biggest-drop': 'COALESCE(d.market_discount_pct, d.discount_pct, -1) DESC',
  'best-verified':
    "CASE d.verdict WHEN 'verified-low' THEN 3 WHEN 'verified-good' THEN 2 WHEN 'market-price' THEN 1 ELSE 0 END DESC, COALESCE(d.market_discount_pct, 0) DESC",
  'price-asc': 'COALESCE(d.price_now, 999999999) ASC',
  'price-desc': 'COALESCE(d.price_now, -1) DESC',
  expiring: "COALESCE(d.expires_at, '9999-12-31') ASC",
};

export function buildDealQuery(query: DealQuery, dialect: Dialect): BuiltQuery {
  const params: unknown[] = [];
  const clauses: string[] = [];

  const ph = (value: unknown): string => {
    params.push(value);
    return dialect === 'sqlite' ? '?' : `$${params.length}`;
  };

  const inList = (values: readonly string[]): string => values.map((value) => ph(value)).join(', ');

  // Default to active deals only. Expired deals stay reachable by direct URL but
  // must not pollute listings.
  const statuses = query.statuses?.length ? query.statuses : ['active'];
  clauses.push(`d.status IN (${inList(statuses)})`);

  if (query.categories?.length) {
    clauses.push(`d.category IN (${inList(query.categories)})`);
  }
  if (query.departments?.length) {
    clauses.push(`d.department IN (${inList(query.departments)})`);
  }
  if (query.merchantSlugs?.length) {
    clauses.push(`m.slug IN (${inList(query.merchantSlugs)})`);
  }
  if (query.families?.length) {
    clauses.push(`m.family IN (${inList(query.families)})`);
  }
  if (query.brands?.length) {
    clauses.push(`LOWER(d.brand) IN (${inList(query.brands.map((b) => b.toLowerCase()))})`);
  }
  if (query.storeIds?.length) {
    clauses.push(`d.store_id IN (${inList(query.storeIds)})`);
  }
  if (query.sources?.length) {
    clauses.push(`d.source IN (${inList(query.sources)})`);
  }

  // A deal with no known price should not be excluded by a price ceiling the user
  // set — but it must be excluded by a floor, since we cannot claim it qualifies.
  if (typeof query.minPrice === 'number') {
    clauses.push(`d.price_now IS NOT NULL AND d.price_now >= ${ph(query.minPrice)}`);
  }
  if (typeof query.maxPrice === 'number') {
    clauses.push(`(d.price_now IS NULL OR d.price_now <= ${ph(query.maxPrice)})`);
  }
  if (typeof query.minDiscountPct === 'number') {
    clauses.push(`d.discount_pct IS NOT NULL AND d.discount_pct >= ${ph(query.minDiscountPct)}`);
  }
  if (query.couponOnly) {
    clauses.push(`d.coupon_code IS NOT NULL AND d.coupon_code <> ''`);
  }
  if (query.inStockOnly) {
    clauses.push(`d.in_stock = 1`);
  }

  // Verified-deal filters. These exist because a retailer's own "was" price is
  // not evidence; see src/lib/pipeline/deal-quality.ts.
  if (query.verifiedOnly) {
    clauses.push(`d.verdict IN ('verified-low', 'verified-good')`);
  }
  if (query.excludeSuspect) {
    clauses.push(`d.claim_suspect = 0`);
  }
  if (query.verdicts?.length) {
    clauses.push(`d.verdict IN (${inList(query.verdicts)})`);
  }

  if (query.search?.trim()) {
    // Accent- and case-insensitive partial matching across the fields a shopper
    // would actually type into a search box.
    const term = normalizeSearchTerm(query.search);

    /**
     * Matches the term at the START of a word, not anywhere inside one.
     *
     * A bare '%table%' matches "comfortable", "sustainable", "adjustable" and
     * "breathable" — words that appear in the description of most garments ever
     * written. Searching "table" returned tank tops and beanies, and any real
     * table was buried under them.
     *
     * Padding the column with a leading space lets one LIKE cover both "the
     * word starts the text" and "the word follows a space", so "tables" and
     * "tablecloth" still match while "comfortable" no longer does.
     */
    const wordStart = (column: string): string =>
      `(' ' || LOWER(COALESCE(${column}, ''))) LIKE ${ph(`% ${term}%`)}`;

    clauses.push(
      `(${wordStart('d.title')} OR ${wordStart('d.description')} OR ${wordStart(
        'm.name',
      )} OR ${wordStart('d.brand')} OR LOWER(COALESCE(d.keywords, '')) LIKE ${ph(
        // Keywords are stored already padded, and are whole words by
        // construction, so this is an exact word match rather than a prefix.
        `% ${term} %`,
      )})`,
    );
  }

  const sort = SORTS[query.sort ?? 'hottest'];
  // Always tie-break on id so pagination is deterministic — without this, two rows
  // with equal heat can swap between pages and a user sees a duplicate or a gap.
  const orderBy = `${sort}, d.id ASC`;

  return { where: clauses.join(' AND '), params, orderBy };
}

/**
 * Lowercases and strips diacritics so "Bébé" matches a search for "bebe".
 * Applied to both the needle and, at write time, nothing — the LIKE runs against
 * raw columns, so this only widens matching for the common accented cases via
 * the caller normalizing input. Deliberately simple and dependency-free.
 */
export function normalizeSearchTerm(term: string): string {
  return term.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Bounding box for a radius query.
 *
 * SQLite is not guaranteed to ship trig functions, so proximity is done in two
 * steps: a cheap indexable box filter in SQL, then exact haversine in JS. This is
 * both portable and faster than trig in the database.
 */
export function boundingBox(lat: number, lng: number, radiusKm: number) {
  const latDelta = radiusKm / 111.32;
  // Guard the pole case where cos(lat) approaches zero.
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const lngDelta = radiusKm / (111.32 * cosLat);
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}
