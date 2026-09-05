import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runPipeline } from '@/lib/pipeline/run';
import { register, resetRegistry, allAdapters, getAdapter } from '@/lib/sources/registry';
import type { SourceAdapter, RawDeal } from '@/lib/sources/types';
import { tempSqliteRepo } from '../db/helpers';
import type { DealRepository } from '@/lib/db/repository';

let repo: DealRepository;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  const ctx = tempSqliteRepo();
  repo = ctx.repo;
  cleanup = ctx.cleanup;
  await repo.migrate();
  resetRegistry();
});

afterEach(async () => {
  await cleanup();
  resetRegistry();
});

function rawDeal(overrides: Partial<RawDeal> = {}): RawDeal {
  return {
    sourceId: 'x1',
    title: 'Samsung 65" QN90D Neo QLED 4K Smart TV',
    url: 'https://www.bestbuy.ca/en-ca/product/12345',
    price: '$1,499.99',
    priceWas: '$1,999.99',
    ...overrides,
  };
}

function fakeAdapter(
  id: string,
  behaviour: 'healthy' | 'throws' | 'hangs' | 'malformed' | 'disabled',
  deals: RawDeal[] = [rawDeal()],
): SourceAdapter {
  return {
    id,
    name: id,
    enabled: () =>
      behaviour === 'disabled'
        ? { enabled: false, reason: 'credentials not configured' }
        : { enabled: true },
    fetch: async () => {
      if (behaviour === 'throws') throw new Error('upstream returned 500');
      if (behaviour === 'hangs') {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
      }
      if (behaviour === 'malformed') {
        // A title too short to survive normalization: dropped, not fatal.
        return { deals: [rawDeal({ title: 'x', sourceId: 'bad' })] };
      }
      return { deals };
    },
  };
}

describe('runPipeline: isolation', () => {
  it('lets healthy sources succeed while another throws, hangs or is disabled', async () => {
    const summary = await runPipeline({
      adapters: [
        fakeAdapter('healthy', 'healthy'),
        fakeAdapter('broken', 'throws'),
        fakeAdapter('slow', 'hangs'),
        fakeAdapter('dormant', 'disabled'),
      ],
      repo,
      adapterTimeoutMs: 50,
      concurrency: 4,
    });

    const byId = Object.fromEntries(summary.sources.map((s) => [s.source, s]));

    expect(byId['healthy']?.outcome).toBe('ok');
    expect(byId['broken']?.outcome).toBe('failed');
    expect(byId['slow']?.outcome).toBe('failed');
    // A missing credential is a configuration state, not a malfunction.
    expect(byId['dormant']?.outcome).toBe('skipped');

    // The healthy adapter's data still landed.
    expect((await repo.queryDeals({})).total).toBe(1);
  });

  it('writes exactly one source_runs row per adapter, whatever happened', async () => {
    await runPipeline({
      adapters: [
        fakeAdapter('a', 'healthy'),
        fakeAdapter('b', 'throws'),
        fakeAdapter('c', 'disabled'),
      ],
      repo,
      adapterTimeoutMs: 500,
    });

    const health = await repo.getSourceHealth();
    expect(health).toHaveLength(3);
    expect(health.map((r) => r.source).sort()).toEqual(['a', 'b', 'c']);
    expect(health.find((r) => r.source === 'b')?.error).toContain('500');
  });

  it('records the reason a source was skipped', async () => {
    await runPipeline({ adapters: [fakeAdapter('dormant', 'disabled')], repo });

    const [run] = await repo.getSourceHealth();
    expect(run?.outcome).toBe('skipped');
    expect(run?.error).toBe('credentials not configured');
  });

  it('counts dropped items with a reason instead of failing the source', async () => {
    const summary = await runPipeline({
      adapters: [fakeAdapter('messy', 'malformed')],
      repo,
    });

    expect(summary.sources[0]?.outcome).toBe('ok');
    expect(summary.sources[0]?.itemsDropped).toBe(1);
    expect(Object.keys(summary.sources[0]?.dropReasons ?? {})).not.toHaveLength(0);
  });
});

describe('runPipeline: persistence', () => {
  it('normalizes, resolves the merchant and stores a usable deal', async () => {
    await runPipeline({ adapters: [fakeAdapter('bestbuy', 'healthy')], repo });

    const { deals } = await repo.queryDeals({});
    const deal = deals[0];

    expect(deal?.title).toContain('Samsung');
    expect(deal?.priceNow).toBe(149999);
    expect(deal?.priceWas).toBe(199999);
    expect(deal?.category).toBe('electronics');
    expect(deal?.merchant?.slug).toBe('best-buy');
    expect(deal?.slug).toMatch(/samsung/);
  });

  it('writes nothing on a dry run', async () => {
    const summary = await runPipeline({
      adapters: [fakeAdapter('bestbuy', 'healthy')],
      repo,
      dryRun: true,
    });

    expect(summary.totalFound).toBe(1);
    expect(summary.totalNew).toBe(0);
    expect((await repo.queryDeals({})).total).toBe(0);
    expect(await repo.getSourceHealth()).toHaveLength(0);
  });

  it('records a price point on first sight and again only when the price moves', async () => {
    const adapter = fakeAdapter('bestbuy', 'healthy');
    await runPipeline({ adapters: [adapter], repo });

    const first = (await repo.queryDeals({})).deals[0]!;
    expect(await repo.getPriceHistory(first.id)).toHaveLength(1);

    // Same price again: no new observation.
    await runPipeline({ adapters: [adapter], repo });
    expect(await repo.getPriceHistory(first.id)).toHaveLength(1);

    // Price drops: a new observation is recorded.
    await runPipeline({
      adapters: [fakeAdapter('bestbuy', 'healthy', [rawDeal({ price: '$1,299.99' })])],
      repo,
    });
    expect(await repo.getPriceHistory(first.id)).toHaveLength(2);
  });

  it('collapses the same product arriving from two sources', async () => {
    const summary = await runPipeline({
      adapters: [
        fakeAdapter('redflagdeals', 'healthy', [
          rawDeal({ sourceId: 'rfd1', url: 'https://www.bestbuy.ca/en-ca/product/12345?utm_source=rfd' }),
        ]),
        fakeAdapter('bestbuy', 'healthy', [
          rawDeal({ sourceId: 'bb1', url: 'https://bestbuy.ca/en-ca/product/12345' }),
        ]),
      ],
      repo,
    });

    expect(summary.totalFound).toBe(2);
    expect(summary.merged).toBe(1);
    expect((await repo.queryDeals({})).total).toBe(1);
  });

  it('auto-creates a merchant for an unseen domain rather than losing the deal', async () => {
    await runPipeline({
      adapters: [
        fakeAdapter('new-shop', 'healthy', [
          rawDeal({ url: 'https://brand-new-canadian-shop.ca/products/thing' }),
        ]),
      ],
      repo,
    });

    const { deals } = await repo.queryDeals({});
    expect(deals[0]?.merchant?.slug).toBe('brand-new-canadian-shop');
  });
});

describe('runPipeline: verification', () => {
  it('leaves a single-source claim unverified', async () => {
    await runPipeline({ adapters: [fakeAdapter('bestbuy', 'healthy')], repo });

    const deal = (await repo.queryDeals({})).deals[0];
    expect(deal?.verdict).toBe('unverified');
    expect(deal?.qualityNote).toContain("retailer's own claim");
  });

  it('verifies against the market when the same product appears at several merchants', async () => {
    const summary = await runPipeline({
      adapters: [
        fakeAdapter('a', 'healthy', [
          rawDeal({
            sourceId: 'a1',
            url: 'https://bestbuy.ca/p/1',
            price: '$1,299.99',
            priceWas: '$1,499.99',
            gtin: '4006381333931',
          }),
        ]),
        fakeAdapter('b', 'healthy', [
          rawDeal({
            sourceId: 'b1',
            url: 'https://walmart.ca/p/2',
            price: '$1,499.99',
            priceWas: null,
            gtin: '4006381333931',
          }),
        ]),
        fakeAdapter('c', 'healthy', [
          rawDeal({
            sourceId: 'c1',
            url: 'https://costco.ca/p/3',
            price: '$1,529.99',
            priceWas: null,
            gtin: '4006381333931',
          }),
        ]),
      ],
      repo,
    });

    expect(summary.comparedAcrossMerchants).toBeGreaterThan(0);
    expect(summary.verified).toBeGreaterThan(0);

    const cheapest = (await repo.queryDeals({ sort: 'price-asc' })).deals[0];
    expect(cheapest?.verdict).toBe('verified-good');
    expect(cheapest?.marketPrice).toBeGreaterThan(0);
  });

  it('flags and demotes an inflated anchor end to end', async () => {
    await runPipeline({
      adapters: [
        fakeAdapter('liar', 'healthy', [
          rawDeal({
            sourceId: 'l1',
            url: 'https://sketchy.ca/p/1',
            price: '$499.99',
            priceWas: '$1,299.99',
            gtin: '4006381333931',
          }),
        ]),
        fakeAdapter('honest-a', 'healthy', [
          rawDeal({ sourceId: 'h1', url: 'https://bestbuy.ca/p/1', price: '$499.99', priceWas: null, gtin: '4006381333931' }),
        ]),
        fakeAdapter('honest-b', 'healthy', [
          rawDeal({ sourceId: 'h2', url: 'https://walmart.ca/p/1', price: '$519.99', priceWas: null, gtin: '4006381333931' }),
        ]),
      ],
      repo,
    });

    const { deals } = await repo.queryDeals({ verdicts: ['inflated-anchor'] });
    expect(deals).toHaveLength(1);
    expect(deals[0]?.claimSuspect).toBe(true);
    expect(deals[0]?.heat).toBeLessThanOrEqual(25);

    // And it is excluded by the filter a cautious shopper would use.
    const clean = await repo.queryDeals({ excludeSuspect: true });
    expect(clean.deals.every((d) => !d.claimSuspect)).toBe(true);
  });
});

describe('registry', () => {
  it('rejects a duplicate adapter id rather than shadowing one', () => {
    register(fakeAdapter('dup', 'healthy'));
    expect(() => register(fakeAdapter('dup', 'healthy'))).toThrow(/Duplicate/);
  });

  it('looks adapters up by id', () => {
    register(fakeAdapter('findme', 'healthy'));
    expect(getAdapter('findme')?.id).toBe('findme');
    expect(getAdapter('nope')).toBeUndefined();
    expect(allAdapters()).toHaveLength(1);
  });
});
