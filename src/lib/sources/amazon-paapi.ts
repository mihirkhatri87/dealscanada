import { createHash, createHmac } from 'node:crypto';
import type { AdapterContext, AdapterResult, RawDeal, SourceAdapter } from './types';
import { env, flags } from '../config';

/**
 * Amazon Product Advertising API v5 — the official, ToS-clean route.
 *
 * Dormant unless all three credentials are configured, and most installs will
 * never have them: access requires an Amazon Associates account with three
 * qualifying sales inside 180 days. That gate is why `amazon-alt` exists, and
 * why this adapter reports "skipped — credentials not configured" rather than
 * failing. A half-configured integration is not a broken one.
 *
 * When it is configured this is strictly better data than any tracker: real list
 * versus current price, from Amazon, with images and ASINs, under terms that
 * permit it.
 */

const MARKETPLACE = 'www.amazon.ca';
const HOST = 'webservices.amazon.ca';
const REGION = 'us-east-1';
const SERVICE = 'ProductAdvertisingAPI';

export interface SignatureInput {
  accessKey: string;
  secretKey: string;
  /** ISO basic format, e.g. 20260905T120000Z. */
  timestamp: string;
  target: string;
  path: string;
  payload: string;
}

/**
 * AWS Signature Version 4.
 *
 * Written out rather than pulled from a dependency because it is forty lines of
 * well-specified hashing, and a signing bug is invisible until it produces a 403
 * that looks exactly like a credential problem. A known-vector test pins it.
 */
export function signRequest(input: SignatureInput): {
  authorization: string;
  headers: Record<string, string>;
} {
  const date = input.timestamp.slice(0, 8);
  const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;

  // Signed headers must be lowercase, sorted, and exactly the set sent.
  const headers: Record<string, string> = {
    'content-encoding': 'amz-1.0',
    'content-type': 'application/json; charset=utf-8',
    host: HOST,
    'x-amz-date': input.timestamp,
    'x-amz-target': input.target,
  };

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key]}\n`)
    .join('');

  const canonicalRequest = [
    'POST',
    input.path,
    '',
    canonicalHeaders,
    signedHeaders,
    sha256(input.payload),
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', input.timestamp, scope, sha256(canonicalRequest)].join(
    '\n',
  );

  // The signing key is a four-step HMAC chain, written out rather than reduced:
  // this is the code someone will read when a 403 arrives, and a fold obscures
  // which step is wrong.
  const kDate = hmac('AWS4' + input.secretKey, date);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');

  const signature = hmac(kSigning, stringToSign).toString('hex');

  return {
    authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    headers,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/** ISO basic timestamp, which is the only format SigV4 accepts. */
export function amzTimestamp(now: Date): string {
  return `${now.toISOString().replace(/[:-]|\.\d{3}/g, '')}`;
}

export function parseSearchItemsResponse(payload: unknown): RawDeal[] {
  if (payload === null || typeof payload !== 'object') return [];

  const result = (payload as Record<string, unknown>)['SearchResult'];
  if (result === null || typeof result !== 'object') return [];

  const items = (result as Record<string, unknown>)['Items'];
  if (!Array.isArray(items)) return [];

  const deals: RawDeal[] = [];

  for (const entry of items) {
    if (entry === null || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;

    const asin = typeof item['ASIN'] === 'string' ? item['ASIN'] : null;
    const title = path(item, ['ItemInfo', 'Title', 'DisplayValue']);
    if (!asin || typeof title !== 'string') continue;

    const listing = firstListing(item);
    if (!listing) continue;

    const price = numberAt(listing, ['Price', 'Amount']);
    // SavingBasis is Amazon's own "was" price. Its absence means there is no
    // strikethrough on the page either, so there is no saving to claim.
    const was = numberAt(listing, ['SavingBasis', 'Amount']);
    if (price === null || was === null || was <= price) continue;

    deals.push({
      sourceId: `paapi:${asin}`,
      title,
      // DetailPageURL already carries the partner tag when one is configured.
      url: stringAt(item, ['DetailPageURL']) ?? `https://${MARKETPLACE}/dp/${asin}`,
      description: null,
      imageUrl: stringAt(item, ['Images', 'Primary', 'Large', 'URL']),
      price,
      priceWas: was,
      currency: stringAt(listing, ['Price', 'Currency']) ?? 'CAD',
      merchantDomain: 'amazon.ca',
      merchantName: 'Amazon.ca',
      asin,
      brand: stringAt(item, ['ItemInfo', 'ByLineInfo', 'Brand', 'DisplayValue']),
      categoryHint: stringAt(item, ['BrowseNodeInfo', 'BrowseNodes', '0', 'DisplayName']),
      inStock: stringAt(listing, ['Availability', 'Type']) !== 'OutOfStock',
      postedAt: null,
    });
  }

  return deals;
}

function firstListing(item: Record<string, unknown>): Record<string, unknown> | null {
  const listings = path(item, ['Offers', 'Listings']);
  if (!Array.isArray(listings) || listings.length === 0) return null;
  const first = listings[0];
  return first !== null && typeof first === 'object' ? (first as Record<string, unknown>) : null;
}

function path(node: unknown, keys: string[]): unknown {
  let current: unknown = node;
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return null;
    current = Array.isArray(current)
      ? current[Number(key)]
      : (current as Record<string, unknown>)[key];
  }
  return current ?? null;
}

function stringAt(node: unknown, keys: string[]): string | null {
  const value = path(node, keys);
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function numberAt(node: unknown, keys: string[]): number | null {
  const value = path(node, keys);
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export const amazonPaapiAdapter: SourceAdapter = {
  id: 'amazon-paapi',
  name: 'Amazon.ca Product Advertising API',
  weight: 0.9,

  enabled: () =>
    flags.amazonPaapiEnabled
      ? { enabled: true }
      : {
          enabled: false,
          // Names all three, because having two of them is the confusing case.
          reason:
            'credentials not configured — set AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY and ' +
            'AMAZON_PARTNER_TAG (requires an approved Associates account)',
        },

  async fetch(context: AdapterContext): Promise<AdapterResult> {
    const accessKey = env.AMAZON_ACCESS_KEY;
    const secretKey = env.AMAZON_SECRET_KEY;
    const partnerTag = env.AMAZON_PARTNER_TAG;

    if (!accessKey || !secretKey || !partnerTag) {
      return { deals: [], path: 'paapi', reason: 'credentials not configured' };
    }

    const payload = JSON.stringify({
      Keywords: 'deals',
      SearchIndex: 'All',
      ItemCount: Math.min(10, context.limit ?? 10),
      PartnerTag: partnerTag,
      PartnerType: 'Associates',
      Marketplace: MARKETPLACE,
      Resources: [
        'ItemInfo.Title',
        'ItemInfo.ByLineInfo',
        'Images.Primary.Large',
        'Offers.Listings.Price',
        'Offers.Listings.SavingBasis',
        'Offers.Listings.Availability.Type',
        'BrowseNodeInfo.BrowseNodes',
      ],
    });

    const target = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems';
    const requestPath = '/paapi5/searchitems';
    const timestamp = amzTimestamp(new Date());

    const { authorization, headers } = signRequest({
      accessKey,
      secretKey,
      timestamp,
      target,
      path: requestPath,
      payload,
    });

    try {
      const response = await context.http.fetchJson<unknown>(`https://${HOST}${requestPath}`, {
        body: payload,
        headers: { ...headers, Authorization: authorization },
        // A documented API with a signed request, not a page to be crawled.
        skipRobots: true,
      });

      const deals = parseSearchItemsResponse(response.data);
      return {
        deals,
        path: 'paapi',
        ...(deals.length === 0 ? { reason: 'no discounted items in the response' } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        deals: [],
        path: 'paapi',
        // TooManyRequests is throttling, not breakage: PA-API quota scales with
        // an account's actual sales, so a new account hits it constantly.
        reason: /429|TooManyRequests/i.test(message)
          ? `throttled by PA-API (quota scales with Associates sales): ${message}`
          : message,
      };
    }
  },
};
