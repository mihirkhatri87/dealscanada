/**
 * Coupon code extraction.
 *
 * Two failure modes matter here, and they are not symmetric. Missing a code is a
 * minor loss. Showing a code that does not exist wastes someone's time at
 * checkout and makes the whole site untrustworthy — so the rules below are tuned
 * to a zero-false-positive target, and the tests enforce it explicitly.
 */

export interface CouponResult {
  code: string | null;
  /** Short human note, e.g. "Use code at checkout". */
  note: string | null;
  /** Description with the code phrase removed, so it does not read twice. */
  cleanedText: string;
}

/**
 * Patterns are ordered most- to least-specific. Each must capture the code in
 * group 1. A code is 3-20 characters of letters, digits, hyphen or underscore,
 * and must contain at least one letter or digit.
 */
const CODE = '([A-Z0-9][A-Z0-9_-]{2,19})';

const PATTERNS: RegExp[] = [
  new RegExp(`\\b(?:promo|coupon|discount|voucher)\\s*code\\s*[:=-]?\\s*${CODE}\\b`, 'i'),
  new RegExp(`\\buse\\s+(?:the\\s+)?code\\s*[:=-]?\\s*${CODE}\\b`, 'i'),
  new RegExp(`\\bwith\\s+(?:promo\\s+|coupon\\s+)?code\\s*[:=-]?\\s*${CODE}\\b`, 'i'),
  new RegExp(`\\bapply\\s+code\\s*[:=-]?\\s*${CODE}\\b`, 'i'),
  new RegExp(`\\benter\\s+code\\s*[:=-]?\\s*${CODE}\\b`, 'i'),
  new RegExp(`\\bcode\\s*[:=]\\s*${CODE}\\b`, 'i'),
  new RegExp(`\\bcode\\s+${CODE}\\s+at\\s+checkout\\b`, 'i'),
  new RegExp(`\\b${CODE}\\s+at\\s+checkout\\b`, 'i'),
  new RegExp(`\\bcoupon\\s*[:=]\\s*${CODE}\\b`, 'i'),
];

/** Phrases that explicitly say there is no code — never extract from these. */
const NEGATIONS =
  /\b(?:no|without|not?)\s+(?:promo\s+|coupon\s+|discount\s+)?code\s+(?:needed|required|necessary)\b|\bno\s+code\b|\bcode\s+not\s+required\b|\bautomatically\s+applied\b|\bno\s+coupon\b/i;

/**
 * Words that follow "code" in ordinary prose and are not codes. Without this,
 * "use code words carefully" yields the code WORDS.
 */
const STOPWORDS = new Set([
  'AT',
  'IN',
  'ON',
  'TO',
  'IS',
  'IT',
  'OR',
  'AND',
  'THE',
  'FOR',
  'YOU',
  'YOUR',
  'WILL',
  'WITH',
  'FROM',
  'THIS',
  'THAT',
  'WHEN',
  'ABOVE',
  'BELOW',
  'HERE',
  'NEEDED',
  'REQUIRED',
  'APPLIED',
  'VALID',
  'EXPIRES',
  'ONLY',
  'ALSO',
  'PLUS',
  'FREE',
  'SALE',
  'OFF',
  'NOW',
  'NEW',
  'ALL',
  'SHIPPING',
  'CHECKOUT',
  'ONLINE',
  'STORE',
  'PRICE',
  'DEAL',
  'DEALS',
  'ITEM',
  'ITEMS',
  'ORDER',
  'ORDERS',
  'CART',
  'AUTOMATICALLY',
  'WORDS',
  'WORD',
  'BASE',
  'AREA',
  'POSTAL',
  'ZIP',
  'ERROR',
  'STATUS',
  'REVIEW',
  'SOURCE',
  'QUALITY',
]);

/**
 * A candidate that looks like a model or SKU rather than a promo code.
 * Retail titles are full of these ("SM-S928W", "RTX4070"), so they must not be
 * mistaken for coupons when they happen to follow the word "code".
 */
function looksLikeModelNumber(code: string): boolean {
  // Pure digits are a quantity or a SKU, never a promo code in practice.
  if (/^\d+$/.test(code)) return true;
  // A letter-digit-letter alternation with hyphens reads as a part number.
  if (/^[A-Z]{1,3}-?\d{3,}-?[A-Z]*$/i.test(code) && code.includes('-')) return true;
  return false;
}

export function extractCoupon(text: string | null | undefined): CouponResult {
  const source = (text ?? '').trim();
  if (source === '') return { code: null, note: null, cleanedText: '' };

  if (NEGATIONS.test(source)) {
    return { code: null, note: null, cleanedText: source };
  }

  for (const pattern of PATTERNS) {
    const match = pattern.exec(source);
    const raw = match?.[1];
    if (!match || !raw) continue;

    const code = raw.toUpperCase().replace(/[.,;:!?]+$/, '');

    if (STOPWORDS.has(code)) continue;
    if (looksLikeModelNumber(code)) continue;
    // A code must carry at least one letter; "1234" alone is not a promo code.
    if (!/[A-Z]/.test(code)) continue;

    const cleanedText = source.replace(match[0], '').replace(/\s{2,}/g, ' ').trim();

    return {
      code,
      note: 'Use code at checkout',
      cleanedText,
    };
  }

  return { code: null, note: null, cleanedText: source };
}

/** Convenience for the pipeline: searches title first, then description. */
export function extractCouponFrom(
  title: string,
  description?: string | null,
): CouponResult & { source: 'title' | 'description' | null } {
  const fromTitle = extractCoupon(title);
  if (fromTitle.code) return { ...fromTitle, source: 'title' };

  const fromDescription = extractCoupon(description);
  if (fromDescription.code) return { ...fromDescription, source: 'description' };

  return { code: null, note: null, cleanedText: description ?? '', source: null };
}
