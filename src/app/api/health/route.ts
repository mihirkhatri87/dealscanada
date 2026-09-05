import { NextResponse } from 'next/server';
import { getRepository } from '@/lib/db';
import { env } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 *
 * Always 200, even when every source is failing — this endpoint reports health,
 * so returning an error status would make a monitoring tool unable to read the
 * detail it needs. The `ok` field carries the verdict.
 */
export async function GET() {
  const repo = await getRepository();
  const [runs, activeDeals] = await Promise.all([repo.getSourceHealth(), repo.countDeals({})]);

  const successful = runs.filter((run) => run.outcome === 'ok');
  const latest = successful.length
    ? Math.max(...successful.map((run) => Date.parse(run.startedAt)))
    : null;

  const ageMinutes = latest === null ? null : (Date.now() - latest) / 60_000;
  const stale = ageMinutes === null || ageMinutes > env.STALE_AFTER_MINUTES;

  return NextResponse.json(
    {
      ok: successful.length > 0 && !stale,
      activeDeals,
      lastSuccessfulRun: latest === null ? null : new Date(latest).toISOString(),
      staleAfterMinutes: env.STALE_AFTER_MINUTES,
      stale,
      sources: runs.map((run) => ({
        source: run.source,
        outcome: run.outcome,
        startedAt: run.startedAt,
        itemsFound: run.itemsFound,
        itemsNew: run.itemsNew,
        latencyMs: run.latencyMs,
        path: run.sourcePath,
        error: run.error,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
