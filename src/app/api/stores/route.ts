import { NextResponse } from 'next/server';
import { getRepository } from '@/lib/db';
import { DEFAULT_RADIUS_KM } from '@/lib/location';

export const dynamic = 'force-dynamic';

/** GET /api/stores?lat&lng&radius — stores near a point, ordered by distance. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { error: 'invalid_query', message: 'lat and lng are required and must be numbers' },
      { status: 400 },
    );
  }

  // Absence and zero are different things: Number(null) is 0, which is finite,
  // so testing the parsed value alone silently collapsed a missing radius into
  // a 1 km search.
  const rawRadius = url.searchParams.get('radius');
  const requested = rawRadius === null ? Number.NaN : Number(rawRadius);

  // Clamp rather than reject: a silly radius should still answer, and the
  // response reports what was actually used.
  const radiusKm = Number.isFinite(requested)
    ? Math.min(200, Math.max(1, requested))
    : DEFAULT_RADIUS_KM;

  const repo = await getRepository();
  const stores = await repo.findStoresNear(lat, lng, radiusKm);

  return NextResponse.json({
    radiusKm,
    stores: stores.map((store) => ({
      id: store.id,
      chain: store.chain,
      name: store.name,
      address: store.address,
      city: store.city,
      province: store.province,
      distanceKm: Math.round(store.distanceKm * 10) / 10,
    })),
  });
}
