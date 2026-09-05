import { describe, expect, it } from 'vitest';
import { computeFlags, parseEnv } from '@/lib/config';

describe('config', () => {
  it('boots on a completely empty environment', () => {
    const env = parseEnv({});
    expect(env.SQLITE_PATH).toBe('data/deals.db');
    expect(env.RATE_LIMIT_RPS).toBe(1);
    expect(env.ASSISTANT_MODEL).toBe('claude-sonnet-5');
    expect(env.STOCKTRACK_ENABLED).toBe(true);
  });

  it('treats blank values as absent rather than invalid', () => {
    const env = parseEnv({ DATABASE_URL: '   ', RATE_LIMIT_RPS: '' });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.RATE_LIMIT_RPS).toBe(1);
  });

  it('names the offending key when a value is invalid', () => {
    expect(() => parseEnv({ RATE_LIMIT_RPS: 'fast' })).toThrow(/RATE_LIMIT_RPS/);
    expect(() => parseEnv({ SCRAPE_CONCURRENCY: '-2' })).toThrow(/SCRAPE_CONCURRENCY/);
    expect(() => parseEnv({ STOCKTRACK_ENABLED: 'maybe' })).toThrow(/STOCKTRACK_ENABLED/);
  });

  it('accepts the documented boolean spellings', () => {
    for (const truthy of ['true', '1', 'yes', 'TRUE']) {
      expect(parseEnv({ STOCKTRACK_ENABLED: truthy }).STOCKTRACK_ENABLED).toBe(true);
    }
    for (const falsy of ['false', '0', 'no', 'FALSE']) {
      expect(parseEnv({ STOCKTRACK_ENABLED: falsy }).STOCKTRACK_ENABLED).toBe(false);
    }
  });

  describe('Amazon PA-API credential matrix', () => {
    it('is dormant with no credentials', () => {
      expect(computeFlags({}).amazonPaapiEnabled).toBe(false);
    });

    it('is dormant with a partial credential set', () => {
      expect(
        computeFlags({ AMAZON_ACCESS_KEY: 'a', AMAZON_SECRET_KEY: 'b' }).amazonPaapiEnabled,
      ).toBe(false);
    });

    it('activates only when all three are present', () => {
      expect(
        computeFlags({
          AMAZON_ACCESS_KEY: 'a',
          AMAZON_SECRET_KEY: 'b',
          AMAZON_PARTNER_TAG: 'c',
        }).amazonPaapiEnabled,
      ).toBe(true);
    });
  });

  describe('assistant flag', () => {
    it('is off without an API key even when enabled', () => {
      expect(computeFlags({ ASSISTANT_ENABLED: 'true' }).assistantEnabled).toBe(false);
    });

    it('is off when explicitly disabled despite a key', () => {
      expect(
        computeFlags({ ASSISTANT_ENABLED: 'false', ANTHROPIC_API_KEY: 'sk-ant-x' })
          .assistantEnabled,
      ).toBe(false);
    });

    it('is on with both', () => {
      expect(
        computeFlags({ ASSISTANT_ENABLED: 'true', ANTHROPIC_API_KEY: 'sk-ant-x' })
          .assistantEnabled,
      ).toBe(true);
    });
  });

  it('selects Postgres purely from DATABASE_URL presence', () => {
    expect(computeFlags({}).usesPostgres).toBe(false);
    expect(computeFlags({ DATABASE_URL: 'postgres://x' }).usesPostgres).toBe(true);
  });
});
