/**
 * Heat scoring — what "hottest" means on the front page.
 *
 * Four signals, each normalized to 0..1 and weighted. The weights live in one
 * exported object so they are tunable without touching any call site, and so a
 * change to ranking is a one-line diff rather than an archaeology exercise.
 */

export interface HeatWeights {
  votes: number;
  discount: number;
  recency: number;
  source: number;
}

export const HEAT_WEIGHTS: HeatWeights = {
  votes: 30, // community signal
  discount: 35, // depth of discount
  recency: 25, // freshness
  source: 10, // per-source trust
};

/** Half-life of the recency term. A 12-hour-old deal scores half a fresh one. */
export const RECENCY_HALF_LIFE_HOURS = 12;

/**
 * Per-source trust, 0..1.
 *
 * RedFlagDeals carries human curation and votes, so it earns the top weight.
 * A raw retailer feed is trustworthy about price but says nothing about whether
 * the deal is actually good.
 */
export const SOURCE_WEIGHTS: Record<string, number> = {
  redflagdeals: 1.0,
  smartcanucks: 0.8,
  cocowest: 0.8,
  costcoeast: 0.8,
  bestbuy: 0.7,
  'amazon-paapi': 0.7,
  camelcamelcamel: 0.6,
  stocktrack: 0.7,
  costco: 0.6,
  walmart: 0.6,
  shopify: 0.5,
  sfcc: 0.5,
  hybris: 0.5,
  gapinc: 0.5,
  magento: 0.5,
  jsonld: 0.4,
};

const DEFAULT_SOURCE_WEIGHT = 0.4;

export interface HeatInput {
  votes: number;
  discountPct: number | null;
  postedAt: string | null;
  source: string;
  /** Injected in tests so scoring is deterministic. */
  now?: Date;
}

/** log1p normalization: the difference between 0 and 20 votes matters far more
 *  than the difference between 500 and 520. */
export function normalizeVotes(votes: number): number {
  if (votes <= 0) return 0;
  // Saturates around 200 votes, which is an exceptional RFD thread.
  return Math.min(1, Math.log1p(votes) / Math.log1p(200));
}

/** A 70%+ discount is already exceptional; beyond that the curve flattens. */
export function normalizeDiscount(discountPct: number | null): number {
  if (discountPct === null || discountPct <= 0) return 0;
  return Math.min(1, discountPct / 70);
}

/** Exponential decay on a 12-hour half-life. */
export function recencyDecay(postedAt: string | null, now: Date = new Date()): number {
  if (!postedAt) return 0.3; // unknown age: neither fresh nor stale

  const posted = Date.parse(postedAt);
  if (!Number.isFinite(posted)) return 0.3;

  const ageHours = (now.getTime() - posted) / 3_600_000;
  // A future timestamp is a source error, not a fresher deal.
  if (ageHours < 0) return 1;

  return Math.pow(0.5, ageHours / RECENCY_HALF_LIFE_HOURS);
}

export function sourceWeight(source: string): number {
  return SOURCE_WEIGHTS[source] ?? DEFAULT_SOURCE_WEIGHT;
}

/** Computes heat in 0..100. Never throws; every input has a defined fallback. */
export function computeHeat(input: HeatInput, weights: HeatWeights = HEAT_WEIGHTS): number {
  const now = input.now ?? new Date();

  const score =
    weights.votes * normalizeVotes(input.votes) +
    weights.discount * normalizeDiscount(input.discountPct) +
    weights.recency * recencyDecay(input.postedAt, now) +
    weights.source * sourceWeight(input.source);

  const total = weights.votes + weights.discount + weights.recency + weights.source;
  const scaled = (score / total) * 100;

  return Math.max(0, Math.min(100, Math.round(scaled * 10) / 10));
}
