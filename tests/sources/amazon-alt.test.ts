import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { amazonAltAdapter, parseCamelFeed } from '@/lib/sources/amazon-alt';

const FEED = readFileSync(join(__dirname, '../fixtures/amazon/camel-drops.xml'), 'utf8');

/**
 * The constraint that matters most here is not what this adapter parses — it is
 * what it never requests. Scraping amazon.ca HTML violates their terms, so the
 * prohibition is enforced by a test rather than left to whoever edits next.
 */

describe('never touching amazon.ca', () => {
  it('issues no request to an amazon.ca URL', async () => {
    const requested: string[] = [];
    const fetchText = vi.fn(async (url: string) => {
      requested.push(url);
      return { data: FEED };
    });

    await amazonAltAdapter.fetch({
      http: { fetchText, fetchJson: vi.fn() },
      log: vi.fn(),
      limit: 50,
    } as never);

    expect(requested.length).toBeGreaterThan(0);
    for (const url of requested) {
      expect(url, `must not request ${url}`).not.toMatch(/amazon\.(ca|com)/i);
    }
  });

  it('still produces canonical amazon.ca links for the shopper', async () => {
    // Building the URL from the ASIN is the point: the shopper gets a working
    // link, and we get there without following one.
    const result = await amazonAltAdapter.fetch({
      http: { fetchText: vi.fn(async () => ({ data: FEED })), fetchJson: vi.fn() },
      log: vi.fn(),
      limit: 50,
    } as never);

    expect(result.deals.length).toBeGreaterThan(0);
    for (const deal of result.deals) {
      expect(deal.url).toMatch(/^https:\/\/www\.amazon\.ca\/dp\/[A-Z0-9]{10}$/);
    }
  });
});

describe('parsing the drops feed', () => {
  it('extracts both prices from prose, since the feed has no price fields', () => {
    const deal = parseCamelFeed(FEED).find((d) => d.title.includes('WH-1000XM5'));

    expect(deal?.price).toBe(328);
    expect(deal?.priceWas).toBe(549.99);
  });

  it('reads a plain dollar amount as well as the CDN$ form', () => {
    const deal = parseCamelFeed(FEED).find((d) => d.title.includes('Instant Pot'));

    expect(deal?.price).toBe(89.99);
    expect(deal?.priceWas).toBe(139.99);
  });

  it('drops an entry with no before price rather than asserting a drop', () => {
    // A drop feed entry that states one number cannot support the claim it makes.
    const titles = parseCamelFeed(FEED).map((d) => d.title);
    expect(titles).not.toContain('Kindle Paperwhite 16GB');
  });

  it('drops an entry with no ASIN, which would be unmergeable', () => {
    const titles = parseCamelFeed(FEED).map((d) => d.title);
    expect(titles).not.toContain('Mystery Item With No ASIN');
  });

  it('never emits a price rise as a drop', () => {
    const titles = parseCamelFeed(FEED).map((d) => d.title);
    expect(titles).not.toContain('Price Went Up Item');
  });

  it('collapses the same ASIN appearing twice', () => {
    const sony = parseCamelFeed(FEED).filter((d) => d.asin === 'B09XS7JWHH');
    expect(sony).toHaveLength(1);
  });

  it('carries the ASIN, which is what makes an Amazon deal comparable', () => {
    // Without it the row cannot be matched against the same product at Best Buy
    // or Walmart, which is the whole basis of the verification engine.
    const deal = parseCamelFeed(FEED).find((d) => d.title.includes('WH-1000XM5'));
    expect(deal?.asin).toBe('B09XS7JWHH');
  });

  it('says the price is third-party on every single deal', () => {
    // Amazon reprices faster than any feed refreshes. Presenting a tracker's
    // snapshot as a confirmed current price would be this site's most common lie.
    const deals = parseCamelFeed(FEED);
    expect(deals.length).toBeGreaterThan(0);
    for (const deal of deals) {
      expect(deal.stockNote).toContain('confirm on Amazon');
    }
  });

  it('strips the percentage the feed appends to headlines', () => {
    const deal = parseCamelFeed(FEED).find((d) => d.asin === 'B09XS7JWHH');
    expect(deal?.title).toBe('Sony WH-1000XM5 Wireless Headphones');
  });

  it('takes an image from an enclosure or an embedded tag', () => {
    const deals = parseCamelFeed(FEED);
    expect(deals.find((d) => d.title.includes('Instant Pot'))?.imageUrl).toContain('/y.jpg');
    expect(deals.find((d) => d.title.includes('WH-1000XM5'))?.imageUrl).toContain('/x.jpg');
  });

  it('returns nothing for junk rather than throwing', () => {
    expect(parseCamelFeed('')).toEqual([]);
    expect(parseCamelFeed('<rss><channel></channel></rss>')).toEqual([]);
    expect(parseCamelFeed('not xml at all')).toEqual([]);
  });
});

describe('the adapter', () => {
  it('reports unreachable feeds rather than throwing', async () => {
    const result = await amazonAltAdapter.fetch({
      http: {
        fetchText: vi.fn(async () => {
          throw new Error('HTTP 403');
        }),
        fetchJson: vi.fn(),
      },
      log: vi.fn(),
    } as never);

    expect(result.deals).toEqual([]);
    expect(result.reason).toContain('403');
  });

  it('dedupes across the two overlapping feeds', async () => {
    // Both feeds are top-drop lists over the same catalogue, so overlap is the
    // normal case rather than an edge one.
    const result = await amazonAltAdapter.fetch({
      http: { fetchText: vi.fn(async () => ({ data: FEED })), fetchJson: vi.fn() },
      log: vi.fn(),
      limit: 50,
    } as never);

    const asins = result.deals.map((deal) => deal.asin);
    expect(new Set(asins).size).toBe(asins.length);
  });
});
