import type { DealVerdict, DealWithRelations, EvidenceLevel } from './db/types';

export { formatCents } from './util/money';

/**
 * Presentation helpers shared by every surface.
 *
 * Kept out of the components so the wording of a verdict — the most
 * consequential text on the page — is defined once and testable.
 */

export interface VerdictPresentation {
  label: string;
  /** Drives colour and stripe: good, caution or warning. */
  tone: 'good' | 'neutral' | 'caution' | 'alert';
  /** Short enough to sit on a card. */
  short: string;
}

const VERDICTS: Record<DealVerdict, VerdictPresentation> = {
  'verified-low': { label: 'Lowest we’ve recorded', tone: 'good', short: 'Record low' },
  'verified-good': { label: 'Verified below market', tone: 'good', short: 'Below market' },
  'market-price': { label: 'About the usual price', tone: 'neutral', short: 'Usual price' },
  'above-market': { label: 'Cheaper elsewhere', tone: 'caution', short: 'Cheaper elsewhere' },
  'inflated-anchor': { label: 'Inflated “was” price', tone: 'alert', short: 'Inflated claim' },
  unverified: { label: 'Retailer’s claim only', tone: 'neutral', short: 'Unverified' },
};

export function presentVerdict(verdict: DealVerdict): VerdictPresentation {
  return VERDICTS[verdict] ?? VERDICTS.unverified;
}

export function presentEvidence(evidence: EvidenceLevel): string {
  switch (evidence) {
    case 'strong':
      return 'Checked against other stores and our price history';
    case 'moderate':
      return 'Partially corroborated';
    case 'none':
      return 'Not yet corroborated';
  }
}

/**
 * How confidently the discount badge should be styled.
 *
 * A corroborated saving earns the deal colour. An uncorroborated one is still
 * shown - it is what the retailer claims and hiding it would be its own
 * distortion - but in a neutral tone, because dressing an unchecked claim in the
 * same green as a verified one is exactly the visual sleight of hand this
 * product exists to stop.
 */
export function discountConfidence(deal: DealWithRelations): 'verified' | 'claimed' {
  return deal.marketDiscountPct !== null && deal.marketDiscountPct > 0 ? 'verified' : 'claimed';
}

/**
 * The percentage the card should lead with.
 *
 * Prefers the market-corroborated figure, and returns null for a flagged anchor
 * so a misleading claim never gets a headline number.
 */
export function headlineDiscount(deal: DealWithRelations): number | null {
  if (deal.verdict === 'inflated-anchor') return null;
  if (deal.marketDiscountPct !== null && deal.marketDiscountPct > 0) {
    return Math.round(deal.marketDiscountPct);
  }
  if (deal.discountPct !== null && deal.discountPct > 0) return Math.round(deal.discountPct);
  return null;
}

/**
 * Whether the struck-through "was" price may be shown.
 *
 * Suppressed on a flagged anchor: repeating the number beside the real price is
 * the very presentation that makes fake discounts work.
 */
export function showsPriceWas(deal: DealWithRelations): boolean {
  return deal.priceWas !== null && deal.verdict !== 'inflated-anchor';
}

/** "2 hours ago", "3 days ago" — coarse on purpose; precision adds nothing here. */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';

  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;

  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? 'month' : 'months'} ago`;
}

/** "Ends in 6 hours" / "Ends tomorrow". Null when there is no expiry. */
export function expiryLabel(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;

  const ms = then - now.getTime();
  if (ms <= 0) return 'Expired';

  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return 'Ends within the hour';
  if (hours < 24) return `Ends in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'Ends tomorrow';
  return `Ends in ${days} days`;
}

/** True when a deal is close enough to expiry to warrant visual urgency. */
export function isExpiringSoon(iso: string | null, now: Date = new Date()): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso) - now.getTime();
  return Number.isFinite(ms) && ms > 0 && ms < 24 * 3_600_000;
}

/** Initials for the image fallback, e.g. "Best Buy" -> "BB". */
export function merchantInitials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

export const CATEGORY_LABELS: Record<string, string> = {
  electronics: 'Electronics',
  computers: 'Computers',
  gaming: 'Gaming',
  clothing: 'Clothing',
  'shoes-accessories': 'Shoes & Accessories',
  'toys-games': 'Toys & Games',
  'baby-kids': 'Baby & Kids',
  home: 'Home',
  kitchen: 'Kitchen',
  appliances: 'Appliances',
  grocery: 'Grocery',
  'beauty-health': 'Beauty & Health',
  'sports-outdoors': 'Sports & Outdoors',
  'tools-auto': 'Tools & Auto',
  travel: 'Travel',
  other: 'Other',
};

export const DEPARTMENT_LABELS: Record<string, string> = {
  women: 'Women',
  men: 'Men',
  girls: 'Girls',
  boys: 'Boys',
  baby: 'Baby',
  unisex: 'Unisex',
  na: '',
};

export const FAMILY_LABELS: Record<string, string> = {
  'canadian-tire': 'Canadian Tire family',
  'gap-inc': 'Gap Inc. Canada',
  reitmans: 'Reitmans Group',
};

export function categoryLabel(value: string): string {
  return CATEGORY_LABELS[value] ?? value;
}

export function departmentLabel(value: string): string {
  return DEPARTMENT_LABELS[value] ?? '';
}

export function familyLabel(value: string): string {
  return FAMILY_LABELS[value] ?? value;
}
