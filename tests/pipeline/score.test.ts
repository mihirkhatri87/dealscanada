import { describe, expect, it } from 'vitest';
import {
  RECENCY_HALF_LIFE_HOURS,
  computeHeat,
  normalizeDiscount,
  normalizeVotes,
  recencyDecay,
  sourceWeight,
} from '@/lib/pipeline/score';

const NOW = new Date('2026-01-10T12:00:00.000Z');

function at(hoursAgo: number): string {
  return new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
}

describe('normalizeVotes', () => {
  it('is bounded and monotonic', () => {
    expect(normalizeVotes(0)).toBe(0);
    expect(normalizeVotes(-5)).toBe(0);
    expect(normalizeVotes(10)).toBeGreaterThan(normalizeVotes(5));
    expect(normalizeVotes(10_000)).toBeLessThanOrEqual(1);
  });

  it('weights early votes far more than late ones', () => {
    // The gap between 0 and 20 votes should dwarf the gap between 500 and 520.
    const early = normalizeVotes(20) - normalizeVotes(0);
    const late = normalizeVotes(520) - normalizeVotes(500);
    expect(early).toBeGreaterThan(late * 5);
  });
});

describe('normalizeDiscount', () => {
  it('is bounded and monotonic', () => {
    expect(normalizeDiscount(null)).toBe(0);
    expect(normalizeDiscount(0)).toBe(0);
    expect(normalizeDiscount(50)).toBeGreaterThan(normalizeDiscount(20));
    expect(normalizeDiscount(95)).toBeLessThanOrEqual(1);
  });
});

describe('recencyDecay', () => {
  it('halves at exactly the stated half-life', () => {
    const fresh = recencyDecay(at(0), NOW);
    const halfLife = recencyDecay(at(RECENCY_HALF_LIFE_HOURS), NOW);
    expect(halfLife).toBeCloseTo(fresh / 2, 5);
  });

  it('decays continuously', () => {
    expect(recencyDecay(at(1), NOW)).toBeGreaterThan(recencyDecay(at(6), NOW));
    expect(recencyDecay(at(6), NOW)).toBeGreaterThan(recencyDecay(at(48), NOW));
  });

  it('treats an unknown age as neither fresh nor stale', () => {
    expect(recencyDecay(null, NOW)).toBe(0.3);
    expect(recencyDecay('not a date', NOW)).toBe(0.3);
  });

  it('does not reward a future timestamp beyond fresh', () => {
    expect(recencyDecay(at(-100), NOW)).toBe(1);
  });
});

describe('sourceWeight', () => {
  it('trusts community-curated sources above raw retailer feeds', () => {
    expect(sourceWeight('redflagdeals')).toBeGreaterThan(sourceWeight('jsonld'));
  });

  it('falls back for an unknown source', () => {
    expect(sourceWeight('brand-new-adapter')).toBeGreaterThan(0);
    expect(sourceWeight('brand-new-adapter')).toBeLessThanOrEqual(1);
  });
});

describe('computeHeat', () => {
  const base = { votes: 0, discountPct: null, postedAt: at(1), source: 'bestbuy', now: NOW };

  it('stays within 0..100 for every input shape', () => {
    const cases = [
      base,
      { ...base, votes: 100_000, discountPct: 99 },
      { ...base, votes: -5, discountPct: -10, postedAt: null },
      { ...base, postedAt: 'garbage' },
    ];
    for (const input of cases) {
      const heat = computeHeat(input);
      expect(heat).toBeGreaterThanOrEqual(0);
      expect(heat).toBeLessThanOrEqual(100);
    }
  });

  it('ranks more votes higher, all else equal', () => {
    expect(computeHeat({ ...base, votes: 50 })).toBeGreaterThan(computeHeat({ ...base, votes: 5 }));
  });

  it('ranks a deeper discount higher, all else equal', () => {
    expect(computeHeat({ ...base, discountPct: 60 })).toBeGreaterThan(
      computeHeat({ ...base, discountPct: 10 }),
    );
  });

  it('ranks a 24-hour-old deal below a 1-hour-old one with equal signals', () => {
    const fresh = computeHeat({ ...base, votes: 20, discountPct: 40, postedAt: at(1) });
    const old = computeHeat({ ...base, votes: 20, discountPct: 40, postedAt: at(24) });
    expect(old).toBeLessThan(fresh);
  });

  it('never throws on missing or malformed signals', () => {
    expect(() =>
      computeHeat({ votes: 0, discountPct: null, postedAt: null, source: 'unknown', now: NOW }),
    ).not.toThrow();
  });

  it('is deterministic for a fixed clock', () => {
    const input = { ...base, votes: 33, discountPct: 45 };
    expect(computeHeat(input)).toBe(computeHeat(input));
  });

  it('respects injected weights so ranking is tunable in one place', () => {
    const input = { ...base, votes: 200, discountPct: 5 };
    const voteHeavy = computeHeat(input, { votes: 90, discount: 5, recency: 3, source: 2 });
    const discountHeavy = computeHeat(input, { votes: 5, discount: 90, recency: 3, source: 2 });
    expect(voteHeavy).toBeGreaterThan(discountHeavy);
  });
});
