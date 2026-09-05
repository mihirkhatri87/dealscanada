import type { RawDeal } from './types';

/**
 * In-store clearance collected during the current run.
 *
 * The store-level source writes here as it goes, and the composite adapters read
 * it for their in-store path. Without this they would each re-fetch the same
 * store pages, tripling the traffic we send a small independent site to obtain
 * rows already in memory.
 *
 * Run-scoped, not a cache: cleared at the start of every run so a composite can
 * never present last run's clearance as today's.
 */
const pool: RawDeal[] = [];

export function addInStoreDeals(deals: RawDeal[]): void {
  pool.push(...deals);
}

export function inStoreDeals(): RawDeal[] {
  return [...pool];
}

export function clearInStorePool(): void {
  pool.length = 0;
}
