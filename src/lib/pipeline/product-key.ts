/**
 * Product identity across merchants.
 *
 * Cross-merchant price comparison is only as good as the matching underneath it.
 * Saying "this TV is cheaper at Best Buy than Walmart" requires being certain it
 * is the *same* TV — so identity is resolved from strongest evidence to weakest,
 * and the confidence is recorded alongside it. A weak match must never be
 * presented with the same authority as a GTIN match.
 */

export type IdentityStrength = 'gtin' | 'mpn' | 'asin' | 'model' | 'title' | 'none';

export interface ProductIdentity {
  /** Stable key grouping the same product across merchants, or null. */
  key: string | null;
  strength: IdentityStrength;
}

export interface IdentityInput {
  title: string;
  brand?: string | null;
  /** GTIN/EAN/UPC as published in JSON-LD or a Shopify barcode field. */
  gtin?: string | null;
  /** Manufacturer part number. */
  mpn?: string | null;
  asin?: string | null;
  /** Retailer's own SKU. Deliberately NOT used: it is merchant-scoped. */
  sku?: string | null;
}

/** GTIN-8/12/13/14 with a valid check digit. */
export function isValidGtin(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(digits.length)) return false;

  const body = digits.slice(0, -1).split('').reverse();
  const check = Number(digits.slice(-1));

  let sum = 0;
  body.forEach((digit, index) => {
    sum += Number(digit) * (index % 2 === 0 ? 3 : 1);
  });

  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Extracts a model number from a title.
 *
 * Retail titles carry them in a recognizable shape: mixed letters and digits,
 * usually 4+ characters ("QN65QN90D", "WH-1000XM5", "RTX4070"). Pure words and
 * pure numbers are excluded, since those are descriptions and quantities.
 */
export function extractModelToken(title: string): string | null {
  const candidates = title
    .split(/[\s,()[\]]+/)
    .map((token) => token.replace(/[^A-Za-z0-9-]/g, ''))
    .filter((token) => token.length >= 4 && token.length <= 24);

  for (const token of candidates) {
    const hasLetter = /[A-Za-z]/.test(token);
    const hasDigit = /\d/.test(token);
    if (!hasLetter || !hasDigit) continue;

    // Exclude capacity/size/measurement tokens - they describe a variant, not a model.
    if (/^\d+(?:gb|tb|mb|kg|lb|ml|oz|cm|mm|in|ft|hz|w|k|pc|pk|ct)$/i.test(token)) continue;
    if (/^(?:\d+k|\d+p|\d+hz|\d+w)$/i.test(token)) continue;
    // Exclude years.
    if (/^(?:19|20)\d{2}$/.test(token)) continue;

    return token.toUpperCase();
  }

  return null;
}

/** Normalizes a brand for use inside a key. */
function normalizeBrand(brand: string | null | undefined): string | null {
  if (!brand) return null;
  const cleaned = brand
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return cleaned.length >= 2 ? cleaned : null;
}

/**
 * Resolves a product identity, strongest evidence first.
 *
 * Note what is deliberately absent: the retailer's own SKU. A SKU is unique to
 * one merchant, so keying on it would put the same product in two groups and
 * silently defeat the entire comparison.
 */
export function resolveProductIdentity(input: IdentityInput): ProductIdentity {
  const gtin = input.gtin?.replace(/\D/g, '');
  if (gtin && isValidGtin(gtin)) {
    // Normalize to 14 digits so a UPC-12 and its EAN-13 form match.
    return { key: `gtin:${gtin.padStart(14, '0')}`, strength: 'gtin' };
  }

  if (input.asin && /^[A-Z0-9]{10}$/i.test(input.asin)) {
    return { key: `asin:${input.asin.toUpperCase()}`, strength: 'asin' };
  }

  const brand = normalizeBrand(input.brand);

  if (input.mpn) {
    const mpn = input.mpn.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (mpn.length >= 3) {
      // Scope by brand where known: two manufacturers can reuse a part number.
      return { key: brand ? `mpn:${brand}:${mpn}` : `mpn:${mpn}`, strength: 'mpn' };
    }
  }

  const model = extractModelToken(input.title);
  if (model && brand) {
    return { key: `model:${brand}:${model}`, strength: 'model' };
  }
  if (model) {
    return { key: `model:${model}`, strength: 'model' };
  }

  return { key: null, strength: 'none' };
}

/**
 * Whether an identity is strong enough to justify a cross-merchant price claim.
 *
 * A title-shaped match is fine for collapsing duplicate listings on the front
 * page, but not for telling someone "this is cheaper than everywhere else" - that
 * assertion needs an identifier the manufacturer assigned.
 */
export function isComparableIdentity(strength: IdentityStrength): boolean {
  return strength === 'gtin' || strength === 'asin' || strength === 'mpn';
}
