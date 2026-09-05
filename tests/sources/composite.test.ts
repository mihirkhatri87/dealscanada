import { describe, expect, it, vi } from 'vitest';
import {
  matchesRetailer,
  redflagdealsPath,
  runComposite,
  type CompositeConfig,
  type CompositePath,
} from '@/lib/sources/engines/composite';
import { parseWalmartResponse, createWalmartAdapter } from '@/lib/sources/walmart';
import { createCostcoAdapter } from '@/lib/sources/costco';
import type { RawDeal } from '@/lib/sources/types';

/**
 * Composites exist because Walmart and Costco block us. The behaviour worth
 * testing is therefore not the happy path — it is what happens when paths fail,
 * which on most IPs is what will actually happen.
 */

const CONFIG: CompositeConfig = {
  id: 'walmart',
  name: 'Walmart Canada',
  domain: 'walmart.ca',
  dealerNames: ['walmart', 'walmart canada'],
};

function deal(overrides: Partial<RawDeal> = {}): RawDeal {
  return {
    sourceId: 's',
    title: 'A deal',
    url: 'https://example.ca/p/1',
    ...overrides,
  } as RawDeal;
}

function path(id: string, deals: RawDeal[], throws?: string): CompositePath {
  return {
    id,
    describe: id,
    run: async () => {
      if (throws) throw new Error(throws);
      return { deals, ...(deals.length === 0 ? { reason: 'nothing found' } : {}) };
    },
  };
}

function context() {
  return { http: { fetchJson: vi.fn(), fetchText: vi.fn() }, log: vi.fn() } as never;
}

describe('running the chain', () => {
  it('records which path produced each deal', async () => {
    // The whole point of the design: a silent degradation from the retailer's
    // own feed to a community mirror has to be visible.
    const outcome = await runComposite(
      [path('native', []), path('community', [deal({ url: 'https://walmart.ca/a' })])],
      context(),
      50,
    );

    expect(outcome.path).toBe('community');
    expect(outcome.deals[0]?.sourcePath).toBe('community');
  });

  it('keeps going after a path that blocks, rather than giving up', async () => {
    const outcome = await runComposite(
      [path('native', [], 'HTTP 403'), path('community', [deal({ url: 'https://walmart.ca/a' })])],
      context(),
      50,
    );

    expect(outcome.deals).toHaveLength(1);
    expect(outcome.attempts[0]).toMatchObject({ path: 'native', deals: 0, reason: 'HTTP 403' });
  });

  it('collects from every path rather than stopping at the first that works', async () => {
    // Stopping early would let the retailer's own feed hide in-store clearance
    // that only the store-level source knows about.
    const outcome = await runComposite(
      [
        path('native', [deal({ url: 'https://walmart.ca/a' })]),
        path('in-store', [deal({ url: 'https://walmart.ca/b' })]),
      ],
      context(),
      50,
    );

    expect(outcome.deals).toHaveLength(2);
  });

  it('lets the earlier path win when two find the same product', async () => {
    // Chain order is a quality ranking: the retailer's own price beats a
    // poster's report of it.
    const outcome = await runComposite(
      [
        path('native', [deal({ url: 'https://walmart.ca/same', price: 10 })]),
        path('community', [deal({ url: 'https://walmart.ca/same', price: 99 })]),
      ],
      context(),
      50,
    );

    expect(outcome.deals).toHaveLength(1);
    expect(outcome.deals[0]?.sourcePath).toBe('native');
  });

  it('reports a total block as an outcome, not a failure', async () => {
    const outcome = await runComposite(
      [path('native', [], 'HTTP 403'), path('community', [])],
      context(),
      50,
    );

    expect(outcome.deals).toEqual([]);
    // The reason names every path, so "Walmart has no deals" is distinguishable
    // from "we could not look".
    expect(outcome.reason).toContain('native: HTTP 403');
    expect(outcome.reason).toContain('community: nothing found');
  });

  it('never throws, whatever every path does', async () => {
    const outcome = await runComposite(
      [path('a', [], 'boom'), path('b', [], 'also boom')],
      context(),
      50,
    );

    expect(outcome.deals).toEqual([]);
    expect(outcome.attempts).toHaveLength(2);
  });

  it('honours the limit', async () => {
    const many = Array.from({ length: 10 }, (_, i) => deal({ url: `https://walmart.ca/p/${i}` }));
    const outcome = await runComposite([path('a', many)], context(), 4);
    expect(outcome.deals).toHaveLength(4);
  });
});

describe('matching a retailer', () => {
  it('trusts the link over the dealer name a poster typed', () => {
    expect(
      matchesRetailer(
        deal({ url: 'https://www.walmart.ca/en/ip/1', merchantName: 'Nope' }),
        CONFIG,
      ),
    ).toBe(true);
  });

  it('falls back to the dealer name when the link goes elsewhere', () => {
    expect(
      matchesRetailer(
        deal({ url: 'https://forums.redflagdeals.com/t/1', merchantName: 'Walmart Canada' }),
        CONFIG,
      ),
    ).toBe(true);
  });

  it('does not match an unrelated retailer', () => {
    expect(
      matchesRetailer(deal({ url: 'https://bestbuy.ca/p/1', merchantName: 'Best Buy' }), CONFIG),
    ).toBe(false);
  });

  it('is not fooled by a lookalike domain', () => {
    // A plain endsWith is wrong and quietly so: every one of these ends with
    // "walmart.ca" as a substring, and none of them is Walmart.
    for (const url of [
      'https://notwalmart.ca/p/1',
      'https://fakewalmart.ca/p/1',
      'https://walmart.ca.evil.test/p',
    ]) {
      expect(matchesRetailer(deal({ url }), CONFIG), url).toBe(false);
    }
  });

  it('accepts the site itself and its subdomains', () => {
    for (const url of [
      'https://walmart.ca/p',
      'https://www.walmart.ca/p',
      'https://m.walmart.ca/p',
    ]) {
      expect(matchesRetailer(deal({ url }), CONFIG), url).toBe(true);
    }
  });
});

describe('the RedFlagDeals path', () => {
  it('keeps only threads about this retailer', async () => {
    const payload = {
      topics: [
        {
          topic_id: 1,
          title: 'Walmart clearance TV',
          offer: {
            dealer_name: 'Walmart',
            price: 199,
            list_price: 399,
            url: 'https://walmart.ca/a',
          },
        },
        {
          topic_id: 2,
          title: 'Best Buy laptop',
          offer: {
            dealer_name: 'Best Buy',
            price: 999,
            list_price: 1299,
            url: 'https://bestbuy.ca/b',
          },
        },
      ],
    };

    const result = await redflagdealsPath(CONFIG).run({
      http: { fetchJson: vi.fn(async () => ({ data: payload })), fetchText: vi.fn() },
      log: vi.fn(),
    } as never);

    expect(result.deals).toHaveLength(1);
    expect(result.deals[0]?.title).toContain('Walmart');
  });

  it('says so when the community has nothing today', async () => {
    const result = await redflagdealsPath(CONFIG).run({
      http: { fetchJson: vi.fn(async () => ({ data: { topics: [] } })), fetchText: vi.fn() },
      log: vi.fn(),
    } as never);

    expect(result.deals).toEqual([]);
    expect(result.reason).toContain('no current Walmart Canada threads');
  });
});

describe('the Walmart payload', () => {
  const payload = {
    data: {
      products: [
        {
          productId: '6000200123456',
          name: 'Instant Pot Duo 6QT',
          currentPrice: 89.99,
          wasPrice: 149.99,
          url: '/en/ip/instant-pot/6000200123456',
          image: 'https://i5.walmartimages.ca/x.jpg',
          upc: '00123456789012',
          brand: 'Instant Pot',
        },
        {
          productId: '600020099',
          name: 'Full Price Kettle',
          currentPrice: 29.99,
          wasPrice: 29.99,
        },
        { name: 'No Id Product', currentPrice: 5, wasPrice: 10 },
      ],
    },
  };

  it('emits genuinely discounted products with a resolved URL', () => {
    const deals = parseWalmartResponse(payload);

    expect(deals).toHaveLength(1);
    expect(deals[0]?.url).toBe('https://www.walmart.ca/en/ip/instant-pot/6000200123456');
    expect(deals[0]?.price).toBe(89.99);
    expect(deals[0]?.priceWas).toBe(149.99);
  });

  it('carries the UPC, which is the strongest identity any path gives us', () => {
    // The fallback paths cannot supply this, which is exactly why path A is
    // worth attempting even though it usually fails.
    expect(parseWalmartResponse(payload)[0]?.gtin).toBe('00123456789012');
  });

  it('returns nothing for a shape it does not recognise', () => {
    expect(parseWalmartResponse({ unexpected: true })).toEqual([]);
    expect(parseWalmartResponse(null)).toEqual([]);
  });
});

describe('the adapters', () => {
  it('are enabled and never throw when everything is blocked', async () => {
    for (const adapter of [createWalmartAdapter(), createCostcoAdapter()]) {
      expect(adapter.enabled()).toMatchObject({ enabled: true });

      const result = await adapter.fetch({
        http: {
          fetchJson: vi.fn(async () => {
            throw new Error('HTTP 403');
          }),
          fetchText: vi.fn(async () => {
            throw new Error('HTTP 403');
          }),
        },
        log: vi.fn(),
        limit: 10,
      } as never);

      expect(result.deals).toEqual([]);
      expect(result.reason).toContain('403');
    }
  });

  it('reads in-store clearance from the pool rather than fetching it again', async () => {
    // Adding a composite retailer must cost no extra traffic to the small
    // independent site that supplies store-level data.
    const pool = [
      { ...deal({ url: 'https://www.walmart.ca/en/ip/9' }), storeId: 'store-1' } as RawDeal,
    ];
    const fetchJson = vi.fn(async () => {
      throw new Error('HTTP 403');
    });

    const result = await createWalmartAdapter(() => pool).fetch({
      http: { fetchJson, fetchText: fetchJson },
      log: vi.fn(),
      limit: 10,
    } as never);

    expect(result.deals).toHaveLength(1);
    expect(result.deals[0]?.sourcePath).toBe('in-store');
  });
});
