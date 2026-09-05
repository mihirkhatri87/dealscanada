import type { AdapterContext, RawDeal, SourceAdapter } from './types';
import {
  createCompositeAdapter,
  inStorePath,
  redflagdealsPath,
  type CompositeConfig,
  type CompositePath,
  type CompositePathResult,
} from './engines/composite';

/**
 * Walmart Canada.
 *
 * Akamai-protected, so the chain matters more here than anywhere else: on most
 * IPs path A will fail and the retailer's presence on the site depends entirely
 * on B and C. That is a worse dataset than their own feed - community prices are
 * second-hand - but it is a real one, and the recorded source path keeps the
 * difference visible rather than pretending the two are equivalent.
 */

const CONFIG: CompositeConfig = {
  id: 'walmart',
  name: 'Walmart Canada',
  domain: 'walmart.ca',
  dealerNames: ['walmart', 'walmart.ca', 'walmart canada'],
  storeChain: 'walmart',
};

const SEARCH_URL =
  'https://www.walmart.ca/api/product-page/v2/price-offer?lang=en&pageType=clearance';

/**
 * Path A — Walmart's own endpoint.
 *
 * Conservative by design: one request, realistic headers, no retry storm. This
 * path is expected to fail on most IPs, and hammering it would achieve nothing
 * except making the block permanent.
 */
function nativePath(): CompositePath {
  return {
    id: 'walmart-api',
    describe: 'walmart.ca clearance API',
    async run(context: AdapterContext): Promise<CompositePathResult> {
      const response = await context.http.fetchJson<unknown>(SEARCH_URL, {
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'en-CA,en;q=0.9',
        },
      });

      const deals = parseWalmartResponse(response.data);
      return {
        deals,
        ...(deals.length === 0 ? { reason: 'endpoint responded but carried no offers' } : {}),
      };
    },
  };
}

/**
 * Maps Walmart's offer payload.
 *
 * Tolerant about where the product list sits, strict about what counts as a
 * deal: both a current and a higher was-price, or the item does not qualify.
 */
export function parseWalmartResponse(payload: unknown): RawDeal[] {
  const items = findOfferList(payload);
  const deals: RawDeal[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const id = stringOf(item, 'productId') ?? stringOf(item, 'id') ?? stringOf(item, 'sku');
    const title = stringOf(item, 'name') ?? stringOf(item, 'title');
    if (!id || !title || seen.has(id)) continue;

    const price = priceOf(item, ['currentPrice', 'price', 'salePrice']);
    const was = priceOf(item, ['wasPrice', 'listPrice', 'regularPrice', 'originalPrice']);
    if (price === null || was === null || was <= price) continue;

    seen.add(id);
    const path = stringOf(item, 'url') ?? stringOf(item, 'productUrl') ?? `/en/ip/${id}`;

    deals.push({
      sourceId: `walmart.ca:${id}`,
      title,
      url: path.startsWith('http') ? path : `https://www.walmart.ca${path}`,
      description: null,
      imageUrl: stringOf(item, 'image') ?? stringOf(item, 'thumbnailUrl'),
      price,
      priceWas: was,
      currency: 'CAD',
      merchantDomain: 'walmart.ca',
      merchantName: 'Walmart Canada',
      brand: stringOf(item, 'brand'),
      // Walmart publishes UPCs, which is the strongest identity available for
      // cross-merchant comparison - better than anything the fallback paths give.
      gtin: stringOf(item, 'upc') ?? stringOf(item, 'gtin'),
      inStock: item['availabilityStatus'] !== 'OUT_OF_STOCK',
      postedAt: null,
    });
  }

  return deals;
}

function findOfferList(payload: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 6 || payload === null || typeof payload !== 'object') return [];
  if (Array.isArray(payload)) return payload.flatMap((e) => findOfferList(e, depth + 1));

  const node = payload as Record<string, unknown>;
  const found: Array<Record<string, unknown>> = [];

  for (const key of ['offers', 'products', 'items', 'results']) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
          found.push(entry as Record<string, unknown>);
        }
      }
    }
  }

  if (found.length === 0) {
    for (const value of Object.values(node)) {
      if (value !== null && typeof value === 'object')
        found.push(...findOfferList(value, depth + 1));
    }
  }

  return found;
}

function stringOf(node: Record<string, unknown>, key: string): string | null {
  const value = node[key];
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function priceOf(node: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = node[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[^\d.]/g, ''));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    if (value !== null && typeof value === 'object') {
      const nested = priceOf(value as Record<string, unknown>, ['value', 'amount', 'price']);
      if (nested !== null) return nested;
    }
  }
  return null;
}

/**
 * @param inStorePool deals already collected this run by the store-level source.
 * Passed in rather than fetched so a composite retailer costs no extra traffic.
 */
export function createWalmartAdapter(inStorePool: () => RawDeal[] = () => []): SourceAdapter {
  return createCompositeAdapter(CONFIG, [
    nativePath(),
    redflagdealsPath(CONFIG),
    inStorePath(CONFIG, inStorePool),
  ]);
}
