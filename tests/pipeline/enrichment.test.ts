import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { classifyCategory, classifyDepartment, extractBrand } from '@/lib/pipeline/classify';
import { normalizeDeal } from '@/lib/pipeline/normalize';
import { createShopifyAdapter } from '@/lib/sources/engines/shopify';
import type { RetailerConfig } from '@/lib/sources/catalogue';

/**
 * Department and brand decide whether a shopper can find anything. "50% off" is
 * meaningless if it is not their size or their section, so these carry accuracy
 * floors rather than a handful of illustrative cases.
 */

interface Labelled {
  title: string;
  expected: string;
  merchant?: string;
}

const CASES = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/pipeline/apparel-departments.json'), 'utf8'),
) as Labelled[];

describe('department classification', () => {
  it('clears the accuracy floor on the labelled set', () => {
    let correct = 0;
    const misses: string[] = [];

    for (const testCase of CASES) {
      const category = classifyCategory({ title: testCase.title });
      const got = classifyDepartment({
        title: testCase.title,
        category,
        merchantSlug: testCase.merchant ?? null,
      });

      if (got === testCase.expected) correct += 1;
      else misses.push(`${testCase.title} → ${got}, expected ${testCase.expected}`);
    }

    const accuracy = correct / CASES.length;
    expect(accuracy, `misses:\n${misses.join('\n')}`).toBeGreaterThanOrEqual(0.9);
  });

  it('prefers what the engine said over anything it could infer', () => {
    // The retailer's own navigation is better evidence than our keywords, always.
    expect(
      classifyDepartment({ title: "Men's Jacket", sourceHint: 'girls', category: 'clothing' }),
    ).toBe('girls');
  });

  it('lets the title outrank a single-department merchant', () => {
    // Penningtons is a womenswear retailer, but a title saying "boys" is better
    // evidence than an assumption about the store.
    expect(classifyDepartment({ title: "Boys' Winter Coat", merchantSlug: 'penningtons' })).toBe(
      'boys',
    );
  });

  it('uses the merchant when the title says nothing', () => {
    expect(classifyDepartment({ title: 'Quilted Vest', merchantSlug: 'penningtons' })).toBe(
      'women',
    );
  });

  it('reads a garment that names its own department', () => {
    // A blouse is not filed under unisex by any retailer, and leaving it there
    // is how someone filtering for womenswear misses half of it.
    for (const title of ['Wrap Front Blouse', 'Ribbed Bodysuit', 'Brushed Jersey Nightgown']) {
      expect(classifyDepartment({ title }), title).toBe('women');
    }
  });

  it('recognises baby gear that never says "baby"', () => {
    for (const title of ['One4Life Convertible Car Seat', 'Organic Cotton Crib Sheet']) {
      expect(classifyDepartment({ title }), title).toBe('baby');
    }
  });

  it('leaves non-apparel alone rather than inventing a department', () => {
    for (const title of ['65" Neo QLED Smart TV', 'Cordless Drill Combo Kit']) {
      expect(classifyDepartment({ title, category: 'electronics' }), title).toBe('na');
    }
  });
});

describe('brand extraction', () => {
  it('recovers a brand from a title when no field carried one', () => {
    expect(extractBrand('Sony WH-1000XM5 Wireless Headphones')).toBe('Sony');
    expect(extractBrand('LEGO Star Wars Millennium Falcon 75375')).toBe('LEGO');
    expect(extractBrand('Instant Pot Duo Plus 6QT')).toBe('Instant Pot');
  });

  it('prefers the longest match, so a stray word does not win', () => {
    expect(extractBrand('The North Face Nuptse Jacket')).toBe('The North Face');
  });

  it('anchors on word boundaries', () => {
    // "Applesauce" is not Apple, and a substring match would file it under one.
    expect(extractBrand('Motts Applesauce 24-Pack')).toBeNull();
    expect(extractBrand('Sonyx Generic Earbuds')).toBeNull();
  });

  it('returns null rather than guessing', () => {
    expect(extractBrand('Generic Winter Coat')).toBeNull();
    expect(extractBrand('')).toBeNull();
  });

  it('clears the coverage floor on a realistic title set', () => {
    const titles = [
      'Sony WH-1000XM5 Wireless Headphones',
      'LEGO Star Wars Millennium Falcon',
      'Instant Pot Duo Plus 6QT',
      'DEWALT 20V MAX Cordless Drill',
      'Michelin X-Ice Snow Winter Tire',
      'Graco Modes Pramette Travel System',
      'Nike Air Max 90 Sneakers',
      'Columbia Powder Lite Insulated Jacket',
      'Dyson V15 Detect Cordless Vacuum',
      'CeraVe Moisturizing Cream 454g',
    ];

    const found = titles.filter((title) => extractBrand(title) !== null).length;
    expect(found / titles.length).toBeGreaterThanOrEqual(0.8);
  });
});

describe('normalization wiring', () => {
  function normalize(raw: Partial<Parameters<typeof normalizeDeal>[0]>) {
    return normalizeDeal(
      {
        sourceId: 's',
        title: 'Sony WH-1000XM5 Wireless Headphones',
        url: 'https://www.bestbuy.ca/en-ca/product/1',
        ...raw,
      } as Parameters<typeof normalizeDeal>[0],
      {
        source: 'test',
        resolveMerchant: () => ({ id: 'm', slug: 'best-buy' }),
      },
    );
  }

  it('never lets an inferred brand override the one an engine supplied', () => {
    // The engine read a field; we read a string. The field wins.
    expect(normalize({ brand: 'Sony Electronics' }).deal?.brand).toBe('Sony Electronics');
  });

  it('fills the brand in when no engine supplied one', () => {
    expect(normalize({}).deal?.brand).toBe('Sony');
  });

  it('feeds the recovered brand into product identity', () => {
    // This is why it matters: brand plus model is what lets the verification
    // pass compare the same product across merchants.
    const withBrand = normalize({ mpn: 'WH1000XM5' }).deal;
    expect(withBrand?.productKey).toBeTruthy();
  });
});

describe('sizes cost nothing extra', () => {
  it('collects sizes without issuing another request', async () => {
    // A per-product request for a nice-to-have field would multiply the traffic
    // this project sends every retailer by its catalogue size.
    const products = {
      products: [
        {
          id: 1,
          title: 'Merino Crew',
          handle: 'merino-crew',
          options: [{ name: 'Size', values: ['S', 'M', 'L'] }],
          variants: [
            { id: 11, price: '59.99', compare_at_price: '120.00', available: true, option1: 'S' },
            { id: 12, price: '59.99', compare_at_price: '120.00', available: true, option1: 'M' },
          ],
          images: [{ src: 'https://cdn.test/x.jpg' }],
        },
      ],
    };

    const fetchJson = vi.fn(async () => ({ data: products }));
    const config = {
      id: 'x',
      name: 'X',
      domain: 'x.ca',
      baseUrl: 'https://x.ca',
      engine: 'shopify',
      status: 'unverified',
      enabled: true,
      salePaths: ['sale'],
    } as RetailerConfig;

    const result = await createShopifyAdapter(config).fetch({
      http: { fetchJson, fetchText: vi.fn() },
      log: vi.fn(),
      limit: 10,
    } as never);

    expect(result.deals[0]?.sizesAvailable).toEqual(['S', 'M']);
    // One request for the collection, and nothing else.
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
});
