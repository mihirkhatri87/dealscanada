import type { AdapterContext, AdapterResult, RawDeal, SourceAdapter } from '../types';
import { parseTopicsResponse } from '../redflagdeals';
import { extractDomain } from '../../util/url';

/**
 * Composite engine — for retailers whose own site will not let us in.
 *
 * Walmart Canada and Costco both sit behind bot protection. A single-path
 * adapter for either would be a coin flip that reports zero deals when it loses,
 * which reads as "this retailer has no sales" rather than "we could not look".
 *
 * So each is a chain of paths tried in order, and the run records which one
 * produced the data. That distinction is the whole point of the design: health
 * output says *how* the deals were obtained, so a silent degradation from the
 * retailer's own feed to a community mirror is visible rather than invisible.
 *
 * A total block is a real outcome, not an error. It yields zero deals with a
 * stated reason and a green run — one blocked retailer must never colour a scrape
 * that worked for sixty others.
 */

export interface CompositePathResult {
  deals: RawDeal[];
  /** Why this path produced nothing, when it produced nothing. */
  reason?: string;
}

export interface CompositePath {
  /** Short identifier recorded on every deal this path produced. */
  id: string;
  /** What this path is, for the health table's benefit. */
  describe: string;
  run(context: AdapterContext): Promise<CompositePathResult>;
}

export interface CompositeConfig {
  id: string;
  name: string;
  domain: string;
  /** Names the community uses for this retailer, matched case-insensitively. */
  dealerNames: string[];
  /** The chain name used by the in-store clearance source, when it has one. */
  storeChain?: string;
  /** The retailer's own endpoint, when it has a usable one. */
  nativePath?: CompositePath;
}

const RFD_API = 'https://forums.redflagdeals.com/api/topics';

/**
 * Path B — the community mirror.
 *
 * RedFlagDeals posters cover exactly the retailers that block us, which is why
 * this path exists. The data is second-hand: a poster's price claim, not the
 * retailer's own feed. The verification pass treats it accordingly, and the
 * source path recorded on each deal keeps its provenance visible downstream.
 */
export function redflagdealsPath(config: CompositeConfig): CompositePath {
  return {
    id: 'redflagdeals',
    describe: `RedFlagDeals threads for ${config.name}`,
    async run(context: AdapterContext): Promise<CompositePathResult> {
      const url = `${RFD_API}?forum_id=9&per_page=40&page=1`;
      const response = await context.http.fetchJson<unknown>(url, { skipRobots: true });

      const matches = parseTopicsResponse(response.data).filter((deal) =>
        matchesRetailer(deal, config),
      );

      return {
        deals: matches,
        ...(matches.length === 0
          ? { reason: `no current ${config.name} threads on RedFlagDeals` }
          : {}),
      };
    },
  };
}

/**
 * Whether a community post is about this retailer.
 *
 * The URL domain is checked first and trusted over the dealer name: a poster can
 * type anything into the dealer field, but a link to walmart.ca is a link to
 * walmart.ca. The name is the fallback for threads that link elsewhere.
 */
export function matchesRetailer(deal: RawDeal, config: CompositeConfig): boolean {
  const domain = deal.merchantDomain ?? extractDomain(deal.url);
  if (domain && isSameSite(domain, config.domain)) return true;

  const dealer = deal.merchantName?.toLowerCase() ?? '';
  if (dealer === '') return false;

  return config.dealerNames.some((name) => dealer.includes(name.toLowerCase()));
}

/**
 * Whether `domain` is the retailer's site or a subdomain of it.
 *
 * A plain `endsWith` is wrong and quietly so: "notwalmart.ca" ends with
 * "walmart.ca", and would file a stranger's listing under Walmart. The match has
 * to land on a label boundary.
 */
function isSameSite(domain: string, site: string): boolean {
  const host = domain.toLowerCase();
  const target = site.toLowerCase();
  return host === target || host.endsWith(`.${target}`);
}

/**
 * Path C — in-store clearance for this chain.
 *
 * Only ever store-scoped. It reads deals the stocktrack adapter already wrote
 * this run rather than issuing its own requests, so adding a composite retailer
 * costs no extra traffic to a small independent site.
 */
export function inStorePath(config: CompositeConfig, pool: () => RawDeal[]): CompositePath {
  return {
    id: 'in-store',
    describe: `in-store clearance at ${config.name}`,
    async run(): Promise<CompositePathResult> {
      const matches = pool().filter((deal) => matchesRetailer(deal, config));
      return {
        deals: matches,
        ...(matches.length === 0 ? { reason: 'no in-store clearance for this chain' } : {}),
      };
    },
  };
}

export interface CompositeOutcome extends AdapterResult {
  /** Every path attempted, with what it produced. Surfaced in health output. */
  attempts: Array<{ path: string; deals: number; reason?: string }>;
}

/**
 * Runs the chain, collecting from every path rather than stopping at the first
 * that works.
 *
 * Stopping early would mean the retailer's own feed hides the in-store clearance
 * that only the store-level source knows about. Dedupe handles the overlap, and
 * the pipeline's own dedupe pass handles it again across sources.
 */
export async function runComposite(
  paths: CompositePath[],
  context: AdapterContext,
  limit: number,
): Promise<CompositeOutcome> {
  const attempts: CompositeOutcome['attempts'] = [];
  const collected: RawDeal[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    if (collected.length >= limit) break;

    try {
      const result = await path.run(context);
      let added = 0;

      for (const deal of result.deals) {
        // Two paths surfacing the same product is the expected case, not an
        // error - it is why the chain exists. The first path to find it wins,
        // and the order of the chain is therefore a quality ranking.
        const key = deal.url.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push({ ...deal, sourcePath: path.id });
        added += 1;
      }

      attempts.push({
        path: path.id,
        deals: added,
        ...(result.reason ? { reason: result.reason } : {}),
      });
    } catch (error) {
      // A blocked path is information, not a failure. The next one runs.
      attempts.push({
        path: path.id,
        deals: 0,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const winner = attempts.find((attempt) => attempt.deals > 0);

  return {
    deals: collected.slice(0, limit),
    ...(winner ? { path: winner.path } : { path: 'none' }),
    ...(collected.length === 0
      ? {
          reason: `every path blocked or empty — ${attempts
            .map((attempt) => `${attempt.path}: ${attempt.reason ?? 'nothing'}`)
            .join('; ')}`,
        }
      : {}),
    attempts,
  };
}

/** Builds a composite adapter from a chain of paths. */
export function createCompositeAdapter(
  config: CompositeConfig,
  paths: CompositePath[],
): SourceAdapter {
  return {
    id: config.id,
    name: config.name,
    weight: 0.8,

    enabled: () =>
      paths.length > 0 ? { enabled: true } : { enabled: false, reason: 'no paths configured' },

    async fetch(context: AdapterContext): Promise<AdapterResult> {
      const outcome = await runComposite(paths, context, context.limit ?? 100);

      for (const attempt of outcome.attempts) {
        context.log(
          `${attempt.path}: ${attempt.deals} deals${attempt.reason ? ` (${attempt.reason})` : ''}`,
        );
      }

      return outcome;
    },
  };
}
