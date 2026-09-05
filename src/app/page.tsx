import { Suspense } from 'react';
import Link from 'next/link';
import { getRepository } from '@/lib/db';
import { env } from '@/lib/config';
import { parseSearchParams, PAGE_SIZE } from '@/lib/query-params';
import { DealGrid, EmptyState } from '@/components/DealGrid';
import { FilterBar } from '@/components/FilterBar';
import { StaleBanner } from '@/components/StaleBanner';
import { Pagination } from '@/components/Pagination';

export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { query, page } = parseSearchParams(params);
  const repo = await getRepository();

  // One round trip per surface the page shows, in parallel.
  const [{ deals, total }, hottest, merchants, health] = await Promise.all([
    repo.queryDeals(query),
    // The hero only makes sense on an unfiltered view.
    Object.keys(params).length === 0
      ? repo.queryDeals({ sort: 'best-verified', limit: 3 })
      : Promise.resolve({ deals: [], total: 0 }),
    repo.facets('merchant'),
    repo.getSourceHealth(),
  ]);

  const isFiltered = Object.keys(params).some((key) => key !== 'page');

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6">
      <StaleBanner runs={health} staleAfterMinutes={env.STALE_AFTER_MINUTES} />

      {hottest.deals.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-lg font-bold tracking-tight">Verified right now</h1>
            <p className="text-xs text-fg-muted">
              Checked against other stores and our own price history
            </p>
          </div>
          <DealGrid deals={hottest.deals} />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight">
            {isFiltered ? 'Matching deals' : 'All deals'}
          </h2>
          <p className="text-sm tabular-nums text-fg-muted">
            {total.toLocaleString('en-CA')} {total === 1 ? 'deal' : 'deals'}
          </p>
        </div>

        <Suspense fallback={<div className="h-32 rounded border border-border bg-bg-raised" />}>
          <FilterBar merchants={merchants} />
        </Suspense>

        {deals.length > 0 ? (
          <>
            <DealGrid deals={deals} />
            <Pagination page={page} total={total} pageSize={PAGE_SIZE} />
          </>
        ) : (
          <EmptyState
            title="No deals match those filters"
            message="Try removing a filter, lowering the minimum discount, or clearing the store selection."
            action={
              <Link href="/" className="text-sm font-medium text-accent hover:underline">
                Clear all filters
              </Link>
            }
          />
        )}
      </section>
    </main>
  );
}
