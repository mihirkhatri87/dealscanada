import { describe, expect, it } from 'vitest';
import { buildDealQuery, freshnessCutoff } from '@/lib/db/query-builder';

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
 * run.
 *
 * These are the clause-shape tests, which inject the clock rather than relying
 * on wall time. What the window actually hides is in tests/db/contract-suite.ts,
 * so both engines are held to it.
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
