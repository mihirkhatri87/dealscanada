import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getRepository } from '@/lib/db';
import {
  categoryLabel,
  departmentLabel,
  expiryLabel,
  discountConfidence,
  familyLabel,
  formatCents,
  headlineDiscount,
  presentEvidence,
  relativeTime,
  showsPriceWas,
} from '@/lib/format';
import { applyAffiliateTemplate } from '@/lib/util/url';
import { VerdictBadge } from '@/components/VerdictBadge';
import { CouponCode } from '@/components/CouponCode';
import { PriceHistory } from '@/components/PriceHistory';
import { DealGrid } from '@/components/DealGrid';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const repo = await getRepository();
  const deal = await repo.getDealBySlug(slug);
  if (!deal) return { title: 'Deal not found' };

  return {
    title: deal.title,
    description:
      deal.qualityNote ??
      `${formatCents(deal.priceNow, deal.currency)} at ${deal.merchant?.name ?? 'a Canadian retailer'}.`,
  };
}

export default async function DealPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const repo = await getRepository();

  const deal = await repo.getDealBySlug(slug);
  if (!deal) notFound();

  const [history, related] = await Promise.all([
    repo.getPriceHistory(deal.id),
    repo.queryDeals({ categories: [deal.category], limit: 4, sort: 'best-verified' }),
  ]);

  const discount = headlineDiscount(deal);
  const expires = expiryLabel(deal.expiresAt);
  // Affiliate templates live on the merchant record; none is configured yet, so
  // this is the plain URL today and becomes the tagged one the moment a program
  // is approved, without touching this page.
  const outbound = applyAffiliateTemplate(deal.url, null);
  const flagged = deal.verdict === 'inflated-anchor';

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-6">
      <nav className="text-xs text-fg-muted" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-fg">
          All deals
        </Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/c/${deal.category}`} className="hover:text-fg">
          {categoryLabel(deal.category)}
        </Link>
        {deal.merchant && (
          <>
            <span aria-hidden="true"> / </span>
            <Link href={`/m/${deal.merchant.slug}`} className="hover:text-fg">
              {deal.merchant.name}
            </Link>
          </>
        )}
      </nav>

      {deal.source === 'seed' && (
        <p className="rounded border border-warn/40 bg-warn-subtle px-3 py-2 text-sm text-warn">
          <strong className="font-semibold">This is sample data.</strong> It was generated to
          demonstrate the interface and the verification engine — the price is not real and the
          link does not lead to a live product. Run{' '}
          <code className="font-mono text-xs">npm run scrape</code> to load actual deals.
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-5">
          <div className="relative aspect-[4/3] overflow-hidden rounded border border-border bg-bg-inset">
            {deal.imageUrl && (
              /* eslint-disable-next-line @next/next/no-img-element --
                 merchant CDNs and data URIs; see DealCard for the full note. */
              <img src={deal.imageUrl} alt="" className="h-full w-full object-cover" />
            )}
            {discount !== null && (
              <span
                className={`absolute left-3 top-3 rounded px-2 py-1 font-mono text-sm font-bold ${
                  discountConfidence(deal) === 'verified'
                    ? 'bg-deal text-deal-fg'
                    : 'bg-bg/85 text-fg-muted backdrop-blur'
                }`}
              >
                −{discount}%
                <span className="ml-1.5 font-sans text-[10px] font-medium opacity-80">
                  {discountConfidence(deal) === 'verified' ? 'verified' : 'as claimed'}
                </span>
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
              <span className="font-medium">{deal.merchant?.name ?? 'Unknown store'}</span>
              {deal.merchant?.family && (
                <>
                  <span aria-hidden="true">·</span>
                  <Link
                    href={`/family/${deal.merchant.family}`}
                    className="hover:text-accent hover:underline"
                  >
                    {familyLabel(deal.merchant.family)}
                  </Link>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>{categoryLabel(deal.category)}</span>
              {departmentLabel(deal.department) && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{departmentLabel(deal.department)}</span>
                </>
              )}
            </div>

            <h1 className="text-xl font-bold leading-tight">{deal.title}</h1>

            {deal.description && (
              <p className="max-w-prose text-sm leading-relaxed text-fg-muted">
                {deal.description}
              </p>
            )}
          </div>

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Price history</h2>
            <PriceHistory points={history} currency={deal.currency} />
          </section>

          {related.deals.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">More in {categoryLabel(deal.category)}</h2>
              <DealGrid deals={related.deals.filter((entry) => entry.id !== deal.id).slice(0, 3)} />
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded border border-border bg-bg-raised p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-2xl font-bold tabular-nums">
                {formatCents(deal.priceNow, deal.currency)}
              </span>
              {showsPriceWas(deal) && (
                <span className="font-mono text-base text-fg-subtle line-through tabular-nums">
                  {formatCents(deal.priceWas, deal.currency)}
                </span>
              )}
            </div>

            <VerdictBadge verdict={deal.verdict} evidence={deal.evidence} size="md" />

            {/* The verification detail. This is the section that distinguishes
                the product, so it gets full prose rather than a tooltip. */}
            <div
              className={`flex flex-col gap-2 rounded-sm p-3 text-sm ${
                flagged ? 'bg-hot-subtle text-hot' : 'bg-bg-inset text-fg-muted'
              }`}
            >
              {deal.qualityNote && <p className="leading-snug">{deal.qualityNote}</p>}
              <p className="text-xs opacity-90">{presentEvidence(deal.evidence)}</p>

              {deal.marketPrice !== null && (
                <p className="text-xs">
                  Median elsewhere:{' '}
                  <span className="font-mono tabular-nums">
                    {formatCents(deal.marketPrice, deal.currency)}
                  </span>
                </p>
              )}
              {deal.observedLow !== null && (
                <p className="text-xs">
                  Lowest we&rsquo;ve recorded:{' '}
                  <span className="font-mono tabular-nums">
                    {formatCents(deal.observedLow, deal.currency)}
                  </span>
                </p>
              )}
            </div>

            {deal.couponCode && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                  Coupon code
                </span>
                <CouponCode code={deal.couponCode} />
              </div>
            )}

            {deal.source === 'seed' ? (
              <span className="rounded border border-dashed border-border px-4 py-2.5 text-center text-sm text-fg-muted">
                No link — sample data
              </span>
            ) : (
              <a
                href={outbound}
                target="_blank"
                rel="noopener nofollow sponsored"
                className="rounded bg-accent px-4 py-2.5 text-center text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
              >
                Go to {deal.merchant?.name ?? 'store'} →
              </a>
            )}

            <dl className="flex flex-col gap-1.5 text-xs text-fg-muted">
              <div className="flex justify-between gap-2">
                <dt>Availability</dt>
                <dd className={deal.inStock ? '' : 'text-warn'}>
                  {deal.inStock ? 'In stock' : 'Sold out'}
                </dd>
              </div>
              {expires && (
                <div className="flex justify-between gap-2">
                  <dt>Expiry</dt>
                  <dd>{expires}</dd>
                </div>
              )}
              {deal.shippingNote && (
                <div className="flex justify-between gap-2">
                  <dt>Shipping</dt>
                  <dd>{deal.shippingNote}</dd>
                </div>
              )}
              {deal.sizesAvailable && deal.sizesAvailable.length > 0 && (
                <div className="flex justify-between gap-2">
                  <dt>Sizes</dt>
                  <dd className="text-right">{deal.sizesAvailable.join(', ')}</dd>
                </div>
              )}
              {deal.store && (
                <div className="flex justify-between gap-2">
                  <dt>Store</dt>
                  <dd className="text-right">{deal.store.name}</dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt>First seen</dt>
                <dd>{relativeTime(deal.postedAt)}</dd>
              </div>
            </dl>
          </div>

          {/* Attribution: every deal credits and links to where it came from. */}
          <div className="rounded border border-border bg-bg-raised p-3 text-xs text-fg-muted">
            <p>
              Found via <span className="font-medium text-fg">{deal.source}</span>
              {deal.alsoSeenOn && deal.alsoSeenOn.length > 1 && (
                <> · also seen on {deal.alsoSeenOn.filter((s) => s !== deal.source).join(', ')}</>
              )}
            </p>
            <p className="mt-1.5">
              Price observed {relativeTime(deal.lastSeenAt)}. Confirm on the retailer&rsquo;s site
              before buying.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
