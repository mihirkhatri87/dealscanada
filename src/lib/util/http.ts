import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { env } from '../config';
import { RateLimiter, sleep } from './rate-limit';
import { RobotsDisallowedError, RobotsTxt } from './robots';

export { RobotsDisallowedError };

export interface FetchOptions {
  /** Skip the robots.txt gate. Only for endpoints a site publishes as an API. */
  skipRobots?: boolean;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
  /** Cache TTL override in minutes; 0 disables caching for this request. */
  cacheTtlMinutes?: number;
  /** Base delay for exponential backoff. Lowered in tests to keep them fast. */
  retryBaseMs?: number;
  signal?: AbortSignal;
}

export interface HttpResponse<T> {
  data: T;
  status: number;
  fromCache: boolean;
  latencyMs: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

interface CacheEntry {
  body: string;
  status: number;
  etag?: string;
  lastModified?: string;
  storedAt: number;
}

/**
 * The single outbound HTTP path.
 *
 * Responsibilities, all of which exist so we are a well-behaved guest:
 *   - identify ourselves honestly via a descriptive User-Agent with a contact route
 *   - respect robots.txt before any HTML scrape
 *   - rate limit per domain, with stricter limits for small independent sites
 *   - retry only what is worth retrying (429, 5xx, network), with backoff and jitter
 *   - use conditional requests and an on-disk cache so we do not refetch unchanged pages
 */
export class HttpClient {
  private readonly limiter: RateLimiter;
  private readonly robotsCache = new Map<string, RobotsTxt>();
  private readonly cacheDir: string;

  constructor(
    private readonly userAgent: string = env.SCRAPE_USER_AGENT,
    rps: number = env.RATE_LIMIT_RPS,
    cacheDir: string = env.HTTP_CACHE_DIR,
  ) {
    this.limiter = new RateLimiter(rps);
    this.cacheDir = cacheDir;
    // stocktrack.ca is a small independent site; it gets a deliberately slow lane.
    this.limiter.setDomainRate('stocktrack.ca', env.STOCKTRACK_RATE_LIMIT_RPS);
    this.limiter.setDomainRate('www.stocktrack.ca', env.STOCKTRACK_RATE_LIMIT_RPS);
  }

  setDomainRate(domain: string, rps: number): void {
    this.limiter.setDomainRate(domain, rps);
  }

  async fetchText(url: string, options: FetchOptions = {}): Promise<HttpResponse<string>> {
    return this.request(url, options);
  }

  async fetchJson<T>(url: string, options: FetchOptions = {}): Promise<HttpResponse<T>> {
    const response = await this.request(url, {
      ...options,
      headers: { Accept: 'application/json', ...options.headers },
    });
    let data: T;
    try {
      data = JSON.parse(response.data) as T;
    } catch {
      throw new HttpError(response.status, url, `Response from ${url} was not valid JSON`);
    }
    return { ...response, data };
  }

  /** True when robots.txt permits our user-agent to fetch this URL. */
  async isAllowed(url: string): Promise<boolean> {
    const parsed = new URL(url);
    const robots = await this.robotsFor(parsed.origin);
    return robots.isAllowed(parsed.pathname + parsed.search, this.userAgent);
  }

  private async robotsFor(origin: string): Promise<RobotsTxt> {
    const cached = this.robotsCache.get(origin);
    if (cached) return cached;

    let robots: RobotsTxt;
    try {
      const response = await this.rawFetch(`${origin}/robots.txt`, {
        timeoutMs: 10000,
        headers: {},
      });
      robots = response.status === 200 ? RobotsTxt.parse(response.body) : RobotsTxt.allowAll();
    } catch {
      // A missing or unreachable robots.txt is not permission to ignore it, but it
      // is also not a prohibition. The convention is to proceed.
      robots = RobotsTxt.allowAll();
    }

    this.robotsCache.set(origin, robots);
    return robots;
  }

  private async request(url: string, options: FetchOptions): Promise<HttpResponse<string>> {
    const started = Date.now();
    const parsed = new URL(url);

    if (!options.skipRobots && !(await this.isAllowed(url))) {
      throw new RobotsDisallowedError(url);
    }

    const ttlMinutes = options.cacheTtlMinutes ?? env.HTTP_CACHE_TTL_MINUTES;
    const cached = ttlMinutes > 0 ? this.readCache(url) : null;

    if (cached && Date.now() - cached.storedAt < ttlMinutes * 60_000) {
      return { data: cached.body, status: cached.status, fromCache: true, latencyMs: 0 };
    }

    const maxRetries = options.maxRetries ?? env.HTTP_MAX_RETRIES;
    const retryBaseMs = options.retryBaseMs ?? 500;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      await this.limiter.acquire(parsed.hostname);

      try {
        const conditional: Record<string, string> = {};
        if (cached?.etag) conditional['If-None-Match'] = cached.etag;
        if (cached?.lastModified) conditional['If-Modified-Since'] = cached.lastModified;

        const response = await this.rawFetch(url, {
          timeoutMs: options.timeoutMs,
          headers: { ...conditional, ...options.headers },
          signal: options.signal,
        });

        // 304: the cached body is still current. Refresh its age and serve it.
        if (response.status === 304 && cached) {
          this.writeCache(url, { ...cached, storedAt: Date.now() });
          return {
            data: cached.body,
            status: 200,
            fromCache: true,
            latencyMs: Date.now() - started,
          };
        }

        if (response.status === 429 || response.status >= 500) {
          const retryAfterMs = parseRetryAfter(response.headers['retry-after']);
          if (retryAfterMs !== null) this.limiter.backOff(parsed.hostname, retryAfterMs);

          if (attempt < maxRetries) {
            await sleep(retryAfterMs ?? backoffDelay(attempt, retryBaseMs));
            lastError = new HttpError(response.status, url);
            continue;
          }
          throw new HttpError(response.status, url);
        }

        // Any other 4xx is a real answer, not a transient failure. Do not retry it.
        if (response.status >= 400) throw new HttpError(response.status, url);

        if (ttlMinutes > 0) {
          this.writeCache(url, {
            body: response.body,
            status: response.status,
            etag: response.headers['etag'],
            lastModified: response.headers['last-modified'],
            storedAt: Date.now(),
          });
        }

        return {
          data: response.body,
          status: response.status,
          fromCache: false,
          latencyMs: Date.now() - started,
        };
      } catch (error) {
        // Never retry a definitive answer or a policy decision.
        if (error instanceof RobotsDisallowedError) throw error;
        if (error instanceof HttpError && error.status < 500 && error.status !== 429) {
          throw error;
        }
        lastError = error;
        if (attempt < maxRetries) {
          await sleep(backoffDelay(attempt, retryBaseMs));
          continue;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Request to ${url} failed after ${maxRetries + 1} attempts`);
  }

  private async rawFetch(
    url: string,
    options: { timeoutMs?: number; headers?: Record<string, string>; signal?: AbortSignal },
  ): Promise<{ status: number; body: string; headers: Record<string, string> }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? env.HTTP_TIMEOUT_MS);

    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept-Language': 'en-CA,en;q=0.9,fr-CA;q=0.8',
          ...options.headers,
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      // A 304 carries no body; reading it would just yield an empty string.
      const body = response.status === 304 ? '' : await response.text();
      return { status: response.status, body, headers };
    } finally {
      clearTimeout(timeout);
    }
  }

  private cachePath(url: string): string {
    const hash = createHash('sha256').update(url).digest('hex');
    return join(this.cacheDir, `${hash}.json`);
  }

  private readCache(url: string): CacheEntry | null {
    try {
      const path = this.cachePath(url);
      if (!existsSync(path)) return null;
      return JSON.parse(readFileSync(path, 'utf8')) as CacheEntry;
    } catch {
      return null;
    }
  }

  private writeCache(url: string, entry: CacheEntry): void {
    try {
      mkdirSync(this.cacheDir, { recursive: true });
      writeFileSync(this.cachePath(url), JSON.stringify(entry), 'utf8');
    } catch {
      // A cache write failure must never fail a scrape.
    }
  }
}

/** Exponential backoff with jitter, so retries from parallel adapters do not align. */
export function backoffDelay(attempt: number, baseMs = 500): number {
  const exponential = baseMs * 2 ** attempt;
  const jitter = Math.random() * baseMs;
  return Math.min(exponential + jitter, 30_000);
}

/** Retry-After is either delta-seconds or an HTTP date. Both appear in the wild. */
export function parseRetryAfter(value: string | undefined): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());

  return null;
}
