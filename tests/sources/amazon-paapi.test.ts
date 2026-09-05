import { createHmac, createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  amazonPaapiAdapter,
  amzTimestamp,
  parseSearchItemsResponse,
  signRequest,
} from '@/lib/sources/amazon-paapi';

/**
 * A signing bug is invisible: it produces a 403 that looks exactly like a wrong
 * credential, and someone loses an afternoon to it. So the signature is pinned
 * to an independently computed vector rather than to whatever the code happens
 * to emit.
 */

const FIXED = {
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  timestamp: '20260905T120000Z',
  target: 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems',
  path: '/paapi5/searchitems',
  payload: '{"Keywords":"deals"}',
};

/** The SigV4 algorithm computed independently of the implementation. */
function expectedSignature(): string {
  const date = FIXED.timestamp.slice(0, 8);
  const scope = `${date}/us-east-1/ProductAdvertisingAPI/aws4_request`;

  const canonicalHeaders =
    'content-encoding:amz-1.0\n' +
    'content-type:application/json; charset=utf-8\n' +
    'host:webservices.amazon.ca\n' +
    `x-amz-date:${FIXED.timestamp}\n` +
    `x-amz-target:${FIXED.target}\n`;

  const signedHeaders = 'content-encoding;content-type;host;x-amz-date;x-amz-target';
  const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

  const canonicalRequest = [
    'POST',
    FIXED.path,
    '',
    canonicalHeaders,
    signedHeaders,
    hash(FIXED.payload),
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', FIXED.timestamp, scope, hash(canonicalRequest)].join(
    '\n',
  );

  const sign = (key: Buffer | string, value: string) =>
    createHmac('sha256', key).update(value, 'utf8').digest();

  const kDate = sign(`AWS4${FIXED.secretKey}`, date);
  const kRegion = sign(kDate, 'us-east-1');
  const kService = sign(kRegion, 'ProductAdvertisingAPI');
  const kSigning = sign(kService, 'aws4_request');

  return sign(kSigning, stringToSign).toString('hex');
}

describe('request signing', () => {
  it('matches an independently computed signature for a fixed input', () => {
    const { authorization } = signRequest(FIXED);
    expect(authorization).toContain(`Signature=${expectedSignature()}`);
  });

  it('is deterministic for the same input', () => {
    expect(signRequest(FIXED).authorization).toBe(signRequest(FIXED).authorization);
  });

  it('changes when any input changes', () => {
    const base = signRequest(FIXED).authorization;

    expect(signRequest({ ...FIXED, payload: '{"Keywords":"other"}' }).authorization).not.toBe(base);
    expect(signRequest({ ...FIXED, timestamp: '20260906T120000Z' }).authorization).not.toBe(base);
    expect(signRequest({ ...FIXED, secretKey: 'different' }).authorization).not.toBe(base);
  });

  it('names the credential scope and the exact headers it signed', () => {
    const { authorization, headers } = signRequest(FIXED);

    expect(authorization).toContain(
      `Credential=${FIXED.accessKey}/20260905/us-east-1/ProductAdvertisingAPI/aws4_request`,
    );
    // Signed headers must be exactly the set sent, or the service rejects it.
    const signed = /SignedHeaders=([^,]+)/.exec(authorization)?.[1]?.split(';') ?? [];
    expect(signed.sort()).toEqual(Object.keys(headers).sort());
  });

  it('never puts the secret in the header it produces', () => {
    const { authorization, headers } = signRequest(FIXED);
    const serialized = `${authorization} ${JSON.stringify(headers)}`;
    expect(serialized).not.toContain(FIXED.secretKey);
  });
});

describe('the timestamp', () => {
  it('is ISO basic, the only format SigV4 accepts', () => {
    expect(amzTimestamp(new Date('2026-09-05T12:00:00.000Z'))).toBe('20260905T120000Z');
  });
});

describe('parsing a SearchItems response', () => {
  const response = {
    SearchResult: {
      Items: [
        {
          ASIN: 'B09XS7JWHH',
          DetailPageURL: 'https://www.amazon.ca/dp/B09XS7JWHH?tag=partner-20',
          ItemInfo: {
            Title: { DisplayValue: 'Sony WH-1000XM5 Headphones' },
            ByLineInfo: { Brand: { DisplayValue: 'Sony' } },
          },
          Images: { Primary: { Large: { URL: 'https://m.media-amazon.com/x.jpg' } } },
          BrowseNodeInfo: { BrowseNodes: [{ DisplayName: 'Headphones' }] },
          Offers: {
            Listings: [
              {
                Price: { Amount: 328.0, Currency: 'CAD' },
                SavingBasis: { Amount: 549.99 },
                Availability: { Type: 'Now' },
              },
            ],
          },
        },
        {
          ASIN: 'B0FULLPRICE',
          ItemInfo: { Title: { DisplayValue: 'Full Price Item' } },
          Offers: { Listings: [{ Price: { Amount: 49.99, Currency: 'CAD' } }] },
        },
        {
          ASIN: 'B0NOOFFERS',
          ItemInfo: { Title: { DisplayValue: 'No Offers Item' } },
        },
      ],
    },
  };

  it('emits a discounted item with both prices', () => {
    const deals = parseSearchItemsResponse(response);

    expect(deals).toHaveLength(1);
    expect(deals[0]?.price).toBe(328);
    expect(deals[0]?.priceWas).toBe(549.99);
  });

  it('drops an item with no SavingBasis', () => {
    // No SavingBasis means no strikethrough on Amazon's own page either, so
    // there is no saving to claim.
    const titles = parseSearchItemsResponse(response).map((deal) => deal.title);
    expect(titles).not.toContain('Full Price Item');
  });

  it('drops an item with no offers rather than crashing on it', () => {
    const titles = parseSearchItemsResponse(response).map((deal) => deal.title);
    expect(titles).not.toContain('No Offers Item');
  });

  it('keeps the affiliate-tagged URL Amazon returns', () => {
    expect(parseSearchItemsResponse(response)[0]?.url).toContain('tag=partner-20');
  });

  it('carries the ASIN, brand and image', () => {
    const deal = parseSearchItemsResponse(response)[0];

    expect(deal?.asin).toBe('B09XS7JWHH');
    expect(deal?.brand).toBe('Sony');
    expect(deal?.imageUrl).toContain('m.media-amazon.com');
  });

  it('returns nothing for a shape it does not recognise', () => {
    expect(parseSearchItemsResponse({ Errors: [{ Code: 'InvalidSignature' }] })).toEqual([]);
    expect(parseSearchItemsResponse(null)).toEqual([]);
  });
});

describe('dormancy', () => {
  it('reports itself skipped with all three variable names, not failed', () => {
    // Having two of the three is the confusing case, so the message names them
    // all rather than whichever one it checked first.
    const gate = amazonPaapiAdapter.enabled();

    if (!process.env['AMAZON_ACCESS_KEY']) {
      expect(gate.enabled).toBe(false);
      const reason = 'reason' in gate ? gate.reason : '';
      expect(reason).toContain('AMAZON_ACCESS_KEY');
      expect(reason).toContain('AMAZON_SECRET_KEY');
      expect(reason).toContain('AMAZON_PARTNER_TAG');
      expect(reason).toContain('Associates');
    }
  });

  it('makes no request without credentials', async () => {
    const fetchJson = vi.fn();
    const result = await amazonPaapiAdapter.fetch({
      http: { fetchJson, fetchText: vi.fn() },
      log: vi.fn(),
    } as never);

    if (!process.env['AMAZON_ACCESS_KEY']) {
      expect(fetchJson).not.toHaveBeenCalled();
      expect(result.deals).toEqual([]);
      expect(result.reason).toContain('credentials not configured');
    }
  });
});
