import { describe, expect, it } from 'vitest';
import { computeDiscount, formatCents, parsePriceToCents } from '@/lib/util/money';

describe('parsePriceToCents', () => {
  it.each([
    // English Canadian conventions
    ['$19.99', 1999],
    ['19.99', 1999],
    ['$1,299.99', 129999],
    ['$1,299', 129900],
    ['CAD 99', 9900],
    ['CAD$ 49.50', 4950],
    ['$0.99', 99],
    ['1299.99', 129999],
    ['$9,999,999.99', 999999999],

    // French Canadian conventions — both appear on .ca sites
    ['1 299,99 $', 129999],
    ['19,99 $', 1999],
    ['1299,99', 129999],

    // European thousands separator
    ['1.299,99', 129999],

    // Free
    ['Free', 0],
    ['free', 0],
    ['gratuit', 0],
    ['$0.00', 0],

    // Whitespace and decoration
    ['  $49.99  ', 4999],
    ['Now $49.99', 4999],
    ['Sale: $15', 1500],
  ])('parses %s to %i cents', (input, expected) => {
    expect(parsePriceToCents(input)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['not a price'],
    ['2026-01-15'],
    ['01/15/2026'],
    ['SKU12345'],
    [null],
    [undefined],
  ])('rejects %s', (input) => {
    expect(parsePriceToCents(input as string)).toBeNull();
  });

  it('rejects negative and implausible values', () => {
    expect(parsePriceToCents(-5)).toBeNull();
    // Beyond a plausible retail price, a "number" is a parse error, not a listing.
    expect(parsePriceToCents('99999999999')).toBeNull();
    expect(parsePriceToCents('$12,345,678.90')).toBeNull();
  });

  it('accepts numbers without floating point drift', () => {
    // The reason money is integer cents: 19.99 * 100 is not 1999 in IEEE 754.
    expect(parsePriceToCents(19.99)).toBe(1999);
    expect(parsePriceToCents(0.1 + 0.2)).toBe(30);
  });

  it('takes the first price from a multi-price string', () => {
    expect(parsePriceToCents('$30 for 2')).toBe(3000);
    expect(parsePriceToCents('2 for $30')).toBe(200);
  });

  it('does not merge two separate numbers across stripped words', () => {
    // Stripping letters leaves whitespace; "30 for 2" must not become 302.
    expect(parsePriceToCents('30 for 2')).toBe(3000);
    expect(parsePriceToCents('Buy 2 get 100 free')).toBe(200);
  });
});

describe('formatCents', () => {
  it('formats whole and fractional amounts', () => {
    expect(formatCents(1999)).toBe('$19.99');
    expect(formatCents(129999)).toBe('$1,299.99');
  });

  it('drops trailing zeroes only when the amount is whole dollars', () => {
    expect(formatCents(5000)).toBe('$50');
    expect(formatCents(4999)).toBe('$49.99');
  });

  it('renders free and unknown distinctly', () => {
    expect(formatCents(0)).toBe('Free');
    expect(formatCents(null)).toBe('—');
    expect(formatCents(undefined)).toBe('—');
  });
});

describe('computeDiscount', () => {
  it('computes percentage and absolute discount', () => {
    const result = computeDiscount(4999, 9999);
    expect(result.discountPct).toBeCloseTo(50, 0);
    expect(result.discountAbs).toBe(5000);
    expect(result.priceWas).toBe(9999);
  });

  it('never invents a before price when one is missing', () => {
    expect(computeDiscount(4999, null)).toEqual({
      discountPct: null,
      discountAbs: null,
      priceWas: null,
    });
    expect(computeDiscount(null, 9999).priceWas).toBeNull();
  });

  it('discards a before price that is not above the current price', () => {
    expect(computeDiscount(5000, 5000).priceWas).toBeNull();
    expect(computeDiscount(5000, 4000).priceWas).toBeNull();
  });

  it('discards an implausible near-total discount as a data error', () => {
    // A $0.99 item against a $999 "MSRP" is a placeholder or a cents/dollars mixup.
    expect(computeDiscount(99, 99900).priceWas).toBeNull();
  });

  it('keeps a steep but believable discount', () => {
    const result = computeDiscount(1000, 10000); // 90% off
    expect(result.discountPct).toBe(90);
    expect(result.priceWas).toBe(10000);
  });

  it('rounds the percentage to one decimal', () => {
    expect(computeDiscount(6667, 10000).discountPct).toBe(33.3);
  });
});
