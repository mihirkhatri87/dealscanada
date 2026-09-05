import type { DealRepository, DealInput, MerchantInput } from '../db/repository';
import type { SourceAdapter, AdapterContext } from '../sources/types';
import {
  ALL_MERCHANT_SEEDS,
  merchantIdForDomain,
  seedToMerchantInput,
  slugForDomain,
} from '../sources/merchants';
import { HttpClient } from '../util/http';
import { dedupeDeals } from './dedupe';
import { normalizeDeal } from './normalize';
import { verifyDeals, type PriceObservation } from './verify';

/**
 * The pipeline runner.
 *
 * Two guarantees shape everything here:
 *   1. One failing adapter never costs us the others. Each runs isolated, with a
 *      timeout, and always writes exactly one source_runs row - success, failure
 *      or skipped.
 *   2. Verification happens once, after every source is in, because that is the
 *      only moment the same product is visible at several merchants at once.
 */

export interface RunOptions {
  adapters: SourceAdapter[];
  repo: DealRepository;
  http?: HttpClient;
  /** Cap on items per adapter. */
  limit?: number;
  storeIds?: string[];
  /** Parse and report, write nothing. */
  dryRun?: boolean;
  concurrency?: number;
  adapterTimeoutMs?: number;
  verbose?: boolean;
  now?: Date;
}

export interface SourceOutcome {
  source: string;
  outcome: 'ok' | 'failed' | 'skipped';
  itemsFound: number;
  itemsNew: number;
  itemsUpdated: number;
  itemsDropped: number;
  latencyMs: number;
  path?: string;
  error?: string;
  dropReasons: Record<string, number>;
}

export interface RunSummary {
  sources: SourceOutcome[];
  totalFound: number;
  totalNew: number;
  totalUpdated: number;
  totalDropped: number;
  merged: number;
  verified: number;
  suspectAnchors: number;
  comparedAcrossMerchants: number;
  durationMs: number;
}

const DEFAULT_ADAPTER_TIMEOUT_MS = 120_000;

export async function runPipeline(options: RunOptions): Promise<RunSummary> {
  const started = Date.now();
  const now = options.now ?? new Date();
  const http = options.http ?? new HttpClient();
  const concurrency = options.concurrency ?? 4;
  const timeoutMs = options.adapterTimeoutMs ?? DEFAULT_ADAPTER_TIMEOUT_MS;

  // Seed merchants first so domain resolution has something to match against.
  if (!options.dryRun) {
    await options.repo.upsertMerchants(ALL_MERCHANT_SEEDS.map(seedToMerchantInput));
  }
  const merchantResolver = await createMerchantResolver(options.repo);

  const outcomes: SourceOutcome[] = [];
  const allDeals: DealInput[] = [];

  // Bounded concurrency: adapters are rate-limited per domain anyway, and running
  // everything at once would just queue behind the limiter while holding memory.
  const queue = [...options.adapters];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const adapter = queue.shift();
      if (!adapter) return;

      const result = await runAdapter(adapter, {
        http,
        limit: options.limit,
        storeIds: options.storeIds,
        timeoutMs,
        verbose: options.verbose ?? false,
      });

      outcomes.push(result.outcome);
      allDeals.push(
        ...normalizeBatch(result.raw, adapter, merchantResolver.resolve, result.outcome, now),
      );
    }
  });

  await Promise.all(workers);

  // Collapse duplicates before verification so a product's listings are grouped.
  const { deals: deduped, mergedCount } = dedupeDeals(
    allDeals.map((deal) => ({ ...deal, id: deal.id })),
  );

  // Historical evidence for the verification pass.
  const historyByProductKey = options.dryRun
    ? new Map<string, PriceObservation[]>()
    : await loadPriceHistory(options.repo, deduped);

  const { summary: verifySummary } = verifyDeals(deduped, { historyByProductKey, now });

  let totalNew = 0;
  let totalUpdated = 0;

  if (!options.dryRun && deduped.length > 0) {
    // Merchants invented during normalization must exist before the deals that
    // reference them, or every one of those rows fails its foreign key.
    const invented = merchantResolver.created();
    if (invented.length > 0) await options.repo.upsertMerchants(invented);

    const upsert = await options.repo.upsertDeals(deduped);
    totalNew = upsert.inserted;
    totalUpdated = upsert.updated;

    // Record a price point for anything whose price actually moved. This is the
    // evidence base that later lets us say "lowest in 90 days" and mean it.
    // The repository returns the PERSISTED id with the price, because
    // normalization mints a new UUID each run and matching on our own id would
    // silently record nothing.
    await options.repo.appendPricePoints(
      upsert.priceChanged.map((change) => ({
        dealId: change.dealId,
        price: change.price,
        observedAt: now.toISOString(),
      })),
    );

    await options.repo.markExpired(now.toISOString());
  }

  if (!options.dryRun) {
    for (const outcome of outcomes) {
      await options.repo.recordSourceRun({
        source: outcome.source,
        startedAt: new Date(started).toISOString(),
        finishedAt: new Date().toISOString(),
        outcome: outcome.outcome,
        itemsFound: outcome.itemsFound,
        itemsNew: outcome.itemsNew,
        itemsUpdated: outcome.itemsUpdated,
        itemsDropped: outcome.itemsDropped,
        latencyMs: outcome.latencyMs,
        sourcePath: outcome.path ?? null,
        error: outcome.error ?? null,
      });
    }
  }

  return {
    sources: outcomes.sort((a, b) => a.source.localeCompare(b.source)),
    totalFound: outcomes.reduce((sum, o) => sum + o.itemsFound, 0),
    totalNew,
    totalUpdated,
    totalDropped: outcomes.reduce((sum, o) => sum + o.itemsDropped, 0),
    merged: mergedCount,
    verified: verifySummary.verified,
    suspectAnchors: verifySummary.suspectAnchors,
    comparedAcrossMerchants: verifySummary.comparedAcrossMerchants,
    durationMs: Date.now() - started,
  };
}

async function runAdapter(
  adapter: SourceAdapter,
  options: {
    http: HttpClient;
    limit?: number;
    storeIds?: string[];
    timeoutMs: number;
    verbose: boolean;
  },
): Promise<{ raw: Awaited<ReturnType<SourceAdapter['fetch']>>['deals']; outcome: SourceOutcome }> {
  const started = Date.now();

  const base: SourceOutcome = {
    source: adapter.id,
    outcome: 'ok',
    itemsFound: 0,
    itemsNew: 0,
    itemsUpdated: 0,
    itemsDropped: 0,
    latencyMs: 0,
    dropReasons: {},
  };

  // A disabled adapter is skipped, not failed. Missing credentials or a flag set
  // to off is a configuration state, not a malfunction.
  const gate = adapter.enabled();
  if (!gate.enabled) {
    return {
      raw: [],
      outcome: { ...base, outcome: 'skipped', error: gate.reason, latencyMs: 0 },
    };
  }

  const context: AdapterContext = {
    http: options.http,
    limit: options.limit,
    storeIds: options.storeIds,
    log: (message, meta) => {
      if (options.verbose) console.log(`  [${adapter.id}] ${message}`, meta ?? '');
    },
  };

  try {
    const result = await withTimeout(adapter.fetch(context), options.timeoutMs, adapter.id);
    return {
      raw: result.deals,
      outcome: {
        ...base,
        itemsFound: result.deals.length,
        latencyMs: Date.now() - started,
        path: result.path,
        error: result.reason,
      },
    };
  } catch (error) {
    // Isolated: this adapter is done, every other one carries on.
    return {
      raw: [],
      outcome: {
        ...base,
        outcome: 'failed',
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function normalizeBatch(
  raw: Awaited<ReturnType<SourceAdapter['fetch']>>['deals'],
  adapter: SourceAdapter,
  resolveMerchant: MerchantResolver,
  outcome: SourceOutcome,
  now: Date,
): DealInput[] {
  const deals: DealInput[] = [];

  for (const item of raw) {
    const { deal, dropReason } = normalizeDeal(item, {
      source: adapter.id,
      resolveMerchant,
      now,
    });

    if (deal) {
      deals.push(deal);
    } else {
      outcome.itemsDropped += 1;
      const reason = dropReason ?? 'unknown';
      outcome.dropReasons[reason] = (outcome.dropReasons[reason] ?? 0) + 1;
    }
  }

  return deals;
}

type MerchantResolver = (
  domain: string | null,
  name: string | null,
) => { id: string; slug: string } | null;

interface MerchantResolverBundle {
  resolve: MerchantResolver;
  /** Merchants invented during this run, which must be inserted before deals. */
  created: () => MerchantInput[];
}

/**
 * Resolves a domain to a merchant, creating one for an unseen domain so a new
 * retailer never silently loses its deals.
 */
async function createMerchantResolver(repo: DealRepository): Promise<MerchantResolverBundle> {
  const known = new Map<string, { id: string; slug: string }>();
  const invented: MerchantInput[] = [];

  for (const merchant of await repo.listMerchants()) {
    known.set(merchant.domain, { id: merchant.id, slug: merchant.slug });
  }
  for (const seed of ALL_MERCHANT_SEEDS) {
    if (!known.has(seed.domain)) {
      known.set(seed.domain, { id: merchantIdForDomain(seed.domain), slug: seed.slug });
    }
  }

  return {
    resolve: (domain, name) => {
      if (!domain) return null;
      const key = domain.toLowerCase().replace(/^www\./, '');

      const existing = known.get(key);
      if (existing) return existing;

      // Unseen domain: mint a merchant so a new retailer never silently loses
      // its deals. It is queued for insertion, not just cached - the deal rows
      // reference it by foreign key.
      const created = { id: merchantIdForDomain(key), slug: slugForDomain(key) };
      known.set(key, created);
      invented.push({
        id: created.id,
        slug: created.slug,
        name: name?.trim() || created.slug,
        domain: key,
        logoUrl: null,
        affiliateUrlTemplate: null,
        family: null,
        vertical: null,
        engine: null,
        status: 'unverified',
        rateLimitRps: null,
      });
      return created;
    },
    created: () => invented,
  };
}

/** Loads recorded price history keyed by product, for the verification pass. */
async function loadPriceHistory(
  repo: DealRepository,
  deals: DealInput[],
): Promise<Map<string, PriceObservation[]>> {
  const keys = new Set(
    deals.map((deal) => deal.productKey).filter((key): key is string => Boolean(key)),
  );
  if (keys.size === 0) return new Map();

  return repo.getPriceHistoryByProductKeys([...keys]);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
