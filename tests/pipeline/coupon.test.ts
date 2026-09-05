import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractCoupon, extractCouponFrom } from '@/lib/pipeline/coupon';

interface Fixture {
  withCode: Array<{ text: string; code: string }>;
  withoutCode: Array<{ text: string }>;
}

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/pipeline/coupons.json'), 'utf8'),
) as Fixture;

describe('extractCoupon', () => {
  it('meets the recall floor on the labelled coupon set', () => {
    const misses: string[] = [];

    for (const item of fixture.withCode) {
      const result = extractCoupon(item.text);
      if (result.code !== item.code) {
        misses.push(`"${item.text}" -> expected ${item.code}, got ${result.code ?? 'null'}`);
      }
    }

    const recall = (fixture.withCode.length - misses.length) / fixture.withCode.length;
    if (recall < 0.9) {
      throw new Error(
        `Coupon recall ${(recall * 100).toFixed(1)}% is below the 90% floor.\n  ${misses.join('\n  ')}`,
      );
    }
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });

  it('produces ZERO false positives on the no-coupon set', () => {
    // Non-negotiable: a fabricated code wastes someone's time at checkout and
    // costs the whole site its credibility. There is no acceptable rate above 0.
    const falsePositives = fixture.withoutCode
      .map((item) => ({ text: item.text, code: extractCoupon(item.text).code }))
      .filter((result) => result.code !== null);

    expect(
      falsePositives,
      `Fabricated codes:\n  ${falsePositives.map((f) => `"${f.text}" -> ${f.code}`).join('\n  ')}`,
    ).toEqual([]);
  });

  it('uppercases and trims trailing punctuation', () => {
    expect(extractCoupon('use code save20.').code).toBe('SAVE20');
    expect(extractCoupon('use code winter25,').code).toBe('WINTER25');
  });

  it('honours explicit negations', () => {
    expect(extractCoupon('50% off, no code needed').code).toBeNull();
    expect(extractCoupon('Discount applied automatically').code).toBeNull();
    expect(extractCoupon('No coupon required').code).toBeNull();
  });

  it('rejects model and part numbers that follow the word code', () => {
    expect(extractCoupon('Dell XPS, model code 9530').code).toBeNull();
    expect(extractCoupon('Error code 404').code).toBeNull();
  });

  it('strips the code phrase from the text so it does not read twice', () => {
    const result = extractCoupon('Extra 25% off with promo code SAVE25 this weekend');
    expect(result.cleanedText).not.toContain('SAVE25');
    expect(result.cleanedText).toContain('Extra 25% off');
  });

  it('attaches a usable note alongside the code', () => {
    expect(extractCoupon('use code SAVE20').note).toBe('Use code at checkout');
    expect(extractCoupon('no code needed').note).toBeNull();
  });

  it('handles empty and absent input', () => {
    expect(extractCoupon('').code).toBeNull();
    expect(extractCoupon(null).code).toBeNull();
    expect(extractCoupon(undefined).code).toBeNull();
  });
});

describe('extractCouponFrom', () => {
  it('prefers a code in the title over one in the description', () => {
    const result = extractCouponFrom('Use code TITLE20', 'Use code BODY10');
    expect(result.code).toBe('TITLE20');
    expect(result.source).toBe('title');
  });

  it('falls back to the description', () => {
    const result = extractCouponFrom('Winter coat sale', 'Use code BODY10 at checkout');
    expect(result.code).toBe('BODY10');
    expect(result.source).toBe('description');
  });

  it('reports no source when neither carries a code', () => {
    const result = extractCouponFrom('Winter coat sale', 'Now 40% off');
    expect(result.code).toBeNull();
    expect(result.source).toBeNull();
  });
});
