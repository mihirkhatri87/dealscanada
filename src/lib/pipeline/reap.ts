import type { DealRepository } from '../db/repository';
import { env } from '../config';

/**
 * Retirement and pruning.
 *
 * A deal ends in one of two ways, and they are not the same thing. It can pass
 * its own stated expiry, which is something the retailer told us; or it can stop
 * appearing in any source, which is something we inferred from absence. The
 * first is a fact worth showing a visitor ("this sale ended"), the second is a
 * guess worth acting on quietly.
 *
 * Both statuses drop out of default listings but stay reachable by direct URL,
 * because a link shared last week should explain itself rather than 404.
 */

export interface ReapOptions {
  repo: DealRepository;
  now?: Date;
  deadAfterHours?: number;
  priceHistoryDays?: number;
  /**
   * Whether absence is evidence this time.
   *
   * It only is when the run actually saw something. A run where every source was
   * blocked has not learned that deals disappeared — it has learned nothing at
   * all, and inferring death from it would empty the site after a few days of
   * failed scrapes. Expiry is unaffected: a retailer's own end date is a fact
   * regardless of whether today's scrape worked.
   */
  inferAbsence?: boolean;
}

export interface ReapSummary {
  expired: number;
  dead: number;
  /** False when absence was not treated as evidence; `dead` is then 0 by choice. */
  inferredAbsence: boolean;
  prunedPricePoints: number;
  deadBefore: string;
  prunedBefore: string;
}

export async function reap(options: ReapOptions): Promise<ReapSummary> {
  const now = options.now ?? new Date();
  const deadAfterHours = options.deadAfterHours ?? env.DEAD_AFTER_HOURS;
  const priceHistoryDays = options.priceHistoryDays ?? env.PRICE_HISTORY_DAYS;

  const deadBefore = new Date(now.getTime() - deadAfterHours * 3_600_000).toISOString();
  const prunedBefore = new Date(now.getTime() - priceHistoryDays * 86_400_000).toISOString();

  // Expiry runs first. A deal that both expired and went unseen should read as
  // expired, which is the more specific and more honest of the two.
  const inferAbsence = options.inferAbsence ?? true;

  const expired = await options.repo.markExpired(now.toISOString());
  const dead = inferAbsence ? await options.repo.markDead(deadBefore) : 0;
  const prunedPricePoints = await options.repo.prunePricePoints(prunedBefore);

  return {
    expired,
    dead,
    inferredAbsence: inferAbsence,
    prunedPricePoints,
    deadBefore,
    prunedBefore,
  };
}
