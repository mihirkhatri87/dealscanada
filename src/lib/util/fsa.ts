/**
 * Forward Sortation Area centroids.
 *
 * Canada Post postal codes begin with a three-character FSA, and the first
 * character alone identifies a province or region. Mapping an FSA to an
 * approximate point is enough to answer "which stores are near me" without ever
 * sending a coordinate to a geocoding service — which is both a privacy property
 * and the reason this feature needs no API key.
 *
 * Precision is deliberately coarse. A shopper choosing between stores 3 km and
 * 40 km away is not affected by a few hundred metres of error, and pretending to
 * more accuracy than a centroid supports would be dishonest.
 */

export interface Coordinates {
  lat: number;
  lng: number;
  /** How the point was derived, so the UI can be honest about precision. */
  precision: 'fsa' | 'city' | 'province';
  label: string;
}

/** Centroids for the FSA prefixes of major Canadian population centres. */
const FSA_PREFIX: Record<string, { lat: number; lng: number; label: string }> = {
  // Toronto and GTA
  M4: { lat: 43.6866, lng: -79.3535, label: 'Toronto' },
  M5: { lat: 43.6532, lng: -79.3832, label: 'Toronto' },
  M6: { lat: 43.6738, lng: -79.4405, label: 'Toronto' },
  M1: { lat: 43.7599, lng: -79.2255, label: 'Scarborough' },
  M2: { lat: 43.7712, lng: -79.4103, label: 'North York' },
  M3: { lat: 43.7543, lng: -79.4422, label: 'North York' },
  M8: { lat: 43.6205, lng: -79.5132, label: 'Etobicoke' },
  M9: { lat: 43.7118, lng: -79.5666, label: 'Etobicoke' },
  L4: { lat: 43.8361, lng: -79.4983, label: 'Vaughan' },
  L5: { lat: 43.5890, lng: -79.6441, label: 'Mississauga' },
  L6: { lat: 43.7315, lng: -79.7624, label: 'Brampton' },
  L3: { lat: 43.8828, lng: -79.2663, label: 'Markham' },
  L1: { lat: 43.8971, lng: -78.8658, label: 'Oshawa' },
  L8: { lat: 43.2557, lng: -79.8711, label: 'Hamilton' },
  N2: { lat: 43.4643, lng: -80.5204, label: 'Kitchener–Waterloo' },
  K1: { lat: 45.4215, lng: -75.6972, label: 'Ottawa' },
  K2: { lat: 45.3475, lng: -75.7594, label: 'Ottawa' },
  N6: { lat: 42.9849, lng: -81.2453, label: 'London' },

  // Quebec
  H1: { lat: 45.5744, lng: -73.5492, label: 'Montréal' },
  H2: { lat: 45.5300, lng: -73.5900, label: 'Montréal' },
  H3: { lat: 45.4972, lng: -73.5794, label: 'Montréal' },
  H4: { lat: 45.4790, lng: -73.6440, label: 'Montréal' },
  H7: { lat: 45.6066, lng: -73.7124, label: 'Laval' },
  H9: { lat: 45.4600, lng: -73.8300, label: 'West Island' },
  J4: { lat: 45.4700, lng: -73.4500, label: 'Longueuil' },
  G1: { lat: 46.8139, lng: -71.2080, label: 'Québec City' },

  // Western Canada
  V5: { lat: 49.2276, lng: -123.0076, label: 'Vancouver' },
  V6: { lat: 49.2650, lng: -123.1300, label: 'Vancouver' },
  V7: { lat: 49.3200, lng: -123.0700, label: 'North Vancouver' },
  V3: { lat: 49.2057, lng: -122.9110, label: 'Surrey' },
  V8: { lat: 48.4284, lng: -123.3656, label: 'Victoria' },
  T2: { lat: 51.0447, lng: -114.0719, label: 'Calgary' },
  T3: { lat: 51.1000, lng: -114.1800, label: 'Calgary' },
  T5: { lat: 53.5461, lng: -113.4938, label: 'Edmonton' },
  T6: { lat: 53.4700, lng: -113.4900, label: 'Edmonton' },
  S7: { lat: 52.1332, lng: -106.6700, label: 'Saskatoon' },
  S4: { lat: 50.4452, lng: -104.6189, label: 'Regina' },
  R3: { lat: 49.8951, lng: -97.1384, label: 'Winnipeg' },
  R2: { lat: 49.9200, lng: -97.1400, label: 'Winnipeg' },

  // Atlantic and North
  B3: { lat: 44.6488, lng: -63.5752, label: 'Halifax' },
  E1: { lat: 46.0878, lng: -64.7782, label: 'Moncton' },
  A1: { lat: 47.5615, lng: -52.7126, label: "St. John's" },
  C1: { lat: 46.2382, lng: -63.1311, label: 'Charlottetown' },
  X1: { lat: 62.4540, lng: -114.3718, label: 'Yellowknife' },
  Y1: { lat: 60.7212, lng: -135.0568, label: 'Whitehorse' },
};

/** Province-level fallback, keyed by the first character of the postal code. */
const PROVINCE_BY_LETTER: Record<string, { lat: number; lng: number; label: string }> = {
  A: { lat: 47.5615, lng: -52.7126, label: 'Newfoundland and Labrador' },
  B: { lat: 44.6488, lng: -63.5752, label: 'Nova Scotia' },
  C: { lat: 46.2382, lng: -63.1311, label: 'Prince Edward Island' },
  E: { lat: 45.9636, lng: -66.6431, label: 'New Brunswick' },
  G: { lat: 46.8139, lng: -71.2080, label: 'Eastern Québec' },
  H: { lat: 45.5019, lng: -73.5674, label: 'Montréal' },
  J: { lat: 45.4000, lng: -73.2000, label: 'Western Québec' },
  K: { lat: 45.4215, lng: -75.6972, label: 'Eastern Ontario' },
  L: { lat: 43.6000, lng: -79.6000, label: 'Central Ontario' },
  M: { lat: 43.6532, lng: -79.3832, label: 'Toronto' },
  N: { lat: 43.0000, lng: -81.0000, label: 'Southwestern Ontario' },
  P: { lat: 46.4917, lng: -80.9930, label: 'Northern Ontario' },
  R: { lat: 49.8951, lng: -97.1384, label: 'Manitoba' },
  S: { lat: 52.1332, lng: -106.6700, label: 'Saskatchewan' },
  T: { lat: 51.0447, lng: -114.0719, label: 'Alberta' },
  V: { lat: 49.2827, lng: -123.1207, label: 'British Columbia' },
  X: { lat: 62.4540, lng: -114.3718, label: 'Northwest Territories and Nunavut' },
  Y: { lat: 60.7212, lng: -135.0568, label: 'Yukon' },
};

/**
 * Resolves a postal code or FSA to an approximate point.
 *
 * Falls back from the two-character prefix to the province, so any valid
 * Canadian postal code produces a usable location rather than nothing.
 */
export function coordinatesForPostal(input: string): Coordinates | null {
  const cleaned = input.trim().toUpperCase().replace(/[\s-]/g, '');

  // Must actually look like an FSA: letter, digit, letter. Without this check a
  // city name is silently read as a postal code by its first letter alone, so
  // "Halifax" resolves to Montréal (H) and "Toronto" to Alberta (T).
  if (!/^[ABCEGHJ-NPRSTVXY]\d[A-Z]/.test(cleaned)) return null;

  const prefix = cleaned.slice(0, 2);
  const exact = FSA_PREFIX[prefix];
  if (exact) return { ...exact, precision: 'fsa' };

  const letter = cleaned[0];
  const province = letter ? PROVINCE_BY_LETTER[letter] : undefined;
  if (province) return { ...province, precision: 'province' };

  return null;
}

/** Cities a shopper is likely to type, for the manual-entry fallback. */
export const KNOWN_CITIES: Array<{ name: string; lat: number; lng: number }> = [
  { name: 'Toronto', lat: 43.6532, lng: -79.3832 },
  { name: 'Montréal', lat: 45.5019, lng: -73.5674 },
  { name: 'Vancouver', lat: 49.2827, lng: -123.1207 },
  { name: 'Calgary', lat: 51.0447, lng: -114.0719 },
  { name: 'Edmonton', lat: 53.5461, lng: -113.4938 },
  { name: 'Ottawa', lat: 45.4215, lng: -75.6972 },
  { name: 'Winnipeg', lat: 49.8951, lng: -97.1384 },
  { name: 'Québec City', lat: 46.8139, lng: -71.2080 },
  { name: 'Hamilton', lat: 43.2557, lng: -79.8711 },
  { name: 'Mississauga', lat: 43.589, lng: -79.6441 },
  { name: 'Halifax', lat: 44.6488, lng: -63.5752 },
  { name: 'Victoria', lat: 48.4284, lng: -123.3656 },
  { name: 'Saskatoon', lat: 52.1332, lng: -106.67 },
  { name: 'Regina', lat: 50.4452, lng: -104.6189 },
  { name: 'London', lat: 42.9849, lng: -81.2453 },
  { name: 'Kitchener', lat: 43.4516, lng: -80.4925 },
];

export function coordinatesForCity(input: string): Coordinates | null {
  const needle = input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (needle.length < 2) return null;

  const match = KNOWN_CITIES.find((city) => {
    const name = city.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return name === needle || name.startsWith(needle);
  });

  return match
    ? { lat: match.lat, lng: match.lng, precision: 'city', label: match.name }
    : null;
}

/** Accepts either a postal code or a city name. */
export function resolveLocation(input: string): Coordinates | null {
  return coordinatesForPostal(input) ?? coordinatesForCity(input);
}
