import { describe, expect, it } from 'vitest';
import { ENGINES, byFamily, runnableRetailers, validateCatalogue } from '@/lib/sources/catalogue';
import { CATALOGUE_ERRORS, RETAILER_CATALOGUE } from '@/lib/sources/catalogue-data';
import { allAdapters, resetRegistry } from '@/lib/sources/registry';

describe('catalogue validation', () => {
  it('reports every problem rather than throwing on the first', () => {
    const { valid, errors } = validateCatalogue([
      {
        id: 'good',
        name: 'Good',
        domain: 'good.ca',
        baseUrl: 'https://good.ca',
        engine: 'shopify',
      },
      {
        id: 'bad-engine',
        name: 'Bad',
        domain: 'bad.ca',
        baseUrl: 'https://bad.ca',
        engine: 'nope',
      },
      { id: 'bad-url', name: 'Bad', domain: 'b2.ca', baseUrl: 'not-a-url', engine: 'shopify' },
    ]);

    // The good entry survives: one typo must not take the catalogue offline.
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(2);
  });

  it('rejects a duplicate id, which would silently merge two retailers run history', () => {
    const { errors } = validateCatalogue([
      { id: 'x', name: 'A', domain: 'a.ca', baseUrl: 'https://a.ca', engine: 'shopify' },
      { id: 'x', name: 'B', domain: 'b.ca', baseUrl: 'https://b.ca', engine: 'shopify' },
    ]);
    expect(errors.some((e) => e.includes('duplicate id'))).toBe(true);
  });

  it('rejects a duplicate domain', () => {
    const { errors } = validateCatalogue([
      { id: 'a', name: 'A', domain: 'same.ca', baseUrl: 'https://same.ca', engine: 'shopify' },
      { id: 'b', name: 'B', domain: 'same.ca', baseUrl: 'https://same.ca/x', engine: 'shopify' },
    ]);
    expect(errors.some((e) => e.includes('duplicate domain'))).toBe(true);
  });

  it('handles a non-array input', () => {
    expect(validateCatalogue('nope').errors).toHaveLength(1);
  });
});

describe('the shipped catalogue', () => {
  it('has no validation errors', () => {
    expect(CATALOGUE_ERRORS).toEqual([]);
  });

  it('covers the target breadth of Canadian retail', () => {
    expect(RETAILER_CATALOGUE.length).toBeGreaterThanOrEqual(60);
  });

  it('declares only implemented engines', () => {
    for (const retailer of RETAILER_CATALOGUE) {
      expect(ENGINES).toContain(retailer.engine);
    }
  });

  it('groups the Canadian Tire banners into one family', () => {
    const family = byFamily(RETAILER_CATALOGUE, 'canadian-tire');
    expect(family.length).toBeGreaterThanOrEqual(8);
    expect(family.map((r) => r.id)).toEqual(
      expect.arrayContaining(['canadian-tire', 'sportchek', 'marks', 'atmosphere']),
    );
  });

  it('groups the Gap Inc. brands into one family', () => {
    const family = byFamily(RETAILER_CATALOGUE, 'gap-inc');
    expect(family.map((r) => r.id)).toEqual(
      expect.arrayContaining(['gap', 'old-navy', 'banana-republic', 'athleta']),
    );
  });

  it('groups the Reitmans brands into one family', () => {
    expect(byFamily(RETAILER_CATALOGUE, 'reitmans').map((r) => r.id)).toEqual(
      expect.arrayContaining(['reitmans', 'rw-co', 'penningtons']),
    );
  });

  it('covers every retail vertical the PRD targets', () => {
    const verticals = new Set(RETAILER_CATALOGUE.map((r) => r.vertical));
    for (const required of [
      'electronics',
      'apparel',
      'toys',
      'home',
      'grocery',
      'beauty',
      'sports',
    ]) {
      expect(verticals).toContain(required);
    }
  });

  it('keeps known-but-unsupported retailers visible rather than omitting them', () => {
    // A shopper should see that Walmart is known and why it is not live, not
    // silently find it missing from the store directory.
    const disabled = RETAILER_CATALOGUE.filter((r) => !r.enabled);
    expect(disabled.length).toBeGreaterThan(0);
    expect(disabled.every((r) => Boolean(r.note))).toBe(true);
  });

  it('excludes disabled and blocked retailers from a run', () => {
    const runnable = runnableRetailers(RETAILER_CATALOGUE);
    expect(runnable.every((r) => r.enabled && r.status !== 'blocked')).toBe(true);
    expect(runnable.length).toBeLessThan(RETAILER_CATALOGUE.length);
  });

  it('gives every JSON-LD retailer the configuration that engine needs', () => {
    for (const retailer of runnableRetailers(RETAILER_CATALOGUE)) {
      if (retailer.engine !== 'jsonld') continue;
      expect(retailer.salePaths?.length, `${retailer.id} needs salePaths`).toBeGreaterThan(0);
      expect(retailer.productLinkSelector, `${retailer.id} needs a selector`).toBeTruthy();
    }
  });
});

describe('adapter registration', () => {
  it('registers a working adapter for every runnable retailer', async () => {
    resetRegistry();
    await import('@/lib/sources/all');

    const ids = allAdapters().map((a) => a.id);

    // The two bespoke adapters plus one per runnable catalogue retailer.
    expect(ids).toContain('redflagdeals');
    expect(ids).toContain('bestbuy');
    expect(ids.filter((id) => id.startsWith('shopify:')).length).toBeGreaterThan(10);

    // Ids are unique - a collision would overwrite one source's run history.
    expect(new Set(ids).size).toBe(ids.length);
  });
});
