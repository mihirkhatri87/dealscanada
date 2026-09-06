import type { AdapterContext, AdapterResult, RawDeal, SourceAdapter } from '../types';
import type { RetailerConfig } from '../catalogue';
import { env } from '../../config';

/**
 * Affiliate product-feed engine.
 *
 * The permitted route into retailers that will never be scraped: Staples, MEC,
 * Best Buy, Golf Town and the rest publish a product feed to their affiliate
 * network, and an approved publisher is given a URL to it. This engine reads
 * that URL.
 *
 * It is worth having for two reasons beyond access. The feed is the merchant's
 * own catalogue export rather than a rendering of it, so `price` and
 * `sale_price` are stated numbers. And it carries `gtin` and `mpn` — the
 * manufacturer identifiers the verification pass requires before it will make
 * any cross-merchant claim. A scraped page rarely yields those, which is why a
 * feed-sourced retailer strengthens every *other* retailer's verdicts too.
 *
 * Rakuten, CJ, AvantLink, Impact, Awin and FlexOffers all specify the Google
 * product feed format, so one parser covers every network a Canadian retailer
 * is likely to use. Delimiters differ, and are detected rather than configured.
 *
 * Feed URLs are credentials — they embed a publisher token — so they live in
 * the environment, never in the catalogue.
 */

/** Column names from the Google product feed spec that networks standardise on. */
const COLUMNS = {
  id: ['id', 'sku', 'product_id'],
  title: ['title', 'name', 'product_name'],
  description: ['description', 'long_description'],
  link: ['link', 'product_url', 'url'],
  image: ['image_link', 'image_url', 'image'],
  price: ['price', 'retail_price', 'regular_price'],
  salePrice: ['sale_price', 'saleprice', 'discount_price'],
  brand: ['brand', 'manufacturer'],
  gtin: ['gtin', 'upc', 'ean', 'barcode'],
  mpn: ['mpn', 'manufacturer_part_number', 'part_number'],
  availability: ['availability', 'in_stock', 'stock_status'],
  category: ['product_type', 'google_product_category', 'category', 'primary_category'],
} as const;

/**
 * Reads a delimited feed into rows keyed by lower-cased header.
 *
 * Written out rather than taken from a library because the failure mode matters:
 * a product description containing a comma, a quote, or a newline is completely
 * ordinary, and a naive split on the delimiter silently shifts every following
 * column — which would put a description where a price belongs and land a wrong
 * number on a deal card. This follows RFC 4180 quoting.
 */
export function parseDelimited(text: string): Array<Record<string, string>> {
  const clean = text.replace(/^﻿/, '');
  if (clean.trim() === '') return [];

  // Tab-delimited is as common as comma in this space, and a feed full of
  // product titles contains commas either way, so the header line decides.
  const firstLine = clean.slice(0, clean.indexOf('\n') === -1 ? undefined : clean.indexOf('\n'));
  const delimiter = firstLine.split('\t').length > firstLine.split(',').length ? '\t' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index]!;

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (clean[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }

  const header = rows.shift();
  if (!header) return [];

  const keys = header.map((name) => name.trim().toLowerCase());

  return rows
    .filter((values) => values.some((value) => value.trim() !== ''))
    .map((values) => {
      const record: Record<string, string> = {};
      keys.forEach((key, position) => {
        record[key] = (values[position] ?? '').trim();
      });
      return record;
    });
}

function pick(row: Record<string, string>, names: readonly string[]): string | null {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== '') return value;
  }
  return null;
}

/**
 * Reads a feed price.
 *
 * The spec writes money as "19.99 CAD", but networks emit "$19.99", "19,99" and
 * a bare number too. The currency is stripped rather than parsed here; the
 * pipeline stores integer cents and treats CAD as the only currency.
 */
export function parseFeedPrice(value: string | null): number | null {
  if (!value) return null;

  const numeric = value.replace(/[^\d.,]/g, '');
  if (numeric === '') return null;

  // "1.234,56" is European; "1,234.56" is not. Whichever separator comes last
  // is the decimal one.
  const normalized =
    numeric.lastIndexOf(',') > numeric.lastIndexOf('.')
      ? numeric.replace(/\./g, '').replace(',', '.')
      : numeric.replace(/,/g, '');

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export interface FeedParseOptions {
  merchantDomain: string;
  merchantName?: string;
  departmentHint?: string;
}

export function parseProductFeed(text: string, options: FeedParseOptions): RawDeal[] {
  const deals: RawDeal[] = [];

  for (const row of parseDelimited(text)) {
    const title = pick(row, COLUMNS.title);
    const link = pick(row, COLUMNS.link);
    if (!title || !link) continue;

    const regular = parseFeedPrice(pick(row, COLUMNS.price));
    const sale = parseFeedPrice(pick(row, COLUMNS.salePrice));

    // A feed is the retailer's whole catalogue, not a deal feed. Without a sale
    // price below the regular one there is no markdown to report, and shipping
    // the catalogue would bury every real deal on the site.
    if (regular === null || sale === null || sale >= regular) continue;

    const availability = (pick(row, COLUMNS.availability) ?? '').toLowerCase();

    deals.push({
      sourceId: `${options.merchantDomain}:${pick(row, COLUMNS.id) ?? link}`,
      title,
      url: link,
      description: pick(row, COLUMNS.description),
      imageUrl: pick(row, COLUMNS.image),
      price: sale,
      priceWas: regular,
      currency: 'CAD',
      merchantDomain: options.merchantDomain,
      merchantName: options.merchantName ?? null,
      brand: pick(row, COLUMNS.brand),
      // The whole reason this engine is worth having: manufacturer identifiers
      // arrive stated rather than inferred, which is what lets the verification
      // pass compare this product across merchants at all.
      gtin: pick(row, COLUMNS.gtin),
      mpn: pick(row, COLUMNS.mpn),
      categoryHint: pick(row, COLUMNS.category),
      departmentHint: options.departmentHint ?? null,
      inStock: availability === '' ? true : /in ?stock|available|yes|true|1/.test(availability),
      postedAt: null,
    });
  }

  return deals;
}

/**
 * The feed URL for a retailer, from the environment.
 *
 * `AFFILIATE_FEEDS` is a JSON object of retailer id to URL. One variable rather
 * than one per retailer, because the set grows as approvals land and adding a
 * retailer should not need a config schema change.
 */
export function feedUrlFor(retailerId: string): string | null {
  if (!env.AFFILIATE_FEEDS) return null;

  try {
    const parsed = JSON.parse(env.AFFILIATE_FEEDS) as Record<string, unknown>;
    const url = parsed[retailerId];
    return typeof url === 'string' && url !== '' ? url : null;
  } catch {
    return null;
  }
}

/** Builds an adapter for one affiliate feed from its catalogue entry. */
export function createFeedAdapter(config: RetailerConfig): SourceAdapter {
  return {
    id: `feed:${config.id}`,
    name: config.name,
    weight: 0.7,

    enabled: () => {
      if (config.enabled === false) return { enabled: false, reason: 'disabled in catalogue' };
      if (!feedUrlFor(config.id)) {
        return {
          enabled: false,
          reason: `no feed URL configured — add "${config.id}" to AFFILIATE_FEEDS once the affiliate application is approved`,
        };
      }
      return { enabled: true };
    },

    async fetch(context: AdapterContext): Promise<AdapterResult> {
      const url = feedUrlFor(config.id);
      if (!url) {
        return { deals: [], path: 'feed', reason: 'no feed URL configured' };
      }

      // The publisher was given this URL for this purpose, so robots.txt does
      // not gate it, exactly as it does not gate Shopify's products.json.
      const response = await context.http.fetchText(url, { skipRobots: true });
      const deals = parseProductFeed(response.data, {
        merchantDomain: config.domain,
        merchantName: config.name,
        departmentHint: config.departmentHint ?? undefined,
      });

      context.log(`${deals.length} discounted products in the feed`);

      return {
        deals: deals.slice(0, context.limit ?? deals.length),
        path: 'feed',
        reason: deals.length === 0 ? 'feed read, but no product carried a sale price' : undefined,
      };
    },
  };
}
