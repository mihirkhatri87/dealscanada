import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { reap } from '@/lib/pipeline/reap';
import { makeDeal, makeMerchant, tempSqliteRepo } from '../db/helpers';
import type { DealRepository } from '@/lib/db/repository';

/**
 * Retirement decides what a visitor sees, so its edges matter more than its
 * happy path: a deal wrongly retired is one nobody can find, and a price point
 * wrongly pruned makes a live price look unobserved.
 */

let repo: DealRepository;
let cleanup: () => Promise<void>;

const NOW = new Date('2026-03-01T12:00:00.000Z');

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

beforeEach(async () => {
  const ctx = tempSqliteRepo();
  repo = ctx.repo;
  cleanup = ctx.cleanup;
  await repo.migrate();
  await repo.upsertMerchants([makeMerchant({ id: 'm-1', slug: 'store', domain: 'store.ca' })]);
});

afterEach(async () => {
  await cleanup();
});

describe('expiry', () => {
  it('retires a deal past the date the retailer itself gave', async () => {
    await repo.upsertDeals([
      makeDeal({ sourceId: 'a', slug: 'a', merchantId: 'm-1', expiresAt: hoursAgo(1) }),
      makeDeal({ sourceId: 'b', slug: 'b', merchantId: 'm-1', expiresAt: hoursAgo(-24) }),
    ]);

    const summary = await reap({ repo, now: NOW });
    expect(summary.expired).toBe(1);

    const { deals } = await repo.queryDeals({});
    expect(deals.map((deal) => deal.slug)).toEqual(['b']);
  });

  it('leaves a deal with no stated expiry alone', async () => {
    await repo.upsertDeals([
      makeDeal({ sourceId: 'a', slug: 'a', merchantId: 'm-1', expiresAt: null }),
    ]);

    const summary = await reap({ repo, now: NOW });
    expect(summary.expired).toBe(0);
  });

  it('keeps an expired deal reachable by its own URL', async () => {
    // A link shared last week should explain that the sale ended, not 404.
    await repo.upsertDeals([
      makeDeal({ sourceId: 'a', slug: 'ended-sale', merchantId: 'm-1', expiresAt: hoursAgo(1) }),
    ]);
    await reap({ repo, now: NOW });

    const deal = await repo.getDealBySlug('ended-sale');
    expect(deal?.status).toBe('expired');
  });
});

describe('unseen deals', () => {
  it('retires one no source has returned inside the window', async () => {
    // last_seen_at is the repository's to set - it means "a source returned this
    // then", which only the write path knows - so ageing a row means writing it
    // at an earlier observation time, exactly as an older run would have.
    await repo.upsertDeals(
      [makeDeal({ sourceId: 'stale', slug: 'stale', merchantId: 'm-1' })],
      hoursAgo(100),
    );
    await repo.upsertDeals(
      [makeDeal({ sourceId: 'fresh', slug: 'fresh', merchantId: 'm-1' })],
      hoursAgo(2),
    );

    const summary = await reap({ repo, now: NOW, deadAfterHours: 72 });
    expect(summary.dead).toBe(1);

    const { deals } = await repo.queryDeals({});
    expect(deals.map((deal) => deal.slug)).toEqual(['fresh']);
  });

  it('is generous by default, because a gap is likelier a blocked scrape than an ended sale', async () => {
    await repo.upsertDeals(
      [makeDeal({ sourceId: 'a', slug: 'a', merchantId: 'm-1' })],
      hoursAgo(48),
    );

    const summary = await reap({ repo, now: NOW });
    expect(summary.dead).toBe(0);
  });

  it('does not relabel an already expired deal as merely unseen', async () => {
    // "This sale ended" is more specific and more honest than "we stopped seeing
    // it", so the first status wins.
    await repo.upsertDeals(
      [makeDeal({ sourceId: 'a', slug: 'a', merchantId: 'm-1', expiresAt: hoursAgo(200) })],
      hoursAgo(200),
    );

    const summary = await reap({ repo, now: NOW, deadAfterHours: 72 });
    expect(summary.expired).toBe(1);
    expect(summary.dead).toBe(0);
    expect((await repo.getDealBySlug('a'))?.status).toBe('expired');
  });
});

describe('price point pruning', () => {
  it('never deletes a deal’s most recent observation, however old', async () => {
    // Dropping it would make the current price look unobserved, which is worse
    // than keeping a stale row: the chart and the "lowest recorded" claim both
    // read from this table.
    await repo.upsertDeals([makeDeal({ sourceId: 'a', slug: 'a', merchantId: 'm-1' })]);
    const { deals } = await repo.queryDeals({});
    const dealId = deals[0]!.id;

    await repo.appendPricePoints([
      { dealId, price: 5000, observedAt: daysAgo(400) },
      { dealId, price: 4000, observedAt: daysAgo(300) },
    ]);

    const summary = await reap({ repo, now: NOW, priceHistoryDays: 180 });
    expect(summary.prunedPricePoints).toBe(1);

    const history = await repo.getPriceHistory(dealId);
    expect(history).toHaveLength(1);
    expect(history[0]?.price).toBe(4000);
  });

  it('keeps everything inside the retention window', async () => {
    await repo.upsertDeals([makeDeal({ sourceId: 'a', slug: 'a', merchantId: 'm-1' })]);
    const { deals } = await repo.queryDeals({});
    const dealId = deals[0]!.id;

    await repo.appendPricePoints([
      { dealId, price: 5000, observedAt: daysAgo(90) },
      { dealId, price: 4000, observedAt: daysAgo(30) },
      { dealId, price: 3000, observedAt: daysAgo(1) },
    ]);

    const summary = await reap({ repo, now: NOW, priceHistoryDays: 180 });
    expect(summary.prunedPricePoints).toBe(0);
    expect(await repo.getPriceHistory(dealId)).toHaveLength(3);
  });

  it('prunes each deal independently', async () => {
    await repo.upsertDeals([
      makeDeal({ sourceId: 'a', slug: 'a', merchantId: 'm-1' }),
      makeDeal({ sourceId: 'b', slug: 'b', merchantId: 'm-1' }),
    ]);
    const { deals } = await repo.queryDeals({});
    const [first, second] = [deals[0]!.id, deals[1]!.id];

    await repo.appendPricePoints([
      { dealId: first, price: 100, observedAt: daysAgo(400) },
      { dealId: first, price: 200, observedAt: daysAgo(390) },
      { dealId: second, price: 300, observedAt: daysAgo(400) },
    ]);

    await reap({ repo, now: NOW, priceHistoryDays: 180 });

    // Each deal keeps exactly its own latest, not one row across the table.
    expect(await repo.getPriceHistory(first)).toHaveLength(1);
    expect(await repo.getPriceHistory(second)).toHaveLength(1);
  });
});

describe('the summary', () => {
  it('reports the cutoffs it used, so a surprising count is diagnosable', async () => {
    const summary = await reap({ repo, now: NOW, deadAfterHours: 24, priceHistoryDays: 10 });
    expect(summary.deadBefore).toBe(hoursAgo(24));
    expect(summary.prunedBefore).toBe(daysAgo(10));
  });
});

describe('absence as evidence', () => {
  it('refuses to infer death when the run learned nothing', async () => {
    // A few days of blocked scrapes would otherwise retire the entire catalogue
    // on the strength of having looked nowhere.
    await repo.upsertDeals(
      [makeDeal({ sourceId: 'a', slug: 'a', merchantId: 'm-1' })],
      hoursAgo(200),
    );

    const summary = await reap({ repo, now: NOW, inferAbsence: false });
    expect(summary.dead).toBe(0);
    expect(summary.inferredAbsence).toBe(false);
    expect((await repo.getDealBySlug('a'))?.status).toBe('active');
  });

  it('still expires on its stated date, because that is a fact either way', async () => {
    await repo.upsertDeals([
      makeDeal({ sourceId: 'a', slug: 'a', merchantId: 'm-1', expiresAt: hoursAgo(1) }),
    ]);

    const summary = await reap({ repo, now: NOW, inferAbsence: false });
    expect(summary.expired).toBe(1);
  });
});
