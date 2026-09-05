import Link from 'next/link';
import { getRepository } from '@/lib/db';
import { formatCents } from '@/lib/format';
import { CouponCode } from '@/components/CouponCode';
import { VerdictBadge } from '@/components/VerdictBadge';
import { EmptyState } from '@/components/DealGrid';
import { expiryLabel, isExpiringSoon } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Coupon codes' };

/**
 * Coupons grouped by store.
 *
 * Deliberately not the card grid: someone here already knows what they want to
 * buy and is looking for a code, so the code itself is the primary element and
 * the product is context.
 */
export default async function CouponsPage() {
  const repo = await getRepository();
  const { deals } = await repo.queryDeals({ couponOnly: true, sort: 'expiring', limit: 100 });

  const byMerchant = new Map<string, typeof deals>();
  for (const deal of deals) {
    const key = deal.merchant?.name ?? 'Other stores';
    byMerchant.set(key, [...(byMerchant.get(key) ?? []), deal]);
  }

  const groups = [...byMerchant.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight">Coupon codes</h1>
        <p className="text-sm text-fg-muted">
          Codes we found attached to a current deal, soonest to expire first. Click a code to copy
          it.
        </p>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title="No coupon codes right now"
          message="We only list a code when it came attached to a deal we can point at — we do not republish code lists we cannot verify."
          action={
            <Link href="/" className="text-sm font-medium text-accent hover:underline">
              Browse all deals
            </Link>
          }
        />
      ) : (
        groups.map(([merchant, group]) => (
          <section key={merchant} className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">{merchant}</h2>
            <ul className="flex flex-col gap-px overflow-hidden rounded border border-border bg-border">
              {group.map((deal) => {
                const expires = expiryLabel(deal.expiresAt);
                return (
                  <li
                    key={deal.id}
                    className="flex flex-wrap items-center justify-between gap-3 bg-bg-raised px-3 py-2.5"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <Link
                        href={`/deal/${deal.slug}`}
                        className="truncate text-sm font-medium hover:text-accent"
                      >
                        {deal.title}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                        <span className="font-mono tabular-nums">
                          {formatCents(deal.priceNow, deal.currency)}
                        </span>
                        <VerdictBadge verdict={deal.verdict} evidence={deal.evidence} />
                        {expires && (
                          <span className={isExpiringSoon(deal.expiresAt) ? 'text-hot' : ''}>
                            {expires}
                          </span>
                        )}
                      </div>
                    </div>
                    {deal.couponCode && <CouponCode code={deal.couponCode} />}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
