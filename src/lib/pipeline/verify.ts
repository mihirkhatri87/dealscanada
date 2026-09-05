import type { DealInput } from '../db/repository';
import { assessDealQuality, trustedDiscountPct } from './deal-quality';
import { computeHeat } from './score';

/**
 * The verification pass.
 *
 * Runs after every source has been ingested, because that is the only moment we
 * can see the same product at several merchants at once. It answers the question
 * a single adapter cannot: *is this actually a deal, or just a retailer saying so?*
 *
 * Two evidence sources, both ours:
 *   - what the same product costs at OTHER merchants right now
 *   - the prices we have recorded for it over time
 *
 * Nothing here trusts the retailer's own "was" price. That number is an input to
 * be checked, not a fact to be republished.
 */

export interface PriceObservation {
  price: number;
  observedAt: string;
  /** Distinguishes merchants so one retailer cannot vote twice. */
  merchantId: string | null;
}

export interface VerifyContext {
  /**
   * Historical observations per product key, from price_points joined through
   * deals. Includes prices from every merchant selling that product.
   */
  historyByProductKey: Map<string, PriceObservation[]>;
  now?: Date;
}

export interface VerifySummary {
  assessed: number;
  verified: number;
  suspectAnchors: number;
  comparedAcrossMerchants: number;
}

/**
 * Assigns a verdict to every deal in the batch and rewrites heat to rank on
 * corroborated evidence rather than the retailer's claim.
 *
 * Returns the same deals, mutated in place, plus a summary for the run log.
 */
export function verifyDeals(
  deals: DealInput[],
  context: VerifyContext,
): { deals: DealInput[]; summary: VerifySummary } {
  const now = context.now ?? new Date();

  // Group the batch by product key so competitor prices are visible per product.
  const byProductKey = new Map<string, DealInput[]>();
  for (const deal of deals) {
    if (!deal.productKey) continue;
    const bucket = byProductKey.get(deal.productKey) ?? [];
    bucket.push(deal);
    byProductKey.set(deal.productKey, bucket);
  }

  const summary: VerifySummary = {
    assessed: 0,
    verified: 0,
    suspectAnchors: 0,
    comparedAcrossMerchants: 0,
  };

  for (const deal of deals) {
    const siblings = deal.productKey ? (byProductKey.get(deal.productKey) ?? []) : [];

    // Competitor prices: the same product at DIFFERENT merchants. One merchant
    // listing a product twice must not count as market corroboration, so prices
    // are collapsed per merchant first.
    const perMerchant = new Map<string, number>();
    for (const sibling of siblings) {
      if (sibling.id === deal.id) continue;
      if (!sibling.merchantId || sibling.merchantId === deal.merchantId) continue;
      if (sibling.priceNow === null) continue;

      const existing = perMerchant.get(sibling.merchantId);
      // Keep each merchant's best price — that is what a shopper would pay there.
      if (existing === undefined || sibling.priceNow < existing) {
        perMerchant.set(sibling.merchantId, sibling.priceNow);
      }
    }
    const competitorPrices = [...perMerchant.values()];

    const history = deal.productKey
      ? (context.historyByProductKey.get(deal.productKey) ?? [])
      : [];
    // Prior observations only. The current price must NOT be folded in here: it
    // would make every deal its own minimum whenever history is sparse, so
    // everything would read "lowest ever recorded".
    const observedHistory = history.map((point) => point.price);
    const historyDays = spanInDays(history, now);

    const quality = assessDealQuality({
      priceNow: deal.priceNow,
      claimedPriceWas: deal.priceWas,
      identityStrength: deal.productKeyStrength ?? 'none',
      competitorPrices,
      observedHistory,
      historyDays,
    });

    deal.marketPrice = quality.marketPrice;
    deal.marketDiscountPct = quality.marketDiscountPct;
    deal.observedLow = quality.observedLow;
    deal.priceRankPct = quality.priceRankPct;
    deal.verdict = quality.verdict;
    deal.evidence = quality.evidence;
    deal.claimSuspect = quality.claimSuspect;
    deal.qualityNote = quality.explanation;

    // Rank on the discount we can defend, not the one the retailer asserts.
    // Without this, a fake anchor still reaches the front page.
    const trusted = trustedDiscountPct(quality, deal.discountPct);
    deal.heat = computeHeat({
      votes: deal.votes,
      discountPct: trusted,
      postedAt: deal.postedAt,
      source: deal.source,
      now,
    });

    // A flagged anchor is demoted outright: it is shown so shoppers can see the
    // claim is misleading, not promoted as a bargain.
    if (quality.verdict === 'inflated-anchor') {
      deal.heat = Math.min(deal.heat, 25);
      summary.suspectAnchors += 1;
    }

    if (quality.verdict === 'verified-low' || quality.verdict === 'verified-good') {
      summary.verified += 1;
    }
    if (quality.marketPrice !== null) summary.comparedAcrossMerchants += 1;
    summary.assessed += 1;
  }

  return { deals, summary };
}

function spanInDays(history: PriceObservation[], now: Date): number {
  if (history.length === 0) return 0;

  let earliest = Number.POSITIVE_INFINITY;
  for (const point of history) {
    const time = Date.parse(point.observedAt);
    if (Number.isFinite(time) && time < earliest) earliest = time;
  }
  if (!Number.isFinite(earliest)) return 0;

  return Math.max(0, (now.getTime() - earliest) / 86_400_000);
}
