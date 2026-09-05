import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bestbuyAdapter, parseSearchResponse } from '@/lib/sources/bestbuy';
import type { AdapterContext } from '@/lib/sources/types';
import { computeDiscount, parsePriceToCents } from '@/lib/util/money';

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/bestbuy/search.json'), 'utf8'),
) as unknown;

function context(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    http: { fetchJson: vi.fn(), fetchText: vi.fn() } as unknown as AdapterContext['http'],
    log: () => {},
    ...overrides,
  };
}

describe('parseSearchResponse', () => {
  const deals = parseSearchResponse(fixture);

  it('keeps only genuinely discounted products', () => {
    // Seven products in: one at full price and one with no salePrice are excluded.
    expect(deals).toHaveLength(5);
    expect(deals.some((d) => d.title.includes('MacBook Air'))).toBe(false);
    expect(deals.some((d) => d.title.includes('Dyson'))).toBe(false);
  });

  it('carries both prices, so before/after comes from the retailer system', () => {
    const tv = deals.find((d) => d.title.includes('QN90D'));
    expect(tv?.price).toBe(1499.99);
    expect(tv?.priceWas).toBe(1999.99);
  });

  it('produces a discount matching the arithmetic within half a point', () => {
    for (const deal of deals) {
      const now = parsePriceToCents(deal.price ?? null);
      const was = parsePriceToCents(deal.priceWas ?? null);
      if (now === null || was === null) continue;

      const { discountPct } = computeDiscount(now, was);
      const expected = ((was - now) / was) * 100;
      expect(Math.abs((discountPct ?? 0) - expected)).toBeLessThan(0.5);
    }
  });

  it('supplies a model number, which is what enables cross-merchant comparison', () => {
    const tv = deals.find((d) => d.title.includes('QN90D'));
    expect(tv?.mpn).toBe('QN65QN90DAFXZC');
    expect(tv?.brand).toBe('Samsung');
  });

  it('prefers the high-resolution image and falls back to the thumbnail', () => {
    const tv = deals.find((d) => d.title.includes('QN90D'));
    expect(tv?.imageUrl).toContain('/high/');

    const sony = deals.find((d) => d.title.includes('WH-1000XM5'));
    expect(sony?.imageUrl).toContain('/thumb/');
  });

  it('builds an absolute product URL from a relative path', () => {
    for (const deal of deals) {
      expect(deal.url).toMatch(/^https:\/\/www\.bestbuy\.ca\//);
    }
  });

  it('falls back to a SKU URL when the product URL is missing', () => {
    const instantPot = deals.find((d) => d.title.includes('Instant Pot'));
    expect(instantPot?.url).toBe('https://www.bestbuy.ca/en-ca/product/11119999');
  });

  it('accepts a numeric SKU as well as a string one', () => {
    const instantPot = deals.find((d) => d.title.includes('Instant Pot'));
    expect(instantPot?.sourceId).toBe('11119999');
  });

  it('records stock status rather than hiding sold-out deals', () => {
    // A sold-out clearance item is still worth showing - it may restock, and
    // hiding it silently would look like the deal never existed.
    const lego = deals.find((d) => d.title.includes('LEGO'));
    expect(lego?.inStock).toBe(false);

    const tv = deals.find((d) => d.title.includes('QN90D'));
    expect(tv?.inStock).toBe(true);
  });

  it('notes free shipping only where the source says so', () => {
    expect(deals.find((d) => d.title.includes('QN90D'))?.shippingNote).toBe('Free shipping');
    expect(deals.find((d) => d.title.includes('LEGO'))?.shippingNote).toBeNull();
  });

  it('drops a product with no current price instead of guessing one', () => {
    expect(deals.some((d) => d.title.includes('Dyson'))).toBe(false);
  });

  it('ignores unknown fields so an API addition cannot break ingestion', () => {
    const instantPot = deals.find((d) => d.title.includes('Instant Pot'));
    expect(instantPot).toBeDefined();
  });

  it('returns an empty array on a malformed payload rather than throwing', () => {
    expect(parseSearchResponse(null)).toEqual([]);
    expect(parseSearchResponse({})).toEqual([]);
    expect(parseSearchResponse({ products: 'nope' })).toEqual([]);
    expect(parseSearchResponse({ products: [{ garbage: true }] })).toEqual([]);
  });
});

describe('bestbuyAdapter', () => {
  it('needs no credentials', () => {
    expect(bestbuyAdapter.enabled()).toEqual({ enabled: true });
  });

  it('fetches and reports its path', async () => {
    const fetchJson = vi.fn().mockResolvedValue({ data: fixture });
    const result = await bestbuyAdapter.fetch(
      context({ http: { fetchJson } as unknown as AdapterContext['http'], limit: 50 }),
    );

    expect(result.path).toBe('search-api');
    expect(result.deals.length).toBeGreaterThan(0);
  });

  it('respects the limit and the page cap', async () => {
    const fetchJson = vi.fn().mockResolvedValue({ data: fixture });
    const result = await bestbuyAdapter.fetch(
      context({ http: { fetchJson } as unknown as AdapterContext['http'], limit: 3 }),
    );

    expect(result.deals).toHaveLength(3);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('stops paginating on an empty page', async () => {
    const fetchJson = vi
      .fn()
      .mockResolvedValueOnce({ data: fixture })
      .mockResolvedValueOnce({ data: { products: [] } });

    await bestbuyAdapter.fetch(
      context({ http: { fetchJson } as unknown as AdapterContext['http'], limit: 500 }),
    );

    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('reports a reachable-but-empty response distinctly from a failure', async () => {
    const fetchJson = vi.fn().mockResolvedValue({ data: { products: [] } });
    const result = await bestbuyAdapter.fetch(
      context({ http: { fetchJson } as unknown as AdapterContext['http'] }),
    );

    expect(result.deals).toHaveLength(0);
    expect(result.reason).toContain('no discounted products');
  });

  it('lets a transport failure propagate so the runner records it', async () => {
    const fetchJson = vi.fn().mockRejectedValue(new Error('403 Forbidden'));
    await expect(
      bestbuyAdapter.fetch(context({ http: { fetchJson } as unknown as AdapterContext['http'] })),
    ).rejects.toThrow('403');
  });
});
