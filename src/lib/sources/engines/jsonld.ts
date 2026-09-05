import * as cheerio from 'cheerio';
import type { AdapterContext, AdapterResult, RawDeal, SourceAdapter } from '../types';
import type { RetailerConfig } from '../catalogue';

/**
 * JSON-LD engine — the universal fallback.
 *
 * Retailers publish schema.org Product markup for Google Shopping, which means
 * almost every product page already carries structured price, availability, GTIN
 * and brand. Reading what a retailer publishes for machines is both more reliable
 * and more respectful than scraping the rendered page.
 *
 * Unlike the platform engines this one crawls, so it is the only engine gated by
 * robots.txt on every request and capped on pages per run.
 */

interface JsonLdOffer {
  price?: unknown;
  priceCurrency?: unknown;
  availability?: unknown;
  lowPrice?: unknown;
  highPrice?: unknown;
}

interface JsonLdProduct {
  '@type'?: unknown;
  name?: unknown;
  description?: unknown;
  image?: unknown;
  brand?: unknown;
  gtin?: unknown;
  gtin8?: unknown;
  gtin12?: unknown;
  gtin13?: unknown;
  gtin14?: unknown;
  mpn?: unknown;
  sku?: unknown;
  offers?: unknown;
  category?: unknown;
}

/**
 * Extracts every JSON-LD node from a page.
 *
 * Handles the three shapes seen in the wild: a bare object, an array of nodes,
 * and an `@graph` wrapper. Malformed blocks are skipped individually — one bad
 * script tag must not cost us the page.
 */
export function extractJsonLdNodes(html: string): unknown[] {
  const $ = cheerio.load(html);
  const nodes: unknown[] = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text().trim();
    if (!raw) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    collect(parsed, nodes);
  });

  return nodes;
}

function collect(value: unknown, into: unknown[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collect(entry, into);
    return;
  }
  if (value === null || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  if (Array.isArray(record['@graph'])) {
    for (const entry of record['@graph']) collect(entry, into);
    return;
  }

  into.push(value);
}

function isProduct(node: unknown): node is JsonLdProduct {
  if (node === null || typeof node !== 'object') return false;
  const type = (node as JsonLdProduct)['@type'];

  if (typeof type === 'string') return type.toLowerCase() === 'product';
  if (Array.isArray(type)) {
    return type.some((entry) => typeof entry === 'string' && entry.toLowerCase() === 'product');
  }
  return false;
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstString(entry);
      if (found) return found;
    }
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // Common nested shapes: { name: "Sony" }, { url: "..." }.
    return firstString(record['name'] ?? record['url'] ?? record['@id']);
  }
  return null;
}

function firstOffer(offers: unknown): JsonLdOffer | null {
  if (!offers) return null;

  if (Array.isArray(offers)) {
    for (const entry of offers) {
      const offer = firstOffer(entry);
      if (offer) return offer;
    }
    return null;
  }

  if (typeof offers !== 'object') return null;
  const record = offers as Record<string, unknown>;

  // An AggregateOffer wraps individual offers; its lowPrice is the shopper price.
  if (Array.isArray(record['offers'])) {
    const nested = firstOffer(record['offers']);
    if (nested) return nested;
  }

  return record as JsonLdOffer;
}

export interface JsonLdParseOptions {
  url: string;
  merchantDomain: string;
  merchantName?: string;
  categoryHint?: string;
  departmentHint?: string;
}

/**
 * Parses one product page. Falls back to OpenGraph when JSON-LD is absent, then
 * gives up cleanly rather than guessing from the rendered HTML.
 */
export function parseProductPage(html: string, options: JsonLdParseOptions): RawDeal | null {
  const nodes = extractJsonLdNodes(html);
  const product = nodes.find(isProduct);

  if (product) {
    const offer = firstOffer(product.offers);
    const price = offer?.price ?? offer?.lowPrice ?? null;
    const title = firstString(product.name);

    if (title && price !== null && price !== undefined) {
      const availability = firstString(offer?.availability)?.toLowerCase() ?? '';

      return {
        sourceId: `${options.merchantDomain}:${firstString(product.sku) ?? options.url}`,
        title,
        url: options.url,
        description: firstString(product.description),
        imageUrl: firstString(product.image),
        price: price as string | number,
        // JSON-LD has no standard "was" price. Inventing one from the page's
        // strikethrough markup would be exactly the fabricated anchor this
        // project refuses to publish, so it is left null and the verification
        // pass decides using cross-merchant evidence instead.
        priceWas: null,
        currency: firstString(offer?.priceCurrency) ?? 'CAD',
        merchantDomain: options.merchantDomain,
        merchantName: options.merchantName ?? null,
        brand: firstString(product.brand),
        gtin:
          firstString(product.gtin13) ??
          firstString(product.gtin12) ??
          firstString(product.gtin14) ??
          firstString(product.gtin8) ??
          firstString(product.gtin),
        mpn: firstString(product.mpn),
        categoryHint: options.categoryHint ?? firstString(product.category),
        departmentHint: options.departmentHint ?? null,
        inStock:
          availability === '' ? true : /instock|inStock|limitedavailability/i.test(availability),
      };
    }
  }

  return parseOpenGraph(html, options);
}

/** Last resort: OpenGraph product tags, which many retailers also publish. */
export function parseOpenGraph(html: string, options: JsonLdParseOptions): RawDeal | null {
  const $ = cheerio.load(html);

  const meta = (property: string): string | null => {
    const value =
      $(`meta[property="${property}"]`).attr('content') ??
      $(`meta[name="${property}"]`).attr('content');
    return value?.trim() || null;
  };

  const title = meta('og:title');
  const price = meta('product:price:amount') ?? meta('og:price:amount');
  if (!title || !price) return null;

  const availability = (meta('product:availability') ?? '').toLowerCase();

  return {
    sourceId: `${options.merchantDomain}:${options.url}`,
    title,
    url: options.url,
    description: meta('og:description'),
    imageUrl: meta('og:image'),
    price,
    priceWas: null,
    currency: meta('product:price:currency') ?? 'CAD',
    merchantDomain: options.merchantDomain,
    merchantName: options.merchantName ?? null,
    brand: meta('product:brand'),
    categoryHint: options.categoryHint ?? null,
    departmentHint: options.departmentHint ?? null,
    inStock: availability === '' ? true : /instock|in stock|available/i.test(availability),
  };
}

/** Extracts product links from a listing page using the configured selector. */
export function extractProductLinks(html: string, baseUrl: string, selector: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $(selector).each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;

    try {
      links.add(new URL(href, baseUrl).toString());
    } catch {
      // A malformed href is skipped, not fatal.
    }
  });

  return [...links];
}

export function createJsonLdAdapter(config: RetailerConfig): SourceAdapter {
  return {
    id: `jsonld:${config.id}`,
    name: config.name,
    weight: 0.4,

    enabled: () => {
      if (config.enabled === false) return { enabled: false, reason: 'disabled in catalogue' };
      if (!config.productLinkSelector) {
        return { enabled: false, reason: 'no productLinkSelector configured' };
      }
      if (!config.salePaths?.length) {
        return { enabled: false, reason: 'no salePaths configured' };
      }
      return { enabled: true };
    },

    async fetch(context: AdapterContext): Promise<AdapterResult> {
      const base = config.baseUrl.replace(/\/$/, '');
      const maxPages = config.maxProductPages ?? 30;
      const limit = Math.min(context.limit ?? maxPages, maxPages);

      if (config.rateLimitRps) {
        context.http.setDomainRate(config.domain, config.rateLimitRps);
      }

      const links = new Set<string>();

      for (const path of config.salePaths ?? []) {
        if (links.size >= limit) break;

        const listingUrl = `${base}${path.startsWith('/') ? '' : '/'}${path}`;
        // This engine crawls, so robots.txt is honoured on every request - it is
        // deliberately NOT skipped the way a documented API endpoint is.
        const listing = await context.http.fetchText(listingUrl);

        for (const link of extractProductLinks(
          listing.data,
          base,
          config.productLinkSelector ?? 'a',
        )) {
          links.add(link);
          if (links.size >= limit) break;
        }
      }

      const deals: RawDeal[] = [];
      let failures = 0;

      for (const link of [...links].slice(0, limit)) {
        try {
          const page = await context.http.fetchText(link);
          const deal = parseProductPage(page.data, {
            url: link,
            merchantDomain: config.domain,
            merchantName: config.name,
            departmentHint: config.departmentHint ?? undefined,
          });

          if (deal) deals.push(deal);
          else failures += 1;
        } catch {
          failures += 1;
        }
      }

      context.log(`${deals.length} products parsed, ${failures} unreadable`);

      return {
        deals,
        path: 'jsonld',
        reason:
          deals.length === 0
            ? `found ${links.size} product links but parsed none - markup may have changed`
            : undefined,
      };
    },
  };
}
