import { Suspense } from 'react';
import Link from 'next/link';
import { getRepository } from '@/lib/db';
import { parseSearchParams, PAGE_SIZE } from '@/lib/query-params';
import type { DealQuery } from '@/lib/db/types';
import { DealGrid, EmptyState } from './DealGrid';
import { FilterBar } from './FilterBar';
import { Pagination } from './Pagination';

/**
 * Every listing surface renders through here.
 *
 * Category, merchant, family, department, coupons and search differ only by the
 * base query they pin. Sharing the implementation is what keeps their filtering,
 * sorting and pagination behaviour identical instead of six near-copies drifting.
 */
export async function ListingPage({
  title,
  subtitle,
  base,
  params,
  emptyTitle,
  emptyMessage,
}: {
  title: string;
  subtitle?: React.ReactNode;
  base: Partial<DealQuery>;
  params: Record<string, string | string[] | undefined>;
  emptyTitle?: string;
  emptyMessage?: string;
}) {
  const { query, page } = parseSearchParams(params);
  const repo = await getRepository();

  // The pinned base wins over anything the user could put in the query string,
  // so /c/gaming cannot be turned into a different category by hand-editing.
  const merged: DealQuery = { ...query, ...base };

  const [{ deals, total }, merchants] = await Promise.all([
    repo.queryDeals(merged),
    repo.facets('merchant'),
  ]);

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm tabular-nums text-fg-muted">
            {total.toLocaleString('en-CA')} {total === 1 ? 'deal' : 'deals'}
          </p>
        </div>
        {subtitle && <div className="text-sm text-fg-muted">{subtitle}</div>}
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
          title={emptyTitle ?? 'Nothing here right now'}
          message={
            emptyMessage ??
            'Deals come and go quickly. Try clearing your filters, or check back after the next scrape.'
          }
          action={
            <Link href="/" className="text-sm font-medium text-accent hover:underline">
              Browse all deals
            </Link>
          }
        />
      )}
    </main>
  );
}
