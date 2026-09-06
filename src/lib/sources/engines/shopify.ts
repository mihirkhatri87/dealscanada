import { z } from 'zod';
import type { AdapterContext, AdapterResult, RawDeal, SourceAdapter } from '../types';
import type { RetailerConfig } from '../catalogue';

/**
 * Shopify engine — the highest coverage-per-effort source in the catalogue.
 *
 * A large share of Canadian mid-size and independent retailers run Shopify, and
 * every Shopify store exposes `/products.json` publicly. Critically, variants
 * carry `compare_at_price` natively, so before/after comes from the merchant's
 * own record rather than a scraped strikethrough.
 *
 * Onboarding a Shopify retailer is a catalogue entry with a base URL. No code.
 */

const variantSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string().nullish(),
    price: z.union([z.string(), z.number()]).nullish(),
    compare_at_price: z.union([z.string(), z.number()]).nullish(),
    available: z.boolean().nullish(),
    sku: z.string().nullish(),
    barcode: z.string().nullish(),
    option1: z.string().nullish(),
    option2: z.string().nullish(),
    option3: z.string().nullish(),
  })
  .passthrough();

const productSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string(),
    handle: z.string(),
    body_html: z.string().nullish(),
    vendor: z.string().nullish(),
    product_type: z.string().nullish(),
    tags: z.union([z.array(z.string()), z.string()]).nullish(),
    published_at: z.string().nullish(),
    variants: z.array(z.unknown()).nullish(),
    images: z.array(z.object({ src: z.string().nullish() }).passthrough()).nullish(),
    options: z
      .array(
        z
          .object({ name: z.string().nullish(), values: z.array(z.string()).nullish() })
          .passthrough(),
      )
      .nullish(),
  })
  .passthrough();

const responseSchema = z.object({ products: z.array(z.unknown()) }).passthrough();

/** Collection handles that hold discounted stock on most Shopify storefronts. */
export const SALE_COLLECTIONS = [
  'sale',
  'clearance',
  'on-sale',
  'outlet',
  'markdowns',
  'last-chance',
];

export interface ShopifyParseOptions {
  baseUrl: string;
  merchantDomain: string;
  merchantName?: string;
  /** True when the URL was a sale collection, which relaxes the discount rule. */
  fromSaleCollection?: boolean;
  departmentHint?: string;
}

export function parseShopifyProducts(payload: unknown, options: ShopifyParseOptions): RawDeal[] {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) return [];

  const deals: RawDeal[] = [];

  for (const candidate of parsed.data.products) {
    const result = productSchema.safeParse(candidate);
    if (!result.success) continue;

    const product = result.data;
    const variants = (product.variants ?? [])
      .map((variant) => variantSchema.safeParse(variant))
      .filter(
        (parse): parse is { success: true; data: z.infer<typeof variantSchema> } => parse.success,
      )
      .map((parse) => parse.data);

    if (variants.length === 0) continue;

    // Choose the variant a shopper would actually get: in stock, cheapest.
    // Falling back to any variant means an entirely sold-out product still
    // appears with an honest price rather than vanishing.
    const inStockVariants = variants.filter((variant) => variant.available !== false);
    const pool = inStockVariants.length > 0 ? inStockVariants : variants;

    const chosen = pool.reduce((best, variant) => {
      const bestPrice = toNumber(best.price);
      const price = toNumber(variant.price);
      if (bestPrice === null) return variant;
      if (price === null) return best;
      return price < bestPrice ? variant : best;
    }, pool[0]!);

    const price = toNumber(chosen.price);
    if (price === null) continue;

    const compareAt = toNumber(chosen.compare_at_price);
    // Shopify stores routinely leave compare_at_price equal to or below price
    // when nothing is discounted. Treating that as a "was" would fabricate a
    // saving, so it is discarded here rather than downstream.
    const priceWas = compareAt !== null && compareAt > price ? compareAt : null;

    // Outside an explicit sale collection, only actual markdowns qualify — the
    // whole catalogue at list price is a storefront, not a deal feed.
    if (!options.fromSaleCollection && priceWas === null) continue;

    const tags = normalizeTags(product.tags);
    const sizes = extractSizes(product, variants);

    deals.push({
      sourceId: `${options.merchantDomain}:${product.id}`,
      title: product.title,
      url: `${options.baseUrl.replace(/\/$/, '')}/products/${product.handle}`,
      description: product.body_html ?? null,
      imageUrl: product.images?.[0]?.src ?? null,
      price,
      priceWas,
      currency: 'CAD',
      merchantDomain: options.merchantDomain,
      merchantName: options.merchantName ?? null,
      brand: product.vendor ?? null,
      // Shopify's barcode field is usually a GTIN, which is the strongest
      // identity available for cross-merchant comparison.
      gtin: chosen.barcode ?? null,
      categoryHint: product.product_type ?? null,
      departmentHint: options.departmentHint ?? departmentFromTags(tags) ?? null,
      sizesAvailable: sizes.length > 0 ? sizes : null,
      inStock: chosen.available !== false,
      postedAt: product.published_at ?? null,
    });
  }

  return deals;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeTags(tags: string[] | string | null | undefined): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((tag) => tag.toLowerCase());
  return tags.split(',').map((tag) => tag.trim().toLowerCase());
}

function departmentFromTags(tags: string[]): string | null {
  for (const tag of tags) {
    if (/\b(women|womens|ladies)\b/.test(tag)) return 'women';
    if (/\b(men|mens)\b/.test(tag)) return 'men';
    if (/\b(girls?)\b/.test(tag)) return 'girls';
    if (/\b(boys?)\b/.test(tag)) return 'boys';
    if (/\b(baby|infant|newborn)\b/.test(tag)) return 'baby';
  }
  return null;
}

/**
 * Sizes come from variant options already in the payload — this must never cost
 * an extra request, which is why it reads the option definitions rather than
 * fetching a product page.
 */
function extractSizes(
  product: z.infer<typeof productSchema>,
  variants: Array<z.infer<typeof variantSchema>>,
): string[] {
  const sizeOptionIndex = (product.options ?? []).findIndex((option) =>
    /size|taille/i.test(option.name ?? ''),
  );
  if (sizeOptionIndex === -1) return [];

  const key = (['option1', 'option2', 'option3'] as const)[sizeOptionIndex];
  if (!key) return [];

  const sizes = new Set<string>();
  for (const variant of variants) {
    if (variant.available === false) continue;
    const value = variant[key];
    if (typeof value === 'string' && value.trim() !== '') sizes.add(value.trim());
  }

  return [...sizes];
}

const collectionsSchema = z
  .object({ collections: z.array(z.object({ handle: z.string().nullish() }).passthrough()) })
  .passthrough();

/** Handles that read like a markdown section rather than a department. */
const SALE_HANDLE = /sale|clearance|outlet|markdown|final-?sale|last-chance|promo|deals?\b/i;

/**
 * Sale collections a store actually has, from its own `/collections.json`.
 *
 * The fixed list in `SALE_COLLECTIONS` covers stores that name things plainly,
 * but plenty do not: Indigo files markdowns under three dozen seasonal handles
 * like `our-big-sale-vinyl-records`, and pinning this month's name in the
 * catalogue buys a source that works until the promotion ends. Reading the
 * store's own index costs one request and survives the rename.
 *
 * Shorter handles sort first because generic sections (`sale`, `clearance`)
 * outlast campaign ones (`sale-fall-most-anticipated-books`), and the budget
 * here is small enough that ordering decides what gets fetched at all.
 */
export function saleCollectionHandles(payload: unknown, limit = 8): string[] {
  const parsed = collectionsSchema.safeParse(payload);
  if (!parsed.success) return [];

  return parsed.data.collections
    .map((collection) => collection.handle)
    .filter((handle): handle is string => typeof handle === 'string' && SALE_HANDLE.test(handle))
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .slice(0, limit);
}

/** Builds an adapter for one Shopify retailer from its catalogue entry. */
export function createShopifyAdapter(config: RetailerConfig): SourceAdapter {
  return {
    id: `shopify:${config.id}`,
    name: config.name,
    weight: 0.5,

    enabled: () =>
      config.enabled === false
        ? { enabled: false, reason: 'disabled in catalogue' }
        : { enabled: true },

    async fetch(context: AdapterContext): Promise<AdapterResult> {
      const limit = context.limit ?? 250;
      const base = config.baseUrl.replace(/\/$/, '');
      const collections = config.salePaths?.length ? config.salePaths : SALE_COLLECTIONS;

      const collected: RawDeal[] = [];
      const tried: string[] = [];
      let lastError: string | undefined;

      /**
       * `pinned` is the difference between a collection someone chose and one a
       * regex matched. A pinned handle is a decision that everything filed under
       * it is a deal, so an item with no `compare_at_price` still counts. A
       * discovered handle is a guess — `sale-klutz` is a brand section at list
       * price — so there, only an actual markdown qualifies.
       */
      const harvest = async (collection: string, pinned: boolean): Promise<void> => {
        const url = `${base}/collections/${collection}/products.json?limit=250`;
        tried.push(collection);

        try {
          const response = await context.http.fetchJson<unknown>(url, { skipRobots: true });
          const deals = parseShopifyProducts(response.data, {
            baseUrl: base,
            merchantDomain: config.domain,
            merchantName: config.name,
            fromSaleCollection: pinned,
            departmentHint: config.departmentHint ?? undefined,
          });

          context.log(`collection ${collection}: ${deals.length} deals`);
          collected.push(...deals);
        } catch (error) {
          // A missing collection is normal — stores name them differently. Only
          // a total failure across all of them is worth reporting.
          lastError = error instanceof Error ? error.message : String(error);
        }
      };

      for (const collection of collections) {
        if (collected.length >= limit) break;
        await harvest(collection, true);
      }

      // Nothing under the names we guessed does not mean nothing on sale. Ask
      // the store which collections it has before giving up on it.
      let discovered: string[] = [];
      if (collected.length === 0) {
        try {
          const index = await context.http.fetchJson<unknown>(
            `${base}/collections.json?limit=250`,
            { skipRobots: true },
          );
          discovered = saleCollectionHandles(index.data).filter(
            (handle) => !tried.includes(handle),
          );
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }

        for (const collection of discovered) {
          if (collected.length >= limit) break;
          await harvest(collection, false);
        }
      }

      if (collected.length === 0) {
        const attempted = tried.join(', ');
        return {
          deals: [],
          path: 'products.json',
          reason: lastError
            ? `no sale collections found (tried ${attempted}); last error: ${lastError}`
            : `no discounted products in ${attempted}`,
        };
      }

      return {
        deals: collected.slice(0, limit),
        path: discovered.length > 0 ? 'products.json (discovered)' : 'products.json',
      };
    },
  };
}
