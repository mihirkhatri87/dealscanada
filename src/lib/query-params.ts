import { z } from 'zod';
import { CATEGORIES, DEPARTMENTS, type DealQuery, type DealSort } from './db/types';

/**
 * The URL query string is the single representation of a filtered view.
 *
 * The FilterBar writes it, the pages read it, the JSON API validates it, and the
 * shopping assistant emits the same DealQuery its tools produce. One encoding,
 * so a view can be handed between browsing and the assistant in either direction
 * without translation — and so a shared link reproduces exactly what was seen.
 */

const SORTS: DealSort[] = [
  'hottest',
  'best-verified',
  'newest',
  'biggest-drop',
  'price-asc',
  'price-desc',
  'expiring',
];

const list = (value: string | null | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const positiveInt = (value: string | null | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
};

export const PAGE_SIZE = 24;

export interface ParsedQuery {
  query: DealQuery;
  page: number;
}

/** Params come from the URL, so every value is treated as untrusted input. */
export function parseSearchParams(
  params: Record<string, string | string[] | undefined>,
): ParsedQuery {
  const get = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const page = Math.max(1, positiveInt(get('page')) ?? 1);

  const categories = list(get('category')).filter((value): value is (typeof CATEGORIES)[number] =>
    (CATEGORIES as readonly string[]).includes(value),
  );
  const departments = list(get('department')).filter(
    (value): value is (typeof DEPARTMENTS)[number] =>
      (DEPARTMENTS as readonly string[]).includes(value),
  );

  const sortParam = get('sort');
  const sort = SORTS.includes(sortParam as DealSort) ? (sortParam as DealSort) : undefined;

  // Prices arrive as dollars in the URL because that is what a person types;
  // everything below this line is cents.
  const toCents = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : undefined;
  };

  const query: DealQuery = {
    search: get('q')?.trim() || undefined,
    categories: categories.length ? categories : undefined,
    departments: departments.length ? departments : undefined,
    merchantSlugs: list(get('merchant')).length ? list(get('merchant')) : undefined,
    families: list(get('family')).length ? list(get('family')) : undefined,
    brands: list(get('brand')).length ? list(get('brand')) : undefined,
    minPrice: toCents(get('minprice')),
    maxPrice: toCents(get('maxprice')),
    minDiscountPct: positiveInt(get('mindiscount')),
    couponOnly: get('coupon') === '1' || undefined,
    inStockOnly: get('instock') === '1' || undefined,
    verifiedOnly: get('verified') === '1' || undefined,
    excludeSuspect: get('hidesuspect') === '1' || undefined,
    sort,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  return { query, page };
}

/** Zod schema for the JSON API, which must reject bad input rather than coerce it. */
export const apiQuerySchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(400).optional(),
  department: z.string().max(200).optional(),
  merchant: z.string().max(400).optional(),
  family: z.string().max(200).optional(),
  brand: z.string().max(400).optional(),
  minprice: z.coerce.number().min(0).max(1_000_000).optional(),
  maxprice: z.coerce.number().min(0).max(1_000_000).optional(),
  mindiscount: z.coerce.number().min(0).max(100).optional(),
  coupon: z.enum(['0', '1']).optional(),
  instock: z.enum(['0', '1']).optional(),
  verified: z.enum(['0', '1']).optional(),
  hidesuspect: z.enum(['0', '1']).optional(),
  sort: z.enum(SORTS as [DealSort, ...DealSort[]]).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** Rebuilds a query string from a DealQuery — the assistant-to-browsing handoff. */
export function toSearchParams(query: DealQuery): URLSearchParams {
  const params = new URLSearchParams();

  if (query.search) params.set('q', query.search);
  if (query.categories?.length) params.set('category', query.categories.join(','));
  if (query.departments?.length) params.set('department', query.departments.join(','));
  if (query.merchantSlugs?.length) params.set('merchant', query.merchantSlugs.join(','));
  if (query.families?.length) params.set('family', query.families.join(','));
  if (query.brands?.length) params.set('brand', query.brands.join(','));
  if (query.minPrice !== undefined) params.set('minprice', String(query.minPrice / 100));
  if (query.maxPrice !== undefined) params.set('maxprice', String(query.maxPrice / 100));
  if (query.minDiscountPct !== undefined) params.set('mindiscount', String(query.minDiscountPct));
  if (query.couponOnly) params.set('coupon', '1');
  if (query.inStockOnly) params.set('instock', '1');
  if (query.verifiedOnly) params.set('verified', '1');
  if (query.excludeSuspect) params.set('hidesuspect', '1');
  if (query.sort) params.set('sort', query.sort);

  return params;
}
