import type { IdentityStrength } from './product-key';
import { isComparableIdentity } from './product-key';

/**
 * Is this actually a deal?
 *
 * A retailer's own "was" price is the least trustworthy number in the entire
 * dataset. Permanent fake anchors ("$199, now $79" forever) are endemic, and
 * republishing them uncritically would make DealsCanada a laundering service for
 * fake discounts.
 *
 * So a discount claim is only repeated when we can corroborate it with evidence
 * we hold ourselves:
 *
 *   1. cross-merchant  - what the same product costs at other merchants right now
 *   2. our own history - the prices we have actually observed over time
 *
 * When neither is available the deal is labelled unverified rather than dressed
 * up as a bargain, and when the retailer's claim contradicts the market we say so.
 */

export type DealVerdict =
  | 'verified-low' // at or near the lowest we have ever observed
  | 'verified-good' // beats the current cross-merchant median
  | 'market-price' // in line with what everyone else charges
  | 'above-market' // more expensive than elsewhere
  | 'inflated-anchor' // the claimed "was" is contradicted by the market
  | 'unverified'; // only the retailer's own claim to go on

export type EvidenceLevel = 'strong' | 'moderate' | 'none';

export interface QualityInput {
  priceNow: number | null;
  /** What the retailer claims the price used to be. Treated as an assertion. */
  claimedPriceWas: number | null;
  identityStrength: IdentityStrength;
  /** Current prices for the same product at OTHER merchants, in cents. */
  competitorPrices: number[];
  /**
   * Prices observed for this product BEFORE now, in cents, at any merchant.
   *
   * The current price is deliberately NOT included. Including it would make the
   * deal its own minimum whenever history is sparse or higher, so every listing
   * would read "lowest ever recorded" - a claim that is technically true and
   * completely worthless.
   */
  observedHistory: number[];
  /** Days of history behind observedHistory, used to grade evidence strength. */
  historyDays: number;
}

export interface QualityResult {
  verdict: DealVerdict;
  evidence: EvidenceLevel;
  /** Median competitor price, or null when there is nothing to compare against. */
  marketPrice: number | null;
  /** Discount against the market median - the honest number. */
  marketDiscountPct: number | null;
  /** Lowest price we have ever observed for this product. */
  observedLow: number | null;
  /** Where this price sits in our observed history, 0 = cheapest ever. */
  priceRankPct: number | null;
  /** Whether the retailer's claimed "was" is contradicted by the evidence. */
  claimSuspect: boolean;
  /** One plain sentence for the UI. Never overstates what we know. */
  explanation: string;
}

/** Minimum independent merchants before a market median means anything. */
const MIN_COMPETITORS_FOR_MARKET = 2;
/** Minimum observations before a historical low means anything. */
const MIN_HISTORY_POINTS = 3;
/** Within 2% of the observed low counts as "at the low". */
const NEAR_LOW_TOLERANCE = 0.02;
/**
 * How far a claimed "was" may exceed the market median before we call it
 * inflated. Real MSRPs do sit above street price, so this is deliberately
 * generous - we flag the egregious cases, not ordinary MSRP drift.
 */
const ANCHOR_TOLERANCE = 1.25;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
    : (sorted[mid] ?? null);
}

export function assessDealQuality(input: QualityInput): QualityResult {
  const { priceNow, claimedPriceWas } = input;

  // Without a current price there is nothing to assess.
  if (priceNow === null) {
    return {
      verdict: 'unverified',
      evidence: 'none',
      marketPrice: null,
      marketDiscountPct: null,
      observedLow: null,
      priceRankPct: null,
      claimSuspect: false,
      explanation: 'No price available to compare.',
    };
  }

  // A cross-merchant claim requires a manufacturer-assigned identifier. A
  // title-shaped match is good enough to collapse duplicates, not to assert
  // "cheaper than everywhere else".
  const comparable = isComparableIdentity(input.identityStrength);
  const competitors = comparable ? input.competitorPrices.filter((p) => p > 0) : [];

  const marketPrice = competitors.length >= MIN_COMPETITORS_FOR_MARKET ? median(competitors) : null;

  // The cheapest a shopper could pay elsewhere today. A "lowest we've recorded"
  // claim has to survive this: our history is irrelevant if someone is selling it
  // for less right now.
  const bestCompetitorPrice = competitors.length > 0 ? Math.min(...competitors) : null;

  const marketDiscountPct =
    marketPrice && marketPrice > 0
      ? Math.round(((marketPrice - priceNow) / marketPrice) * 1000) / 10
      : null;

  const prior = input.observedHistory.filter((p) => p > 0);
  const hasHistory = prior.length >= MIN_HISTORY_POINTS;

  // The low a "lowest we've recorded" claim is measured against comes from prior
  // observations only. What we report as observedLow includes the current price,
  // since that is genuinely the lowest we have on record once today counts.
  const priorLow = hasHistory ? Math.min(...prior) : null;
  const observedLow = hasHistory ? Math.min(priorLow as number, priceNow) : null;

  const priceRankPct = hasHistory
    ? Math.round((prior.filter((p) => p < priceNow).length / prior.length) * 1000) / 10
    : null;

  // Does the retailer's claimed "was" survive contact with the market?
  const claimSuspect =
    claimedPriceWas !== null &&
    marketPrice !== null &&
    claimedPriceWas > marketPrice * ANCHOR_TOLERANCE;

  const evidence: EvidenceLevel =
    marketPrice !== null && observedLow !== null
      ? 'strong'
      : marketPrice !== null || (observedLow !== null && input.historyDays >= 30)
        ? 'moderate'
        : 'none';

  const verdict = decideVerdict({
    priceNow,
    marketPrice,
    marketDiscountPct,
    bestCompetitorPrice,
    priorLow,
    claimSuspect,
    evidence,
  });

  return {
    verdict,
    evidence,
    marketPrice,
    marketDiscountPct,
    observedLow,
    priceRankPct,
    claimSuspect,
    explanation: explain({
      verdict,
      priceNow,
      marketPrice,
      marketDiscountPct,
      observedLow,
      historyDays: input.historyDays,
      competitorCount: competitors.length,
      claimedPriceWas,
    }),
  };
}

function decideVerdict(input: {
  priceNow: number;
  marketPrice: number | null;
  marketDiscountPct: number | null;
  /** Cheapest current price at another merchant, or null if none is known. */
  bestCompetitorPrice: number | null;
  /** Low across PRIOR observations only - never including the current price. */
  priorLow: number | null;
  claimSuspect: boolean;
  evidence: EvidenceLevel;
}): DealVerdict {
  // An inflated anchor is the most important thing to surface, so it outranks a
  // genuinely decent price: the shopper needs to know the claim is misleading.
  if (input.claimSuspect) return 'inflated-anchor';

  // Live market evidence beats our own history when the two disagree. Being the
  // cheapest WE have recorded while still costing more than everyone else charges
  // today is not a good deal, and calling it "lowest ever" would mislead.
  if (input.marketDiscountPct !== null && input.marketDiscountPct <= -5) {
    return 'above-market';
  }

  // "Lowest we've recorded" requires two things, not one: below everything we
  // logged before, AND not beaten by a live price elsewhere today. Without the
  // second condition a merchant whose history happens to be expensive earns the
  // best badge on the page while a competitor quietly sells it for less.
  const atRecordedLow =
    input.priorLow !== null && input.priceNow <= input.priorLow * (1 + NEAR_LOW_TOLERANCE);
  const notBeatenToday =
    input.bestCompetitorPrice === null ||
    input.priceNow <= input.bestCompetitorPrice * (1 + NEAR_LOW_TOLERANCE);

  if (atRecordedLow && notBeatenToday) return 'verified-low';

  if (input.marketDiscountPct !== null) {
    if (input.marketDiscountPct >= 5) return 'verified-good';
    return 'market-price';
  }

  return 'unverified';
}

function explain(input: {
  verdict: DealVerdict;
  priceNow: number;
  marketPrice: number | null;
  marketDiscountPct: number | null;
  observedLow: number | null;
  historyDays: number;
  competitorCount: number;
  claimedPriceWas: number | null;
}): string {
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  switch (input.verdict) {
    case 'verified-low':
      return input.historyDays >= 1
        ? `Lowest price we've recorded in ${Math.round(input.historyDays)} days.`
        : "Lowest price we've recorded.";

    case 'verified-good':
      return `${input.marketDiscountPct}% below the ${dollars(
        input.marketPrice ?? 0,
      )} median across ${input.competitorCount} other ${
        input.competitorCount === 1 ? 'store' : 'stores'
      }.`;

    case 'market-price':
      return `In line with the ${dollars(input.marketPrice ?? 0)} median at ${
        input.competitorCount
      } other stores.`;

    case 'above-market':
      return `Cheaper elsewhere — ${dollars(input.marketPrice ?? 0)} median at ${
        input.competitorCount
      } other stores.`;

    case 'inflated-anchor':
      return `The ${dollars(
        input.claimedPriceWas ?? 0,
      )} "was" price looks inflated: this sells for about ${dollars(
        input.marketPrice ?? 0,
      )} elsewhere.`;

    case 'unverified':
      return "Not enough independent data yet — this is the retailer's own claim.";
  }
}

/**
 * The discount figure the UI and ranking should actually use.
 *
 * Prefers the market-corroborated number. Falls back to the retailer's claim only
 * when nothing contradicts it, and returns null outright when the claim is
 * suspect — a flagged deal must not also carry a headline percentage.
 */
export function trustedDiscountPct(
  quality: QualityResult,
  claimedDiscountPct: number | null,
): number | null {
  if (quality.verdict === 'inflated-anchor') return null;
  if (quality.marketDiscountPct !== null && quality.marketDiscountPct > 0) {
    return quality.marketDiscountPct;
  }
  return claimedDiscountPct;
}
