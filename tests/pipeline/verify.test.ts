import { describe, expect, it } from 'vitest';
import { verifyDeals, type PriceObservation } from '@/lib/pipeline/verify';
import { makeDeal } from '../db/helpers';
import type { DealInput } from '@/lib/db/repository';

const NOW = new Date('2026-02-01T00:00:00.000Z');

function tv(overrides: Partial<DealInput> = {}): DealInput {
  return makeDeal({
    productKey: 'gtin:00004006381333931',
    productKeyStrength: 'gtin',
    title: 'Samsung 65" QN90D Neo QLED 4K TV',
    priceNow: 149999,
    priceWas: 199999,
    discountPct: 25,
    ...overrides,
  });
}

function history(prices: number[], daysAgoStart = 90): PriceObservation[] {
  return prices.map((price, index) => ({
    price,
    merchantId: 'm-any',
    observedAt: new Date(NOW.getTime() - (daysAgoStart - index * 10) * 86_400_000).toISOString(),
  }));
}

describe('verifyDeals', () => {
  it('leaves a lone retailer claim unverified — the core requirement', () => {
    // One platform saying "50% off" is not evidence of anything.
    const deals = [tv({ merchantId: 'm-bestbuy' })];
    const { summary } = verifyDeals(deals, { historyByProductKey: new Map(), now: NOW });

    expect(deals[0]?.verdict).toBe('unverified');
    expect(deals[0]?.evidence).toBe('none');
    expect(deals[0]?.marketPrice).toBeNull();
    expect(summary.verified).toBe(0);
  });

  it('compares the same product across merchants and verifies a real discount', () => {
    const deals = [
      // Plausible MSRP claims, so the anchor check is not what is under test here.
      tv({ id: 'd1', sourceId: 's1', merchantId: 'm-bestbuy', priceNow: 129999, priceWas: 159999 }),
      tv({ id: 'd2', sourceId: 's2', merchantId: 'm-walmart', priceNow: 149999, priceWas: null }),
      tv({ id: 'd3', sourceId: 's3', merchantId: 'm-costco', priceNow: 152999, priceWas: null }),
    ];

    verifyDeals(deals, { historyByProductKey: new Map(), now: NOW });

    const cheapest = deals.find((d) => d.id === 'd1');
    expect(cheapest?.verdict).toBe('verified-good');
    expect(cheapest?.marketPrice).toBe(151499); // median of 149999 and 152999
    expect(cheapest?.marketDiscountPct).toBeGreaterThan(5);
    expect(cheapest?.qualityNote).toContain('other stores');
  });

  it('tells the shopper plainly when a listing is above market', () => {
    const deals = [
      tv({ id: 'd1', sourceId: 's1', merchantId: 'm-a', priceNow: 189999, priceWas: null }),
      tv({ id: 'd2', sourceId: 's2', merchantId: 'm-b', priceNow: 149999, priceWas: null }),
      tv({ id: 'd3', sourceId: 's3', merchantId: 'm-c', priceNow: 152999, priceWas: null }),
    ];

    verifyDeals(deals, { historyByProductKey: new Map(), now: NOW });

    expect(deals.find((d) => d.id === 'd1')?.verdict).toBe('above-market');
  });

  it('flags an inflated anchor and demotes it out of the front page', () => {
    const deals = [
      // Claims "was $2,499" on a TV the market sells at ~$1,500.
      tv({
        id: 'd1',
        sourceId: 's1',
        merchantId: 'm-a',
        priceNow: 149999,
        priceWas: 249999,
        discountPct: 40,
        heat: 95,
      }),
      tv({ id: 'd2', sourceId: 's2', merchantId: 'm-b', priceNow: 149999, priceWas: null }),
      tv({ id: 'd3', sourceId: 's3', merchantId: 'm-c', priceNow: 152999, priceWas: null }),
    ];

    const { summary } = verifyDeals(deals, { historyByProductKey: new Map(), now: NOW });

    const flagged = deals.find((d) => d.id === 'd1');
    expect(flagged?.verdict).toBe('inflated-anchor');
    expect(flagged?.claimSuspect).toBe(true);
    // Demoted: a misleading claim must not be promoted as a bargain.
    expect(flagged?.heat).toBeLessThanOrEqual(25);
    expect(summary.suspectAnchors).toBe(1);
  });

  it('does not let one merchant corroborate itself', () => {
    // The same retailer listing a product twice is not a second opinion.
    const deals = [
      tv({ id: 'd1', sourceId: 's1', merchantId: 'm-same', priceNow: 129999 }),
      tv({ id: 'd2', sourceId: 's2', merchantId: 'm-same', priceNow: 149999 }),
      tv({ id: 'd3', sourceId: 's3', merchantId: 'm-same', priceNow: 152999 }),
    ];

    verifyDeals(deals, { historyByProductKey: new Map(), now: NOW });

    expect(deals[0]?.marketPrice).toBeNull();
    expect(deals[0]?.verdict).toBe('unverified');
  });

  it('uses recorded history to confirm a genuine all-time low', () => {
    const deals = [tv({ id: 'd1', merchantId: 'm-a', priceNow: 99999, priceWas: null })];
    const historyMap = new Map([
      ['gtin:00004006381333931', history([169999, 159999, 149999, 129999, 109999])],
    ]);

    verifyDeals(deals, { historyByProductKey: historyMap, now: NOW });

    expect(deals[0]?.verdict).toBe('verified-low');
    expect(deals[0]?.observedLow).toBe(99999);
    expect(deals[0]?.qualityNote).toMatch(/Lowest price we've recorded/);
  });

  it('refuses a cross-merchant claim when identity is only title-shaped', () => {
    // Two coats with similar titles are not necessarily the same coat.
    const deals = [
      tv({ id: 'd1', merchantId: 'm-a', productKeyStrength: 'title', priceNow: 4999 }),
      tv({
        id: 'd2',
        sourceId: 's2',
        merchantId: 'm-b',
        productKeyStrength: 'title',
        priceNow: 9999,
      }),
      tv({
        id: 'd3',
        sourceId: 's3',
        merchantId: 'm-c',
        productKeyStrength: 'title',
        priceNow: 9999,
      }),
    ];

    verifyDeals(deals, { historyByProductKey: new Map(), now: NOW });

    expect(deals[0]?.marketPrice).toBeNull();
    expect(deals[0]?.verdict).toBe('unverified');
  });

  it('ranks a market-verified deal above an unverifiable one with the same claim', () => {
    const verified = [
      tv({ id: 'v1', merchantId: 'm-a', priceNow: 99999, priceWas: null, votes: 0 }),
      tv({ id: 'v2', sourceId: 's2', merchantId: 'm-b', priceNow: 149999, priceWas: null }),
      tv({ id: 'v3', sourceId: 's3', merchantId: 'm-c', priceNow: 152999, priceWas: null }),
    ];
    const unverified = [
      tv({
        id: 'u1',
        productKey: 'gtin:00000000000000',
        merchantId: 'm-z',
        priceNow: 99999,
        priceWas: 149999,
        discountPct: 33,
        votes: 0,
      }),
    ];

    verifyDeals(verified, { historyByProductKey: new Map(), now: NOW });
    verifyDeals(unverified, { historyByProductKey: new Map(), now: NOW });

    // Both claim roughly a third off; only one can prove it.
    expect(verified[0]!.heat).toBeGreaterThan(unverified[0]!.heat as number);
  });

  it('handles deals with no product key at all', () => {
    const deals = [tv({ productKey: null, productKeyStrength: null })];
    expect(() => verifyDeals(deals, { historyByProductKey: new Map(), now: NOW })).not.toThrow();
    expect(deals[0]?.verdict).toBe('unverified');
  });

  it('reports what it did for the run log', () => {
    const deals = [
      tv({ id: 'd1', merchantId: 'm-a', priceNow: 129999, priceWas: null }),
      tv({ id: 'd2', sourceId: 's2', merchantId: 'm-b', priceNow: 149999, priceWas: null }),
      tv({ id: 'd3', sourceId: 's3', merchantId: 'm-c', priceNow: 152999, priceWas: null }),
    ];

    const { summary } = verifyDeals(deals, { historyByProductKey: new Map(), now: NOW });

    expect(summary.assessed).toBe(3);
    expect(summary.comparedAcrossMerchants).toBe(3);
    expect(summary.verified).toBeGreaterThanOrEqual(1);
  });
});
