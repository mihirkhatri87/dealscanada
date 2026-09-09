import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  amazonAltAdapter,
  amazonImageUrl,
  isRealImage,
  parseCamelFeed,
} from '@/lib/sources/amazon-alt';

const FEED = readFileSync(join(__dirname, '../fixtures/amazon/camel-drops.xml'), 'utf8');

/**
 * The constraint that matters most here is not what this adapter parses — it is
 * what it never requests. Scraping amazon.ca HTML violates their terms, so the
 * prohibition is enforced by a test rather than left to whoever edits next.
 */

/** A real rendition: JPEG, and far too big to be the placeholder. */
const REAL_IMAGE = {
  status: 200,
  headers: { 'content-type': 'image/jpeg', 'content-length': '19718' },
};

/**
 * What Amazon serves for an ASIN that has no image: 200, not 404, carrying a
 * 43-byte transparent GIF. The status code is useless here, which is the whole
 * reason isRealImage exists.
 */
const PLACEHOLDER_IMAGE = {
  status: 200,
  headers: { 'content-type': 'image/gif', 'content-length': '43' },
};

type HeadResult = { status: number; headers: Record<string, string> };

function makeContext(options: { head?: (url: string) => HeadResult; feed?: string } = {}) {
  const requested: string[] = [];

  const http = {
    fetchText: vi.fn(async (url: string) => {
      requested.push(url);
      return { data: options.feed ?? FEED };
    }),
    fetchJson: vi.fn(),
    setDomainRate: vi.fn(),
    head: vi.fn(async (url: string) => {
      requested.push(url);
      return options.head ? options.head(url) : REAL_IMAGE;
    }),
  };

  return { requested, http, context: { http, log: vi.fn(), limit: 50 } as never };
}

describe('never touching amazon.ca', () => {
  it('requests only the tracker feed and the image CDN', async () => {
    // Stated as an allowlist rather than a denylist. The adapter gained a second
    // host when it started resolving images, and "no amazon.ca" alone would not
    // have said which other hosts are acceptable.
    const allowed = new Set(['ca.camelcamelcamel.com', 'm.media-amazon.com']);
    const { requested, context } = makeContext();

    await amazonAltAdapter.fetch(context);

    expect(requested.length).toBeGreaterThan(0);
    for (const url of requested) {
      expect(new URL(url).hostname, `must not request ${url}`).toSatisfy((host: string) =>
        allowed.has(host),
      );
    }
  });

  it('issues no request to an amazon storefront host', async () => {
    // media-amazon.com is a different registrable domain from amazon.com, and
    // serves static assets rather than pages. The distinction is the entire
    // basis on which the image lookup is permitted, so it is asserted, not
    // assumed: this must keep failing for www.amazon.ca and www.amazon.com.
    const { requested, context } = makeContext();

    await amazonAltAdapter.fetch(context);

    expect(requested.length).toBeGreaterThan(0);
    for (const url of requested) {
      expect(new URL(url).hostname, `must not request ${url}`).not.toMatch(
        /(^|\.)amazon\.(ca|com)$/i,
      );
    }
  });

  it('asks the image CDN for images and nothing else', async () => {
    const { requested, context } = makeContext();

    await amazonAltAdapter.fetch(context);

    const cdn = requested.filter((url) => new URL(url).hostname === 'm.media-amazon.com');
    expect(cdn.length).toBeGreaterThan(0);
    for (const url of cdn) {
      expect(new URL(url).pathname).toMatch(/^\/images\//);
    }
  });

  it('still produces canonical amazon.ca links for the shopper', async () => {
    // Building the URL from the ASIN is the point: the shopper gets a working
    // link, and we get there without following one.
    const { context } = makeContext();
    const result = await amazonAltAdapter.fetch(context);

    expect(result.deals.length).toBeGreaterThan(0);
    for (const deal of result.deals) {
      expect(deal.url).toMatch(/^https:\/\/www\.amazon\.ca\/dp\/[A-Z0-9]{10}$/);
    }
  });
});

describe('resolving the image the feed does not carry', () => {
  it('names the image from the ASIN', () => {
    expect(amazonImageUrl('B0F9LMQ5VM')).toBe(
      'https://m.media-amazon.com/images/P/B0F9LMQ5VM.01._SCLZZZZZZZ_.jpg',
    );
  });

  it('fills in an image for a feed entry that states none', async () => {
    const { context } = makeContext();
    const result = await amazonAltAdapter.fetch(context);

    const deal = result.deals.find((d) => d.asin === 'B0F9LMQ5VM');
    expect(deal?.imageUrl).toBe(
      'https://m.media-amazon.com/images/P/B0F9LMQ5VM.01._SCLZZZZZZZ_.jpg',
    );
  });

  it('rejects the placeholder rather than storing an image that paints nothing', async () => {
    const { context } = makeContext({ head: () => PLACEHOLDER_IMAGE });
    const result = await amazonAltAdapter.fetch(context);

    expect(result.deals.length).toBeGreaterThan(0);
    // The two fixture entries that carry their own image keep it; nothing else
    // may end up pointing at the CDN, because every probe came back a placeholder.
    for (const deal of result.deals) {
      expect(deal.imageUrl ?? '', `${deal.asin} kept a placeholder`).not.toContain(
        'm.media-amazon.com',
      );
    }
    expect(result.deals.find((d) => d.asin === 'B0F9LMQ5VM')?.imageUrl).toBeNull();
  });

  it('prefers an image the feed does supply over the constructed one', async () => {
    // The feed's own URL is already known to be the right product; ours is
    // inferred from the ASIN. Free and authoritative beats constructed.
    const { requested, context } = makeContext();
    const result = await amazonAltAdapter.fetch(context);

    const deal = result.deals.find((d) => d.asin === 'B075CYMYK6');
    expect(deal?.imageUrl).toContain('/img/B075CYMYK6.jpg');
    expect(requested).not.toContain(amazonImageUrl('B075CYMYK6'));
  });

  it('leaves the image null when the probe fails, rather than failing the run', async () => {
    const { context } = makeContext({
      head: () => {
        throw new Error('ECONNRESET');
      },
    });

    const result = await amazonAltAdapter.fetch(context);

    expect(result.deals.length).toBeGreaterThan(0);
    expect(result.deals.find((d) => d.asin === 'B0F9LMQ5VM')?.imageUrl).toBeNull();
  });

  it('reads content-type and size, because the status code says 200 either way', () => {
    expect(isRealImage(200, REAL_IMAGE.headers)).toBe(true);
    expect(isRealImage(200, PLACEHOLDER_IMAGE.headers)).toBe(false);

    // Size alone is enough when the type is unhelpful, and vice versa.
    expect(isRealImage(200, { 'content-type': 'image/jpeg', 'content-length': '43' })).toBe(false);
    expect(isRealImage(200, { 'content-type': 'image/jpeg' })).toBe(true);
    expect(isRealImage(200, { 'content-type': 'text/html', 'content-length': '9000' })).toBe(false);
    expect(isRealImage(404, REAL_IMAGE.headers)).toBe(false);
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

  it('strips the live "- down N% ($X) to $Y from $Z" suffix', () => {
    // The prices are parsed out of this suffix, so it has to survive extraction
    // and be dropped only for display.
    const deals = parseCamelFeed(FEED);

    expect(deals.find((d) => d.asin === 'B0GKTYTY3J')?.title).toBe('Zootopia 2');
    expect(deals.find((d) => d.asin === 'B0F9LMQ5VM')?.title).toBe(
      'Conair Handheld Steamer for Cl...ousehold Fabrics, 1100W, Black',
    );
  });

  it('reads both prices out of the title, which is the only place they appear', () => {
    const deal = parseCamelFeed(FEED).find((d) => d.asin === 'B0F9LMQ5VM');

    expect(deal?.price).toBe(25.23);
    expect(deal?.priceWas).toBe(31.99);
  });

  it('takes an image from an enclosure or an embedded tag when one is present', () => {
    // Neither live feed carries either form today - see the fixture header. This
    // pins the precedence for the day one of them does.
    const deals = parseCamelFeed(FEED);
    expect(deals.find((d) => d.title.includes('Instant Pot'))?.imageUrl).toContain(
      '/img/B075CYMYK6.jpg',
    );
    expect(deals.find((d) => d.title.includes('WH-1000XM5'))?.imageUrl).toContain(
      '/img/B09XS7JWHH.jpg',
    );
  });

  it('carries no image for a real feed entry, because the feed states none', () => {
    // The symptom that started this: every Amazon card rendered as bare merchant
    // initials. Asserted on a verbatim entry so it stays true to the live shape.
    const deal = parseCamelFeed(FEED).find((d) => d.asin === 'B0F9LMQ5VM');
    expect(deal).toBeDefined();
    expect(deal?.imageUrl).toBeNull();
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
    const { context } = makeContext();
    const result = await amazonAltAdapter.fetch(context);

    const asins = result.deals.map((deal) => deal.asin);
    expect(new Set(asins).size).toBe(asins.length);
  });
});
