import { getRepository } from '@/lib/db';
import { env, flags } from '@/lib/config';
import { allAdapters } from '@/lib/sources/registry';
import { registerStocktrack } from '@/lib/sources/all';
import { runPipeline } from '@/lib/pipeline/run';
import { isCronAuthorized, resolveCronBudgetMs } from '@/lib/cron';

export const dynamic = 'force-dynamic';
// Next reads this at build time by static analysis, so it must be a literal -
// an imported constant fails the build. CRON_MAX_DURATION_S in @/lib/cron mirrors
// it, and a test asserts the two agree.
export const maxDuration = 300;

/**
 * POST /api/cron/scrape — the hosted scheduler's entry point.
 *
 * Guarded by a shared secret rather than a session, because the caller is a
 * platform cron, not a person. With no CRON_SECRET set the route refuses
 * outright: a scrape endpoint that anyone can trigger is a way to have your own
 * site DoS a retailer on your behalf.
 *
 * Serverless platforms cap execution time, so a run that would exceed the budget
 * scrapes a subset and says so. Partial results with an honest count beat a
 * timeout that reports nothing.
 */
export async function POST(request: Request): Promise<Response> {
  if (!flags.hostedCronEnabled) {
    return Response.json(
      {
        error: 'cron_disabled',
        message: 'CRON_SECRET is not configured, so this endpoint is disabled.',
      },
      { status: 503 },
    );
  }

  if (!isCronAuthorized(request.headers)) {
    // Deliberately terse. An unauthenticated caller learns nothing about
    // whether the secret was wrong, malformed, or missing.
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const budgetMs = resolveCronBudgetMs(url.searchParams.get('budgetMs'));

  const repo = await getRepository();
  await repo.migrate();

  registerStocktrack(await repo.listStores(env.STOCKTRACK_MAX_STORES));
  const adapters = allAdapters();

  const started = Date.now();
  const summary = await runPipeline({
    adapters,
    repo,
    concurrency: env.SCRAPE_CONCURRENCY,
    deadlineMs: budgetMs,
  });

  const skipped = summary.sources.filter((source) => source.outcome === 'skipped');
  const failed = summary.sources.filter((source) => source.outcome === 'failed');

  return Response.json({
    ok: failed.length < summary.sources.length,
    partial: summary.sources.some((source) => source.error === 'deadline exceeded'),
    durationMs: Date.now() - started,
    budgetMs,
    sources: {
      attempted: summary.sources.length,
      failed: failed.length,
      skipped: skipped.length,
    },
    deals: {
      found: summary.totalFound,
      new: summary.totalNew,
      updated: summary.totalUpdated,
      dropped: summary.totalDropped,
      merged: summary.merged,
    },
    verification: {
      comparedAcrossMerchants: summary.comparedAcrossMerchants,
      verified: summary.verified,
      suspectAnchors: summary.suspectAnchors,
    },
    reaped: summary.reaped,
  });
}
