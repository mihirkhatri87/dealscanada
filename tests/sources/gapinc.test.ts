import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildCategoryUrl,
  createGapIncAdapter,
  describePromo,
  isPriceRange,
  parseGapIncCategory,
  parseGapPrice,
} from '@/lib/sources/engines/gapinc';
import type { RetailerConfig } from '@/lib/sources/catalogue';

const CATEGORY = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/gapinc/category.json'), 'utf8'),
) as unknown;

const options = {
  baseUrl: 'https://oldnavy.gapcanada.ca',
  merchantDomain: 'oldnavy.ca',
  merchantName: 'Old Navy',
  departmentHint: 'girls',
};

function config(overrides: Partial<RetailerConfig> = {}): RetailerConfig {
  return {
    id: 'old-navy',
    name: 'Old Navy',
    domain: 'oldnavy.ca',
    baseUrl: 'https://oldnavy.gapcanada.ca',
    engine: 'gapinc',
    status: 'unverified',
    enabled: true,
    salePaths: ['1130530'],
    ...overrides,
  } as RetailerConfig;
}

describe('price parsing', () => {
  it('reads a plain price', () => {
    expect(parseGapPrice('$29.99')).toBe(29.99);
  });

  it('takes the low end of a range, which is a price a shopper can actually pay', () => {
    expect(parseGapPrice('$34.99 - $49.99')).toBe(34.99);
  });

  it('handles French formatting', () => {
    expect(parseGapPrice('29,99 $')).toBe(29.99);
  });

  it('returns null rather than zero on junk, because zero renders as "Free"', () => {
    for (const value of ['', 'Sale', null, undefined, '$0.00']) {
      expect(parseGapPrice(value)).toBeNull();
    }
  });

  it('recognises a range', () => {
    expect(isPriceRange('$20.00 - $30.00')).toBe(true);
    expect(isPriceRange('$20.00')).toBe(false);
  });
});

describe('parsing a category', () => {
  it('emits genuinely discounted products', () => {
    const deals = parseGapIncCategory(CATEGORY, options);
    const titles = deals.map((deal) => deal.title);

    expect(titles).toContain('Girls Frost-Free Puffer Jacket');
    expect(titles).toContain('Girls Rib-Knit Leggings');
  });

  it('drops a product whose sale price equals its regular price', () => {
    const titles = parseGapIncCategory(CATEGORY, options).map((deal) => deal.title);
    expect(titles).not.toContain('Girls Graphic Tee');
  });

  it('refuses a "discount" that is only variant spread', () => {
    // regular "$20.00 - $60.00" vs sale "$25.00 - $45.00": comparing the range
    // floor to the ceiling would invent a saving where the cheapest variant
    // actually went up.
    const titles = parseGapIncCategory(CATEGORY, options).map((deal) => deal.title);
    expect(titles).not.toContain('Girls Range-Priced Sweater');
  });

  it('compares like with like on a real range discount', () => {
    const deal = parseGapIncCategory(CATEGORY, options).find((d) => d.title.includes('Leggings'));

    expect(deal?.price).toBe(9.99);
    expect(deal?.priceWas).toBe(24.99);
  });

  it('describes a stacked promo instead of folding it into the price', () => {
    // Multiplying "extra 50% off" into $22.49 would print $11.25, a number no
    // page shows. The listed price stands and the offer is described.
    const deal = parseGapIncCategory(CATEGORY, options).find((d) => d.title.includes('Sherpa'));

    expect(deal?.price).toBe(22.49);
    expect(deal?.stockNote).toContain('EXTRA50');
    expect(deal?.stockNote).toContain('checkout');
  });

  it('distinguishes an automatic promo from a code-gated one', () => {
    const deal = parseGapIncCategory(CATEGORY, options).find((d) => d.title.includes('Joggers'));

    expect(deal?.stockNote).toContain('not included in the price shown');
    expect(deal?.stockNote).not.toMatch(/code [A-Z0-9]+/);
  });

  it('takes the department from the brand’s own navigation', () => {
    const deals = parseGapIncCategory(CATEGORY, options);
    expect(deals.every((deal) => deal.departmentHint === 'girls')).toBe(true);
  });

  it('carries the style id as an mpn and a stable source id', () => {
    const deal = parseGapIncCategory(CATEGORY, options).find((d) => d.title.includes('Puffer'));

    expect(deal?.mpn).toBe('000123456');
    expect(deal?.sourceId).toBe('oldnavy.ca:000123456');
  });

  it('resolves the image against the storefront', () => {
    const deal = parseGapIncCategory(CATEGORY, options).find((d) => d.title.includes('Puffer'));
    expect(deal?.imageUrl).toBe(
      'https://oldnavy.gapcanada.ca/webcontent/0056/123/456/cn56123456.jpg',
    );
  });

  it('collects sizes without an extra request', () => {
    const deal = parseGapIncCategory(CATEGORY, options).find((d) => d.title.includes('Puffer'));
    expect(deal?.sizesAvailable).toEqual(['XS', 'S', 'M']);
  });

  it('marks a sold-out product rather than dropping it', () => {
    const deal = parseGapIncCategory(CATEGORY, options).find((d) => d.title.includes('Sherpa'));
    expect(deal?.inStock).toBe(false);
  });

  it('skips a product with no id, which cannot be upserted stably', () => {
    const titles = parseGapIncCategory(CATEGORY, options).map((deal) => deal.title);
    expect(titles).not.toContain('Product With No Id');
  });

  it('collapses a product repeated in one response', () => {
    const jackets = parseGapIncCategory(CATEGORY, options).filter((d) =>
      d.title.includes('Puffer'),
    );
    expect(jackets).toHaveLength(1);
  });

  it('returns nothing for a shape it does not recognise', () => {
    expect(parseGapIncCategory({ unexpected: true }, options)).toEqual([]);
    expect(parseGapIncCategory(null, options)).toEqual([]);
  });
});

describe('promo description', () => {
  it('names the code when one is required', () => {
    expect(describePromo('Extra 50% off, use code SAVE50')).toContain('with code SAVE50');
  });

  it('says the offer is not in the price when it applies automatically', () => {
    expect(describePromo('Extra 40% off clearance')).toContain('not included in the price shown');
  });
});

describe('the category URL', () => {
  it('requests Canadian pricing in the configured locale', () => {
    const url = buildCategoryUrl('https://oldnavy.gapcanada.ca/', '1130530', 0, 'fr_CA');

    expect(url).toContain('/resources/productSearch/v1/search');
    expect(url).toContain('cid=1130530');
    expect(url).toContain('globalShippingCountryCode=ca');
    expect(url).toContain('globalShippingCurrencyCode=CAD');
    expect(url).toContain('locale=fr_CA');
  });
});

describe('the adapter', () => {
  function context(fetchJson: (url: string) => Promise<{ data: unknown }>) {
    return {
      http: { fetchJson: vi.fn(fetchJson), fetchText: vi.fn() },
      log: vi.fn(),
      limit: 100,
    } as never;
  }

  it('maps each category to the department the catalogue names for it', async () => {
    const result = await createGapIncAdapter(
      config({
        salePaths: ['1130530'],
        salePathDepartments: { '1130530': 'girls' },
      }),
    ).fetch(context(async () => ({ data: CATEGORY })));

    expect(result.deals.length).toBeGreaterThan(0);
    expect(result.deals.every((deal) => deal.departmentHint === 'girls')).toBe(true);
  });

  it('is skipped with an actionable reason when no categories are configured', () => {
    // Not "failed": an entry awaiting its category ids is half-configured, not
    // broken, and the message says exactly what to add.
    expect(createGapIncAdapter(config({ salePaths: [] })).enabled()).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('salePaths'),
    });
  });

  it('reports a blocked storefront rather than throwing', async () => {
    const result = await createGapIncAdapter(config()).fetch(
      context(async () => {
        throw new Error('HTTP 403');
      }),
    );

    expect(result.deals).toEqual([]);
    expect(result.reason).toContain('403');
  });

  it('is skipped when the catalogue disables it', () => {
    expect(createGapIncAdapter(config({ enabled: false })).enabled()).toMatchObject({
      enabled: false,
    });
  });
});
