import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeDeal, makeMerchant, makeStore } from './helpers';
import type { DealRepository } from '@/lib/db/repository';

export interface Backend {
  label: string;
  create: () => Promise<{ repo: DealRepository; cleanup: () => Promise<void> }>;
}

/**
 * The repository contract, defined once and executed against every backend.
 *
 * SQLite runs always; Postgres runs when TEST_DATABASE_URL is set. Both engines
 * must satisfy the identical spec — that is what makes DATABASE_URL a genuine
 * one-line switch rather than a hopeful claim in the README.
 */
export function defineContractSuite(backend: Backend): void {
  describe(`DealRepository contract [${backend.label}]`, () => {
    let repo: DealRepository;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      const ctx = await backend.create();
      repo = ctx.repo;
      cleanup = ctx.cleanup;
      await repo.migrate();
    });

    afterEach(async () => {
      await cleanup();
    });

  describe('migrations', () => {
    it('are idempotent', async () => {
      await expect(repo.migrate()).resolves.not.toThrow();
      await expect(repo.migrate()).resolves.not.toThrow();
    });
  });

  describe('merchants', () => {
    it('inserts and reads back by slug and domain', async () => {
      const merchant = makeMerchant({ slug: 'best-buy', domain: 'bestbuy.ca', name: 'Best Buy' });
      await repo.upsertMerchants([merchant]);

      expect((await repo.getMerchantBySlug('best-buy'))?.name).toBe('Best Buy');
      expect((await repo.getMerchantByDomain('bestbuy.ca'))?.slug).toBe('best-buy');
    });

    it('updates rather than duplicating on re-upsert', async () => {
      const merchant = makeMerchant({ slug: 'gap', domain: 'gapcanada.ca', name: 'Gap' });
      await repo.upsertMerchants([merchant]);
      await repo.upsertMerchants([{ ...merchant, name: 'Gap Canada', family: 'gap-inc' }]);

      const all = await repo.listMerchants();
      expect(all).toHaveLength(1);
      expect(all[0]?.name).toBe('Gap Canada');
      expect(all[0]?.family).toBe('gap-inc');
    });

    it('preserves an existing value when an update omits it', async () => {
      const merchant = makeMerchant({ domain: 'x.ca', logoUrl: 'https://x.ca/logo.png' });
      await repo.upsertMerchants([merchant]);
      await repo.upsertMerchants([{ ...merchant, logoUrl: null }]);

      expect((await repo.getMerchantByDomain('x.ca'))?.logoUrl).toBe('https://x.ca/logo.png');
    });
  });

  describe('deals: upsert', () => {
    it('inserts new deals and reports the count', async () => {
      const result = await repo.upsertDeals([makeDeal(), makeDeal()]);
      expect(result.inserted).toBe(2);
      expect(result.updated).toBe(0);
    });

    it('updates on a repeat of the same (source, source_id)', async () => {
      const deal = makeDeal({ sourceId: 'stable-1', title: 'First title' });
      await repo.upsertDeals([deal]);
      const second = await repo.upsertDeals([{ ...deal, id: 'different-id', title: 'Second title' }]);

      expect(second.inserted).toBe(0);
      expect(second.updated).toBe(1);

      const { deals, total } = await repo.queryDeals({});
      expect(total).toBe(1);
      expect(deals[0]?.title).toBe('Second title');
    });

    it('preserves first_seen_at across updates — a deal does not get younger', async () => {
      const deal = makeDeal({ sourceId: 'age-1' });
      await repo.upsertDeals([deal]);
      const first = (await repo.queryDeals({})).deals[0];

      await new Promise((resolve) => setTimeout(resolve, 5));
      await repo.upsertDeals([{ ...deal, title: 'Updated' }]);
      const second = (await repo.queryDeals({})).deals[0];

      expect(second?.firstSeenAt).toBe(first?.firstSeenAt);
      expect(second?.lastSeenAt).not.toBe(first?.lastSeenAt);
    });

    it('reports which deals changed price', async () => {
      const deal = makeDeal({ sourceId: 'price-1', priceNow: 5000 });
      await repo.upsertDeals([deal]);

      const unchanged = await repo.upsertDeals([{ ...deal, priceNow: 5000 }]);
      expect(unchanged.priceChanged).toHaveLength(0);

      const changed = await repo.upsertDeals([{ ...deal, priceNow: 4000 }]);
      expect(changed.priceChanged).toHaveLength(1);
      // The PERSISTED id is returned with the new price. Callers must not have to
      // reconcile it against an id they minted themselves.
      expect(changed.priceChanged[0]?.price).toBe(4000);
      expect(changed.priceChanged[0]?.dealId).toBe(deal.id);
    });

    it('handles a 1000-deal batch inside the performance budget', async () => {
      const deals = Array.from({ length: 1000 }, (_, i) =>
        makeDeal({ sourceId: `bulk-${i}`, slug: `bulk-deal-${i}` }),
      );
      const started = Date.now();
      const result = await repo.upsertDeals(deals);
      const elapsed = Date.now() - started;

      expect(result.inserted).toBe(1000);
      expect(elapsed).toBeLessThan(2000);
    });
  });

  describe('deals: querying', () => {
    beforeEach(async () => {
      await repo.upsertMerchants([
        makeMerchant({ id: 'm-bb', slug: 'best-buy', domain: 'bestbuy.ca', name: 'Best Buy' }),
        makeMerchant({
          id: 'm-on',
          slug: 'old-navy',
          domain: 'oldnavy.ca',
          name: 'Old Navy',
          family: 'gap-inc',
        }),
      ]);
      await repo.upsertDeals([
        makeDeal({
          sourceId: 'q1',
          slug: 'tv',
          title: 'Samsung 55" TV',
          merchantId: 'm-bb',
          category: 'electronics',
          priceNow: 49999,
          priceWas: 79999,
          discountPct: 37.5,
          heat: 90,
          postedAt: '2026-01-03T00:00:00.000Z',
        }),
        makeDeal({
          sourceId: 'q2',
          slug: 'coat',
          title: "Girls' Winter Coat",
          merchantId: 'm-on',
          category: 'clothing',
          department: 'girls',
          brand: 'Old Navy',
          priceNow: 2999,
          priceWas: 7999,
          discountPct: 62.5,
          heat: 70,
          couponCode: 'WARM20',
          postedAt: '2026-01-05T00:00:00.000Z',
        }),
        makeDeal({
          sourceId: 'q3',
          slug: 'laptop',
          title: 'Bébé Monitor',
          merchantId: 'm-bb',
          category: 'baby-kids',
          priceNow: 9999,
          priceWas: null,
          discountPct: null,
          heat: 40,
          inStock: false,
          postedAt: '2026-01-01T00:00:00.000Z',
        }),
      ]);
    });

    it('defaults to active deals only', async () => {
      await repo.upsertDeals([makeDeal({ sourceId: 'dead', status: 'expired' })]);
      const { total } = await repo.queryDeals({});
      expect(total).toBe(3);
    });

    it('filters by category', async () => {
      const { deals } = await repo.queryDeals({ categories: ['clothing'] });
      expect(deals.map((d) => d.slug)).toEqual(['coat']);
    });

    it('filters by department', async () => {
      const { deals } = await repo.queryDeals({ departments: ['girls'] });
      expect(deals.map((d) => d.slug)).toEqual(['coat']);
    });

    it('filters by merchant slug', async () => {
      const { deals } = await repo.queryDeals({ merchantSlugs: ['best-buy'] });
      expect(deals).toHaveLength(2);
    });

    it('filters by brand family', async () => {
      const { deals } = await repo.queryDeals({ families: ['gap-inc'] });
      expect(deals.map((d) => d.slug)).toEqual(['coat']);
    });

    it('filters coupon-only', async () => {
      const { deals } = await repo.queryDeals({ couponOnly: true });
      expect(deals.map((d) => d.couponCode)).toEqual(['WARM20']);
    });

    it('filters in-stock only', async () => {
      const { deals } = await repo.queryDeals({ inStockOnly: true });
      expect(deals.map((d) => d.slug).sort()).toEqual(['coat', 'tv']);
    });

    it('filters by minimum discount', async () => {
      const { deals } = await repo.queryDeals({ minDiscountPct: 50 });
      expect(deals.map((d) => d.slug)).toEqual(['coat']);
    });

    it('excludes unknown-price deals from a price floor but not a ceiling', async () => {
      // A deal with no known price cannot be claimed to meet a minimum...
      const floor = await repo.queryDeals({ minPrice: 1 });
      expect(floor.deals.every((d) => d.priceNow !== null)).toBe(true);

      // ...but a ceiling should not silently hide it either; it is simply unknown.
      const ceiling = await repo.queryDeals({ maxPrice: 1000000 });
      expect(ceiling.total).toBe(3);
    });

    it('searches title, merchant and brand case-insensitively', async () => {
      expect((await repo.queryDeals({ search: 'samsung' })).total).toBe(1);
      expect((await repo.queryDeals({ search: 'OLD NAVY' })).total).toBe(1);
      expect((await repo.queryDeals({ search: 'coat' })).total).toBe(1);
    });

    it('sorts by hottest, newest, biggest drop and price', async () => {
      expect((await repo.queryDeals({ sort: 'hottest' })).deals.map((d) => d.slug)).toEqual([
        'tv',
        'coat',
        'laptop',
      ]);
      expect((await repo.queryDeals({ sort: 'newest' })).deals[0]?.slug).toBe('coat');
      expect((await repo.queryDeals({ sort: 'biggest-drop' })).deals[0]?.slug).toBe('coat');
      expect((await repo.queryDeals({ sort: 'price-asc' })).deals[0]?.slug).toBe('coat');
      expect((await repo.queryDeals({ sort: 'price-desc' })).deals[0]?.slug).toBe('tv');
    });

    it('paginates without duplicating or skipping a row', async () => {
      const pageSize = 2;
      const first = await repo.queryDeals({ limit: pageSize, offset: 0 });
      const second = await repo.queryDeals({ limit: pageSize, offset: pageSize });

      const ids = [...first.deals, ...second.deals].map((d) => d.id);
      expect(new Set(ids).size).toBe(3);
      expect(first.total).toBe(3);
    });

    it('joins merchant relations onto results', async () => {
      const { deals } = await repo.queryDeals({ merchantSlugs: ['old-navy'] });
      expect(deals[0]?.merchant?.name).toBe('Old Navy');
      expect(deals[0]?.merchant?.family).toBe('gap-inc');
    });

    it('fetches by slug and by ids', async () => {
      const bySlug = await repo.getDealBySlug('tv');
      expect(bySlug?.title).toBe('Samsung 55" TV');

      const byIds = await repo.getDealsByIds([bySlug!.id]);
      expect(byIds).toHaveLength(1);
      expect(await repo.getDealsByIds([])).toEqual([]);
    });

    it('returns null for an unknown slug', async () => {
      expect(await repo.getDealBySlug('does-not-exist')).toBeNull();
    });

    it('produces facets with real counts', async () => {
      const categories = await repo.facets('category');
      const clothing = categories.find((f) => f.value === 'clothing');
      expect(clothing?.count).toBe(1);

      const merchants = await repo.facets('merchant');
      expect(merchants.find((f) => f.value === 'best-buy')?.count).toBe(2);
    });

    it('never emits a facet value that yields zero results', async () => {
      for (const facet of await repo.facets('category')) {
        const { total } = await repo.queryDeals({
          categories: [facet.value as 'electronics'],
        });
        expect(total).toBeGreaterThan(0);
      }
    });
  });

  describe('price history', () => {
    it('appends only when the price actually changed', async () => {
      const deal = makeDeal({ sourceId: 'ph-1' });
      await repo.upsertDeals([deal]);

      await repo.appendPricePoints([
        { dealId: deal.id, price: 1999, observedAt: '2026-01-01T00:00:00.000Z' },
      ]);
      await repo.appendPricePoints([
        { dealId: deal.id, price: 1999, observedAt: '2026-01-02T00:00:00.000Z' },
      ]);
      expect(await repo.getPriceHistory(deal.id)).toHaveLength(1);

      await repo.appendPricePoints([
        { dealId: deal.id, price: 1499, observedAt: '2026-01-03T00:00:00.000Z' },
      ]);
      expect(await repo.getPriceHistory(deal.id)).toHaveLength(2);
    });

    it('returns history in chronological order', async () => {
      const deal = makeDeal({ sourceId: 'ph-2' });
      await repo.upsertDeals([deal]);
      await repo.appendPricePoints([
        { dealId: deal.id, price: 3000, observedAt: '2026-01-03T00:00:00.000Z' },
      ]);
      await repo.appendPricePoints([
        { dealId: deal.id, price: 2000, observedAt: '2026-01-01T00:00:00.000Z' },
      ]);

      const history = await repo.getPriceHistory(deal.id);
      expect(history.map((p) => p.price)).toEqual([2000, 3000]);
    });
  });

  describe('stores and proximity', () => {
    it('upserts idempotently on (chain, source_store_id)', async () => {
      const store = makeStore({ sourceStoreId: 'CT-0042', name: 'Canadian Tire Yonge' });
      await repo.upsertStores([store]);
      await repo.upsertStores([{ ...store, id: 'other-id', name: 'Canadian Tire Yonge St' }]);

      const found = await repo.findStoresNear(43.6426, -79.3871, 5);
      expect(found).toHaveLength(1);
      expect(found[0]?.name).toBe('Canadian Tire Yonge St');
    });

    it('returns stores within the radius ordered by distance', async () => {
      await repo.upsertStores([
        makeStore({ sourceStoreId: 'near', name: 'Near', lat: 43.6500, lng: -79.3800 }),
        makeStore({ sourceStoreId: 'far', name: 'Far', lat: 43.8000, lng: -79.3800 }),
        makeStore({ sourceStoreId: 'vancouver', name: 'Vancouver', lat: 49.28, lng: -123.12 }),
      ]);

      const found = await repo.findStoresNear(43.6426, -79.3871, 30);
      expect(found.map((s) => s.name)).toEqual(['Near', 'Far']);
      expect(found[0]!.distanceKm).toBeLessThan(found[1]!.distanceKm);
    });

    it('excludes stores just outside the radius boundary', async () => {
      await repo.upsertStores([
        makeStore({ sourceStoreId: 'edge', lat: 43.7426, lng: -79.3871 }), // ~11.1 km north
      ]);
      expect(await repo.findStoresNear(43.6426, -79.3871, 5)).toHaveLength(0);
      expect(await repo.findStoresNear(43.6426, -79.3871, 15)).toHaveLength(1);
    });

    it('finds store-local deals and attaches distance', async () => {
      const store = makeStore({ id: 'store-1', sourceStoreId: 'CT-1', lat: 43.65, lng: -79.38 });
      await repo.upsertStores([store]);
      await repo.upsertDeals([
        makeDeal({ sourceId: 'local-1', slug: 'clearance-drill', storeId: 'store-1', heat: 60 }),
        makeDeal({ sourceId: 'national-1', slug: 'national-tv' }),
      ]);

      const { deals, total } = await repo.queryDealsNear({
        lat: 43.6426,
        lng: -79.3871,
        radiusKm: 25,
      });

      expect(total).toBe(1);
      expect(deals[0]?.slug).toBe('clearance-drill');
      expect(deals[0]?.distanceKm).toBeGreaterThan(0);
      expect(deals[0]?.distanceKm).toBeLessThan(25);
      expect(deals[0]?.store?.name).toBe('Test Store');
    });
  });

  describe('lifecycle and observability', () => {
    it('marks deals expired past their expiry', async () => {
      await repo.upsertDeals([
        makeDeal({ sourceId: 'exp-1', expiresAt: '2020-01-01T00:00:00.000Z' }),
        makeDeal({ sourceId: 'exp-2', expiresAt: '2999-01-01T00:00:00.000Z' }),
        makeDeal({ sourceId: 'exp-3', expiresAt: null }),
      ]);

      const changed = await repo.markExpired('2026-01-01T00:00:00.000Z');
      expect(changed).toBe(1);
      expect((await repo.queryDeals({})).total).toBe(2);
    });

    it('updates heat in bulk', async () => {
      const deal = makeDeal({ sourceId: 'heat-1', heat: 10 });
      await repo.upsertDeals([deal]);
      await repo.updateHeat([{ id: deal.id, heat: 88 }]);
      expect((await repo.queryDeals({})).deals[0]?.heat).toBe(88);
    });

    it('records one source run per source and reports the latest', async () => {
      await repo.recordSourceRun({
        source: 'bestbuy',
        startedAt: '2026-01-01T00:00:00.000Z',
        outcome: 'ok',
        itemsFound: 10,
      });
      await repo.recordSourceRun({
        source: 'bestbuy',
        startedAt: '2026-01-02T00:00:00.000Z',
        outcome: 'failed',
        error: '403 Forbidden',
      });
      await repo.recordSourceRun({
        source: 'redflagdeals',
        startedAt: '2026-01-02T00:00:00.000Z',
        outcome: 'ok',
        itemsFound: 40,
      });

      const health = await repo.getSourceHealth();
      expect(health).toHaveLength(2);
      expect(health.find((r) => r.source === 'bestbuy')?.outcome).toBe('failed');
      expect(health.find((r) => r.source === 'bestbuy')?.error).toBe('403 Forbidden');
    });
  });

  describe('assistant usage', () => {
    it('summarises spend and cache hit rate by model', async () => {
      await repo.recordAssistantUsage({
        conversationId: 'c1',
        model: 'claude-sonnet-5',
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheCreationTokens: 4000,
        toolCalls: 2,
      });
      await repo.recordAssistantUsage({
        conversationId: 'c1',
        model: 'claude-sonnet-5',
        inputTokens: 200,
        outputTokens: 400,
        cacheReadTokens: 4000,
        cacheCreationTokens: 0,
        toolCalls: 1,
      });

      const summary = await repo.getAssistantUsageSummary();
      expect(summary.conversations).toBe(1);
      expect(summary.turns).toBe(2);
      expect(summary.outputTokens).toBe(900);
      expect(summary.cacheHitRate).toBeGreaterThan(0.7);
      expect(summary.byModel['claude-sonnet-5']?.turns).toBe(2);
    });
  });

  });
}
