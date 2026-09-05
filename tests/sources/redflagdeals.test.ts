import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseRssFeed,
  parseTopicsResponse,
  redflagdealsAdapter,
} from '@/lib/sources/redflagdeals';
import type { AdapterContext } from '@/lib/sources/types';

const topicsFixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/redflagdeals/topics.json'), 'utf8'),
) as unknown;

const rssFixture = readFileSync(
  join(process.cwd(), 'tests/fixtures/redflagdeals/feed.xml'),
  'utf8',
);

function context(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    http: {
      fetchJson: vi.fn(),
      fetchText: vi.fn(),
    } as unknown as AdapterContext['http'],
    log: () => {},
    ...overrides,
  };
}

describe('parseTopicsResponse', () => {
  const deals = parseTopicsResponse(topicsFixture);

  it('extracts the deals a shopper would care about', () => {
    // Eight topics in, minus one [EXPIRED] title, one expired offer flag, and
    // one discussion thread with no offer URL.
    expect(deals).toHaveLength(5);
  });

  it('maps offer metadata into a usable deal', () => {
    const tv = deals.find((d) => d.title.includes('QN90D'));

    expect(tv?.sourceId).toBe('2801455');
    expect(tv?.url).toBe('https://www.bestbuy.ca/en-ca/product/samsung-65-qn90d/17234567');
    expect(tv?.price).toBe('1499.99');
    expect(tv?.priceWas).toBe('1999.99');
    expect(tv?.merchantName).toBe('Best Buy');
    expect(tv?.expiresAt).toBe('2026-01-15T05:00:00+00:00');
  });

  it('accepts prices as numbers as well as strings', () => {
    const dyson = deals.find((d) => d.title.includes('Dyson'));
    expect(dyson?.price).toBe(599.99);
    expect(dyson?.priceWas).toBe(799.99);
  });

  it('skips topics the community has already marked expired', () => {
    expect(deals.some((d) => d.title.includes('EXPIRED'))).toBe(false);
    expect(deals.some((d) => d.title.includes('Sony WH-1000XM5'))).toBe(false);
  });

  it('skips offers flagged expired even when the title is clean', () => {
    expect(deals.some((d) => d.title.includes('Instant Pot'))).toBe(false);
  });

  it('skips discussion threads that carry no offer', () => {
    expect(deals.some((d) => d.title.includes('Discussion'))).toBe(false);
  });

  it('uses net votes so a downvoted thread does not rank as community-approved', () => {
    const socket = deals.find((d) => d.title.includes('Socket Set'));
    // 24 up, 55 down. Net is negative, so it floors at zero rather than
    // contributing positive community signal.
    expect(socket?.votes).toBe(0);

    const tv = deals.find((d) => d.title.includes('QN90D'));
    expect(tv?.votes).toBe(136); // 142 up - 6 down
  });

  it('keeps deals whose offer has no price rather than dropping them', () => {
    // "50% off outerwear" is a real deal with no single price. Dropping it would
    // lose exactly the promotions shoppers most want to see.
    const oldNavy = deals.find((d) => d.title.includes('Old Navy'));
    expect(oldNavy).toBeDefined();
    expect(oldNavy?.price).toBeNull();
  });

  it('never invents a price when the source has none', () => {
    const sportChek = deals.find((d) => d.title.includes('Sport Chek'));
    expect(sportChek?.price).toBeNull();
    expect(sportChek?.priceWas).toBeNull();
  });

  it('returns an empty array on a malformed payload rather than throwing', () => {
    expect(parseTopicsResponse(null)).toEqual([]);
    expect(parseTopicsResponse({})).toEqual([]);
    expect(parseTopicsResponse({ topics: 'not an array' })).toEqual([]);
    expect(parseTopicsResponse({ topics: [{ nonsense: true }] })).toEqual([]);
  });

  it('ignores unknown fields so an API addition cannot break ingestion', () => {
    const withExtras = {
      topics: [
        {
          topic_id: 1,
          title: 'Test deal',
          web_path: '/topics/test-1/',
          brand_new_field: { nested: true },
          offer: { dealer_name: 'X', price: '10', url: 'https://x.ca/p', another_new_field: 1 },
        },
      ],
    };
    expect(parseTopicsResponse(withExtras)).toHaveLength(1);
  });
});

describe('parseRssFeed', () => {
  const deals = parseRssFeed(rssFixture);

  it('parses the feed and still filters expired titles', () => {
    expect(deals).toHaveLength(2);
    expect(deals.some((d) => d.title.includes('EXPIRED'))).toBe(false);
  });

  it('leaves price and votes null rather than guessing', () => {
    // RSS carries no offer metadata. An invented price is worse than none.
    for (const deal of deals) {
      expect(deal.price).toBeNull();
      expect(deal.priceWas).toBeNull();
      expect(deal.votes).toBe(0);
    }
  });

  it('returns an empty array on malformed XML', () => {
    expect(parseRssFeed('<not-really-xml')).toEqual([]);
    expect(parseRssFeed('')).toEqual([]);
  });
});

describe('redflagdealsAdapter', () => {
  it('is always enabled — it needs no credentials', () => {
    expect(redflagdealsAdapter.enabled()).toEqual({ enabled: true });
  });

  it('uses the JSON API when it works', async () => {
    const fetchJson = vi.fn().mockResolvedValue({ data: topicsFixture });
    const ctx = context({
      http: { fetchJson, fetchText: vi.fn() } as unknown as AdapterContext['http'],
      limit: 40,
    });

    const result = await redflagdealsAdapter.fetch(ctx);

    expect(result.path).toBe('api');
    expect(result.deals.length).toBeGreaterThan(0);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining('forum_id=9'),
      expect.objectContaining({ skipRobots: true }),
    );
  });

  it('falls back to RSS when the API fails, and says so', async () => {
    const fetchJson = vi.fn().mockRejectedValue(new Error('500 Server Error'));
    const fetchText = vi.fn().mockResolvedValue({ data: rssFixture });
    const ctx = context({
      http: { fetchJson, fetchText } as unknown as AdapterContext['http'],
      limit: 40,
    });

    const result = await redflagdealsAdapter.fetch(ctx);

    expect(result.path).toBe('rss');
    expect(result.deals.length).toBeGreaterThan(0);
    // The degradation is reported, not hidden: RSS deals have no price.
    expect(result.reason).toContain('RSS');
  });

  it('respects the item limit', async () => {
    const fetchJson = vi.fn().mockResolvedValue({ data: topicsFixture });
    const ctx = context({
      http: { fetchJson, fetchText: vi.fn() } as unknown as AdapterContext['http'],
      limit: 2,
    });

    const result = await redflagdealsAdapter.fetch(ctx);
    expect(result.deals).toHaveLength(2);
  });

  it('stops paginating when a page comes back empty', async () => {
    const fetchJson = vi
      .fn()
      .mockResolvedValueOnce({ data: topicsFixture })
      .mockResolvedValueOnce({ data: { topics: [] } });

    const ctx = context({
      http: { fetchJson, fetchText: vi.fn() } as unknown as AdapterContext['http'],
      limit: 200,
    });

    await redflagdealsAdapter.fetch(ctx);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });
});
