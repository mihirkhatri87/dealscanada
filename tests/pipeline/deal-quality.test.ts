import { describe, expect, it } from 'vitest';
import {
  assessDealQuality,
  median,
  trustedDiscountPct,
  type QualityInput,
} from '@/lib/pipeline/deal-quality';
import {
  extractModelToken,
  isComparableIdentity,
  isValidGtin,
  resolveProductIdentity,
} from '@/lib/pipeline/product-key';

function input(overrides: Partial<QualityInput> = {}): QualityInput {
  return {
    priceNow: 49999,
    claimedPriceWas: 79999,
    identityStrength: 'gtin',
    competitorPrices: [],
    observedHistory: [],
    historyDays: 0,
    ...overrides,
  };
}

describe('product identity', () => {
  it('validates real GTIN check digits', () => {
    expect(isValidGtin('0012345678905')).toBe(true); // valid UPC-A as EAN-13
    expect(isValidGtin('4006381333931')).toBe(true); // valid EAN-13
    expect(isValidGtin('4006381333932')).toBe(false); // wrong check digit
    expect(isValidGtin('12345')).toBe(false);
  });

  it('matches a UPC-12 to its EAN-13 form', () => {
    const a = resolveProductIdentity({ title: 'X', gtin: '012345678905' });
    const b = resolveProductIdentity({ title: 'X', gtin: '0012345678905' });
    expect(a.key).toBe(b.key);
  });

  it('resolves strongest evidence first', () => {
    expect(
      resolveProductIdentity({ title: 'X', gtin: '4006381333931', mpn: 'ABC', asin: 'B0ABCDEFGH' })
        .strength,
    ).toBe('gtin');
    expect(resolveProductIdentity({ title: 'X', asin: 'B0ABCDEFGH', mpn: 'ABC' }).strength).toBe(
      'asin',
    );
    expect(resolveProductIdentity({ title: 'X', mpn: 'QN65QN90D' }).strength).toBe('mpn');
  });

  it('never keys on a retailer SKU, which would defeat comparison entirely', () => {
    // A SKU is merchant-scoped: keying on it would put the same TV in two groups.
    const identity = resolveProductIdentity({ title: 'Plain words only', sku: '12345678' });
    expect(identity.key).toBeNull();
  });

  it('extracts a model token but not sizes, capacities or years', () => {
    expect(extractModelToken('Sony WH-1000XM5 Wireless Headphones')).toBe('WH-1000XM5');
    expect(extractModelToken('Samsung QN65QN90D Neo QLED')).toBe('QN65QN90D');
    expect(extractModelToken('Winter Coat 500GB')).toBeNull();
    expect(extractModelToken('Sweater 2024 Edition')).toBeNull();
    expect(extractModelToken('Plain Wool Scarf')).toBeNull();
  });

  it('scopes an MPN by brand, since manufacturers reuse part numbers', () => {
    const a = resolveProductIdentity({ title: 'X', brand: 'Sony', mpn: 'A100' });
    const b = resolveProductIdentity({ title: 'X', brand: 'Canon', mpn: 'A100' });
    expect(a.key).not.toBe(b.key);
  });

  it('only treats manufacturer identifiers as comparable', () => {
    expect(isComparableIdentity('gtin')).toBe(true);
    expect(isComparableIdentity('asin')).toBe(true);
    expect(isComparableIdentity('mpn')).toBe(true);
    // A title-shaped match may collapse duplicates but must not license a claim
    // that something is cheaper than everywhere else.
    expect(isComparableIdentity('model')).toBe(false);
    expect(isComparableIdentity('title')).toBe(false);
  });
});

describe('median', () => {
  it('handles odd, even and empty sets', () => {
    expect(median([100, 300, 200])).toBe(200);
    expect(median([100, 200, 300, 400])).toBe(250);
    expect(median([])).toBeNull();
  });
});

describe('assessDealQuality', () => {
  it('refuses to call anything a deal on the retailer word alone', () => {
    // The single most important case: one platform claiming a discount, with
    // nothing to corroborate it.
    const result = assessDealQuality(input({ competitorPrices: [], observedHistory: [] }));

    expect(result.verdict).toBe('unverified');
    expect(result.evidence).toBe('none');
    expect(result.marketDiscountPct).toBeNull();
    expect(result.explanation).toContain("retailer's own claim");
  });

  it('verifies a genuine discount against the cross-merchant median', () => {
    const result = assessDealQuality(
      // A plausible claim: $549 MSRP on something the market sells at ~$500.
      input({ priceNow: 44999, claimedPriceWas: 54999, competitorPrices: [49999, 51999, 49999] }),
    );

    expect(result.verdict).toBe('verified-good');
    expect(result.marketPrice).toBe(49999);
    expect(result.marketDiscountPct).toBeGreaterThan(5);
    expect(result.explanation).toContain('other stores');
  });

  it('flags an inflated anchor when the claim contradicts the market', () => {
    // "Was $799" on something that sells for $500 everywhere is the fake-discount
    // pattern this whole feature exists to catch.
    const result = assessDealQuality(
      input({
        priceNow: 49999,
        claimedPriceWas: 79999,
        competitorPrices: [50999, 49999, 51999],
      }),
    );

    expect(result.verdict).toBe('inflated-anchor');
    expect(result.claimSuspect).toBe(true);
    expect(result.explanation).toContain('inflated');
  });

  it('does not flag an MSRP that sits plausibly above street price', () => {
    const result = assessDealQuality(
      input({ priceNow: 44999, claimedPriceWas: 54999, competitorPrices: [49999, 49999] }),
    );
    expect(result.claimSuspect).toBe(false);
    expect(result.verdict).not.toBe('inflated-anchor');
  });

  it('recognises a new low against prior observations', () => {
    const result = assessDealQuality(
      input({
        priceNow: 39999,
        claimedPriceWas: null,
        // Prior observations only - the current price is not one of them.
        observedHistory: [59999, 54999, 49999, 44999],
        historyDays: 90,
      }),
    );

    expect(result.verdict).toBe('verified-low');
    expect(result.observedLow).toBe(39999);
    expect(result.explanation).toContain('90 days');
  });

  it('says plainly when a price is worse than elsewhere', () => {
    const result = assessDealQuality(
      input({ priceNow: 59999, claimedPriceWas: null, competitorPrices: [49999, 48999, 49999] }),
    );

    expect(result.verdict).toBe('above-market');
    expect(result.explanation).toContain('Cheaper elsewhere');
  });

  it('reports a price in line with the market as exactly that', () => {
    const result = assessDealQuality(
      input({ priceNow: 49999, claimedPriceWas: null, competitorPrices: [49999, 50199, 49899] }),
    );
    expect(result.verdict).toBe('market-price');
  });

  it('ignores competitor prices when identity is too weak to trust', () => {
    // Matching on a title alone cannot license a cross-merchant claim.
    const result = assessDealQuality(
      input({ identityStrength: 'title', competitorPrices: [49999, 51999, 49999] }),
    );

    expect(result.marketPrice).toBeNull();
    expect(result.verdict).toBe('unverified');
  });

  it('requires more than one competitor before claiming a market price', () => {
    const result = assessDealQuality(input({ competitorPrices: [49999] }));
    expect(result.marketPrice).toBeNull();
  });

  it('requires enough history before claiming an observed low', () => {
    const result = assessDealQuality(
      input({ claimedPriceWas: null, observedHistory: [49999, 44999], historyDays: 5 }),
    );
    expect(result.observedLow).toBeNull();
  });

  it('grades evidence strength honestly', () => {
    expect(assessDealQuality(input({})).evidence).toBe('none');

    expect(
      assessDealQuality(input({ claimedPriceWas: null, competitorPrices: [49999, 50999] }))
        .evidence,
    ).toBe('moderate');

    expect(
      assessDealQuality(
        input({
          claimedPriceWas: null,
          competitorPrices: [49999, 50999],
          observedHistory: [59999, 54999, 49999],
          historyDays: 90,
        }),
      ).evidence,
    ).toBe('strong');
  });

  it('reports where the price sits within prior observations', () => {
    const result = assessDealQuality(
      input({
        priceNow: 44999,
        claimedPriceWas: null,
        observedHistory: [59999, 54999, 49999, 44999, 39999],
        historyDays: 60,
      }),
    );
    expect(result.priceRankPct).toBe(20); // one of five prior prices was cheaper
  });

  describe('"lowest recorded" cannot be claimed vacuously', () => {
    it('does not treat the current price as its own historical low', () => {
      // Folding the current price into history would make every listing its own
      // minimum whenever history is sparse, so everything would read
      // "lowest ever recorded" - true, and worthless.
      const result = assessDealQuality(
        input({ priceNow: 9999, claimedPriceWas: null, observedHistory: [], historyDays: 0 }),
      );
      expect(result.verdict).not.toBe('verified-low');
      expect(result.observedLow).toBeNull();
    });

    it('refuses the claim when a competitor sells it cheaper today', () => {
      // Our history being expensive must not earn the best badge on the page
      // while someone else quietly sells the same product for less right now.
      const result = assessDealQuality(
        input({
          priceNow: 152999,
          claimedPriceWas: null,
          competitorPrices: [129999, 149999],
          observedHistory: [169999, 179999, 189999],
          historyDays: 90,
        }),
      );
      expect(result.verdict).not.toBe('verified-low');
      // With competitors at $1,299 and $1,499 the median is $1,399, so $1,529
      // is genuinely above market and says so.
      expect(result.verdict).toBe('above-market');
    });

    it('grants the claim when it is both a record low and the best price today', () => {
      const result = assessDealQuality(
        input({
          priceNow: 129999,
          claimedPriceWas: null,
          competitorPrices: [149999, 152999],
          observedHistory: [169999, 179999, 189999],
          historyDays: 90,
        }),
      );
      expect(result.verdict).toBe('verified-low');
    });

    it('lets a live above-market price override a favourable history', () => {
      const result = assessDealQuality(
        input({
          priceNow: 59999,
          claimedPriceWas: null,
          competitorPrices: [39999, 41999],
          observedHistory: [69999, 79999, 89999],
          historyDays: 90,
        }),
      );
      expect(result.verdict).toBe('above-market');
    });
  });

  it('handles a missing price without throwing', () => {
    const result = assessDealQuality(input({ priceNow: null }));
    expect(result.verdict).toBe('unverified');
    expect(result.explanation).toContain('No price');
  });
});

describe('trustedDiscountPct', () => {
  it('prefers the market-corroborated number over the retailer claim', () => {
    const quality = assessDealQuality(
      input({ priceNow: 44999, claimedPriceWas: null, competitorPrices: [49999, 49999] }),
    );
    // The retailer would have claimed 44% off; the market says 10%.
    expect(trustedDiscountPct(quality, 44)).toBeCloseTo(10, 0);
  });

  it('suppresses the headline percentage entirely on a flagged anchor', () => {
    const quality = assessDealQuality(
      input({ priceNow: 49999, claimedPriceWas: 79999, competitorPrices: [49999, 50999] }),
    );
    expect(quality.verdict).toBe('inflated-anchor');
    expect(trustedDiscountPct(quality, 37.5)).toBeNull();
  });

  it('falls back to the claim when nothing contradicts it', () => {
    const quality = assessDealQuality(input({ competitorPrices: [], observedHistory: [] }));
    expect(trustedDiscountPct(quality, 37.5)).toBe(37.5);
  });
});
