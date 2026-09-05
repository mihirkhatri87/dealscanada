import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createShopifyAdapter, parseShopifyProducts } from '@/lib/sources/engines/shopify';
import { retailerConfigSchema } from '@/lib/sources/catalogue';
import type { AdapterContext } from '@/lib/sources/types';

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/shopify/products.json'), 'utf8'),
) as unknown;

const options = {
  baseUrl: 'https://roots.com',
  merchantDomain: 'roots.com',
  merchantName: 'Roots',
  fromSaleCollection: true,
};

const config = retailerConfigSchema.parse({
  id: 'roots',
  name: 'Roots',
  domain: 'roots.com',
  baseUrl: 'https://roots.com',
  engine: 'shopify',
});

function context(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    http: { fetchJson: vi.fn(), fetchText: vi.fn() } as unknown as AdapterContext['http'],
    log: () => {},
    ...overrides,
  };
}

describe('parseShopifyProducts', () => {
  const deals = parseShopifyProducts(fixture, options);

  it('parses products from a sale collection', () => {
    // Six products in; the one with no variants is unusable.
    expect(deals).toHaveLength(5);
    expect(deals.some((d) => d.title.includes('No Variants'))).toBe(false);
  });

  it('takes before/after from compare_at_price, the merchant own record', () => {
    const coat = deals.find((d) => d.title === 'Wool Blend Peacoat');
    expect(coat?.price).toBe(89.99);
    expect(coat?.priceWas).toBe(228);
  });

  it('discards compare_at_price when it does not exceed the price', () => {
    // Shopify stores routinely leave it equal to price when nothing is on sale.
    // Treating that as a "was" would fabricate a saving.
    const tee = deals.find((d) => d.title === 'Classic Cotton Tee');
    expect(tee?.priceWas).toBeNull();
  });

  it('discards a compare_at_price BELOW the price as bad data', () => {
    const jogger = deals.find((d) => d.title === 'Fleece Jogger');
    expect(jogger?.priceWas).toBeNull();
  });

  it('chooses the cheapest IN-STOCK variant, which is what a shopper would pay', () => {
    const hoodie = deals.find((d) => d.title.includes('Variant Test'));
    // $59.99 is cheapest in stock; $79.99 is cheaper-listed but sold out... no,
    // $59.99 is both. The sold-out $79.99 must not be chosen over it.
    expect(hoodie?.price).toBe(59.99);
    expect(hoodie?.inStock).toBe(true);
  });

  it('still lists an entirely sold-out product, marked out of stock', () => {
    // Hiding it silently would make a real clearance look like it never existed.
    const parka = deals.find((d) => d.title.includes('Sold Out'));
    expect(parka).toBeDefined();
    expect(parka?.inStock).toBe(false);
    expect(parka?.price).toBe(199.99);
  });

  it('captures the barcode as a GTIN for cross-merchant comparison', () => {
    const coat = deals.find((d) => d.title === 'Wool Blend Peacoat');
    expect(coat?.gtin).toBe('0628451234567');
  });

  it('collects available sizes without any extra request', () => {
    const coat = deals.find((d) => d.title === 'Wool Blend Peacoat');
    // M is sold out, so it is not offered as available.
    expect(coat?.sizesAvailable).toEqual(['XS', 'S']);
  });

  it('derives a department from tags in either array or string form', () => {
    expect(deals.find((d) => d.title === 'Wool Blend Peacoat')?.departmentHint).toBe('women');
    expect(deals.find((d) => d.title === 'Classic Cotton Tee')?.departmentHint).toBe('men');
    expect(deals.find((d) => d.title === 'Fleece Jogger')?.departmentHint).toBe('girls');
    expect(deals.find((d) => d.title.includes('Variant Test'))?.departmentHint).toBe('baby');
  });

  it('builds a product URL from the handle', () => {
    const coat = deals.find((d) => d.title === 'Wool Blend Peacoat');
    expect(coat?.url).toBe('https://roots.com/products/wool-blend-peacoat');
  });

  it('namespaces the source id by domain so two stores cannot collide', () => {
    const coat = deals.find((d) => d.title === 'Wool Blend Peacoat');
    expect(coat?.sourceId).toBe('roots.com:7891234567890');
  });

  it('outside a sale collection, keeps only genuine markdowns', () => {
    const strict = parseShopifyProducts(fixture, { ...options, fromSaleCollection: false });
    expect(strict.every((deal) => deal.priceWas !== null)).toBe(true);
    expect(strict.some((d) => d.title === 'Classic Cotton Tee')).toBe(false);
  });

  it('returns an empty array on a malformed payload', () => {
    expect(parseShopifyProducts(null, options)).toEqual([]);
    expect(parseShopifyProducts({}, options)).toEqual([]);
    expect(parseShopifyProducts({ products: [{ junk: 1 }] }, options)).toEqual([]);
  });
});

describe('createShopifyAdapter', () => {
  it('onboards a retailer from a catalogue entry alone', () => {
    const adapter = createShopifyAdapter(config);
    expect(adapter.id).toBe('shopify:roots');
    expect(adapter.enabled()).toEqual({ enabled: true });
  });

  it('reports a catalogue-disabled retailer as skipped, not failed', () => {
    const adapter = createShopifyAdapter({ ...config, enabled: false });
    expect(adapter.enabled()).toEqual({
      enabled: false,
      reason: 'disabled in catalogue',
    });
  });

  it('tries the standard sale collections', async () => {
    const fetchJson = vi.fn().mockResolvedValue({ data: fixture });
    await createShopifyAdapter(config).fetch(
      context({ http: { fetchJson } as unknown as AdapterContext['http'], limit: 5 }),
    );

    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining('/collections/sale/products.json'),
      expect.anything(),
    );
  });

  it('treats a missing collection as normal rather than a failure', async () => {
    const fetchJson = vi
      .fn()
      .mockRejectedValueOnce(new Error('404 Not Found'))
      .mockResolvedValue({ data: fixture });

    const result = await createShopifyAdapter(config).fetch(
      context({ http: { fetchJson } as unknown as AdapterContext['http'], limit: 5 }),
    );

    expect(result.deals.length).toBeGreaterThan(0);
  });

  it('reports a store with products.json closed, without throwing', async () => {
    const fetchJson = vi.fn().mockRejectedValue(new Error('404 Not Found'));
    const result = await createShopifyAdapter(config).fetch(
      context({ http: { fetchJson } as unknown as AdapterContext['http'] }),
    );

    expect(result.deals).toEqual([]);
    expect(result.reason).toContain('no sale collections found');
  });

  it('uses catalogue-specified collections when given', async () => {
    const fetchJson = vi.fn().mockResolvedValue({ data: { products: [] } });
    await createShopifyAdapter({ ...config, salePaths: ['final-sale'] }).fetch(
      context({ http: { fetchJson } as unknown as AdapterContext['http'] }),
    );

    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining('/collections/final-sale/'),
      expect.anything(),
    );
  });
});
