/** Geographic helpers. No external service, no key, no coordinates leaving the app. */

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance in kilometres. */
export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rounds to one decimal, the precision the UI displays. */
export function formatDistanceKm(km: number): string {
  return `${km.toFixed(1)} km`;
}

const POSTAL_FULL = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;
const POSTAL_FSA = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]$/i;

/** True for a full Canadian postal code ("M5V 3L9", "m5v3l9") or a bare FSA ("M5V"). */
export function isValidPostalInput(input: string): boolean {
  const cleaned = input.trim();
  return POSTAL_FULL.test(cleaned) || POSTAL_FSA.test(cleaned);
}

/** Extracts the Forward Sortation Area (first three characters), uppercased. */
export function toFsa(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (cleaned.length < 3) return null;
  const fsa = cleaned.slice(0, 3);
  return POSTAL_FSA.test(fsa) ? fsa : null;
}
