import { describe, expect, it } from 'vitest';
import { RateLimiter } from '@/lib/util/rate-limit';

describe('RateLimiter', () => {
  it('spaces consecutive requests to the same domain', () => {
    const limiter = new RateLimiter(1); // 1 rps => 1000 ms apart
    const now = 1_000_000;

    expect(limiter.reserve('example.ca', now)).toBe(0);
    expect(limiter.reserve('example.ca', now)).toBe(1000);
    expect(limiter.reserve('example.ca', now)).toBe(2000);
  });

  it('does not make one domain wait for another', () => {
    const limiter = new RateLimiter(1);
    const now = 1_000_000;

    limiter.reserve('a.ca', now);
    limiter.reserve('a.ca', now);
    expect(limiter.reserve('b.ca', now)).toBe(0);
  });

  it('applies a per-domain override', () => {
    const limiter = new RateLimiter(10);
    limiter.setDomainRate('stocktrack.ca', 0.5); // one request every 2 s
    const now = 1_000_000;

    limiter.reserve('stocktrack.ca', now);
    expect(limiter.reserve('stocktrack.ca', now)).toBe(2000);
    // The default domain is unaffected by the override.
    limiter.reserve('other.ca', now);
    expect(limiter.reserve('other.ca', now)).toBe(100);
  });

  it('is case-insensitive about domains', () => {
    const limiter = new RateLimiter(1);
    const now = 1_000_000;
    limiter.reserve('Example.CA', now);
    expect(limiter.reserve('example.ca', now)).toBe(1000);
  });

  it('pushes the next slot out when told to back off', () => {
    const limiter = new RateLimiter(10);
    const now = 1_000_000;

    limiter.backOff('example.ca', 5000, now);
    expect(limiter.delayFor('example.ca', now)).toBe(5000);
  });

  it('never shortens an existing delay when backing off', () => {
    const limiter = new RateLimiter(10);
    const now = 1_000_000;

    limiter.backOff('example.ca', 10_000, now);
    limiter.backOff('example.ca', 1000, now);
    expect(limiter.delayFor('example.ca', now)).toBe(10_000);
  });
});
