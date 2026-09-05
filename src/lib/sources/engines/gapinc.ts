import type { AdapterContext, AdapterResult, RawDeal, SourceAdapter } from '../types';
import type { RetailerConfig } from '../catalogue';

/**
 * Gap Inc. Canada engine — Gap, Gap Factory, Old Navy, Banana Republic,
 * BR Factory, Athleta.
 *
 * All six brands run one platform, so this is one implementation and six
 * catalogue entries. Two things make it worth its own engine rather than the
 * JSON-LD fallback:
 *
 * Department is reliable here in a way it is nowhere else. Gap Inc. file their
 * catalogue under their own Girls / Boys / Baby / Women / Men navigation, and a
 * category id maps to a department on their side. Reading that beats inferring
 * "girls" from a product title, which is what every other apparel retailer
 * forces us to do.
 *
 * And their pricing carries two traps the generic engines would fall into:
 * range prices, and stacked promotions. Both are handled explicitly below,
 * because getting either wrong invents a saving that does not exist.
 */

export interface GapIncParseOptions {
  baseUrl: string;
  merchantDomain: string;
  merchantName?: string;
  /** The department this category belongs to, from the brand's own navigation. */
  departmentHint?: string;
}

/**
 * Parses a Gap Inc. price string to a number.
 *
 * Takes the low end of a range: "$34.99 - $49.99" means the cheapest variant
 * costs $34.99, which is a price a shopper can actually pay. The high end is a
 * different garment in a different size.
 */
export function parseGapPrice(value: string | null | undefined): number | null {
  if (!value) return null;

  const first = value.split(/\s*[-–]\s*/)[0] ?? value;
  const cleaned = first.replace(/[^\d.,]/g, '');
  if (cleaned === '') return null;

  // "29,99 $" (fr-CA) and "1,299.99" both occur; the last separator is decimal.
  const normalized =
    cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');

  const parsed = Number(normalized);
  // Zero is rejected rather than passed through: downstream it renders as
  // "Free", which is a wrong claim rather than a missing one.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function isPriceRange(value: string | null | undefined): boolean {
  return typeof value === 'string' && /\d\s*[-–]\s*\D*\d/.test(value);
}

/**
 * Turns a promo message into something a shopper can act on.
 *
 * The promotion is never folded into the price. "Extra 50% off" on a $22.49
 * listing would print $11.25 — a number no page shows, because the exclusions
 * that decide whether it applies are not in this payload. The listed price
 * stands and the offer is described alongside it.
 */
export function describePromo(promo: string): string {
  const code = /\bcode:?\s*([A-Z0-9]{3,20})\b/.exec(promo)?.[1];
  return code
    ? `${promo.replace(/[,.]?\s*use code:?\s*[A-Z0-9]{3,20}\b/i, '')} — apply with code ${code} at checkout.`.replace(
        /\s+/g,
        ' ',
      )
    : `${promo} — not included in the price shown.`;
}

interface StyleColor {
  ccId?: unknown;
  inStock?: unknown;
  productStyleColorImages?: unknown;
  sizes?: unknown;
}

export function parseGapIncCategory(payload: unknown, options: GapIncParseOptions): RawDeal[] {
  const items = collectCcList(payload);
  if (items.length === 0) return [];

  const base = options.baseUrl.replace(/\/$/, '');
  const deals: RawDeal[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const name = stringField(item, 'name');
    const id = stringField(item, 'businessCatalogItemId');

    // No id means no stable upsert key: the row would insert fresh every run and
    // its price history would never accumulate.
    if (!name || !id || seen.has(id)) continue;

    const price = item['price'];
    if (price === null || typeof price !== 'object') continue;
    const priceNode = price as Record<string, unknown>;

    const regularRaw = stringField(priceNode, 'regularPrice');
    const saleRaw = stringField(priceNode, 'salePrice');

    const sale = parseGapPrice(saleRaw) ?? parseGapPrice(stringField(priceNode, 'currentMinPrice'));
    const regular = parseGapPrice(regularRaw);
    if (sale === null || regular === null) continue;

    // Both sides ranges means both numbers are that range's floor, which is a
    // like-for-like comparison. One side a range and the other not would compare
    // a floor against a single price - the "$20-$60 regular, $25-$45 sale" case,
    // where the cheapest variant actually went UP and a naive comparison would
    // advertise a 58% saving on it.
    if (isPriceRange(regularRaw) !== isPriceRange(saleRaw)) continue;
    if (regular <= sale) continue;

    seen.add(id);

    const styleColors = Array.isArray(item['styleColors'])
      ? (item['styleColors'] as StyleColor[])
      : [];
    const promo =
      stringField(priceNode, 'applicablePromo') ?? stringField(priceNode, 'promoText') ?? null;

    deals.push({
      sourceId: `${options.merchantDomain}:${id}`,
      title: name,
      url: `${base}/browse/product.do?pid=${id}`,
      description: null,
      imageUrl: firstImage(styleColors, base),
      price: sale,
      priceWas: regular,
      currency: 'CAD',
      merchantDomain: options.merchantDomain,
      merchantName: options.merchantName ?? null,
      brand: stringField(item, 'brandName') ?? options.merchantName ?? null,
      mpn: id,
      categoryHint: stringField(item, 'productCategoryName'),
      departmentHint: options.departmentHint ?? null,
      // Sizes come from the colourway data already in this payload. Fetching a
      // product page for them would multiply the request count by the catalogue
      // size for a field that is nice to have.
      sizesAvailable: collectSizes(styleColors),
      inStock: styleColors.some((color) => color.inStock === true),
      stockNote: promo ? describePromo(promo) : null,
      postedAt: null,
    });
  }

  return deals;
}

/**
 * Finds the product list inside the category response.
 *
 * Walks to `ccList` rather than pinning the full path, because the wrapper
 * around it differs between brands and between the search and browse endpoints —
 * and a wrapper changing shape should not cost the entire retailer.
 */
function collectCcList(payload: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 8 || payload === null || typeof payload !== 'object') return [];

  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => collectCcList(entry, depth + 1));
  }

  const node = payload as Record<string, unknown>;
  const found: Array<Record<string, unknown>> = [];

  if (Array.isArray(node['ccList'])) {
    for (const entry of node['ccList']) {
      if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
        found.push(entry as Record<string, unknown>);
      }
    }
  }

  for (const value of Object.values(node)) {
    if (value !== null && typeof value === 'object') {
      found.push(...collectCcList(value, depth + 1));
    }
  }

  return found;
}

function stringField(node: Record<string, unknown>, key: string): string | null {
  const value = node[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function firstImage(styleColors: StyleColor[], base: string): string | null {
  for (const color of styleColors) {
    const images = color.productStyleColorImages;
    if (!Array.isArray(images)) continue;

    for (const image of images) {
      if (image === null || typeof image !== 'object') continue;
      const path = (image as Record<string, unknown>)['path'];
      if (typeof path === 'string' && path.trim() !== '') {
        try {
          return new URL(path, `${base}/`).toString();
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function collectSizes(styleColors: StyleColor[]): string[] | null {
  const sizes: string[] = [];

  for (const color of styleColors) {
    if (!Array.isArray(color.sizes)) continue;
    for (const size of color.sizes) {
      if (size === null || typeof size !== 'object') continue;
      const name = (size as Record<string, unknown>)['name'];
      if (typeof name === 'string' && name.trim() !== '' && !sizes.includes(name.trim())) {
        sizes.push(name.trim());
      }
    }
  }

  return sizes.length > 0 ? sizes : null;
}

/**
 * The category search URL.
 *
 * The shipping country and currency parameters are not optional decoration:
 * without them the platform answers with US pricing, which would put USD numbers
 * on the page labelled CAD.
 */
export function buildCategoryUrl(
  baseUrl: string,
  categoryId: string,
  page: number,
  locale: string,
): string {
  const base = baseUrl.replace(/\/$/, '');
  const params = new URLSearchParams({
    cid: categoryId,
    isFacetsEnabled: 'true',
    globalShippingCountryCode: 'ca',
    globalShippingCurrencyCode: 'CAD',
    locale,
    pageId: String(page),
  });
  return `${base}/resources/productSearch/v1/search?${params.toString()}`;
}

export function createGapIncAdapter(config: RetailerConfig): SourceAdapter {
  return {
    id: `gapinc:${config.id}`,
    name: config.name,
    weight: 0.5,

    enabled: () => {
      if (config.enabled === false) return { enabled: false, reason: 'disabled in catalogue' };
      if (!config.salePaths?.length) {
        // Half-configured, not broken. The message names exactly what to add so
        // the fix does not require reading this file.
        return {
          enabled: false,
          reason: 'no category ids configured — add them to salePaths in the catalogue entry',
        };
      }
      return { enabled: true };
    },

    async fetch(context: AdapterContext): Promise<AdapterResult> {
      const limit = context.limit ?? 200;
      const base = config.baseUrl.replace(/\/$/, '');
      const categories = config.salePaths ?? [];
      const locale = config.gapLocale ?? 'en_CA';

      const collected: RawDeal[] = [];
      let lastError: string | undefined;

      for (const categoryId of categories) {
        if (collected.length >= limit) break;

        const url = buildCategoryUrl(base, categoryId, 0, locale);
        const department =
          config.salePathDepartments?.[categoryId] ?? config.departmentHint ?? null;

        try {
          const response = await context.http.fetchJson<unknown>(url);
          const deals = parseGapIncCategory(response.data, {
            baseUrl: base,
            merchantDomain: config.domain,
            merchantName: config.name,
            ...(department ? { departmentHint: department } : {}),
          });

          context.log(`category ${categoryId}: ${deals.length} deals`);
          collected.push(...deals);
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      if (collected.length === 0) {
        return {
          deals: [],
          path: 'category-search',
          reason: lastError
            ? `no products from ${categories.join(', ')}; last error: ${lastError}`
            : `no discounted products in ${categories.join(', ')}`,
        };
      }

      return { deals: collected.slice(0, limit), path: 'category-search' };
    },
  };
}
