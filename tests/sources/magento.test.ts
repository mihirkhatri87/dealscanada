import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCategoryQuery,
  buildProductsQuery,
  createMagentoAdapter,
  parseCategories,
  parseMagentoProducts,
} from '@/lib/sources/engines/magento';
import { retailerConfigSchema } from '@/lib/sources/catalogue';
import type { AdapterContext } from '@/lib/sources/types';

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/magento/products.json'), 'utf8'),
) as unknown;

const options = {
  baseUrl: 'https://www.westcoastkids.ca',
  merchantDomain: 'westcoastkids.ca',
  merchantName: 'West Coast Kids',
};

const config = retailerConfigSchema.parse({
  id: 'west-coast-kids',
  name: 'West Coast Kids',
  domain: 'westcoastkids.ca',
  baseUrl: 'https://www.westcoastkids.ca',
  engine: 'magento',
  salePaths: ['sale'],
});

function context(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    http: { fetchJson: vi.fn(), fetchText: vi.fn() } as unknown as AdapterContext['http'],
    log: () => {},
    ...overrides,
  };
}

describe('parseMagentoProducts', () => {
  const deals = parseMagentoProducts(fixture, options);

  it('reads before/after from the platform rather than scraped markup', () => {
    const nomi = deals.find((deal) => deal.title === 'Nomi Baby Set');
    expect(nomi?.price).toBe(74.99);
    expect(nomi?.priceWas).toBe(119.99);
  });

  it('keeps only genuine markdowns, because a category is not a sale', () => {
    // Magento reports regular === final for anything not on promotion, and
    // stores file permanent sections under `sale` all the time.
    const noPromotion = {
      data: {
        products: {
          items: [
            {
              name: 'Full Price Cot',
              sku: 'COT-1',
              url_key: 'full-price-cot',
              price_range: {
                minimum_price: { regular_price: { value: 200 }, final_price: { value: 200 } },
              },
            },
          ],
        },
      },
    };

    expect(parseMagentoProducts(noPromotion, options)).toEqual([]);
  });

  it('builds the product URL from the store own url_suffix', () => {
    // `.html` is Magento's default but it is a store setting, and this store
    // clears it — appending the conventional suffix would publish dead links.
    const nomi = deals.find((deal) => deal.title === 'Nomi Baby Set');
    expect(nomi?.url).toBe('https://www.westcoastkids.ca/nomi-baby-set');
  });

  it('honours a store that does use a suffix', () => {
    const suffixed = {
      data: {
        products: {
          items: [
            {
              name: 'Suffixed',
              sku: 'S-1',
              url_key: 'suffixed',
              url_suffix: '.html',
              price_range: {
                minimum_price: { regular_price: { value: 50 }, final_price: { value: 25 } },
              },
            },
          ],
        },
      },
    };

    expect(parseMagentoProducts(suffixed, options)[0]?.url).toBe(
      'https://www.westcoastkids.ca/suffixed.html',
    );
  });

  it('treats the SKU as an MPN and never as a GTIN', () => {
    // A Magento SKU is the merchant's own part number. Claiming it as a GTIN
    // would let two retailers' internal codes collide into a confident, wrong
    // cross-merchant comparison.
    const nomi = deals.find((deal) => deal.title === 'Nomi Baby Set');
    expect(nomi?.mpn).toBe('63520');
    expect(nomi?.gtin).toBeUndefined();
  });

  it('namespaces the source id by domain so two stores cannot collide', () => {
    expect(deals[0]?.sourceId.startsWith('westcoastkids.ca:')).toBe(true);
  });

  it('returns an empty array on a malformed payload', () => {
    expect(parseMagentoProducts({ nope: true }, options)).toEqual([]);
    expect(parseMagentoProducts(null, options)).toEqual([]);
  });
});

describe('the GraphQL queries', () => {
  it('quotes url keys so a crafted catalogue entry cannot alter the query', () => {
    const query = buildCategoryQuery(['sale', 'a"b']);
    expect(query).toContain('"sale"');
    expect(query).toContain('"a\\"b"');
  });

  it('asks for the fields the parser needs', () => {
    const query = buildProductsQuery('Nzkw', 20);
    expect(query).toContain('"Nzkw"');
    expect(query).toContain('pageSize:20');
    for (const field of ['url_suffix', 'regular_price', 'final_price', 'sku']) {
      expect(query).toContain(field);
    }
  });
});

describe('parseCategories', () => {
  it('skips an empty category, which is a request that returns nothing', () => {
    const payload = {
      data: {
        categoryList: [
          { uid: 'Nzkw', url_key: 'sale', product_count: 1175 },
          { uid: 'ZW1w', url_key: 'clearance', product_count: 0 },
        ],
      },
    };

    expect(parseCategories(payload)).toEqual([{ uid: 'Nzkw', urlKey: 'sale' }]);
  });

  it('returns nothing rather than throwing on an error response', () => {
    expect(parseCategories({ errors: [{ message: 'unauthorized' }] })).toEqual([]);
  });
});

describe('createMagentoAdapter', () => {
  it('resolves categories, then fetches products for each', async () => {
    const fetchJson = vi.fn(async (_url: string, options?: { body?: string }) => {
      if (options?.body?.includes('categoryList')) {
        return { data: { data: { categoryList: [{ uid: 'Nzkw', url_key: 'sale' }] } } };
      }
      return { data: fixture };
    });

    const result = await createMagentoAdapter(config).fetch(
      context({ http: { fetchJson } as unknown as AdapterContext['http'] }),
    );

    expect(result.deals.length).toBeGreaterThan(0);
    expect(result.path).toBe('graphql');
  });

  it('posts to /graphql and does not gate an API endpoint on robots.txt', async () => {
    const fetchJson = vi.fn().mockResolvedValue({ data: { data: { categoryList: [] } } });

    await createMagentoAdapter(config).fetch(
      context({ http: { fetchJson } as unknown as AdapterContext['http'] }),
    );

    const [url, passed] = fetchJson.mock.calls[0] ?? [];
    expect(url).toBe('https://www.westcoastkids.ca/graphql');
    expect(passed).toMatchObject({ skipRobots: true });
    expect(String(passed?.body)).toContain('categoryList');
  });

  it('says which categories it tried when none matched', async () => {
    const fetchJson = vi.fn().mockResolvedValue({ data: { data: { categoryList: [] } } });

    const result = await createMagentoAdapter(config).fetch(
      context({ http: { fetchJson } as unknown as AdapterContext['http'] }),
    );

    expect(result.deals).toEqual([]);
    expect(result.reason).toContain('sale');
  });

  it('reports a closed GraphQL endpoint without throwing', async () => {
    const fetchJson = vi.fn().mockRejectedValue(new Error('HTTP 401'));

    const result = await createMagentoAdapter(config).fetch(
      context({ http: { fetchJson } as unknown as AdapterContext['http'] }),
    );

    expect(result.deals).toEqual([]);
    expect(result.reason).toContain('category lookup failed');
  });

  it('reports a catalogue-disabled retailer as skipped, not failed', () => {
    expect(createMagentoAdapter({ ...config, enabled: false }).enabled()).toMatchObject({
      enabled: false,
    });
  });
});
