import Link from 'next/link';
import { getRepository } from '@/lib/db';
import { RETAILER_CATALOGUE } from '@/lib/sources/catalogue-data';
import { familyLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Every store we track' };

const STATUS_TONE: Record<string, string> = {
  verified: 'bg-deal-subtle text-deal',
  unverified: 'bg-bg-inset text-fg-muted',
  blocked: 'bg-hot-subtle text-hot',
};

const STATUS_LABEL: Record<string, string> = {
  verified: 'Live',
  unverified: 'Not yet confirmed',
  blocked: 'Unreachable',
};

/**
 * The store directory.
 *
 * Retailers we cannot currently collect from are listed too, with their status
 * shown. A shopper looking for Walmart should learn that we know about it and
 * why it is not live — silently omitting it looks like an oversight and hides a
 * real gap in coverage.
 */
export default async function BrandsPage() {
  const repo = await getRepository();
  const counts = await repo.facets('merchant');
  const countBySlug = new Map(counts.map((facet) => [facet.value, facet.count]));

  const byVertical = new Map<string, typeof RETAILER_CATALOGUE>();
  for (const retailer of RETAILER_CATALOGUE) {
    const key = retailer.vertical ?? 'other';
    byVertical.set(key, [...(byVertical.get(key) ?? []), retailer]);
  }

  const families = new Map<string, typeof RETAILER_CATALOGUE>();
  for (const retailer of RETAILER_CATALOGUE) {
    if (!retailer.family) continue;
    families.set(retailer.family, [...(families.get(retailer.family) ?? []), retailer]);
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight">Every store we track</h1>
        <p className="max-w-prose text-sm text-fg-muted">
          {RETAILER_CATALOGUE.length} Canadian retailers in the catalogue. Stores we cannot
          currently reach are listed with their status rather than hidden.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Brand families</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[...families.entries()].map(([family, members]) => (
            <Link
              key={family}
              href={`/family/${family}`}
              className="flex flex-col gap-1 rounded border border-border bg-bg-raised p-3 transition-colors hover:border-accent"
            >
              <span className="text-sm font-semibold">{familyLabel(family)}</span>
              <span className="text-xs text-fg-muted">
                {members.length} banners · {members.map((m) => m.name).slice(0, 3).join(', ')}
                {members.length > 3 ? '…' : ''}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {[...byVertical.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([vertical, retailers]) => (
          <section key={vertical} className="flex flex-col gap-2">
            <h2 className="text-base font-semibold capitalize">{vertical}</h2>
            <ul className="grid gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-2">
              {retailers.map((retailer) => {
                const count = countBySlug.get(retailer.id) ?? 0;
                return (
                  <li
                    key={retailer.id}
                    className="flex items-center justify-between gap-2 bg-bg-raised px-3 py-2"
                  >
                    <Link href={`/m/${retailer.id}`} className="truncate text-sm hover:text-accent">
                      {retailer.name}
                    </Link>
                    <span className="flex shrink-0 items-center gap-2">
                      {count > 0 && (
                        <span className="font-mono text-xs tabular-nums text-fg-muted">
                          {count}
                        </span>
                      )}
                      <span
                        className={`rounded-sm px-1.5 py-0.5 text-[11px] ${
                          STATUS_TONE[retailer.enabled ? retailer.status : 'blocked']
                        }`}
                      >
                        {retailer.enabled ? STATUS_LABEL[retailer.status] : 'Not yet live'}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
    </main>
  );
}
