import { NextResponse } from 'next/server';
import { getRepository } from '@/lib/db';
import { apiQuerySchema, parseSearchParams, PAGE_SIZE } from '@/lib/query-params';

export const dynamic = 'force-dynamic';

/**
 * GET /api/deals
 *
 * Mirrors the UI's filters exactly, because it is backed by the same DealQuery
 * and the same repository call. A response here and the corresponding page can
 * never disagree about what matches.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = Object.fromEntries(url.searchParams.entries());

  const parsed = apiQuerySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: 'invalid_query',
        // Name the offending parameter: "invalid request" is not debuggable.
        message: `Invalid value for "${issue?.path.join('.') ?? 'query'}": ${issue?.message ?? 'unknown'}`,
      },
      { status: 400 },
    );
  }

  const { query, page } = parseSearchParams(raw);
  const limit = parsed.data.limit ?? PAGE_SIZE;
  const repo = await getRepository();

  const { deals, total } = await repo.queryDeals({
    ...query,
    limit,
    offset: (page - 1) * limit,
  });

  return NextResponse.json(
    {
      deals: deals.map(serializeDeal),
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    },
    {
      headers: {
        // Deals change on the scrape cadence, not per request.
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    },
  );
}

/** The public shape. Kept explicit so internal columns cannot leak by accident. */
function serializeDeal(deal: Awaited<ReturnType<Awaited<ReturnType<typeof getRepository>>['queryDeals']>>['deals'][number]) {
  return {
    id: deal.id,
    slug: deal.slug,
    title: deal.title,
    description: deal.description,
    url: deal.url,
    imageUrl: deal.imageUrl,
    merchant: deal.merchant
      ? { slug: deal.merchant.slug, name: deal.merchant.name, family: deal.merchant.family }
      : null,
    store: deal.store ? { id: deal.store.id, name: deal.store.name, chain: deal.store.chain } : null,
    distanceKm: deal.distanceKm ?? null,
    category: deal.category,
    department: deal.department,
    brand: deal.brand,
    price: { now: deal.priceNow, was: deal.priceWas, currency: deal.currency },
    // Verification is a first-class part of the response, not a footnote:
    // consumers of this API should find it as hard as the UI does to present a
    // discount claim we could not corroborate.
    verification: {
      verdict: deal.verdict,
      evidence: deal.evidence,
      claimedDiscountPct: deal.discountPct,
      marketDiscountPct: deal.marketDiscountPct,
      marketPrice: deal.marketPrice,
      observedLow: deal.observedLow,
      claimSuspect: deal.claimSuspect,
      note: deal.qualityNote,
    },
    couponCode: deal.couponCode,
    shippingNote: deal.shippingNote,
    inStock: deal.inStock,
    postedAt: deal.postedAt,
    expiresAt: deal.expiresAt,
    lastSeenAt: deal.lastSeenAt,
    source: deal.source,
    alsoSeenOn: deal.alsoSeenOn,
    heat: deal.heat,
  };
}
