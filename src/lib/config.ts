import { z } from 'zod';

/**
 * One validated configuration surface.
 *
 * Everything is optional with a documented default so the app boots on a bare
 * checkout with no .env at all (that is an acceptance criterion). Invalid values
 * throw at startup naming the offending key, rather than failing later in a scraper.
 */

const booleanish = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .refine((v) => ['true', 'false', '1', '0', 'yes', 'no', ''].includes(v), {
    message: 'must be one of: true, false, 1, 0, yes, no',
  })
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const positiveNumber = (label: string) =>
  z
    .string()
    .refine((v) => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) > 0, {
      message: `${label} must be a number greater than 0`,
    })
    .transform(Number);

const envSchema = z.object({
  /** Absent → SQLite at data/deals.db. Present → Postgres. Nothing else changes. */
  DATABASE_URL: z.string().min(1).optional(),
  SQLITE_PATH: z.string().min(1).default('data/deals.db'),

  /** Identify ourselves honestly, with a contact route, on every outbound request. */
  SCRAPE_USER_AGENT: z
    .string()
    .min(1)
    .default(
      'DealsCanadaBot/0.1 (+https://github.com/mihirkhatri87/dealscanada; deal aggregator; contact via repo issues)',
    ),
  SCRAPE_CONCURRENCY: positiveNumber('SCRAPE_CONCURRENCY').default('4'),
  /** Requests per second per domain. Deliberately conservative. */
  RATE_LIMIT_RPS: positiveNumber('RATE_LIMIT_RPS').default('1'),
  HTTP_TIMEOUT_MS: positiveNumber('HTTP_TIMEOUT_MS').default('20000'),
  HTTP_MAX_RETRIES: positiveNumber('HTTP_MAX_RETRIES').default('3'),
  HTTP_CACHE_DIR: z.string().min(1).default('.cache/http'),
  HTTP_CACHE_TTL_MINUTES: positiveNumber('HTTP_CACHE_TTL_MINUTES').default('60'),

  /** Deals go stale quietly; the UI banner reads this. */
  STALE_AFTER_MINUTES: positiveNumber('STALE_AFTER_MINUTES').default('180'),

  /**
   * A deal no source has returned for this long is retired.
   *
   * Generous by default: retailers restock, and a two-day gap is more likely a
   * blocked scrape than an ended sale. Retiring a live deal is the worse error
   * of the two - the visitor never sees it at all.
   */
  DEAD_AFTER_HOURS: positiveNumber('DEAD_AFTER_HOURS').default('72'),
  /** Price observations older than this are pruned, except each deal's newest. */
  PRICE_HISTORY_DAYS: positiveNumber('PRICE_HISTORY_DAYS').default('180'),

  /**
   * stocktrack.ca is a small independent site, and this defaults to OFF.
   *
   * The paths this adapter is built around (`/clearance/{storeId}`,
   * `/stores/{chain}`) were written in the sandbox and are not real: all four
   * candidates return 404 against the live site, which serves a JavaScript app
   * and fetches its data from endpoints that are not documented anywhere. The
   * site publishes no API, no terms and no about page, carries PayPal and
   * Coinbase donation buttons, and fingerprints browsers via /fp.php.
   *
   * So the adapter cannot work as written, and making it work would mean
   * reverse-engineering a donation-funded hobby site's private endpoints to
   * take the data that is its entire reason to exist. Left on by default it
   * simply sends futile requests at someone else's server once stores are
   * synced. Turning it on should be a deliberate act by someone who has
   * confirmed real endpoints — ideally with the operator's blessing.
   */
  STOCKTRACK_ENABLED: booleanish.default('false'),
  STOCKTRACK_RATE_LIMIT_RPS: positiveNumber('STOCKTRACK_RATE_LIMIT_RPS').default('0.3'),
  STOCKTRACK_MAX_STORES: positiveNumber('STOCKTRACK_MAX_STORES').default('5'),

  /** Amazon PA-API stays dormant unless all three are present. */
  AMAZON_ACCESS_KEY: z.string().min(1).optional(),
  AMAZON_SECRET_KEY: z.string().min(1).optional(),
  AMAZON_PARTNER_TAG: z.string().min(1).optional(),

  /** Canadian Tire family platform key. No public developer programme exists for
   *  this; absent it, that family falls back to the JSON-LD engine. */
  CANADIAN_TIRE_API_KEY: z.string().min(1).optional(),

  /**
   * Affiliate product feeds, as JSON of retailer id to feed URL:
   *   {"staples":"https://feeds.example/…?token=…"}
   *
   * These URLs embed a publisher token, so they are a secret and belong here
   * rather than in the catalogue. One variable rather than one per retailer,
   * because the set grows every time an application is approved and that should
   * not need a schema change.
   */
  AFFILIATE_FEEDS: z.string().min(1).optional(),

  /** Shopping assistant. Absent key → assistant hidden, site fully functional. */
  ASSISTANT_ENABLED: booleanish.default('true'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ASSISTANT_MODEL: z.string().min(1).default('claude-sonnet-5'),
  ASSISTANT_MAX_TOOL_CALLS: positiveNumber('ASSISTANT_MAX_TOOL_CALLS').default('12'),
  ASSISTANT_MAX_TOKENS_PER_CONVERSATION: positiveNumber(
    'ASSISTANT_MAX_TOKENS_PER_CONVERSATION',
  ).default('200000'),

  /** Hosted cron authentication. */
  CRON_SECRET: z.string().min(1).optional(),
  SCRAPE_CRON: z.string().min(1).default('*/30 * * * *'),
  /**
   * Wall-clock budget for a hosted scrape, under the platform's own ceiling so
   * the run stops itself cleanly rather than being killed mid-write.
   */
  CRON_BUDGET_MS: positiveNumber('CRON_BUDGET_MS').default('240000'),
});

export type Env = z.infer<typeof envSchema>;

/** A bare string map — `process.env` satisfies it, and so does `{}` in tests. */
export type EnvSource = Record<string, string | undefined>;

/** Accepts any string map so tests can pass a bare object, not a full ProcessEnv. */
function parseEnv(source: EnvSource): Env {
  // Treat empty strings as absent so a blank line in .env behaves like no line at all.
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.trim() !== '') cleaned[key] = value;
  }

  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);

/**
 * Derived feature flags. A capability is on only when everything it needs is present —
 * a half-configured integration reports "skipped", never "failed".
 */
export const flags = {
  usesPostgres: Boolean(env.DATABASE_URL),
  amazonPaapiEnabled: Boolean(
    env.AMAZON_ACCESS_KEY && env.AMAZON_SECRET_KEY && env.AMAZON_PARTNER_TAG,
  ),
  canadianTireApiEnabled: Boolean(env.CANADIAN_TIRE_API_KEY),
  stocktrackEnabled: env.STOCKTRACK_ENABLED,
  assistantEnabled: env.ASSISTANT_ENABLED && Boolean(env.ANTHROPIC_API_KEY),
  hostedCronEnabled: Boolean(env.CRON_SECRET),
} as const;

export type Flags = typeof flags;

/** Exported for tests so flag logic can be exercised without mutating process.env. */
export function computeFlags(source: EnvSource): Flags {
  const parsed = parseEnv(source);
  return {
    usesPostgres: Boolean(parsed.DATABASE_URL),
    amazonPaapiEnabled: Boolean(
      parsed.AMAZON_ACCESS_KEY && parsed.AMAZON_SECRET_KEY && parsed.AMAZON_PARTNER_TAG,
    ),
    canadianTireApiEnabled: Boolean(parsed.CANADIAN_TIRE_API_KEY),
    stocktrackEnabled: parsed.STOCKTRACK_ENABLED,
    assistantEnabled: parsed.ASSISTANT_ENABLED && Boolean(parsed.ANTHROPIC_API_KEY),
    hostedCronEnabled: Boolean(parsed.CRON_SECRET),
  };
}

export { parseEnv };
