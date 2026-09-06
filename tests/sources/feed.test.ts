import { describe, expect, it, vi } from 'vitest';
import {
  createFeedAdapter,
  parseDelimited,
  parseFeedPrice,
  parseProductFeed,
} from '@/lib/sources/engines/feed';
import { retailerConfigSchema } from '@/lib/sources/catalogue';
import type { AdapterContext } from '@/lib/sources/types';

const options = { merchantDomain: 'staples.ca', merchantName: 'Staples Canada' };

const config = retailerConfigSchema.parse({
  id: 'staples',
  name: 'Staples Canada',
  domain: 'staples.ca',
  baseUrl: 'https://www.staples.ca',
  engine: 'feed',
});

function context(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    http: { fetchText: vi.fn(), fetchJson: vi.fn() } as unknown as AdapterContext['http'],
    log: () => {},
    ...overrides,
  };
}

describe('parseDelimited', () => {
  it('keeps a quoted comma inside one field', () => {
    // The failure this guards: a naive split shifts every following column, so
    // a description lands where a price belongs and a wrong number reaches a
    // deal card. Product descriptions contain commas constantly.
    const rows = parseDelimited('id,title,price\n1,"Desk, Oak",199.99');
    expect(rows[0]).toMatchObject({ id: '1', title: 'Desk, Oak', price: '199.99' });
  });

  it('handles an escaped quote and an embedded newline', () => {
    const rows = parseDelimited('id,title\n1,"He said ""hi""\nand left"');
    expect(rows[0]?.title).toBe('He said "hi"\nand left');
  });

  it('detects a tab-delimited feed, which is as common as comma', () => {
    const rows = parseDelimited('id\ttitle\tprice\n7\tChair, Blue\t49.99');
    expect(rows[0]).toMatchObject({ id: '7', title: 'Chair, Blue', price: '49.99' });
  });

  it('lower-cases headers so column naming does not matter', () => {
    expect(parseDelimited('ID,Sale_Price\n1,9.99')[0]).toMatchObject({
      id: '1',
      sale_price: '9.99',
    });
  });

  it('survives a BOM, blank lines and an empty feed', () => {
    expect(parseDelimited('﻿id,title\n1,Thing\n\n')[0]).toMatchObject({ title: 'Thing' });
    expect(parseDelimited('')).toEqual([]);
    expect(parseDelimited('id,title')).toEqual([]);
  });
});

describe('parseFeedPrice', () => {
  it('reads the spec format and the shapes networks actually send', () => {
    expect(parseFeedPrice('19.99 CAD')).toBe(19.99);
    expect(parseFeedPrice('$1,299.00')).toBe(1299);
    expect(parseFeedPrice('49.99')).toBe(49.99);
  });

  it('reads a European decimal comma', () => {
    expect(parseFeedPrice('1.234,56')).toBe(1234.56);
  });

  it('rejects what is not a price rather than guessing', () => {
    expect(parseFeedPrice('')).toBeNull();
    expect(parseFeedPrice(null)).toBeNull();
    expect(parseFeedPrice('call for pricing')).toBeNull();
    expect(parseFeedPrice('0.00')).toBeNull();
  });
});

describe('parseProductFeed', () => {
  const feed = [
    'id,title,link,image_link,price,sale_price,brand,gtin,mpn,availability,description',
    '1,Ergo Chair,https://staples.ca/p/1,https://img/1.jpg,299.99 CAD,199.99 CAD,Staples,0628845123456,EC-100,in stock,"Mesh back, adjustable"',
    '2,Full Price Desk,https://staples.ca/p/2,https://img/2.jpg,449.99 CAD,,Staples,0628845999999,FD-200,in stock,Solid',
    '3,No Discount,https://staples.ca/p/3,https://img/3.jpg,50.00 CAD,50.00 CAD,Staples,,ND-1,out of stock,Same',
  ].join('\n');

  const deals = parseProductFeed(feed, options);

  it('takes only genuine markdowns, since a feed is the whole catalogue', () => {
    // Shipping the catalogue would bury every real deal on the site.
    expect(deals.map((deal) => deal.title)).toEqual(['Ergo Chair']);
  });

  it('maps sale_price to the price and price to the was', () => {
    expect(deals[0]?.price).toBe(199.99);
    expect(deals[0]?.priceWas).toBe(299.99);
  });

  it('carries the manufacturer identifiers, which is the point of the feed', () => {
    // These are what let the verification pass make any cross-merchant claim.
    expect(deals[0]?.gtin).toBe('0628845123456');
    expect(deals[0]?.mpn).toBe('EC-100');
  });

  it('keeps a quoted description intact', () => {
    expect(deals[0]?.description).toBe('Mesh back, adjustable');
  });

  it('reads availability, defaulting to in stock when the column is absent', () => {
    expect(deals[0]?.inStock).toBe(true);
    const noColumn = parseProductFeed(
      'title,link,price,sale_price\nThing,https://x/1,10.00,5.00',
      options,
    );
    expect(noColumn[0]?.inStock).toBe(true);
  });

  it('accepts a network that names its columns differently', () => {
    const alternative = [
      'sku,product_name,product_url,image_url,retail_price,discount_price,upc',
      '9,Lamp,https://staples.ca/p/9,https://img/9.jpg,80.00,40.00,0123456789012',
    ].join('\n');

    const [deal] = parseProductFeed(alternative, options);
    expect(deal?.title).toBe('Lamp');
    expect(deal?.price).toBe(40);
    expect(deal?.gtin).toBe('0123456789012');
  });

  it('skips a row with no title or no link rather than emitting a broken card', () => {
    const broken = 'id,title,link,price,sale_price\n1,,https://x/1,10,5\n2,Thing,,10,5';
    expect(parseProductFeed(broken, options)).toEqual([]);
  });
});

describe('createFeedAdapter', () => {
  it('says how to switch it on when no feed URL is configured', () => {
    expect(createFeedAdapter(config).enabled()).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('AFFILIATE_FEEDS'),
    });
  });

  it('reports a catalogue-disabled retailer as skipped, not failed', () => {
    expect(createFeedAdapter({ ...config, enabled: false }).enabled()).toMatchObject({
      enabled: false,
    });
  });

  it('returns nothing rather than throwing when unconfigured', async () => {
    const result = await createFeedAdapter(config).fetch(context());
    expect(result.deals).toEqual([]);
    expect(result.reason).toContain('no feed URL');
  });
});
