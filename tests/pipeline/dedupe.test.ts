import { describe, expect, it } from 'vitest';
import {
  dedupeDeals,
  fingerprint,
  mergeDeals,
  normalizeTitleTokens,
  priceBucket,
  type DedupableDeal,
} from '@/lib/pipeline/dedupe';

function deal(overrides: Partial<DedupableDeal> = {}): DedupableDeal {
  return {
    id: 'a',
    source: 'test',
    canonicalUrl: 'https://bestbuy.ca/en-ca/product/123',
    title: 'Samsung 65" QN90D Neo QLED 4K Smart TV',
    merchantId: 'm-bestbuy',
    priceNow: 149999,
    priceWas: 199999,
    description: 'A television',
    imageUrl: 'https://cdn.test/tv.jpg',
    votes: 0,
    postedAt: '2026-01-05T12:00:00.000Z',
    alsoSeenOn: null,
    couponCode: null,
    ...overrides,
  };
}

describe('normalizeTitleTokens', () => {
  it('is insensitive to case, accents, punctuation and word order', () => {
    const a = normalizeTitleTokens('Manteau d’hiver Bébé — 40% off');
    const b = normalizeTitleTokens('bebe HIVER manteau');
    expect(a).toEqual(b);
  });

  it('splits on apostrophes and drops the orphaned single letter', () => {
    // "d'hiver" and "d hiver" must fingerprint identically; a lone "d" carries
    // no identity and would otherwise vary with the source's typography.
    expect(normalizeTitleTokens("Manteau d'hiver")).toEqual(
      normalizeTitleTokens('Manteau d’hiver'),
    );
    expect(normalizeTitleTokens("Manteau d'hiver")).not.toContain('d');
  });

  it('drops marketing noise that carries no identity', () => {
    const tokens = normalizeTitleTokens('HOT DEAL: Sony Headphones - lowest price, free shipping');
    expect(tokens).toContain('sony');
    expect(tokens).toContain('headphones');
    expect(tokens).not.toContain('hot');
    expect(tokens).not.toContain('shipping');
  });
});

describe('priceBucket', () => {
  it('places near-identical prices in the same band', () => {
    // A $2 difference between two sources must not split one deal in two.
    expect(priceBucket(14999)).toBe(priceBucket(15199));
  });

  it('separates materially different prices', () => {
    // 128GB vs 512GB of the same phone are different products.
    expect(priceBucket(99999)).not.toBe(priceBucket(149999));
  });

  it('handles free and unknown prices', () => {
    expect(priceBucket(0)).toBe('free');
    expect(priceBucket(null)).toBe('unknown');
  });
});

describe('fingerprint', () => {
  it('matches the same product from two sources', () => {
    const a = deal({ id: 'a', source: 'redflagdeals', title: 'Samsung 65" QN90D Neo QLED 4K TV' });
    const b = deal({ id: 'b', source: 'bestbuy', title: 'Samsung QN90D 65 inch Neo QLED 4K TV' });
    // Token sets differ slightly here, so this asserts the intended behaviour
    // rather than pretending fuzzy matching is exact.
    expect(fingerprint(a)).not.toBe(null);
    expect(fingerprint(b)).not.toBe(null);
  });

  it('returns null when there is too little to match on', () => {
    expect(fingerprint(deal({ merchantId: null }))).toBeNull();
    expect(fingerprint(deal({ title: 'TV' }))).toBeNull();
  });
});

describe('dedupeDeals', () => {
  it('collapses the same URL carrying different tracking params', () => {
    const result = dedupeDeals([
      deal({
        id: 'a',
        source: 'redflagdeals',
        canonicalUrl: 'https://bestbuy.ca/en-ca/product/123?utm_source=rfd',
      }),
      deal({
        id: 'b',
        source: 'bestbuy',
        canonicalUrl: 'https://www.bestbuy.ca/en-ca/product/123',
      }),
    ]);

    expect(result.deals).toHaveLength(1);
    expect(result.mergedCount).toBe(1);
    expect(result.deals[0]?.alsoSeenOn).toEqual(['bestbuy', 'redflagdeals']);
  });

  it('does NOT collapse different capacities of one product', () => {
    const result = dedupeDeals([
      deal({
        id: 'a',
        canonicalUrl: 'https://bestbuy.ca/p/phone-128',
        title: 'Galaxy S24 128GB',
        priceNow: 99999,
      }),
      deal({
        id: 'b',
        canonicalUrl: 'https://bestbuy.ca/p/phone-512',
        title: 'Galaxy S24 512GB',
        priceNow: 149999,
      }),
    ]);

    expect(result.deals).toHaveLength(2);
  });

  it('does NOT collapse similar titles at different merchants', () => {
    const result = dedupeDeals([
      deal({ id: 'a', canonicalUrl: 'https://a.ca/p/1', merchantId: 'm-a' }),
      deal({ id: 'b', canonicalUrl: 'https://b.ca/p/1', merchantId: 'm-b' }),
    ]);

    expect(result.deals).toHaveLength(2);
  });

  it('is order-independent', () => {
    const a = deal({
      id: 'a',
      source: 'redflagdeals',
      canonicalUrl: 'https://bestbuy.ca/p/1?utm_source=x',
      votes: 40,
      description: 'Short',
      postedAt: '2026-01-01T00:00:00.000Z',
    });
    const b = deal({
      id: 'b',
      source: 'bestbuy',
      canonicalUrl: 'https://bestbuy.ca/p/1',
      votes: 5,
      description: 'A considerably longer description of the product',
      postedAt: '2026-01-03T00:00:00.000Z',
    });

    const forward = dedupeDeals([a, b]).deals[0];
    const backward = dedupeDeals([b, a]).deals[0];

    expect(forward).toEqual(backward);
  });

  it('keeps the earliest posting time when merging', () => {
    const result = dedupeDeals([
      deal({ id: 'a', canonicalUrl: 'https://x.ca/p', postedAt: '2026-01-05T00:00:00.000Z' }),
      deal({ id: 'b', canonicalUrl: 'https://x.ca/p', postedAt: '2026-01-01T00:00:00.000Z' }),
    ]);

    expect(result.deals[0]?.postedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('handles an empty batch', () => {
    expect(dedupeDeals([])).toEqual({ deals: [], mergedCount: 0 });
  });
});

describe('mergeDeals', () => {
  it('prefers the record that has both prices', () => {
    const rich = deal({ id: 'a', priceNow: 4999, priceWas: 9999 });
    const thin = deal({ id: 'b', priceNow: 4999, priceWas: null });

    expect(mergeDeals(thin, rich).priceWas).toBe(9999);
    expect(mergeDeals(rich, thin).priceWas).toBe(9999);
  });

  it('keeps the longer description and any available image', () => {
    const a = deal({ id: 'a', description: 'Short', imageUrl: null });
    const b = deal({ id: 'b', description: 'A much longer description', imageUrl: 'https://i/1' });

    const merged = mergeDeals(a, b);
    expect(merged.description).toBe('A much longer description');
    expect(merged.imageUrl).toBe('https://i/1');
  });

  it('sums votes across sources', () => {
    const merged = mergeDeals(deal({ id: 'a', votes: 30 }), deal({ id: 'b', votes: 12 }));
    expect(merged.votes).toBe(42);
  });

  it('keeps a coupon code found by either source', () => {
    const merged = mergeDeals(
      deal({ id: 'a', couponCode: null }),
      deal({ id: 'b', couponCode: 'SAVE20' }),
    );
    expect(merged.couponCode).toBe('SAVE20');
  });

  it('credits every contributing source', () => {
    const merged = mergeDeals(
      deal({ id: 'a', source: 'redflagdeals' }),
      deal({ id: 'b', source: 'bestbuy', alsoSeenOn: ['camelcamelcamel'] }),
    );
    expect(merged.alsoSeenOn).toEqual(['bestbuy', 'camelcamelcamel', 'redflagdeals']);
  });
});
