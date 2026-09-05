import { createHash } from 'node:crypto';
import { canonicalizeUrl } from '../util/url';

/**
 * Cross-source deduplication.
 *
 * The same TV arrives from RedFlagDeals, Best Buy's API and an affiliate feed.
 * Two keys catch it:
 *   1. canonical URL — exact, cheap, catches most cases
 *   2. merchant + normalized title tokens + price bucket — catches the rest,
 *      where sources link to different URL shapes for one product
 *
 * The price bucket is what stops a 128GB and a 512GB phone collapsing into one
 * row: same merchant, near-identical titles, materially different prices.
 */

export interface DedupableDeal {
  id: string;
  source: string;
  canonicalUrl: string;
  title: string;
  merchantId: string | null;
  priceNow: number | null;
  priceWas: number | null;
  description: string | null;
  imageUrl: string | null;
  votes: number;
  postedAt: string | null;
  alsoSeenOn: string[] | null;
  couponCode: string | null;
}

/** Words that carry no identity and only add noise to a title fingerprint. */
const NOISE_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'for',
  'with',
  'new',
  'sale',
  'deal',
  'deals',
  'off',
  'save',
  'now',
  'only',
  'free',
  'shipping',
  'clearance',
  'today',
  'hot',
  'best',
  'price',
  'lowest',
  'ymmv',
  'expired',
  'back',
  'in',
  'stock',
  'at',
  'to',
  'from',
  'up',
  'on',
]);

/**
 * Reduces a title to its identifying tokens: lowercased, accent-stripped,
 * punctuation removed, noise words and bare percentages dropped, then sorted so
 * word order cannot fork the fingerprint.
 */
export function normalizeTitleTokens(title: string): string[] {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .filter((token) => !NOISE_WORDS.has(token))
    .filter((token) => !/^\d{1,2}$/.test(token))
    .sort();
}

/**
 * Price bucket for fingerprinting: 5% bands.
 *
 * Wide enough that a temporary $2 difference between two sources does not split
 * one deal in two; narrow enough that different capacities or sizes of a product
 * stay distinct.
 */
export function priceBucket(priceNow: number | null): string {
  if (priceNow === null) return 'unknown';
  if (priceNow === 0) return 'free';
  return String(Math.round(Math.log(priceNow) / Math.log(1.05)));
}

/** Secondary dedupe key. Returns null when there is too little to match on. */
export function fingerprint(deal: DedupableDeal): string | null {
  const tokens = normalizeTitleTokens(deal.title);
  if (tokens.length < 2) return null;
  if (!deal.merchantId) return null;

  const payload = [deal.merchantId, tokens.join(' '), priceBucket(deal.priceNow)].join('|');
  return createHash('sha1').update(payload).digest('hex');
}

/**
 * Merges two records of the same deal, keeping the richer information.
 *
 * Order-independent by construction: every field resolves by a rule that does not
 * depend on which argument came first, so A-then-B and B-then-A produce the same
 * row. A test asserts that property.
 */
export function mergeDeals(a: DedupableDeal, b: DedupableDeal): DedupableDeal {
  const sources = new Set<string>([
    ...(a.alsoSeenOn ?? []),
    ...(b.alsoSeenOn ?? []),
    a.source,
    b.source,
  ]);

  // Prefer the record that actually has both prices — that is the one that can
  // show a real before/after.
  const aComplete = a.priceNow !== null && a.priceWas !== null;
  const bComplete = b.priceNow !== null && b.priceWas !== null;
  const primary = aComplete && !bComplete ? a : bComplete && !aComplete ? b : olderFirst(a, b);
  const secondary = primary === a ? b : a;

  return {
    ...primary,
    // Keep the earliest sighting: a deal does not become newer by being re-found.
    postedAt: earliest(a.postedAt, b.postedAt),
    // Richer field wins regardless of which record it came from.
    description: longer(a.description, b.description),
    imageUrl: primary.imageUrl ?? secondary.imageUrl,
    priceNow: primary.priceNow ?? secondary.priceNow,
    priceWas: primary.priceWas ?? secondary.priceWas,
    couponCode: primary.couponCode ?? secondary.couponCode,
    // Community signal is additive across sources.
    votes: a.votes + b.votes,
    alsoSeenOn: [...sources].sort(),
  };
}

function olderFirst(a: DedupableDeal, b: DedupableDeal): DedupableDeal {
  const aTime = a.postedAt ? Date.parse(a.postedAt) : Number.POSITIVE_INFINITY;
  const bTime = b.postedAt ? Date.parse(b.postedAt) : Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime < bTime ? a : b;
  // Final tiebreak on id keeps the result deterministic regardless of input order.
  return a.id <= b.id ? a : b;
}

function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function longer(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a.length >= b.length ? a : b;
}

export interface DedupeResult<T extends DedupableDeal> {
  deals: T[];
  mergedCount: number;
}

/**
 * Collapses duplicates within a batch.
 *
 * Sorting by id first makes the output independent of the order adapters happened
 * to finish in — otherwise two runs over the same data could produce different
 * merged records.
 */
export function dedupeDeals<T extends DedupableDeal>(input: T[]): DedupeResult<T> {
  const byUrl = new Map<string, T>();
  const byFingerprint = new Map<string, T>();
  let mergedCount = 0;

  const ordered = [...input].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const deal of ordered) {
    const urlKey = canonicalizeUrl(deal.canonicalUrl);
    const printKey = fingerprint(deal);

    const existing = byUrl.get(urlKey) ?? (printKey ? byFingerprint.get(printKey) : undefined);

    if (existing) {
      const merged = mergeDeals(existing, deal) as T;
      mergedCount += 1;

      byUrl.set(canonicalizeUrl(existing.canonicalUrl), merged);
      byUrl.set(urlKey, merged);

      const existingPrint = fingerprint(existing);
      if (existingPrint) byFingerprint.set(existingPrint, merged);
      if (printKey) byFingerprint.set(printKey, merged);
      continue;
    }

    byUrl.set(urlKey, deal);
    if (printKey) byFingerprint.set(printKey, deal);
  }

  // A merged record can sit under several keys; unique by id.
  const unique = new Map<string, T>();
  for (const deal of byUrl.values()) unique.set(deal.id, deal);

  return { deals: [...unique.values()], mergedCount };
}
