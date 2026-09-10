import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDealQuery, freshnessCutoff } from '@/lib/db/query-builder';
import { makeDeal, makeMerchant, tempSqliteRepo } from './helpers';
import type { DealRepository } from '@/lib/db/repository';

/**
 * The read-path freshness window.
 *
 * This exists because `status` cannot carry freshness on its own. The reaper
 * only retires a deal during a run where at least one source worked, so a
 * stretch of blocked scrapes leaves every row reading 'active' — which is
 * exactly when the site knows least about whether those deals, or the sizes
 * recorded against them, still exist.
 *
 * The window is therefore a second, independent guarantee: the listing shows
 * only what a source actually returned recently, whether or not the reaper has
 * run. These tests inject the clock rather than relying on wall time.
 */

const NOW = new Date('2026-03-01T12:00:00.000Z');

const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe('freshnessCutoff', () => {
  it('is the moment the window opens, not the moment it closes', () => {
    expect(freshnessCutoff(3, NOW)).toBe(daysAgo(3));
  });

  it('returns null when disabled, so diagnostics can see every row', () => {
    expect(freshnessCutoff(0, NOW)).toBeNull();
  });
});

describe('buildDealQuery freshness clause', () => {
  it('bounds a default listing by last_seen_at', () => {
    const { where, params } = buildDealQuery({}, 'sqlite', NOW);

    expect(where).toContain('d.last_seen_at >= ?');
    expect(params).toContain(daysAgo(3));
  });

  it('honours an explicit window', () => {
    const { params } = buildDealQuery({ seenWithinDays: 1 }, 'sqlite', NOW);
    expect(params).toContain(daysAgo(1));
  });

  it('omits the clause entirely when the window is off', () => {
    const { where } = buildDealQuery({ seenWithinDays: 0 }, 'sqlite', NOW);
    expect(where).not.toContain('last_seen_at');
  });

  it('numbers the Postgres placeholder in step with the other clauses', () => {
    // A freshness param inserted mid-list must not shift the ones after it out
    // of alignment — that would silently filter on the wrong value.
    const { where, params } = buildDealQuery(
      { categories: ['clothing'], seenWithinDays: 2 },
      'postgres',
      NOW,
    );

    expect(where).toContain('d.last_seen_at >= $2');
    expect(where).toContain('d.category IN ($3)');
    expect(params).toEqual(['active', daysAgo(2), 'clothing']);
  });
});

describe('freshness against a real repository', () => {
  let repo: DealRepository;
  let cleanup: () => Promise<void>;

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

  /** Real-clock relative: the read path reads wall time, not an injected NOW. */
  const realDaysAgo = (days: number): string =>
    new Date(Date.now() - days * 86_400_000).toISOString();

  it('hides a still-active deal no source has re-confirmed inside the window', async () => {
    // Never reaped — status is 'active' — but four days unseen. This is the
    // case that put sold-out sizes on the site: the reaper had not run, so
    // nothing had retired it.
    await repo.upsertDeals(
      [makeDeal({ sourceId: 'stale', slug: 'stale', merchantId: 'm-1' })],
      realDaysAgo(4),
    );
    await repo.upsertDeals(
      [makeDeal({ sourceId: 'fresh', slug: 'fresh', merchantId: 'm-1' })],
      realDaysAgo(1),
    );

    const { deals, total } = await repo.queryDeals({});
    expect(deals.map((deal) => deal.slug)).toEqual(['fresh']);
    expect(total).toBe(1);
  });

  it('leaves the stale deal reachable by its own URL', async () => {
    // A link shared last week should explain itself rather than 404, so the
    // detail page deliberately does not go through the window.
    await repo.upsertDeals(
      [makeDeal({ sourceId: 'stale', slug: 'stale', merchantId: 'm-1' })],
      realDaysAgo(4),
    );

    const deal = await repo.getDealBySlug('stale');
    expect(deal?.slug).toBe('stale');
    expect(deal?.status).toBe('active');
  });

  it('counts facets on the same window as the listing they label', async () => {
    await repo.upsertDeals(
      [makeDeal({ sourceId: 'stale', slug: 'stale', merchantId: 'm-1', category: 'clothing' })],
      realDaysAgo(4),
    );
    await repo.upsertDeals(
      [makeDeal({ sourceId: 'fresh', slug: 'fresh', merchantId: 'm-1', category: 'clothing' })],
      realDaysAgo(1),
    );

    const clothing = (await repo.facets('category')).find((f) => f.value === 'clothing');
    expect(clothing?.count).toBe(1);
  });
});
