import { describe, expect, it, vi } from 'vitest';
import {
  createJsonLdAdapter,
  extractJsonLdNodes,
  extractProductLinks,
  parseOpenGraph,
  parseProductPage,
} from '@/lib/sources/engines/jsonld';
import { retailerConfigSchema } from '@/lib/sources/catalogue';
import type { AdapterContext } from '@/lib/sources/types';

const options = {
  url: 'https://canadacomputers.com/product/123',
  merchantDomain: 'canadacomputers.com',
  merchantName: 'Canada Computers',
};

function page(jsonLd: string): string {
  return `<!doctype html><html><head>
    <script type="application/ld+json">${jsonLd}</script>
  </head><body></body></html>`;
}

describe('extractJsonLdNodes', () => {
  it('reads a plain object node', () => {
    const nodes = extractJsonLdNodes(page('{"@type":"Product","name":"A"}'));
    expect(nodes).toHaveLength(1);
  });

  it('reads an array of nodes', () => {
    const nodes = extractJsonLdNodes(
      page('[{"@type":"Product","name":"A"},{"@type":"Organization","name":"B"}]'),
    );
    expect(nodes).toHaveLength(2);
  });

  it('unwraps an @graph container', () => {
    const nodes = extractJsonLdNodes(
      page('{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"A"}]}'),
    );
    expect(nodes).toHaveLength(1);
  });

  it('skips a malformed block without losing the good ones', () => {
    const html = `<html><head>
      <script type="application/ld+json">{ this is not json </script>
      <script type="application/ld+json">{"@type":"Product","name":"Good"}</script>
    </head></html>`;
    expect(extractJsonLdNodes(html)).toHaveLength(1);
  });

  it('returns nothing for a page with no JSON-LD', () => {
    expect(extractJsonLdNodes('<html><body>nothing</body></html>')).toEqual([]);
  });
});

describe('parseProductPage', () => {
  it('parses a standard Product with a single offer', () => {
    const deal = parseProductPage(
      page(
        JSON.stringify({
          '@type': 'Product',
          name: 'Samsung 65" QN90D Neo QLED TV',
          description: 'A television',
          image: 'https://cdn.test/tv.jpg',
          brand: { '@type': 'Brand', name: 'Samsung' },
          gtin13: '4006381333931',
          mpn: 'QN65QN90D',
          sku: 'CC-9981',
          offers: {
            '@type': 'Offer',
            price: '1499.99',
            priceCurrency: 'CAD',
            availability: 'https://schema.org/InStock',
          },
        }),
      ),
      options,
    );

    expect(deal?.title).toContain('Samsung');
    expect(deal?.price).toBe('1499.99');
    expect(deal?.brand).toBe('Samsung');
    expect(deal?.gtin).toBe('4006381333931');
    expect(deal?.mpn).toBe('QN65QN90D');
    expect(deal?.inStock).toBe(true);
    expect(deal?.sourceId).toBe('canadacomputers.com:CC-9981');
  });

  it('never fabricates a before price from JSON-LD', () => {
    // schema.org has no standard "was" price. Inventing one from strikethrough
    // markup is exactly the fake anchor this project refuses to publish.
    const deal = parseProductPage(
      page(
        JSON.stringify({
          '@type': 'Product',
          name: 'Thing',
          offers: { price: '10.00' },
        }),
      ),
      options,
    );
    expect(deal?.priceWas).toBeNull();
  });

  it('handles an array of offers', () => {
    const deal = parseProductPage(
      page(
        JSON.stringify({
          '@type': 'Product',
          name: 'Thing',
          offers: [
            { price: '99.99', availability: 'https://schema.org/OutOfStock' },
            { price: '89.99' },
          ],
        }),
      ),
      options,
    );
    expect(deal?.price).toBe('99.99');
  });

  it('uses lowPrice from an AggregateOffer', () => {
    const deal = parseProductPage(
      page(
        JSON.stringify({
          '@type': 'Product',
          name: 'Thing',
          offers: { '@type': 'AggregateOffer', lowPrice: '45.00', highPrice: '90.00' },
        }),
      ),
      options,
    );
    expect(deal?.price).toBe('45.00');
  });

  it('accepts an array @type containing Product', () => {
    const deal = parseProductPage(
      page(JSON.stringify({ '@type': ['Product', 'Thing'], name: 'X', offers: { price: '5' } })),
      options,
    );
    expect(deal?.title).toBe('X');
  });

  it('marks out-of-stock availability correctly', () => {
    const deal = parseProductPage(
      page(
        JSON.stringify({
          '@type': 'Product',
          name: 'Thing',
          offers: { price: '10', availability: 'https://schema.org/OutOfStock' },
        }),
      ),
      options,
    );
    expect(deal?.inStock).toBe(false);
  });

  it('falls back to OpenGraph when JSON-LD has no usable product', () => {
    const html = `<html><head>
      <meta property="og:title" content="OG Winter Coat" />
      <meta property="og:image" content="https://cdn.test/coat.jpg" />
      <meta property="product:price:amount" content="79.99" />
      <meta property="product:price:currency" content="CAD" />
      <meta property="product:availability" content="in stock" />
    </head></html>`;

    const deal = parseProductPage(html, options);
    expect(deal?.title).toBe('OG Winter Coat');
    expect(deal?.price).toBe('79.99');
    expect(deal?.inStock).toBe(true);
  });

  it('returns null when neither JSON-LD nor OpenGraph is usable', () => {
    expect(parseProductPage('<html><body>nothing</body></html>', options)).toBeNull();
    expect(
      parseProductPage(page(JSON.stringify({ '@type': 'Product', name: 'No price' })), options),
    ).toBeNull();
  });

  // schema.org tells a retailer to publish ProductGroup for anything sold in
  // several sizes or colours, and the offers then sit on the variants rather
  // than the group. Altitude Sports and The Last Hunt both ship this shape.
  const productGroup = {
    '@type': 'ProductGroup',
    name: 'Ultride Vest',
    image: 'https://cdn.example/vest.jpg',
    brand: { name: 'Café du Cycliste' },
    hasVariant: [
      {
        '@type': 'Product',
        name: 'Ultride Vest - L',
        sku: 'VEST-L',
        gtin13: '7630326407943',
        offers: { '@type': 'Offer', price: 336.99, priceCurrency: 'CAD', availability: 'InStock' },
      },
      {
        '@type': 'Product',
        name: 'Ultride Vest - S',
        sku: 'VEST-S',
        gtin13: '7630326407950',
        offers: { '@type': 'Offer', price: 299.99, priceCurrency: 'CAD', availability: 'InStock' },
      },
    ],
  };

  it('reads a ProductGroup, whose prices live on its variants', () => {
    const deal = parseProductPage(page(JSON.stringify(productGroup)), options);

    // The group's name and image, the chosen variant's price and identity.
    expect(deal?.title).toBe('Ultride Vest');
    expect(deal?.price).toBe(299.99);
    expect(deal?.gtin).toBe('7630326407950');
    expect(deal?.imageUrl).toBe('https://cdn.example/vest.jpg');
  });

  it('prefers an in-stock variant over a cheaper sold-out one', () => {
    const soldOutIsCheaper = {
      ...productGroup,
      hasVariant: [
        {
          '@type': 'Product',
          name: 'Vest - XL',
          sku: 'VEST-XL',
          offers: { price: 250, priceCurrency: 'CAD', availability: 'https://schema.org/InStock' },
        },
        {
          '@type': 'Product',
          name: 'Vest - XS',
          sku: 'VEST-XS',
          offers: {
            price: 99,
            priceCurrency: 'CAD',
            availability: 'https://schema.org/OutOfStock',
          },
        },
      ],
    };

    // $99 is not a price anybody can pay.
    expect(parseProductPage(page(JSON.stringify(soldOutIsCheaper)), options)?.price).toBe(250);
  });

  it('still prefers a group offer when the group carries one itself', () => {
    const withOwnOffer = {
      ...productGroup,
      offers: { '@type': 'Offer', price: 199, priceCurrency: 'CAD' },
    };

    expect(parseProductPage(page(JSON.stringify(withOwnOffer)), options)?.price).toBe(199);
  });
});

describe('parseOpenGraph', () => {
  it('needs both a title and a price', () => {
    expect(
      parseOpenGraph('<meta property="og:title" content="Only a title" />', options),
    ).toBeNull();
  });
});

describe('extractProductLinks', () => {
  it('resolves relative links against the base URL and de-duplicates', () => {
    const html = `<html><body>
      <a class="product" href="/product/1">One</a>
      <a class="product" href="/product/1">One again</a>
      <a class="product" href="https://canadacomputers.com/product/2">Two</a>
      <a class="other" href="/not-a-product">No</a>
    </body></html>`;

    const links = extractProductLinks(html, 'https://canadacomputers.com', 'a.product');
    expect(links).toHaveLength(2);
    expect(links).toContain('https://canadacomputers.com/product/1');
  });

  it('skips malformed hrefs rather than throwing', () => {
    const html = '<a class="product" href="ht!tp://bad">x</a>';
    expect(() => extractProductLinks(html, 'https://x.ca', 'a.product')).not.toThrow();
  });
});

describe('createJsonLdAdapter', () => {
  const config = retailerConfigSchema.parse({
    id: 'canada-computers',
    name: 'Canada Computers',
    domain: 'canadacomputers.com',
    baseUrl: 'https://www.canadacomputers.com',
    engine: 'jsonld',
    salePaths: ['/en/promotions'],
    productLinkSelector: 'a.product-link',
    maxProductPages: 3,
  });

  it('reports missing configuration as skipped rather than failing', () => {
    expect(createJsonLdAdapter({ ...config, productLinkSelector: null }).enabled()).toMatchObject({
      enabled: false,
    });
    expect(createJsonLdAdapter({ ...config, salePaths: null }).enabled()).toMatchObject({
      enabled: false,
    });
  });

  it('keeps going when one listing path has been retired', async () => {
    // Entries here list several sale sections and retailers retire them all the
    // time. A stale path used to throw out of the loop and take the whole
    // retailer with it, even though a later path still worked.
    const fetchText = vi.fn(async (url: string) => {
      if (url.includes('/en/gone')) throw new Error('HTTP 404');
      if (url.includes('/en/live')) {
        return { data: '<a class="product-link" href="/en/p/1">One</a>' };
      }
      return {
        data: `<script type="application/ld+json">${JSON.stringify({
          '@type': 'Product',
          name: 'Graphics Card',
          offers: { price: 499.99, priceCurrency: 'CAD' },
        })}</script>`,
      };
    });

    const result = await createJsonLdAdapter({
      ...config,
      salePaths: ['/en/gone', '/en/live'],
    }).fetch({
      http: {
        fetchText,
        setDomainRate: vi.fn(),
      } as unknown as AdapterContext['http'],
      log: () => {},
    });

    expect(result.deals.map((deal) => deal.title)).toEqual(['Graphics Card']);
  });

  it('says the listings were unreachable rather than blaming the markup', async () => {
    const fetchText = vi.fn().mockRejectedValue(new Error('HTTP 404'));

    const result = await createJsonLdAdapter(config).fetch({
      http: { fetchText, setDomainRate: vi.fn() } as unknown as AdapterContext['http'],
      log: () => {},
    });

    expect(result.deals).toEqual([]);
    expect(result.reason).toContain('no listing reachable');
  });

  it('honours robots.txt on every request, unlike the API engines', async () => {
    const fetchText = vi.fn().mockResolvedValue({ data: '<html></html>' });
    const setDomainRate = vi.fn();

    await createJsonLdAdapter(config).fetch({
      http: { fetchText, setDomainRate } as unknown as AdapterContext['http'],
      log: () => {},
    });

    // No call passes skipRobots — this engine crawls, so it must be gated.
    for (const call of fetchText.mock.calls) {
      expect(call[1]?.skipRobots).toBeFalsy();
    }
  });

  it('applies a per-retailer rate limit when configured', async () => {
    const setDomainRate = vi.fn();
    const fetchText = vi.fn().mockResolvedValue({ data: '<html></html>' });

    await createJsonLdAdapter({ ...config, rateLimitRps: 0.25 }).fetch({
      http: { fetchText, setDomainRate } as unknown as AdapterContext['http'],
      log: () => {},
    });

    expect(setDomainRate).toHaveBeenCalledWith('canadacomputers.com', 0.25);
  });

  it('caps the number of product pages fetched per run', async () => {
    const listing = `<html><body>${Array.from(
      { length: 50 },
      (_, i) => `<a class="product-link" href="/p/${i}">x</a>`,
    ).join('')}</body></html>`;

    const fetchText = vi.fn().mockResolvedValue({ data: listing });
    const setDomainRate = vi.fn();

    await createJsonLdAdapter(config).fetch({
      http: { fetchText, setDomainRate } as unknown as AdapterContext['http'],
      log: () => {},
      limit: 100,
    });

    // One listing fetch plus at most maxProductPages product fetches.
    expect(fetchText.mock.calls.length).toBeLessThanOrEqual(1 + 3);
  });

  it('survives a page that fails to fetch', async () => {
    const listing =
      '<a class="product-link" href="/p/1">x</a><a class="product-link" href="/p/2">y</a>';
    const good = page(JSON.stringify({ '@type': 'Product', name: 'Good', offers: { price: '9' } }));

    const fetchText = vi
      .fn()
      .mockResolvedValueOnce({ data: listing })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: good });

    const result = await createJsonLdAdapter(config).fetch({
      http: { fetchText, setDomainRate: vi.fn() } as unknown as AdapterContext['http'],
      log: () => {},
    });

    expect(result.deals).toHaveLength(1);
  });

  it('reports drifted markup distinctly from an empty listing', async () => {
    const listing = '<a class="product-link" href="/p/1">x</a>';
    const fetchText = vi
      .fn()
      .mockResolvedValueOnce({ data: listing })
      .mockResolvedValue({ data: '<html><body>no markup</body></html>' });

    const result = await createJsonLdAdapter(config).fetch({
      http: { fetchText, setDomainRate: vi.fn() } as unknown as AdapterContext['http'],
      log: () => {},
    });

    expect(result.deals).toEqual([]);
    expect(result.reason).toContain('markup may have changed');
  });
});
