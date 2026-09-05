import { cookies } from 'next/headers';
import Link from 'next/link';
import { getRepository } from '@/lib/db';
import { flags } from '@/lib/config';
import { DEFAULT_RADIUS_KM, LOCATION_COOKIE, decodeLocation } from '@/lib/location';
import { LocationPicker } from '@/components/LocationPicker';
import { DealGrid, EmptyState } from '@/components/DealGrid';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'In-store clearance near you' };

/**
 * The "amazing deals near you" surface.
 *
 * Four distinct empty states, because "nothing here" has four different causes
 * and each needs a different action from the user. Collapsing them into one
 * message would leave people stuck.
 */
export default async function NearMePage() {
  const store = await cookies();
  const location = decodeLocation(store.get(LOCATION_COOKIE)?.value);
  const repo = await getRepository();

  if (!flags.stocktrackEnabled) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6">
        <h1 className="text-xl font-bold tracking-tight">In-store clearance near you</h1>
        <EmptyState
          title="In-store clearance is switched off"
          message="This feature is disabled by configuration (STOCKTRACK_ENABLED). Online deals are unaffected."
          action={
            <Link href="/" className="text-sm font-medium text-accent hover:underline">
              Browse online deals
            </Link>
          }
        />
      </main>
    );
  }

  if (!location) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold tracking-tight">In-store clearance near you</h1>
          <p className="max-w-prose text-sm text-fg-muted">
            Red-tag and clearance stock is priced per store, so this needs to know roughly where you
            are before it can show anything useful.
          </p>
        </div>
        <LocationPicker current={null} />
      </main>
    );
  }

  const [nearbyStores, { deals, total }] = await Promise.all([
    repo.findStoresNear(location.lat, location.lng, DEFAULT_RADIUS_KM),
    repo.queryDealsNear({
      lat: location.lat,
      lng: location.lng,
      radiusKm: DEFAULT_RADIUS_KM,
      limit: 48,
    }),
  ]);

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold tracking-tight">Clearance near {location.label}</h1>
          <p className="text-sm tabular-nums text-fg-muted">
            {total} {total === 1 ? 'deal' : 'deals'} within {DEFAULT_RADIUS_KM} km
          </p>
        </div>
        {location.precision !== 'gps' && (
          <p className="text-xs text-fg-subtle">
            Distances are measured from the centre of {location.label}, so treat them as
            approximate.
          </p>
        )}
      </div>

      <LocationPicker current={location} />

      {nearbyStores.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Stores we check nearby</h2>
          <ul className="flex flex-wrap gap-2">
            {nearbyStores.map((nearby) => (
              <li key={nearby.id}>
                <Link
                  href={`/store/${nearby.id}`}
                  className="inline-flex items-center gap-2 rounded-sm border border-border bg-bg-raised px-2.5 py-1 text-xs transition-colors hover:border-accent"
                >
                  <span>{nearby.name}</span>
                  <span className="font-mono tabular-nums text-fg-subtle">
                    {nearby.distanceKm.toFixed(1)} km
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {deals.length > 0 ? (
        <DealGrid deals={deals} />
      ) : nearbyStores.length === 0 ? (
        <EmptyState
          title="No stores synced near you yet"
          message={`We don't have any store locations within ${DEFAULT_RADIUS_KM} km of ${location.label}. Run \`npm run stores:sync -- --postal=…\` to add them.`}
          action={
            <Link href="/" className="text-sm font-medium text-accent hover:underline">
              Browse online deals
            </Link>
          }
        />
      ) : (
        <EmptyState
          title="No in-store clearance found right now"
          message={`We know about ${nearbyStores.length} nearby ${nearbyStores.length === 1 ? 'store' : 'stores'} but have not collected clearance for them yet. Run \`npm run scrape -- --source=stocktrack\` to check.`}
          action={
            <Link href="/" className="text-sm font-medium text-accent hover:underline">
              Browse online deals
            </Link>
          }
        />
      )}
    </main>
  );
}
