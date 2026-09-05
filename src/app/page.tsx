import { Suspense } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { getRepository } from '@/lib/db';
import { DEFAULT_RADIUS_KM, LOCATION_COOKIE, decodeLocation } from '@/lib/location';
import { env } from '@/lib/config';
import { parseSearchParams, PAGE_SIZE } from '@/lib/query-params';
import { DealGrid, EmptyState } from '@/components/DealGrid';
import { FilterBar } from '@/components/FilterBar';
import { StaleBanner } from '@/components/StaleBanner';
import { SeedBanner } from '@/components/SeedBanner';
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

  // Read from the cookie rather than waiting for the client, so the "near you"
  // section is present in the first paint instead of popping in after hydration.
  const cookieStore = await cookies();
  const location = decodeLocation(cookieStore.get(LOCATION_COOKIE)?.value);

  // One round trip per surface the page shows, in parallel.
  const isUnfiltered = Object.keys(params).length === 0;

  const [{ deals, total }, hottest, nearby, merchants, health] = await Promise.all([
    repo.queryDeals(query),
    // The hero and the local section only make sense on an unfiltered view.
    isUnfiltered
      ? repo.queryDeals({ sort: 'best-verified', limit: 3 })
      : Promise.resolve({ deals: [], total: 0 }),
    isUnfiltered && location
      ? repo.queryDealsNear({
          lat: location.lat,
          lng: location.lng,
          radiusKm: DEFAULT_RADIUS_KM,
          limit: 4,
        })
      : Promise.resolve({ deals: [], total: 0 }),
    repo.facets('merchant'),
    repo.getSourceHealth(),
  ]);

  // Sample rows are labelled site-wide, not just per card.
  const seedCount = await repo.countDeals({ sources: ['seed'] });

  const isFiltered = Object.keys(params).some((key) => key !== 'page');

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6">
      <SeedBanner seedCount={seedCount} total={total} />
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

      {/* Local clearance, above the national grid. When there is no location we
          show a compact prompt in the same slot rather than nothing, so the
          feature is discoverable instead of hidden behind a nav link. */}
      {isUnfiltered &&
        (nearby.deals.length > 0 ? (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold tracking-tight">
                In-store clearance near {location?.label}
              </h2>
              <Link href="/near-me" className="text-sm text-accent hover:underline">
                See all {nearby.total} nearby →
              </Link>
            </div>
            <DealGrid deals={nearby.deals} />
          </section>
        ) : (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded border border-dashed border-border bg-bg-raised px-4 py-3">
            <p className="text-sm text-fg-muted">
              <span className="font-medium text-fg">Shopping in person?</span> Set your location to
              see red-tag clearance at stores near you.
            </p>
            <Link
              href="/near-me"
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90"
            >
              Set location
            </Link>
          </section>
        ))}

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
