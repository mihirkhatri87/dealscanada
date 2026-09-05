/**
 * Per-domain token bucket.
 *
 * Every outbound request in this project passes through here. The default is
 * deliberately slow (1 rps) and stocktrack.ca is slower still — we are a guest on
 * these servers, and a deal aggregator that hammers a small independent site is a
 * problem regardless of whether robots.txt technically permits it.
 */
export class RateLimiter {
  private readonly nextAvailable = new Map<string, number>();
  private readonly overrides = new Map<string, number>();

  constructor(private readonly defaultRps: number) {}

  /** Sets a per-domain rate, used for sites that warrant extra care. */
  setDomainRate(domain: string, rps: number): void {
    this.overrides.set(domain.toLowerCase(), rps);
  }

  private intervalMs(domain: string): number {
    const rps = this.overrides.get(domain.toLowerCase()) ?? this.defaultRps;
    return 1000 / rps;
  }

  /** Milliseconds a request to this domain must wait before it may proceed. */
  delayFor(domain: string, now: number = Date.now()): number {
    const key = domain.toLowerCase();
    const available = this.nextAvailable.get(key) ?? 0;
    return Math.max(0, available - now);
  }

  /** Reserves the next slot for a domain, returning how long the caller must wait. */
  reserve(domain: string, now: number = Date.now()): number {
    const key = domain.toLowerCase();
    const interval = this.intervalMs(key);
    const available = this.nextAvailable.get(key) ?? 0;
    const start = Math.max(now, available);
    this.nextAvailable.set(key, start + interval);
    return start - now;
  }

  /** Blocks until this domain's next slot is free. */
  async acquire(domain: string): Promise<void> {
    const wait = this.reserve(domain);
    if (wait > 0) await sleep(wait);
  }

  /** Pushes a domain's next slot out, e.g. after a 429 with Retry-After. */
  backOff(domain: string, ms: number, now: number = Date.now()): void {
    const key = domain.toLowerCase();
    const available = this.nextAvailable.get(key) ?? 0;
    this.nextAvailable.set(key, Math.max(available, now + ms));
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
