import { describe, expect, it } from 'vitest';
import {
  discountConfidence,
  expiryLabel,
  headlineDiscount,
  isExpiringSoon,
  merchantInitials,
  presentVerdict,
  relativeTime,
  showsPriceWas,
} from '@/lib/format';
import type { DealWithRelations } from '@/lib/db/types';

const NOW = new Date('2026-02-01T12:00:00.000Z');

function deal(overrides: Partial<DealWithRelations> = {}): DealWithRelations {
  return {
    verdict: 'unverified',
    evidence: 'none',
    discountPct: 50,
    marketDiscountPct: null,
    priceWas: 9999,
    priceNow: 4999,
    claimSuspect: false,
    expiresAt: null,
    postedAt: null,
    ...overrides,
  } as DealWithRelations;
}

describe('headlineDiscount', () => {
  it('prefers the market-corroborated figure over the retailer claim', () => {
    expect(headlineDiscount(deal({ discountPct: 60, marketDiscountPct: 12 }))).toBe(12);
  });

  it('falls back to the claim when nothing contradicts it', () => {
    expect(headlineDiscount(deal({ discountPct: 60 }))).toBe(60);
  });

  it('gives a flagged anchor no headline number at all', () => {
    // The whole mechanism of a fake discount is the big percentage. Withholding
    // it is the point of flagging.
    expect(headlineDiscount(deal({ verdict: 'inflated-anchor', discountPct: 60 }))).toBeNull();
  });

  it('returns null when there is no discount to show', () => {
    expect(headlineDiscount(deal({ discountPct: null }))).toBeNull();
  });
});

describe('discountConfidence', () => {
  it('marks a market-corroborated saving as verified', () => {
    expect(discountConfidence(deal({ marketDiscountPct: 15 }))).toBe('verified');
  });

  it('marks an uncorroborated saving as merely claimed', () => {
    // Styling it like a verified one is the visual sleight of hand we refuse.
    expect(discountConfidence(deal({ marketDiscountPct: null, discountPct: 63 }))).toBe('claimed');
  });
});

describe('showsPriceWas', () => {
  it('shows a struck-out price when there is one', () => {
    expect(showsPriceWas(deal())).toBe(true);
  });

  it('suppresses it entirely on a flagged anchor', () => {
    // Printing the fake "was" beside the real price is the presentation that
    // makes the deception work, so it is removed rather than annotated.
    expect(showsPriceWas(deal({ verdict: 'inflated-anchor' }))).toBe(false);
  });

  it('shows nothing when no before price exists', () => {
    expect(showsPriceWas(deal({ priceWas: null }))).toBe(false);
  });
});

describe('presentVerdict', () => {
  it('gives every verdict a distinct label and tone', () => {
    const verdicts = [
      'verified-low',
      'verified-good',
      'market-price',
      'above-market',
      'inflated-anchor',
      'unverified',
    ] as const;

    const labels = verdicts.map((v) => presentVerdict(v).label);
    expect(new Set(labels).size).toBe(verdicts.length);

    expect(presentVerdict('verified-low').tone).toBe('good');
    expect(presentVerdict('inflated-anchor').tone).toBe('alert');
    expect(presentVerdict('above-market').tone).toBe('caution');
  });

  it('never phrases an unverified deal as a saving', () => {
    const { label, short } = presentVerdict('unverified');
    expect(`${label} ${short}`.toLowerCase()).not.toMatch(/save|deal|off|low/);
  });
});

describe('relativeTime', () => {
  it.each([
    ['2026-02-01T11:59:30.000Z', 'just now'],
    ['2026-02-01T11:30:00.000Z', '30 min ago'],
    ['2026-02-01T09:00:00.000Z', '3 hours ago'],
    ['2026-01-30T12:00:00.000Z', '2 days ago'],
    ['2025-12-01T12:00:00.000Z', '2 months ago'],
  ])('renders %s as %s', (iso, expected) => {
    expect(relativeTime(iso, NOW)).toBe(expected);
  });

  it('is empty for missing or malformed input', () => {
    expect(relativeTime(null, NOW)).toBe('');
    expect(relativeTime('nonsense', NOW)).toBe('');
  });
});

describe('expiry', () => {
  it('describes upcoming expiry in human terms', () => {
    expect(expiryLabel('2026-02-01T18:00:00.000Z', NOW)).toBe('Ends in 6 hours');
    expect(expiryLabel('2026-02-02T12:00:00.000Z', NOW)).toBe('Ends tomorrow');
    expect(expiryLabel('2026-02-06T12:00:00.000Z', NOW)).toBe('Ends in 5 days');
  });

  it('says expired rather than showing a negative duration', () => {
    expect(expiryLabel('2026-01-01T12:00:00.000Z', NOW)).toBe('Expired');
  });

  it('flags urgency only within a day', () => {
    expect(isExpiringSoon('2026-02-01T18:00:00.000Z', NOW)).toBe(true);
    expect(isExpiringSoon('2026-02-05T12:00:00.000Z', NOW)).toBe(false);
    expect(isExpiringSoon(null, NOW)).toBe(false);
  });
});

describe('merchantInitials', () => {
  it('takes up to two initials', () => {
    expect(merchantInitials('Best Buy Canada')).toBe('BB');
    expect(merchantInitials('Costco')).toBe('C');
    expect(merchantInitials(null)).toBe('?');
  });
});
