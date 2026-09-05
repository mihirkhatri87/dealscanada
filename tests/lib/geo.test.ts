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
