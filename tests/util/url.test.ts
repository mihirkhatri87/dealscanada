import { describe, expect, it } from 'vitest';
import {
  applyAffiliateTemplate,
  canonicalizeUrl,
  extractAsin,
  extractDomain,
} from '@/lib/util/url';

describe('canonicalizeUrl', () => {
  it('collapses the same product URL carrying different tracking params', () => {
    const a = canonicalizeUrl(
      'https://www.bestbuy.ca/en-ca/product/12345?utm_source=rfd&utm_campaign=x',
    );
    const b = canonicalizeUrl('https://bestbuy.ca/en-ca/product/12345?gclid=abc&fbclid=def');
    const c = canonicalizeUrl('http://www.bestbuy.ca/en-ca/product/12345#reviews');

    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('strips www and forces https', () => {
    expect(canonicalizeUrl('http://www.example.ca/p/1')).toBe('https://example.ca/p/1');
  });

  it('drops the fragment and any credentials', () => {
    expect(canonicalizeUrl('https://example.ca/p/1#section')).toBe('https://example.ca/p/1');
    expect(canonicalizeUrl('https://user:pass@example.ca/p/1')).toBe('https://example.ca/p/1');
  });

  it('keeps parameters that actually identify the product', () => {
    const result = canonicalizeUrl('https://example.ca/p?sku=999&utm_source=x&color=blue');
    expect(result).toContain('sku=999');
    expect(result).toContain('color=blue');
    expect(result).not.toContain('utm_source');
  });

  it('sorts remaining parameters so order cannot fork the canonical form', () => {
    const a = canonicalizeUrl('https://example.ca/p?b=2&a=1');
    const b = canonicalizeUrl('https://example.ca/p?a=1&b=2');
    expect(a).toBe(b);
  });

  it('normalizes a trailing slash', () => {
    expect(canonicalizeUrl('https://example.ca/p/1/')).toBe('https://example.ca/p/1');
    // The bare root keeps its slash — it is not a path segment.
    expect(canonicalizeUrl('https://example.ca/')).toBe('https://example.ca/');
  });

  it('drops default ports', () => {
    expect(canonicalizeUrl('https://example.ca:443/p')).toBe('https://example.ca/p');
  });

  it('strips the Amazon affiliate tag but keeps it elsewhere', () => {
    expect(canonicalizeUrl('https://www.amazon.ca/dp/B0ABCDEFGH?tag=someone-20')).toBe(
      'https://amazon.ca/dp/B0ABCDEFGH',
    );
    // On an unrelated host, `tag` may be a real product parameter.
    expect(canonicalizeUrl('https://shop.ca/p?tag=winter')).toContain('tag=winter');
  });

  it('unwraps a RedFlagDeals redirect to the real destination', () => {
    const wrapped =
      'https://forums.redflagdeals.com/lmg.php?url=https%3A%2F%2Fwww.bestbuy.ca%2Fen-ca%2Fproduct%2F999';
    expect(canonicalizeUrl(wrapped)).toBe('https://bestbuy.ca/en-ca/product/999');
  });

  it('unwraps nested affiliate redirects', () => {
    const inner = encodeURIComponent('https://www.oldnavy.ca/p/123');
    const wrapped = `https://go.redirectingat.com/?url=${inner}`;
    expect(canonicalizeUrl(wrapped)).toBe('https://oldnavy.ca/p/123');
  });

  it('returns non-URL input unchanged rather than throwing', () => {
    expect(canonicalizeUrl('not a url')).toBe('not a url');
    expect(canonicalizeUrl('  /relative/path  ')).toBe('/relative/path');
  });

  it('leaves non-http schemes alone', () => {
    expect(canonicalizeUrl('ftp://example.ca/file')).toBe('ftp://example.ca/file');
  });

  it('is idempotent', () => {
    const once = canonicalizeUrl('https://www.example.ca/p/1?utm_source=x&b=2&a=1');
    expect(canonicalizeUrl(once)).toBe(once);
  });
});

describe('extractDomain', () => {
  it.each([
    ['https://www.bestbuy.ca/en-ca/product/1', 'bestbuy.ca'],
    ['https://shop.canadiantire.ca/x', 'canadiantire.ca'],
    ['https://oldnavy.gapcanada.ca/browse', 'gapcanada.ca'],
    ['https://example.co.uk/p', 'example.co.uk'],
    ['https://example.ca', 'example.ca'],
  ])('extracts %s -> %s', (input, expected) => {
    expect(extractDomain(input)).toBe(expected);
  });

  it('returns null for unparseable input', () => {
    expect(extractDomain('nonsense')).toBeNull();
  });
});

describe('extractAsin', () => {
  it.each([
    ['https://www.amazon.ca/dp/B0ABCDEFGH', 'B0ABCDEFGH'],
    ['https://www.amazon.ca/dp/B0ABCDEFGH?tag=x', 'B0ABCDEFGH'],
    ['https://www.amazon.ca/gp/product/B01234ABCD/', 'B01234ABCD'],
    ['https://www.amazon.ca/Some-Product-Name/dp/B0ABCDEFGH/ref=sr_1_1', 'B0ABCDEFGH'],
    ['https://ca.camelcamelcamel.com/product/B0ABCDEFGH', 'B0ABCDEFGH'],
  ])('extracts an ASIN from %s', (input, expected) => {
    expect(extractAsin(input)).toBe(expected);
  });

  it('returns null when there is no ASIN', () => {
    expect(extractAsin('https://www.bestbuy.ca/en-ca/product/12345')).toBeNull();
    expect(extractAsin('https://www.amazon.ca/dp/TOOSHORT')).toBeNull();
  });

  it('uppercases a lowercase ASIN', () => {
    expect(extractAsin('https://amazon.ca/dp/b0abcdefgh')).toBe('B0ABCDEFGH');
  });
});

describe('applyAffiliateTemplate', () => {
  it('returns the plain URL when no template is configured', () => {
    expect(applyAffiliateTemplate('https://example.ca/p', null)).toBe('https://example.ca/p');
  });

  it('ignores a template with no placeholder', () => {
    expect(applyAffiliateTemplate('https://example.ca/p', 'https://aff.example/go')).toBe(
      'https://example.ca/p',
    );
  });

  it('substitutes the URL into the template', () => {
    const result = applyAffiliateTemplate('https://example.ca/p', 'https://aff.test/go?u={url}');
    expect(result).toContain('https%3A%2F%2Fexample.ca%2Fp');
  });
});
