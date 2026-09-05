import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeTool, summarizeDeal, toDealQuery, TOOL_DEFINITIONS } from '@/lib/assistant/tools';
import { parseSearchParams } from '@/lib/query-params';
import { makeDeal, makeMerchant, makeStore, tempSqliteRepo } from '../db/helpers';
import type { DealRepository } from '@/lib/db/repository';

let repo: DealRepository;
let cleanup: () => Promise<void>;
let seenDealIds: Set<string>;

beforeEach(async () => {
  const ctx = tempSqliteRepo();
  repo = ctx.repo;
  cleanup = ctx.cleanup;
  await repo.migrate();
  seenDealIds = new Set();

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
  await repo.upsertStores([makeStore({ id: 'store-1', lat: 43.65, lng: -79.38 })]);

  await repo.upsertDeals([
    makeDeal({
      sourceId: 'a',
      slug: 'tv',
      title: 'Samsung 65" TV',
      merchantId: 'm-bb',
      category: 'electronics',
      priceNow: 129999,
      priceWas: 159999,
      discountPct: 18.8,
      marketDiscountPct: 14,
      verdict: 'verified-good',
      qualityNote: '14% below the median across 2 other stores.',
    }),
    makeDeal({
      sourceId: 'b',
      slug: 'coat',
      title: "Girls' Winter Coat",
      merchantId: 'm-on',
      category: 'clothing',
      department: 'girls',
      priceNow: 2999,
      priceWas: 7999,
      discountPct: 62.5,
      couponCode: 'WARM20',
      verdict: 'unverified',
    }),
    makeDeal({
      sourceId: 'c',
      slug: 'fake',
      title: 'Suspiciously Discounted TV',
      merchantId: 'm-bb',
      category: 'electronics',
      priceNow: 49999,
      priceWas: 149999,
      discountPct: 66.7,
      verdict: 'inflated-anchor',
      claimSuspect: true,
      qualityNote: 'The $1499.99 "was" price looks inflated.',
    }),
    makeDeal({
      sourceId: 'd',
      slug: 'local',
      title: 'In-store clearance drill',
      merchantId: 'm-bb',
      storeId: 'store-1',
      priceNow: 4999,
    }),
  ]);
});

afterEach(async () => {
  await cleanup();
});

function context() {
  return { repo, seenDealIds, location: { lat: 43.6532, lng: -79.3832, label: 'Toronto' } };
}

describe('the parity guarantee', () => {
  it('returns exactly what the UI filter path returns, for the same filters', async () => {
    // This is the test that makes hallucination structurally impossible: the
    // assistant and the FilterBar are the same query against the same rows. If
    // these ever diverge, the assistant can show something browsing cannot.
    const cases = [
      { assistant: { categories: ['electronics' as const] }, url: { category: 'electronics' } },
      { assistant: { couponOnly: true }, url: { coupon: '1' } },
      { assistant: { verifiedOnly: true }, url: { verified: '1' } },
      { assistant: { excludeSuspect: true }, url: { hidesuspect: '1' } },
      { assistant: { maxPriceDollars: 100 }, url: { maxprice: '100' } },
      { assistant: { minDiscountPct: 50 }, url: { mindiscount: '50' } },
      { assistant: { departments: ['girls' as const] }, url: { department: 'girls' } },
      { assistant: { merchantSlugs: ['old-navy'] }, url: { merchant: 'old-navy' } },
      { assistant: { search: 'samsung' }, url: { q: 'samsung' } },
      { assistant: { families: ['gap-inc'] }, url: { family: 'gap-inc' } },
    ];

    for (const testCase of cases) {
      const viaAssistant = await repo.queryDeals(toDealQuery(testCase.assistant));
      const { query } = parseSearchParams(testCase.url);
      const viaUi = await repo.queryDeals(query);

      expect(
        viaAssistant.deals.map((deal) => deal.id).sort(),
        `mismatch for ${JSON.stringify(testCase.assistant)}`,
      ).toEqual(viaUi.deals.map((deal) => deal.id).sort());
    }
  });
});

describe('grounding', () => {
  it('records every id it hands the model, so citations can be validated', async () => {
    const result = await executeTool('search_deals', {}, context());
    expect(seenDealIds.size).toBeGreaterThan(0);

    const returned = (result.content as { deals: Array<{ id: string }> }).deals;
    for (const deal of returned) expect(seenDealIds.has(deal.id)).toBe(true);
  });

  it('never hands the model a "was" price the UI refuses to show', async () => {
    const { deals } = await repo.queryDeals({ verdicts: ['inflated-anchor'] });
    const summary = summarizeDeal(deals[0]!);

    // The flagged anchor's numbers are withheld from the model exactly as they
    // are withheld from the page, so it cannot repeat them in prose.
    expect(summary.wasPrice).toBeNull();
    expect(summary.discountPct).toBeNull();
    expect(summary.verdict).toBe('inflated-anchor');
    expect(summary.verdictNote).toContain('inflated');
  });

  it('tells the model plainly when nothing matched', async () => {
    const result = await executeTool(
      'search_deals',
      { search: 'nothing at all matches this' },
      context(),
    );
    const content = result.content as { totalMatches: number; note?: string };

    expect(content.totalMatches).toBe(0);
    expect(content.note).toContain('do not exist');
  });

  it('only offers facet values that actually return results', async () => {
    const result = await executeTool('list_facets', { field: 'merchant' }, context());
    const values = (result.content as { values: Array<{ value: string }> }).values;

    for (const facet of values) {
      const { total } = await repo.queryDeals({ merchantSlugs: [facet.value] });
      expect(total, `${facet.value} should not be offered`).toBeGreaterThan(0);
    }
  });
});

describe('tool surface', () => {
  it('exposes no tool that writes, spends or reaches the network', () => {
    // The assistant's only privilege is reading the user's own catalogue.
    const names = TOOL_DEFINITIONS.map((tool) => tool.name);
    for (const name of names) {
      expect(name).not.toMatch(/create|update|delete|write|buy|purchase|order|fetch|post|send/i);
    }
    expect(names).toEqual(
      expect.arrayContaining(['search_deals', 'list_facets', 'get_price_history']),
    );
  });

  it('has unique tool names', () => {
    const names = TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('converts dollars at the boundary to cents inside', () => {
    const query = toDealQuery({ minPriceDollars: 19.99, maxPriceDollars: 100 });
    expect(query.minPrice).toBe(1999);
    expect(query.maxPrice).toBe(10000);
  });
});

describe('tool behaviour', () => {
  it('returns a correctable message rather than throwing on bad input', async () => {
    const result = await executeTool('search_deals', { minDiscountPct: 'lots' }, context());
    expect((result.content as { error?: string }).error).toContain('Invalid search');
  });

  it('handles an unknown tool name', async () => {
    const result = await executeTool('drop_database', {}, context());
    expect((result.content as { error?: string }).error).toContain('No tool named');
  });

  it('emits a UI patch so the canvas follows the conversation', async () => {
    const result = await executeTool('search_deals', { categories: ['clothing'] }, context());
    expect(result.patch?.view).toBe('grid');
    expect(result.patch?.deals?.length).toBeGreaterThan(0);
    // The patch carries the query itself, which is what makes the handoff to
    // normal browsing possible in one step.
    expect(result.patch?.query?.categories).toEqual(['clothing']);
  });

  it('renders human-readable activity, never raw tool output', async () => {
    const result = await executeTool('search_deals', {}, context());
    expect(result.activity).toMatch(/Searched deals/);
    expect(result.activity).not.toContain('{');
  });

  it('grounds a price judgement in recorded history', async () => {
    const { deals } = await repo.queryDeals({ merchantSlugs: ['best-buy'], limit: 1 });
    const dealId = deals[0]!.id;
    await repo.appendPricePoints([
      { dealId, price: 159999, observedAt: '2026-01-01T00:00:00.000Z' },
      { dealId, price: 129999, observedAt: '2026-02-01T00:00:00.000Z' },
    ]);

    const result = await executeTool('get_price_history', { dealId }, context());
    const content = result.content as { observations: unknown[] };
    expect(content.observations).toHaveLength(2);
  });

  it('asks for a location instead of guessing one', async () => {
    const result = await executeTool('find_deals_near_me', {}, {
      repo,
      seenDealIds,
      location: null,
    });

    const content = result.content as { error: string; message: string };
    expect(content.error).toBe('no_location');
    expect(content.message).toContain('do not guess');
  });

  it('finds store-local deals when a location is known', async () => {
    const result = await executeTool('find_deals_near_me', { radiusKm: 25 }, context());
    const content = result.content as { totalMatches: number };
    expect(content.totalMatches).toBeGreaterThan(0);
  });

  it('compares deals only by id, never by description', async () => {
    const { deals } = await repo.queryDeals({ limit: 2 });
    const result = await executeTool(
      'compare_deals',
      { dealIds: deals.map((deal) => deal.id) },
      context(),
    );

    expect(result.patch?.view).toBe('comparison');
    expect((result.content as { deals: unknown[] }).deals).toHaveLength(2);
  });

  it('rejects a comparison of fewer than two deals', async () => {
    const result = await executeTool('compare_deals', { dealIds: ['one'] }, context());
    expect((result.content as { error?: string }).error).toContain('between 2 and 6');
  });
});
