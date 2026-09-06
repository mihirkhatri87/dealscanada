import { z } from 'zod';
import type { AdapterContext, AdapterResult, RawDeal, SourceAdapter } from '../types';
import type { RetailerConfig } from '../catalogue';

/**
 * Magento 2 engine, over the storefront GraphQL endpoint.
 *
 * This is the last of the six platform engines, and the one the catalogue has
 * been waiting on: a long tail of Canadian home, baby and specialty retailers
 * run Magento, and until now every one of them fell through the registry
 * without producing an adapter at all.
 *
 * `/graphql` is the same endpoint the storefront's own JavaScript calls, and
 * Magento serves it publicly for catalogue reads — no key, no account. It is
 * used here in preference to crawling category pages for the reason the Shopify
 * engine prefers `products.json`: the platform states `regular_price` and
 * `final_price` as separate numbers, so before/after is the merchant's own
 * record rather than a strikethrough scraped out of markup that will be
 * restyled next quarter.
 *
 * A retailer is onboarded by adding `engine: 'magento'` and the `url_key` of
 * its sale categories. No code.
 */

const priceSchema = z.object({ value: z.number().nullish() }).passthrough();

const itemSchema = z
  .object({
    name: z.string(),
    sku: z.string().nullish(),
    url_key: z.string().nullish(),
    /** Configurable per store, and routinely empty. See the URL note below. */
    url_suffix: z.string().nullish(),
    small_image: z.object({ url: z.string().nullish() }).passthrough().nullish(),
    price_range: z
      .object({
        minimum_price: z
          .object({
            regular_price: priceSchema.nullish(),
            final_price: priceSchema.nullish(),
          })
          .passthrough()
          .nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const productsSchema = z
  .object({
    data: z
      .object({
        products: z
          .object({ items: z.array(z.unknown()).nullish() })
          .passthrough()
          .nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const categoriesSchema = z
  .object({
    data: z
      .object({
        categoryList: z
          .array(
            z
              .object({
                uid: z.string(),
                url_key: z.string().nullish(),
                product_count: z.number().nullish(),
              })
              .passthrough(),
          )
          .nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

/** Sale category `url_key`s to try when a catalogue entry names none. */
export const SALE_CATEGORIES = ['sale', 'clearance', 'outlet', 'promotions', 'specials'];

/**
 * Resolves sale categories to the opaque uids the product query needs.
 *
 * Magento's `category_uid` is a base64 of an internal id and differs per store,
 * so it cannot be written into the catalogue by hand — asking the store to
 * translate its own `url_key` is what keeps an entry to a readable name.
 */
export function buildCategoryQuery(urlKeys: string[]): string {
  const keys = urlKeys.map((key) => JSON.stringify(key)).join(',');
  return `{categoryList(filters:{url_key:{in:[${keys}]}}){uid url_key product_count}}`;
}

export function buildProductsQuery(categoryUid: string, pageSize: number): string {
  return (
    `{products(filter:{category_uid:{eq:${JSON.stringify(categoryUid)}}},pageSize:${pageSize})` +
    `{items{name sku url_key url_suffix small_image{url}` +
    `price_range{minimum_price{regular_price{value currency}final_price{value}}}}}}`
  );
}

export function parseCategories(payload: unknown): Array<{ uid: string; urlKey: string }> {
  const parsed = categoriesSchema.safeParse(payload);
  if (!parsed.success) return [];

  return (parsed.data.data?.categoryList ?? [])
    // An empty category is a request that will come back with nothing.
    .filter((category) => (category.product_count ?? 1) > 0)
    .map((category) => ({ uid: category.uid, urlKey: category.url_key ?? category.uid }));
}

export interface MagentoParseOptions {
  baseUrl: string;
  merchantDomain: string;
  merchantName?: string;
  departmentHint?: string;
  categoryHint?: string;
}

export function parseMagentoProducts(payload: unknown, options: MagentoParseOptions): RawDeal[] {
  const parsed = productsSchema.safeParse(payload);
  if (!parsed.success) return [];

  const base = options.baseUrl.replace(/\/$/, '');
  const deals: RawDeal[] = [];

  for (const candidate of parsed.data.data?.products?.items ?? []) {
    const result = itemSchema.safeParse(candidate);
    if (!result.success) continue;

    const item = result.data;
    const minimum = item.price_range?.minimum_price;
    const price = minimum?.final_price?.value ?? null;
    if (price === null || price === undefined || !Number.isFinite(price)) continue;

    const regular = minimum?.regular_price?.value ?? null;
    // Magento reports regular === final for anything not on promotion. Treating
    // that as a "was" would manufacture a saving out of a full-price item.
    const priceWas =
      regular !== null && regular !== undefined && regular > price ? regular : null;

    // Unlike a Shopify sale collection, a Magento category is just a category:
    // stores file permanent sections under `sale` all the time. Only an actual
    // markdown counts, so a full-price item here never becomes a deal.
    if (priceWas === null) continue;

    deals.push({
      sourceId: `${options.merchantDomain}:${item.sku ?? item.url_key ?? item.name}`,
      title: item.name,
      // `.html` is Magento's default product URL suffix but it is a store
      // setting and plenty of stores clear it — West Coast Kids serves
      // /nomi-baby-set and 404s /nomi-baby-set.html. Appending the conventional
      // suffix would publish a catalogue of dead links, so the store's own
      // `url_suffix` decides and an absent one means none.
      url: item.url_key ? `${base}/${item.url_key}${item.url_suffix ?? ''}` : base,
      description: null,
      imageUrl: item.small_image?.url ?? null,
      price,
      priceWas,
      currency: 'CAD',
      merchantDomain: options.merchantDomain,
      merchantName: options.merchantName ?? null,
      brand: null,
      // Magento's SKU is the merchant's own part number, not a manufacturer
      // identifier, so it is an MPN at best and never a GTIN. Claiming it as one
      // would let two retailers' internal codes collide into a confident, wrong
      // cross-merchant comparison.
      mpn: item.sku ?? null,
      categoryHint: options.categoryHint ?? null,
      departmentHint: options.departmentHint ?? null,
      inStock: true,
      postedAt: null,
    });
  }

  return deals;
}

/** Builds an adapter for one Magento retailer from its catalogue entry. */
export function createMagentoAdapter(config: RetailerConfig): SourceAdapter {
  return {
    id: `magento:${config.id}`,
    name: config.name,
    weight: 0.5,

    enabled: () =>
      config.enabled === false
        ? { enabled: false, reason: 'disabled in catalogue' }
        : { enabled: true },

    async fetch(context: AdapterContext): Promise<AdapterResult> {
      const limit = context.limit ?? 200;
      const base = config.baseUrl.replace(/\/$/, '');
      const endpoint = `${base}/graphql`;
      const urlKeys = config.salePaths?.length ? config.salePaths : SALE_CATEGORIES;

      // GraphQL is an API the storefront publishes for its own use, so it is
      // treated the way Shopify's products.json is rather than as a crawl.
      const ask = async (query: string): Promise<unknown> => {
        const response = await context.http.fetchJson<unknown>(endpoint, {
          skipRobots: true,
          body: JSON.stringify({ query }),
          headers: { 'content-type': 'application/json' },
        });
        return response.data;
      };

      let categories: Array<{ uid: string; urlKey: string }>;
      try {
        categories = parseCategories(await ask(buildCategoryQuery(urlKeys)));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { deals: [], path: 'graphql', reason: `category lookup failed: ${reason}` };
      }

      if (categories.length === 0) {
        return {
          deals: [],
          path: 'graphql',
          reason: `no sale category matched ${urlKeys.join(', ')}`,
        };
      }

      const collected: RawDeal[] = [];
      let lastError: string | undefined;

      for (const category of categories) {
        if (collected.length >= limit) break;

        try {
          const payload = await ask(
            buildProductsQuery(category.uid, Math.min(limit, 100)),
          );
          const deals = parseMagentoProducts(payload, {
            baseUrl: base,
            merchantDomain: config.domain,
            merchantName: config.name,
            departmentHint: config.departmentHint ?? undefined,
            categoryHint: category.urlKey,
          });

          context.log(`category ${category.urlKey}: ${deals.length} deals`);
          collected.push(...deals);
        } catch (error) {
          // One unreadable category must not cost the retailer the others.
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      if (collected.length === 0) {
        const tried = categories.map((category) => category.urlKey).join(', ');
        return {
          deals: [],
          path: 'graphql',
          reason: lastError
            ? `no products from ${tried}; last error: ${lastError}`
            : `no discounted products in ${tried}`,
        };
      }

      return { deals: collected.slice(0, limit), path: 'graphql' };
    },
  };
}
