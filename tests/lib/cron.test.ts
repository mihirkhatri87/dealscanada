import { describe, expect, it } from 'vitest';
import { CRON_MAX_DURATION_S, isCronAuthorized, resolveCronBudgetMs } from '@/lib/cron';

/**
 * This endpoint makes the site crawl retailers on demand. Getting its auth wrong
 * does not leak data — it hands a stranger the ability to point our scraper at
 * someone else's servers under our name.
 */

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe('cron authorization', () => {
  it('accepts the bearer form the platform sends', () => {
    expect(isCronAuthorized(headers({ authorization: 'Bearer s3cret' }), 's3cret')).toBe(true);
  });

  it('accepts the header form a manual call is likelier to use', () => {
    expect(isCronAuthorized(headers({ 'x-cron-secret': 's3cret' }), 's3cret')).toBe(true);
  });

  it('rejects a missing secret', () => {
    expect(isCronAuthorized(headers({}), 's3cret')).toBe(false);
  });

  it('rejects the wrong secret', () => {
    expect(isCronAuthorized(headers({ authorization: 'Bearer wrong' }), 's3cret')).toBe(false);
  });

  it('rejects a bare token without the Bearer prefix', () => {
    expect(isCronAuthorized(headers({ authorization: 's3cret' }), 's3cret')).toBe(false);
  });

  it('rejects a prefix match, so a truncated secret is not enough', () => {
    expect(isCronAuthorized(headers({ authorization: 'Bearer s3cr' }), 's3cret')).toBe(false);
    expect(isCronAuthorized(headers({ 'x-cron-secret': 's3cretXtra' }), 's3cret')).toBe(false);
  });

  it('authorizes nobody when no secret is configured', () => {
    // Not even a caller who guesses the empty string: an unset secret means the
    // endpoint is closed, not open.
    expect(isCronAuthorized(headers({ authorization: 'Bearer ' }), undefined)).toBe(false);
    expect(isCronAuthorized(headers({ 'x-cron-secret': '' }), undefined)).toBe(false);
    expect(isCronAuthorized(headers({}), '')).toBe(false);
  });

  it('is case-insensitive on the header name only, as HTTP requires', () => {
    expect(isCronAuthorized(headers({ 'X-Cron-Secret': 's3cret' }), 's3cret')).toBe(true);
    // The value itself is compared exactly.
    expect(isCronAuthorized(headers({ 'x-cron-secret': 'S3CRET' }), 's3cret')).toBe(false);
  });
});

describe('the run budget', () => {
  const ceiling = CRON_MAX_DURATION_S * 1000 - 15_000;

  it('uses the configured default when none is requested', () => {
    expect(resolveCronBudgetMs(null, 120_000)).toBe(120_000);
  });

  it('honours a smaller explicit budget', () => {
    expect(resolveCronBudgetMs('30000', 240_000)).toBe(30_000);
  });

  it('clamps below the platform ceiling, so the run stops before it is killed', () => {
    // A budget above maxDuration is not a longer run — it is the platform
    // killing the function mid-write instead of the run ending cleanly.
    expect(resolveCronBudgetMs('999999', 240_000)).toBe(ceiling);
  });

  it('clamps a configured default that is itself too large', () => {
    expect(resolveCronBudgetMs(null, 999_999)).toBe(ceiling);
  });

  it('falls back on junk rather than running unbounded', () => {
    for (const raw of ['', '   ', 'soon', '-1', '0', 'NaN']) {
      expect(resolveCronBudgetMs(raw, 120_000), raw).toBe(120_000);
    }
  });
});
