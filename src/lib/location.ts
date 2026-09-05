import type { Coordinates } from './util/fsa';

/**
 * The user's location, stored client-side only.
 *
 * Kept in localStorage AND a cookie: localStorage is the durable copy, the
 * cookie is what lets the server render the "near you" section on first paint
 * rather than popping it in after hydration.
 *
 * Nothing here is ever sent to a third party. Resolution happens against a
 * bundled FSA table, so a postal code never leaves the application.
 */

export const LOCATION_COOKIE = 'dc_loc';

export interface StoredLocation {
  lat: number;
  lng: number;
  label: string;
  precision: Coordinates['precision'] | 'gps';
  /** Stores the user picked to track, driving what stocktrack scrapes. */
  storeIds?: string[];
}

export function encodeLocation(location: StoredLocation): string {
  return encodeURIComponent(JSON.stringify(location));
}

/** Cookie values are user-controlled, so every field is validated on the way in. */
export function decodeLocation(raw: string | undefined | null): StoredLocation | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (!parsed || typeof parsed !== 'object') return null;

    const value = parsed as Record<string, unknown>;
    const lat = Number(value['lat']);
    const lng = Number(value['lng']);

    // Reject anything outside Canada's bounding box rather than trusting it —
    // a malformed cookie should degrade to "no location", not to a radius query
    // against nonsense coordinates.
    if (!Number.isFinite(lat) || lat < 41 || lat > 84) return null;
    if (!Number.isFinite(lng) || lng < -142 || lng > -52) return null;

    const storeIds = Array.isArray(value['storeIds'])
      ? value['storeIds'].filter((id): id is string => typeof id === 'string').slice(0, 20)
      : undefined;

    return {
      lat,
      lng,
      label: typeof value['label'] === 'string' ? value['label'].slice(0, 60) : 'Your area',
      precision: (value['precision'] as StoredLocation['precision']) ?? 'fsa',
      storeIds,
    };
  } catch {
    return null;
  }
}

export const DEFAULT_RADIUS_KM = 25;
