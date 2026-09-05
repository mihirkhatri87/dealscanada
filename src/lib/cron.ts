import { env } from './config';

/**
 * Authorization and budgeting for the hosted scrape endpoint.
 *
 * Extracted from the route because both are security- and money-relevant: one
 * decides who may make this site crawl retailers, the other decides whether the
 * run stops itself or gets killed mid-write. Neither should live somewhere it
 * cannot be tested.
 */

/** The ceiling a hosted budget may not exceed, from the route's own maxDuration. */
export const CRON_MAX_DURATION_S = 300;
const SHUTDOWN_MARGIN_MS = 15_000;

/**
 * Vercel Cron sends `Authorization: Bearer <secret>`; a manual call is likelier
 * to use a header. Both are accepted; neither is optional, and an unset secret
 * authorizes nobody — an open scrape endpoint is a way to have your own site
 * hammer a retailer on someone else's behalf.
 */
export function isCronAuthorized(
  headers: Headers,
  secret: string | undefined = env.CRON_SECRET,
): boolean {
  if (!secret) return false;

  const authorization = headers.get('authorization');
  if (authorization !== null && authorization === `Bearer ${secret}`) return true;

  return headers.get('x-cron-secret') === secret;
}

/**
 * Resolves the wall-clock budget for one hosted run.
 *
 * Clamped below the platform's own ceiling: a budget longer than `maxDuration`
 * just means the platform kills the function instead of the run stopping
 * cleanly, which is exactly the outcome the budget exists to avoid.
 */
export function resolveCronBudgetMs(
  raw: string | null,
  fallbackMs: number = env.CRON_BUDGET_MS,
): number {
  const ceiling = CRON_MAX_DURATION_S * 1000 - SHUTDOWN_MARGIN_MS;
  const requested = raw === null || raw.trim() === '' ? fallbackMs : Number(raw);

  if (!Number.isFinite(requested) || requested <= 0) return Math.min(fallbackMs, ceiling);
  return Math.min(requested, ceiling);
}
