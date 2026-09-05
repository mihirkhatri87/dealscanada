import { describe, expect, it } from 'vitest';
import { formatDistanceKm, haversineKm, isValidPostalInput, toFsa } from '@/lib/util/geo';

describe('haversineKm', () => {
  it('matches the known Toronto-Vancouver distance within 1%', () => {
    // CN Tower to Vancouver downtown: ~3363 km great-circle.
    const km = haversineKm(43.6426, -79.3871, 49.2827, -123.1207);
    expect(km).toBeGreaterThan(3363 * 0.99);
    expect(km).toBeLessThan(3363 * 1.01);
  });

  it('returns zero for identical points', () => {
    expect(haversineKm(45, -75, 45, -75)).toBe(0);
  });

  it('is symmetric', () => {
    const a = haversineKm(43.65, -79.38, 45.5, -73.57);
    const b = haversineKm(45.5, -73.57, 43.65, -79.38);
    expect(a).toBeCloseTo(b, 9);
  });

  it('handles a short intra-city distance', () => {
    // Eaton Centre to Union Station, ~1.1 km.
    const km = haversineKm(43.6544, -79.3807, 43.6453, -79.3806);
    expect(km).toBeGreaterThan(0.9);
    expect(km).toBeLessThan(1.3);
  });
});

describe('formatDistanceKm', () => {
  it('renders one decimal place', () => {
    expect(formatDistanceKm(3.14159)).toBe('3.1 km');
    expect(formatDistanceKm(12)).toBe('12.0 km');
  });
});

describe('postal input', () => {
  it.each([
    ['M5V 3L9', true],
    ['m5v3l9', true],
    ['M5V-3L9', true],
    ['M5V', true],
    ['m5v', true],
    ['12345', false],
    ['D1A 1A1', false], // D is not a valid first letter
    ['M5V 3L', false],
    ['', false],
    ['ZZZ ZZZ', false],
  ])('validates %s as %s', (input, expected) => {
    expect(isValidPostalInput(input)).toBe(expected);
  });

  it('extracts the FSA from any accepted form', () => {
    expect(toFsa('M5V 3L9')).toBe('M5V');
    expect(toFsa('m5v3l9')).toBe('M5V');
    expect(toFsa('M5V')).toBe('M5V');
  });

  it('returns null for input with no valid FSA', () => {
    expect(toFsa('12')).toBeNull();
    expect(toFsa('D1A')).toBeNull();
  });
});

describe('FSA resolution', () => {
  it('resolves major-city postal codes to a usable point', async () => {
    const { coordinatesForPostal } = await import('@/lib/util/fsa');

    const toronto = coordinatesForPostal('M5V 3L9');
    expect(toronto?.label).toBe('Toronto');
    expect(toronto?.precision).toBe('fsa');
    expect(toronto?.lat).toBeCloseTo(43.65, 0);

    expect(coordinatesForPostal('V6B1A1')?.label).toBe('Vancouver');
    expect(coordinatesForPostal('h3a 1a1')?.label).toBe('Montréal');
  });

  it('falls back to the province rather than returning nothing', async () => {
    const { coordinatesForPostal } = await import('@/lib/util/fsa');
    // P is northern Ontario, which has no city-level entry.
    const resolved = coordinatesForPostal('P3E 1A1');
    expect(resolved?.precision).toBe('province');
    expect(resolved?.label).toContain('Ontario');
  });

  it('rejects input that is not a Canadian postal code', async () => {
    const { coordinatesForPostal } = await import('@/lib/util/fsa');
    expect(coordinatesForPostal('12345')).toBeNull();
    expect(coordinatesForPostal('')).toBeNull();
  });

  it('resolves city names, accent-insensitively', async () => {
    const { coordinatesForCity, resolveLocation } = await import('@/lib/util/fsa');
    expect(coordinatesForCity('Toronto')?.precision).toBe('city');
    // Accent-folded on both sides, so the plain-ASCII spelling people type works.
    expect(coordinatesForCity('montreal')?.label).toBe('Montréal');
    expect(coordinatesForCity('Montréal')?.label).toBe('Montréal');
    expect(coordinatesForCity('calg')?.label).toBe('Calgary');
    expect(resolveLocation('Halifax')?.label).toBe('Halifax');
  });
});

describe('location cookie', () => {
  it('rejects coordinates outside Canada rather than querying on nonsense', async () => {
    const { decodeLocation } = await import('@/lib/location');
    const outside = encodeURIComponent(JSON.stringify({ lat: 51.5, lng: -0.12, label: 'London' }));
    expect(decodeLocation(outside)).toBeNull();

    const absurd = encodeURIComponent(JSON.stringify({ lat: 999, lng: -79 }));
    expect(decodeLocation(absurd)).toBeNull();
  });

  it('accepts a valid Canadian location', async () => {
    const { decodeLocation } = await import('@/lib/location');
    const valid = encodeURIComponent(
      JSON.stringify({ lat: 43.65, lng: -79.38, label: 'Toronto', precision: 'fsa' }),
    );
    expect(decodeLocation(valid)?.label).toBe('Toronto');
  });

  it('survives a malformed or absent cookie', async () => {
    const { decodeLocation } = await import('@/lib/location');
    expect(decodeLocation('not json')).toBeNull();
    expect(decodeLocation(undefined)).toBeNull();
    expect(decodeLocation('')).toBeNull();
  });

  it('caps the stored store list so a cookie cannot grow unbounded', async () => {
    const { decodeLocation } = await import('@/lib/location');
    const many = encodeURIComponent(
      JSON.stringify({
        lat: 43.65,
        lng: -79.38,
        storeIds: Array.from({ length: 100 }, (_, i) => `store-${i}`),
      }),
    );
    expect(decodeLocation(many)?.storeIds?.length).toBeLessThanOrEqual(20);
  });
});

describe('postal versus city disambiguation', () => {
  it('does not read a city name as a postal code by its first letter', async () => {
    const { resolveLocation } = await import('@/lib/util/fsa');

    // Every one of these starts with a valid postal-code letter. Matching on the
    // letter alone sent Halifax to Montréal and Toronto to Alberta.
    expect(resolveLocation('Halifax')?.label).toBe('Halifax');
    expect(resolveLocation('Toronto')?.label).toBe('Toronto');
    expect(resolveLocation('Calgary')?.label).toBe('Calgary');
    expect(resolveLocation('Victoria')?.label).toBe('Victoria');
    expect(resolveLocation('Edmonton')?.label).toBe('Edmonton');
    expect(resolveLocation('Saskatoon')?.label).toBe('Saskatoon');
    expect(resolveLocation('Regina')?.label).toBe('Regina');
    expect(resolveLocation('London')?.label).toBe('London');
  });

  it('still resolves genuine postal codes ahead of city names', async () => {
    const { resolveLocation } = await import('@/lib/util/fsa');
    expect(resolveLocation('M5V 3L9')?.precision).toBe('fsa');
    expect(resolveLocation('T2P1J9')?.label).toBe('Calgary');
  });
});
