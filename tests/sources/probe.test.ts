import { describe, expect, it } from 'vitest';
import {
  buildCatalogueEntry,
  detectPlatform,
  findSalePaths,
  findShopifyCollections,
} from '@/lib/sources/probe';

/**
 * Onboarding a retailer has to be a config change, or coverage stops scaling.
 * This is the tool that makes that true, so its detection is pinned against a
 * fingerprint per platform plus the case that matters most: a site it cannot
 * recognise, where a confident wrong answer is worse than an honest "no".
 */

describe('platform detection', () => {
  it('treats a product array at /products.json as conclusive', () => {
    // Nothing but Shopify serves that, so it outranks every page marker.
    const result = detectPlatform({ html: '<html>no markers at all</html>', productsJsonOk: true });

    expect(result.engine).toBe('shopify');
    expect(result.evidence[0]).toContain('products.json');
  });

  it('recognises Shopify from page markers alone', () => {
    expect(detectPlatform({ html: '<p>Powered by Shopify</p>' }).engine).toBe('shopify');
    expect(detectPlatform({ html: '<img src="https://cdn.shopify.com/x.jpg">' }).engine).toBe(
      'shopify',
    );
  });

  it('recognises SFCC and recovers the site id, which the engine needs', () => {
    const result = detectPlatform({
      html: '<form action="/on/demandware.store/Sites-ExampleCA-Site/en_CA/Search-Show"></form>',
    });

    expect(result.engine).toBe('sfcc');
    expect(result.hints['sfccSiteId']).toBe('ExampleCA');
  });

  it('recognises SFCC from its session cookie', () => {
    expect(detectPlatform({ html: '<html></html>', cookies: ['dwsid'] }).engine).toBe('sfcc');
  });

  it('recognises Gap Inc., Canadian Tire, WordPress and Magento', () => {
    expect(detectPlatform({ html: '<a href="https://oldnavy.ca/x">x</a>' }).engine).toBe('gapinc');
    expect(detectPlatform({ html: 'apim.canadiantire.ca' }).engine).toBe('hybris');
    expect(detectPlatform({ html: '<link href="/wp-content/themes/x.css">' }).engine).toBe(
      'wordpress',
    );
    expect(detectPlatform({ html: '<script src="/static/version1234/x.js">' }).engine).toBe(
      'magento',
    );
  });

  it('does not read "image/" in an asset path as a Magento marker', () => {
    // `mage/` without a word boundary matches inside "image/", which appears in
    // the asset URLs of practically every storefront. Every unrecognised site
    // came back Magento and never reached the JSON-LD fallback.
    const result = detectPlatform({
      html: '<img src="/static/image/logo.png"><script type="application/ld+json">{}</script>',
    });

    expect(result.engine).toBe('jsonld');
  });

  it('still recognises a real mage/ module path', () => {
    expect(detectPlatform({ html: '<script src="/js/mage/apply/main.js">' }).engine).toBe('magento');
  });

  it('offers JSON-LD as a fallback when it recognises nothing but sees structured data', () => {
    const result = detectPlatform({
      html: '<script type="application/ld+json">{"@type":"Product"}</script>',
    });

    expect(result.engine).toBe('jsonld');
    expect(result.evidence[0]).toContain('no platform recognised');
  });

  it('says it does not know rather than guessing', () => {
    // A confident wrong platform produces a catalogue entry that 404s forever.
    const result = detectPlatform({ html: '<html><body>Hello</body></html>' });

    expect(result.engine).toBeNull();
    expect(result.evidence[0]).toContain('no platform fingerprints');
  });
});

describe('finding sale paths', () => {
  const html = `
    <nav>
      <a href="/en/sale.html">Sale</a>
      <a href="/clearance">Clearance</a>
      <a href="/fr/solde">Solde</a>
      <a href="/about-us">About</a>
      <a href="https://other-site.ca/sale">Elsewhere</a>
      <a href="/en/sale/womens/coats/product-12345">A product inside sale</a>
    </nav>`;

  it('takes paths the navigation actually links to', () => {
    // Guessing /sale and hoping is how an entry ends up 404ing forever.
    const paths = findSalePaths(html, 'https://www.example.ca');

    expect(paths).toContain('/en/sale.html');
    expect(paths).toContain('/clearance');
    expect(paths).toContain('/fr/solde');
  });

  it('ignores unrelated links and other origins', () => {
    const paths = findSalePaths(html, 'https://www.example.ca');

    expect(paths).not.toContain('/about-us');
    expect(paths.some((path) => path.includes('other-site'))).toBe(false);
  });

  it('ignores deep product links inside a sale section', () => {
    // Those are items, not entry points.
    const paths = findSalePaths(html, 'https://www.example.ca');
    expect(paths).not.toContain('/en/sale/womens/coats/product-12345');
  });

  it('returns nothing for junk rather than throwing', () => {
    expect(findSalePaths('', 'not a url')).toEqual([]);
    expect(findSalePaths('<html></html>', 'https://x.ca')).toEqual([]);
  });
});

describe('finding Shopify collections', () => {
  it('keeps only the discount-shaped handles', () => {
    const handles = findShopifyCollections(`
      <a href="/collections/sale">Sale</a>
      <a href="/collections/new-arrivals">New</a>
      <a href="/collections/final-sale">Final</a>
    `);

    expect(handles).toContain('sale');
    expect(handles).toContain('final-sale');
    expect(handles).not.toContain('new-arrivals');
  });
});

describe('the emitted entry', () => {
  it('derives an id, name and domain from the URL', () => {
    const entry = buildCatalogueEntry(
      'https://www.somestore.ca/',
      { engine: 'shopify', evidence: [], hints: {} },
      ['sale'],
    );

    expect(entry).toMatchObject({
      id: 'somestore',
      domain: 'somestore.ca',
      baseUrl: 'https://www.somestore.ca',
      engine: 'shopify',
      status: 'unverified',
      salePaths: ['sale'],
    });
  });

  it('carries an SFCC site id through', () => {
    const entry = buildCatalogueEntry(
      'https://www.somestore.ca',
      { engine: 'sfcc', evidence: [], hints: { sfccSiteId: 'SomeStoreCA' } },
      [],
    );

    expect(entry?.sfccSiteId).toBe('SomeStoreCA');
  });

  it('marks the JSON-LD selector as unfinished rather than inventing one', () => {
    // No probe can infer a good selector. A visible TODO beats an entry that
    // looks complete and silently returns nothing.
    const entry = buildCatalogueEntry(
      'https://www.somestore.ca',
      { engine: 'jsonld', evidence: [], hints: {} },
      ['/sale'],
    );

    expect(entry?.productLinkSelector).toContain('TODO');
  });

  it('emits nothing when no platform was recognised', () => {
    expect(
      buildCatalogueEntry('https://x.ca', { engine: null, evidence: [], hints: {} }, []),
    ).toBeNull();
  });

  it('produces an entry the catalogue schema accepts', async () => {
    // The tool is worthless if what it prints does not validate.
    const { validateCatalogue } = await import('@/lib/sources/catalogue');
    const entry = buildCatalogueEntry(
      'https://www.somestore.ca',
      { engine: 'shopify', evidence: [], hints: {} },
      ['sale'],
    );

    const { errors, valid } = validateCatalogue([entry]);
    expect(errors).toEqual([]);
    expect(valid).toHaveLength(1);
  });
});
