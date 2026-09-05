import * as cheerio from 'cheerio';
import { env, flags } from '../config';
import type { AdapterContext, AdapterResult, RawDeal, SourceAdapter } from './types';

/**
 * stocktrack.ca — in-store clearance near you.
 *
 * This is the source behind the "amazing deals near you" section: it tracks
 * per-store clearance and stock for Canadian chains, which is data no retailer
 * API exposes and no national deal feed contains.
 *
 * It is also a small independent site, so it gets treatment nothing else in the
 * catalogue does:
 *
 *   - a dedicated slow rate limit (default 0.3 rps, set in HttpClient)
 *   - only the stores a user actually selected, never a full-chain crawl
 *   - a hard cap on stores per run
 *   - responses cached aggressively so a page is not refetched needlessly
 *   - a single flag that switches the whole adapter off
 *
 * The endpoint shapes could not be verified from the build sandbox, which blocks
 * every retailer host. The selectors are therefore configuration rather than
 * literals, so correcting them after a real `npm run health` run is a config
 * edit and not a rewrite.
 */

export interface StocktrackConfig {
  baseUrl: string;
  /** Path template for one store's clearance list; {storeId} is substituted. */
  clearancePath: string;
  /** Path template for a chain's store list; {chain} is substituted. */
  storeListPath: string;
  selectors: {
    row: string;
    title: string;
    clearancePrice: string;
    regularPrice: string;
    quantity?: string;
    aisle?: string;
    link?: string;
  };
}

export const DEFAULT_STOCKTRACK_CONFIG: StocktrackConfig = {
  baseUrl: 'https://www.stocktrack.ca',
  clearancePath: '/clearance/{storeId}',
  storeListPath: '/stores/{chain}',
  selectors: {
    row: 'table tbody tr, .clearance-item',
    title: '.item-name, td:nth-child(1)',
    clearancePrice: '.clearance-price, td:nth-child(2)',
    regularPrice: '.regular-price, td:nth-child(3)',
    quantity: '.qty, td:nth-child(4)',
    aisle: '.aisle, td:nth-child(5)',
    link: 'a',
  },
};

export interface ParsedClearanceItem {
  title: string;
  clearancePrice: string | null;
  regularPrice: string | null;
  quantity: string | null;
  aisle: string | null;
  href: string | null;
}

/** Parses one store's clearance page. Returns [] on anything unrecognisable. */
export function parseClearancePage(
  html: string,
  config: StocktrackConfig = DEFAULT_STOCKTRACK_CONFIG,
): ParsedClearanceItem[] {
  const $ = cheerio.load(html);
  const items: ParsedClearanceItem[] = [];

  $(config.selectors.row).each((_, element) => {
    const row = $(element);

    const title = row.find(config.selectors.title).first().text().trim();
    // A row without a product name is a header or a spacer, not a listing.
    if (!title || title.length < 3) return;

    const text = (selector: string | undefined): string | null => {
      if (!selector) return null;
      const value = row.find(selector).first().text().trim();
      return value === '' ? null : value;
    };

    items.push({
      title,
      clearancePrice: text(config.selectors.clearancePrice),
      regularPrice: text(config.selectors.regularPrice),
      quantity: text(config.selectors.quantity),
      aisle: text(config.selectors.aisle),
      href:
        row
          .find(config.selectors.link ?? 'a')
          .first()
          .attr('href') ?? null,
    });
  });

  return items;
}

/** Chain slug used by the site, mapped from our store records. */
const CHAIN_DOMAIN: Record<string, string> = {
  'canadian-tire': 'canadiantire.ca',
  sportchek: 'sportchek.ca',
  walmart: 'walmart.ca',
  'best-buy': 'bestbuy.ca',
  'home-depot': 'homedepot.ca',
  marks: 'marks.com',
  atmosphere: 'atmosphere.ca',
};

export interface StocktrackStore {
  id: string;
  chain: string;
  name: string;
}

export function buildStocktrackAdapter(
  stores: StocktrackStore[],
  config: StocktrackConfig = DEFAULT_STOCKTRACK_CONFIG,
): SourceAdapter {
  return {
    id: 'stocktrack',
    name: 'stocktrack.ca in-store clearance',
    weight: 0.7,

    enabled: () => {
      if (!flags.stocktrackEnabled) {
        return { enabled: false, reason: 'STOCKTRACK_ENABLED is false' };
      }
      if (stores.length === 0) {
        return {
          enabled: false,
          reason: 'no stores selected — run `npm run stores:sync` and choose stores',
        };
      }
      return { enabled: true };
    },

    async fetch(context: AdapterContext): Promise<AdapterResult> {
      // Only the stores the user picked, capped. Crawling every store of every
      // chain would be both useless to one shopper and a burden on a small site.
      const selected = context.storeIds?.length
        ? stores.filter((store) => context.storeIds?.includes(store.id))
        : stores;

      const scoped = selected.slice(0, env.STOCKTRACK_MAX_STORES);
      if (scoped.length === 0) {
        return { deals: [], path: 'clearance', reason: 'no matching stores selected' };
      }

      const deals: RawDeal[] = [];
      let failures = 0;

      for (const store of scoped) {
        const path = config.clearancePath.replace('{storeId}', encodeURIComponent(store.id));
        const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;

        try {
          const response = await context.http.fetchText(url, {
            // Long cache: in-store clearance changes daily at most, and this is
            // the politeness lever that matters most for a small site.
            cacheTtlMinutes: 240,
          });

          const items = parseClearancePage(response.data, config);
          context.log(`${store.name}: ${items.length} clearance items`);

          for (const item of items) {
            const domain = CHAIN_DOMAIN[store.chain] ?? 'stocktrack.ca';
            deals.push({
              sourceId: `${store.id}:${slugForItem(item.title)}`,
              title: item.title,
              // Deep link to the chain where we can, otherwise back to the
              // source page - a deal must always link somewhere real.
              url: item.href?.startsWith('http') ? item.href : `${config.baseUrl}${path}`,
              price: item.clearancePrice,
              priceWas: item.regularPrice,
              merchantDomain: domain,
              storeId: store.id,
              inStock: item.quantity ? !/^0\b/.test(item.quantity) : true,
              stockNote:
                [
                  item.quantity ? `${item.quantity} in stock` : null,
                  item.aisle ? `Aisle ${item.aisle}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || null,
              currency: 'CAD',
            });
          }
        } catch (error) {
          failures += 1;
          context.log(`${store.name} failed`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (deals.length === 0) {
        return {
          deals: [],
          path: 'clearance',
          // Distinguishing "unreachable" from "reachable but empty" is what makes
          // the health table actionable.
          reason:
            failures === scoped.length
              ? `all ${scoped.length} store pages failed to load`
              : `reached ${scoped.length - failures} store page(s) but parsed no items — selectors may have drifted`,
        };
      }

      return { deals, path: 'clearance' };
    },
  };
}

function slugForItem(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
