/**
 * Money parsing.
 *
 * Everything is integer cents. Floats are never used for money: 19.99 * 100 is
 * 1998.9999999999998 in IEEE 754, and a deal site that is a cent off on a third of
 * its listings is worse than useless.
 *
 * Canadian sources publish prices in both English and French conventions, so both
 * "$1,299.99" and "1 299,99 $" have to parse to the same 129999.
 */

/** Rejects strings that merely contain digits but are not prices. */
const OBVIOUS_NON_PRICE =
  /^(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|[a-z]{2,}\d+[a-z]*)$/i;

/**
 * Parses a price into integer cents, or null when the input is not a price.
 * Returns 0 for an explicit "free".
 */
export function parsePriceToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;

  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    return Math.round(input * 100);
  }

  const raw = input.trim();
  if (raw === '') return null;

  if (/^(free|gratuit|no charge|\$0(?:\.00)?)$/i.test(raw)) return 0;
  if (OBVIOUS_NON_PRICE.test(raw)) return null;

  // Strip currency markers and words, keeping only numeric punctuation.
  let cleaned = raw
    .replace(/(?:CAD|CDN|USD|EUR|\$|€|£)/gi, ' ')
    .replace(/[^\d.,\s-]/g, ' ')
    .trim();

  if (cleaned === '') return null;

  // Take the first number-like run. A separator only continues the number when it
  // introduces a group of exactly three digits ("1,299", "1 299", "1.299"), or is
  // the decimal mark. Stripping letters leaves whitespace between separate numbers,
  // so without that rule "30 for 2" would parse as 302.
  const match = /-?\d+(?:[.,\u00A0 ]\d{3})*(?:[.,]\d+)?/.exec(cleaned);
  if (!match) return null;
  cleaned = match[0].trim();

  const normalized = normalizeNumericString(cleaned);
  if (normalized === null) return null;

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;

  // A price beyond this is almost certainly a parse error, not a real listing.
  if (value > 10_000_000) return null;

  return Math.round(value * 100);
}

/**
 * Resolves thousands separators and the decimal mark across conventions:
 *   "1,299.99" (en)  "1 299,99" (fr)  "1.299,99" (eu)  "1299" (bare)
 */
function normalizeNumericString(input: string): string | null {
  const value = input.replace(/\s/g, '');
  if (value === '' || value === '-') return null;

  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');

  if (lastComma === -1 && lastDot === -1) return value;

  if (lastComma > lastDot) {
    // Comma is the decimal mark: dots (if any) are thousands separators.
    const decimals = value.length - lastComma - 1;
    // "1,234" with three trailing digits is a thousands separator, not a decimal.
    if (decimals === 3 && lastDot === -1 && !/^\d{1,3},\d{3}$/.test(value)) {
      return value.replace(/,/g, '');
    }
    if (decimals === 3 && /^\d{1,3},\d{3}$/.test(value)) {
      return value.replace(/,/g, '');
    }
    return value.replace(/\./g, '').replace(',', '.');
  }

  // Dot is the decimal mark: commas are thousands separators.
  const decimals = value.length - lastDot - 1;
  if (decimals === 3 && lastComma === -1 && /^\d{1,3}\.\d{3}$/.test(value)) {
    // Ambiguous "1.234" — European thousands separator.
    return value.replace(/\./g, '');
  }
  return value.replace(/,/g, '');
}

/** Formats integer cents as Canadian currency for display. */
export function formatCents(cents: number | null | undefined, currency = 'CAD'): string {
  if (cents === null || cents === undefined) return '—';
  if (cents === 0) return 'Free';

  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export interface DiscountResult {
  discountPct: number | null;
  discountAbs: number | null;
  /** A before price we are willing to stand behind, or null. */
  priceWas: number | null;
}

/**
 * Computes a discount, refusing to invent one.
 *
 * A "was" price that is absent, not above the current price, or implies an
 * implausible discount is discarded rather than displayed. Showing a fake anchor
 * price is the single most misleading thing a deal site can do.
 */
export function computeDiscount(priceNow: number | null, priceWas: number | null): DiscountResult {
  if (priceNow === null || priceWas === null) {
    return { discountPct: null, discountAbs: null, priceWas: null };
  }
  if (priceWas <= priceNow || priceWas <= 0 || priceNow < 0) {
    return { discountPct: null, discountAbs: null, priceWas: null };
  }

  const discountAbs = priceWas - priceNow;
  const discountPct = (discountAbs / priceWas) * 100;

  // A 99.5%+ "discount" is a data error (a placeholder MSRP, a cents/dollars mixup)
  // far more often than it is a real offer.
  if (discountPct >= 99.5) {
    return { discountPct: null, discountAbs: null, priceWas: null };
  }

  return {
    discountPct: Math.round(discountPct * 10) / 10,
    discountAbs,
    priceWas,
  };
}
