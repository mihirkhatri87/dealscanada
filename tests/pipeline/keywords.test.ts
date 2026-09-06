import { describe, expect, it } from 'vitest';
import { deriveKeywords, serializeKeywords } from '@/lib/pipeline/keywords';

/**
 * Search matches the words a merchant chose; shoppers type the words they use.
 * Structube sells a table called "MARCO Console", so a search for "table"
 * returned nothing and the deal may as well not have been in the database.
 */
describe('deriveKeywords', () => {
  it('calls a console table a table', () => {
    expect(deriveKeywords({ title: 'MARCO Console table' })).toContain('table');
    expect(deriveKeywords({ title: 'HENRI Sideboard' })).toContain('table');
    expect(deriveKeywords({ title: 'LOU Nightstand' })).toContain('table');
  });

  it('reads the description when the title is only a product name', () => {
    // Structube names products and describes them separately, so the noun that
    // matters is often nowhere in the title.
    const keywords = deriveKeywords({
      title: 'MARCO',
      description: 'A walnut console with two drawers for an entryway.',
    });

    expect(keywords).toContain('table');
  });

  it('does not call a games console a table', () => {
    // "Console" is the trade term for a table and also a games machine. The
    // furniture patterns require furniture context precisely so this stays out.
    expect(deriveKeywords({ title: 'PlayStation 5 console bundle' })).not.toContain('table');
  });

  it('covers the words shoppers actually use for seating and storage', () => {
    expect(deriveKeywords({ title: 'ROMY Sectional' })).toContain('sofa');
    expect(deriveKeywords({ title: 'Leather loveseat' })).toContain('sofa');
    expect(deriveKeywords({ title: 'Velvet pouf' })).toContain('chair');
    expect(deriveKeywords({ title: 'Oak étagère' })).toContain('storage');
    expect(deriveKeywords({ title: 'Media unit, 60 inch' })).toContain('storage');
    expect(deriveKeywords({ title: 'Queen duvet cover' })).toContain('bedding');
  });

  it('says nothing about a product it has no vocabulary for', () => {
    // Silence is correct here. A wrong keyword is worse than none: it puts a
    // product in front of someone who searched for something else.
    expect(deriveKeywords({ title: 'Instant Pot Duo 6-quart' })).toEqual([]);
  });

  it('is stable and deduplicated, so an unchanged product looks unchanged', () => {
    const once = deriveKeywords({ title: 'Dining table and 4 chairs' });
    const twice = deriveKeywords({ title: 'Dining table and 4 chairs' });

    expect(once).toEqual(twice);
    expect(once).toEqual([...new Set(once)].sort());
  });
});

describe('serializeKeywords', () => {
  it('pads so a search cannot match the middle of a word', () => {
    // '% table %' cannot match inside 'comfortable'.
    expect(serializeKeywords(['table', 'storage'])).toBe(' table storage ');
  });

  it('stores nothing rather than an empty string', () => {
    expect(serializeKeywords([])).toBeNull();
  });
});
