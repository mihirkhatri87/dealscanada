import { z } from 'zod';
import type { AdapterContext, AdapterResult, RawDeal, SourceAdapter } from './types';

/**
 * Best Buy Canada.
 *
 * The most valuable retailer source in the catalogue: its storefront API returns
 * regularPrice alongside salePrice, so before/after comes from the retailer's own
 * system rather than a scraped strikethrough. It also exposes a model number,
 * which feeds cross-merchant product identity.
 *
 * This is the storefront's own JSON, not a documented partner API — so the
 * adapter treats every field as optional and drops items it cannot understand
 * rather than assuming a shape.
 */

const SEARCH_URL = 'https://www.bestbuy.ca/api/v2/json/search';
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

const productSchema = z
  .object({
    sku: z.union([z.string(), z.number()]),
    name: z.string(),
    salePrice: z.number().nullish(),
    regularPrice: z.number().nullish(),
    isOnSale: z.boolean().nullish(),
    isAdvertised: z.boolean().nullish(),
    thumbnailImage: z.string().nullish(),
    highResImage: z.string().nullish(),
    productUrl: z.string().nullish(),
    brandName: z.string().nullish(),
    modelNumber: z.string().nullish(),
    categoryName: z.string().nullish(),
    customerRating: z.number().nullish(),
    hasFreeShipping: z.boolean().nullish(),
    isMarketplace: z.boolean().nullish(),
    availability: z
      .object({
        onlineAvailability: z.string().nullish(),
        isAvailableOnline: z.boolean().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const searchSchema = z
  .object({
    products: z.array(z.unknown()),
    total: z.number().nullish(),
    currentPage: z.number().nullish(),
    totalPages: z.number().nullish(),
  })
  .passthrough();

export function parseSearchResponse(payload: unknown): RawDeal[] {
  const parsed = searchSchema.safeParse(payload);
  if (!parsed.success) return [];

  const deals: RawDeal[] = [];

  for (const candidate of parsed.data.products) {
    const result = productSchema.safeParse(candidate);
    if (!result.success) continue;

    const product = result.data;

    const salePrice = product.salePrice ?? null;
    const regularPrice = product.regularPrice ?? null;

    // Without a current price there is nothing to show. Dropping is correct;
    // a product page with no price is not a deal.
    if (salePrice === null) continue;

    // Only genuinely discounted items belong in a deal feed. The full catalogue
    // at list price is a shopping site, not this.
    const discounted =
      product.isOnSale === true || (regularPrice !== null && regularPrice > salePrice);
    if (!discounted) continue;

    const sku = String(product.sku);
    const url = product.productUrl
      ? absoluteBestBuyUrl(product.productUrl)
      : `https://www.bestbuy.ca/en-ca/product/${sku}`;

    const availability = product.availability?.onlineAvailability?.toUpperCase();
    const inStock =
      product.availability?.isAvailableOnline ??
      (availability ? availability === 'INSTOCK' || availability === 'AVAILABLE' : true);

    deals.push({
      sourceId: sku,
      title: product.name,
      url,
      imageUrl: product.highResImage ?? product.thumbnailImage ?? null,
      price: salePrice,
      // regularPrice is Best Buy's own list price. Still a claim, and still
      // checked by the verification pass - but a far better sourced one than a
      // scraped strikethrough.
      priceWas: regularPrice,
      merchantDomain: 'bestbuy.ca',
      merchantName: 'Best Buy Canada',
      brand: product.brandName ?? null,
      // The model number is what lets the same TV be matched at Walmart and
      // Costco, which is what makes a cross-merchant price claim possible.
      mpn: product.modelNumber ?? null,
      categoryHint: product.categoryName ?? null,
      inStock,
      shippingNote: product.hasFreeShipping ? 'Free shipping' : null,
      currency: 'CAD',
    });
  }

  return deals;
}

function absoluteBestBuyUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `https://www.bestbuy.ca${path.startsWith('/') ? '' : '/'}${path}`;
}

export const bestbuyAdapter: SourceAdapter = {
  id: 'bestbuy',
  name: 'Best Buy Canada',
  weight: 0.7,

  enabled: () => ({ enabled: true }),

  async fetch(context: AdapterContext): Promise<AdapterResult> {
    const limit = context.limit ?? 200;
    const pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(limit / PAGE_SIZE)));
    const collected: RawDeal[] = [];

    for (let page = 1; page <= pages; page += 1) {
      const url =
        `${SEARCH_URL}?lang=en-CA&page=${page}&pageSize=${PAGE_SIZE}` +
        `&path=soldAndShippedBy0enrchstring%3ABest%20Buy&sortBy=bestSelling`;

      const response = await context.http.fetchJson<unknown>(url, {
        skipRobots: true,
        headers: { Accept: 'application/json' },
      });

      const deals = parseSearchResponse(response.data);
      context.log(`page ${page}: ${deals.length} discounted products`);

      collected.push(...deals);
      if (deals.length === 0) break;
      if (collected.length >= limit) break;
    }

    return {
      deals: collected.slice(0, limit),
      path: 'search-api',
      reason:
        collected.length === 0
          ? 'search API reachable but returned no discounted products'
          : undefined,
    };
  },
};
