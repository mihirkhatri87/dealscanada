import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getRepository } from '@/lib/db';
import { DealGrid, EmptyState } from '@/components/DealGrid';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const repo = await getRepository();
  const store = await repo.getStore(storeId);
  return { title: store ? `Clearance at ${store.name}` : 'Store not found' };
}

export default async function StorePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const repo = await getRepository();

  const store = await repo.getStore(storeId);
  if (!store) notFound();

  const { deals, total } = await repo.queryDeals({ storeIds: [storeId], limit: 48 });

  const mapQuery = encodeURIComponent(
    [store.name, store.address, store.city, store.province].filter(Boolean).join(', '),
  );

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold tracking-tight">{store.name}</h1>
          <p className="text-sm tabular-nums text-fg-muted">
            {total} clearance {total === 1 ? 'item' : 'items'}
          </p>
        </div>
        <p className="text-sm text-fg-muted">
          {[store.address, store.city, store.province, store.postalCode]
            .filter(Boolean)
            .join(', ')}{' '}
          ·{' '}
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Directions
          </a>
        </p>
      </div>

      {deals.length > 0 ? (
        <DealGrid deals={deals} />
      ) : (
        <EmptyState
          title="No clearance recorded at this store"
          message="In-store stock changes constantly. We only show what we have actually seen, so an empty list means we have not collected anything here recently."
          action={
            <Link href="/near-me" className="text-sm font-medium text-accent hover:underline">
              Check other nearby stores
            </Link>
          }
        />
      )}
    </main>
  );
}
