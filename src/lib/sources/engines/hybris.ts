import type { AdapterContext, AdapterResult, RawDeal, SourceAdapter } from '../types';
import type { RetailerConfig } from '../catalogue';
import { env } from '../../config';

/**
 * Canadian Tire family engine (SAP Hybris) — Canadian Tire, SportChek, Mark's,
 * Atmosphere, Sports Experts, L'Équipeur, Pro Hockey Life, PartSource,
 * Party City.
 *
 * Nine banners on one platform, so one engine and nine catalogue entries. Sales
 * run across the banners, which is exactly why /family/canadian-tire is worth
 * having.
 *
 * A caveat stated plainly, because it decides whether this engine runs at all:
 * the platform expects an `ocp-apim-subscription-key` header, and there is no
 * public developer programme that issues one. The value is whatever their own
 * web app ships. This engine reads it from CANADIAN_TIRE_API_KEY if you choose
 * to supply one and otherwise reports the family as skipped — the catalogue
 * entries then fall back to the JSON-LD engine, which needs no key.
 *
 * The pricing here needs more care than any other engine in the project. Three
 * of their four common price shapes will produce a wrong headline number if
 * mapped naively, and each is handled explicitly below.
 */

export interface HybrisParseOptions {
  bannerDomain: string;
  bannerName?: string;
  baseUrl: string;
  categoryHint?: string;
}

/** How a price was arrived at, which decides whether it can be the headline. */
export type PriceKind = 'regular' | 'sale' | 'member-only' | 'multi-buy';

export interface ResolvedPrice {
  kind: PriceKind;
  /** The price anyone walking in pays today. Null when there is no such price. */
  headline: number | null;
  was: number | null;
  /** What the shopper needs to know to actually get the advertised number. */
  note: string | null;
}

/**
 * Decides which number a shopper actually pays.
 *
 * The three traps, in the order they bite:
 *
 * **Multi-buy.** "2 for $30" is not a $15 item. Dividing through would print a
 * price that does not exist at the till for anyone buying one, which is most
 * people. The per-unit price is not the headline; the offer is described and the
 * regular price stands.
 *
 * **Member pricing.** A Triangle-member price is real but conditional. Showing
 * it as the headline advertises a saving that a non-member cannot get, so it is
 * labelled rather than promoted.
 *
 * **No markdown.** A current price equal to the regular one is the platform
 * saying "no sale", not a zero-percent discount worth listing.
 */
export function resolvePrice(node: Record<string, unknown>): ResolvedPrice {
  const current = numberFrom(node['currentPrice']);
  const original = numberFrom(node['originalPrice']) ?? numberFrom(node['regularPrice']);

  const multiBuy = multiBuyOffer(node);
  if (multiBuy) {
    return {
      kind: 'multi-buy',
      // Deliberately the regular single-unit price, not the divided one.
      headline: current ?? original,
      was: original !== null && current !== null && original > current ? original : null,
      note: `${multiBuy} — the multi-buy price applies only when you buy the full quantity.`,
    };
  }

  if (isMemberPrice(node)) {
    return {
      kind: 'member-only',
      // The member price is NOT the headline. `original` is what a walk-in pays.
      headline: original ?? current,
      was: null,
      note:
        current !== null
          ? `Triangle members pay $${current.toFixed(2)} — members only, not the shelf price.`
          : 'A member-only price applies to this item.',
    };
  }

  if (current === null) return { kind: 'regular', headline: original, was: null, note: null };

  if (original === null || original <= current) {
    return { kind: 'regular', headline: current, was: null, note: null };
  }

  return { kind: 'sale', headline: current, was: original, note: null };
}

/** The multi-buy message, when the payload advertises one. */
function multiBuyOffer(node: Record<string, unknown>): string | null {
  for (const value of messageStrings(node)) {
    if (/\b\d+\s*(?:for|pour)\s*\$?\d/i.test(value)) return value;
  }
  return null;
}

function isMemberPrice(node: Record<string, unknown>): boolean {
  if (node['isMemberPrice'] === true || node['memberOnly'] === true) return true;
  return messageStrings(node).some((value) => /triangle|member|membre/i.test(value));
}

/** Every human-readable promo string on a product node, wherever it hangs. */
function messageStrings(node: Record<string, unknown>): string[] {
  const out: string[] = [];

  for (const key of ['priceMessage', 'promoMessage', 'badges', 'badge', 'offerMessage']) {
    const value = node[key];
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') out.push(entry);
        else if (entry !== null && typeof entry === 'object') {
          const label =
            (entry as Record<string, unknown>)['label'] ??
            (entry as Record<string, unknown>)['text'];
          if (typeof label === 'string') out.push(label);
        }
      }
    }
  }

  return out;
}

/** Reads a price that may be a number or an object wrapping one. */
function numberFrom(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.]/g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of ['value', 'amount', 'price', 'minPrice']) {
      const parsed = numberFrom((value as Record<string, unknown>)[key]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

export function parseHybrisSearch(payload: unknown, options: HybrisParseOptions): RawDeal[] {
  if (payload === null || typeof payload !== 'object') return [];

  const products = findProducts(payload);
  const base = options.baseUrl.replace(/\/$/, '');
  const deals: RawDeal[] = [];
  const seen = new Set<string>();

  for (const product of products) {
    const code = stringField(product, 'code') ?? stringField(product, 'sku');
    const title = stringField(product, 'title') ?? stringField(product, 'name');
    if (!code || !title || seen.has(code)) continue;

    const price = resolvePrice(product);
    if (price.headline === null) continue;

    // Only genuine markdowns reach the feed. A member or multi-buy offer with no
    // underlying markdown is a promotion, not a deal, and listing it would fill
    // the site with items at their normal price.
    if (price.was === null) continue;

    seen.add(code);

    const href = stringField(product, 'url') ?? `/en/pdp/${code}.html`;

    deals.push({
      sourceId: `${options.bannerDomain}:${code}`,
      title,
      url: absolute(href, base) ?? `${base}${href}`,
      description: null,
      imageUrl: firstImage(product, base),
      price: price.headline,
      priceWas: price.was,
      currency: 'CAD',
      merchantDomain: options.bannerDomain,
      merchantName: options.bannerName ?? null,
      brand: brandOf(product),
      // Their own SKU, which is banner-scoped rather than a manufacturer part
      // number — useful for identity within the family, never across merchants.
      mpn: null,
      categoryHint: stringField(product, 'categoryPath') ?? options.categoryHint ?? null,
      inStock: product['isAvailable'] !== false && product['inStock'] !== false,
      stockNote: price.note,
      postedAt: null,
    });
  }

  return deals;
}

/** The product array, wherever the response wraps it. */
function findProducts(payload: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 6 || payload === null || typeof payload !== 'object') return [];

  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => findProducts(entry, depth + 1));
  }

  const node = payload as Record<string, unknown>;
  const found: Array<Record<string, unknown>> = [];

  for (const key of ['products', 'productData', 'results']) {
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
        found.push(...findProducts(value, depth + 1));
    }
  }

  return found;
}

function stringField(node: Record<string, unknown>, key: string): string | null {
  const value = node[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function brandOf(node: Record<string, unknown>): string | null {
  const brand = node['brand'];
  if (typeof brand === 'string' && brand.trim() !== '') return brand.trim();
  if (brand !== null && typeof brand === 'object') {
    const label = (brand as Record<string, unknown>)['label'];
    if (typeof label === 'string' && label.trim() !== '') return label.trim();
  }
  return null;
}

function firstImage(node: Record<string, unknown>, base: string): string | null {
  const images = node['images'];
  if (Array.isArray(images)) {
    for (const image of images) {
      if (typeof image === 'string') return absolute(image, base);
      if (image !== null && typeof image === 'object') {
        const url = (image as Record<string, unknown>)['url'];
        if (typeof url === 'string' && url.trim() !== '') return absolute(url, base);
      }
    }
  }
  const single = stringField(node, 'imageUrl') ?? stringField(node, 'image');
  return single ? absolute(single, base) : null;
}

function absolute(href: string, base: string): string | null {
  try {
    return new URL(href, `${base}/`).toString();
  } catch {
    return null;
  }
}

/**
 * The platform's search endpoint for one banner.
 *
 * `store` matters: this platform prices by store, and omitting it returns a
 * default that may not match what the shopper would actually pay.
 */
export function buildSearchUrl(
  apiBase: string,
  banner: string,
  category: string,
  storeId: string,
  page: number,
): string {
  const params = new URLSearchParams({
    store: storeId,
    baseStoreId: banner,
    lang: 'en_CA',
    categoryCode: category,
    page: String(page),
    count: '48',
  });
  return `${apiBase.replace(/\/$/, '')}/search/v2/search?${params.toString()}`;
}

/** The banner's default store, used when the user has selected none. */
const DEFAULT_STORE_ID = '33';

export function createHybrisAdapter(config: RetailerConfig): SourceAdapter {
  return {
    id: `hybris:${config.id}`,
    name: config.name,
    weight: 0.5,

    enabled: () => {
      if (config.enabled === false) return { enabled: false, reason: 'disabled in catalogue' };
      if (!env.CANADIAN_TIRE_API_KEY) {
        // The whole family is skipped together, with a message that says what
        // would fix it. Skipped, never failed: a missing credential is a
        // configuration state, and it must not colour the run red or hide the
        // other fifty retailers.
        return {
          enabled: false,
          reason: 'CANADIAN_TIRE_API_KEY is not set — this banner falls back to the JSON-LD engine',
        };
      }
      if (!config.salePaths?.length) {
        return {
          enabled: false,
          reason: 'no category codes configured — add them to salePaths in the catalogue entry',
        };
      }
      return { enabled: true };
    },

    async fetch(context: AdapterContext): Promise<AdapterResult> {
      const key = env.CANADIAN_TIRE_API_KEY;
      if (!key) return { deals: [], path: 'search-api', reason: 'no API key configured' };

      const limit = context.limit ?? 200;
      const base = config.baseUrl.replace(/\/$/, '');
      const apiBase = config.hybrisApiBase ?? 'https://apim.canadiantire.ca/v1';
      const banner = config.hybrisBanner ?? config.id;
      const storeId = context.storeIds?.[0] ?? DEFAULT_STORE_ID;

      const collected: RawDeal[] = [];
      let lastError: string | undefined;

      for (const category of config.salePaths ?? []) {
        if (collected.length >= limit) break;

        const url = buildSearchUrl(apiBase, banner, category, storeId, 0);

        try {
          const response = await context.http.fetchJson<unknown>(url, {
            headers: { 'ocp-apim-subscription-key': key },
          });

          const deals = parseHybrisSearch(response.data, {
            bannerDomain: config.domain,
            bannerName: config.name,
            baseUrl: base,
          });

          context.log(`category ${category}: ${deals.length} deals`);
          collected.push(...deals);
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      if (collected.length === 0) {
        return {
          deals: [],
          path: 'search-api',
          reason: lastError
            ? `no products from ${(config.salePaths ?? []).join(', ')}; last error: ${lastError}`
            : 'no discounted products found',
        };
      }

      return { deals: collected.slice(0, limit), path: 'search-api' };
    },
  };
}
