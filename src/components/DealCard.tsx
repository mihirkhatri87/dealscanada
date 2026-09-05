import Link from 'next/link';
import type { DealWithRelations } from '@/lib/db/types';
import {
  categoryLabel,
  departmentLabel,
  expiryLabel,
  discountConfidence,
  formatCents,
  headlineDiscount,
  isExpiringSoon,
  merchantInitials,
  relativeTime,
  showsPriceWas,
} from '@/lib/format';
import { VerdictBadge } from './VerdictBadge';
import { CouponCode } from './CouponCode';

/**
 * The core visual unit.
 *
 * Every surface in the product renders this same component — the front page, a
 * category, a store page, and the shopping assistant's results canvas. That is
 * deliberate: the assistant showing a different card from the one you get by
 * browsing would let its output drift from the real data.
 *
 * Six states have to work: full data, no before-price, no image, no coupon,
 * expired/sold out, and store-local.
 */
export function DealCard({ deal, now }: { deal: DealWithRelations; now?: Date }) {
  const discount = headlineDiscount(deal);
  const expires = expiryLabel(deal.expiresAt, now);
  const urgent = isExpiringSoon(deal.expiresAt, now);
  const flagged = deal.verdict === 'inflated-anchor';

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded border bg-bg-raised transition-shadow hover:shadow-lg ${
        flagged ? 'border-hot/40' : 'border-border'
      }`}
    >
      {/* Fixed aspect ratio reserves the space, so a loading image cannot shift
          the grid around it. */}
      <div className="relative aspect-[4/3] overflow-hidden bg-bg-inset">
        {/* Merchant initials sit underneath the image rather than as a branch, so
            a URL that resolves but fails to load still shows something. Product
            images come from ~100 merchant CDNs, several of which serve broken
            links for delisted stock. */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          aria-hidden="true"
        >
          <span className="font-mono text-3xl font-semibold text-fg-subtle/40">
            {merchantInitials(deal.merchant?.name)}
          </span>
        </div>

        {deal.imageUrl && (
          /* eslint-disable-next-line @next/next/no-img-element --
             Product images come from ~100 merchant CDNs plus inline data URIs in
             the seed set. next/image would need an allowlist covering every
             retailer in the catalogue and cannot handle data URIs at all. */
          <img
            src={deal.imageUrl}
            alt=""
            loading="lazy"
            className="relative h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        )}

        {discount !== null && (
          <span
            className={`absolute left-2 top-2 rounded-sm px-1.5 py-0.5 font-mono text-xs font-bold ${
              discountConfidence(deal) === 'verified'
                ? 'bg-deal text-deal-fg'
                : 'bg-bg/85 text-fg-muted backdrop-blur'
            }`}
            title={
              discountConfidence(deal) === 'verified'
                ? 'Verified against other stores'
                : 'Discount as claimed by the retailer'
            }
          >
            −{discount}%
          </span>
        )}

        {!deal.inStock && (
          <span className="absolute right-2 top-2 rounded-sm bg-bg/90 px-1.5 py-0.5 text-[11px] font-medium text-fg-muted backdrop-blur">
            Sold out
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
          <span className="truncate font-medium text-fg-muted">
            {deal.merchant?.name ?? 'Unknown store'}
          </span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{categoryLabel(deal.category)}</span>
          {departmentLabel(deal.department) && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{departmentLabel(deal.department)}</span>
            </>
          )}
        </div>

        <h3 className="text-sm font-semibold leading-snug">
          {/* Whole card is one link target; the coupon button sits above it. */}
          <Link href={`/deal/${deal.slug}`} className="after:absolute after:inset-0">
            <span className="line-clamp-2">{deal.title}</span>
          </Link>
        </h3>

        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-mono text-lg font-semibold tabular-nums">
            {formatCents(deal.priceNow, deal.currency)}
          </span>
          {showsPriceWas(deal) && (
            <span className="font-mono text-sm text-fg-subtle line-through tabular-nums">
              {formatCents(deal.priceWas, deal.currency)}
            </span>
          )}
        </div>

        {/* The verdict, and — when we have one — the sentence explaining it.
            A flagged anchor always shows its reason, because the whole point is
            that the shopper understands why the claim is not trustworthy. */}
        <div className="flex flex-col gap-1">
          <VerdictBadge verdict={deal.verdict} evidence={deal.evidence} />
          {flagged && deal.qualityNote && (
            <p className="text-[11px] leading-snug text-hot">{deal.qualityNote}</p>
          )}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          {deal.couponCode && (
            <span className="relative z-10">
              <CouponCode code={deal.couponCode} />
            </span>
          )}
          {deal.shippingNote && (
            <span className="rounded-sm bg-bg-inset px-1.5 py-0.5 text-[11px] text-fg-muted">
              {deal.shippingNote}
            </span>
          )}
          {expires && (
            <span
              className={`rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${
                urgent ? 'bg-hot-subtle text-hot' : 'bg-bg-inset text-fg-muted'
              }`}
            >
              {expires}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px] text-fg-subtle">
          <span>
            {deal.store
              ? `${deal.store.name}${deal.distanceKm !== undefined ? ` · ${deal.distanceKm.toFixed(1)} km` : ''}`
              : relativeTime(deal.postedAt, now)}
          </span>
          {deal.votes > 0 && <span className="tabular-nums">▲ {deal.votes}</span>}
        </div>
      </div>
    </article>
  );
}

/** Matches the card's real dimensions so nothing shifts when data arrives. */
export function DealCardSkeleton() {
  return (
    <div className="flex animate-pulse flex-col overflow-hidden rounded border border-border bg-bg-raised">
      <div className="aspect-[4/3] bg-bg-inset" />
      <div className="flex flex-col gap-2 p-3">
        <div className="h-3 w-24 rounded bg-bg-inset" />
        <div className="h-4 w-full rounded bg-bg-inset" />
        <div className="h-4 w-3/4 rounded bg-bg-inset" />
        <div className="h-6 w-28 rounded bg-bg-inset" />
        <div className="h-5 w-20 rounded bg-bg-inset" />
      </div>
    </div>
  );
}
