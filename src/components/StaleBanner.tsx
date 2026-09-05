import type { SourceRun } from '@/lib/db/types';

/**
 * Staleness banner.
 *
 * Deal data goes stale silently, which is worse than showing nothing: a price
 * from three days ago looks exactly like a price from three minutes ago. This
 * says so rather than letting the page imply freshness it does not have.
 */
export function StaleBanner({
  runs,
  staleAfterMinutes,
  now = new Date(),
}: {
  runs: SourceRun[];
  staleAfterMinutes: number;
  now?: Date;
}) {
  const successful = runs.filter((run) => run.outcome === 'ok');
  if (successful.length === 0) {
    return (
      <p className="rounded border border-warn/40 bg-warn-subtle px-3 py-2 text-sm text-warn">
        No source has completed successfully yet. Run <code className="font-mono">npm run scrape</code> to
        load live deals.
      </p>
    );
  }

  const latest = Math.max(...successful.map((run) => Date.parse(run.startedAt)));
  const ageMinutes = (now.getTime() - latest) / 60_000;
  if (!Number.isFinite(ageMinutes) || ageMinutes < staleAfterMinutes) return null;

  const hours = Math.round(ageMinutes / 60);
  return (
    <p className="rounded border border-warn/40 bg-warn-subtle px-3 py-2 text-sm text-warn">
      Prices were last refreshed about {hours} {hours === 1 ? 'hour' : 'hours'} ago and may have
      changed. Verify on the retailer&rsquo;s site before buying.
    </p>
  );
}
