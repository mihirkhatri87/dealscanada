import type { AdapterContext, RawDeal, SourceAdapter } from './types';
import {
  createCompositeAdapter,
  inStorePath,
  redflagdealsPath,
  type CompositeConfig,
  type CompositePath,
  type CompositePathResult,
} from './engines/composite';
import { parseProductPage } from './engines/jsonld';
import { parseWordPressPosts } from './engines/wordpress';

/**
 * Costco Canada.
 *
 * Two things make Costco unlike the other composites. Their own site is
 * bot-protected, and a large share of what people actually want from Costco -
 * warehouse-only prices and instant savings - never appears online at all.
 *
 * So the community path is not a degraded fallback here; for warehouse pricing it
 * is the only path that exists. The dedicated Costco blogs cover exactly that
 * gap, which is why they are a first-class path rather than an afterthought.
 */

const CONFIG: CompositeConfig = {
  id: 'costco',
  name: 'Costco Canada',
  domain: 'costco.ca',
  dealerNames: ['costco', 'costco.ca', 'costco wholesale'],
  storeChain: 'costco',
};

const SEARCH_URL = 'https://www.costco.ca/CatalogSearch?dept=All&keyword=clearance';

function nativePath(): CompositePath {
  return {
    id: 'costco-site',
    describe: 'costco.ca catalogue search',
    async run(context: AdapterContext): Promise<CompositePathResult> {
      const response = await context.http.fetchText(SEARCH_URL, {
        headers: { 'Accept-Language': 'en-CA,en;q=0.9' },
      });

      // Costco's own pages carry JSON-LD, so the universal parser applies rather
      // than a bespoke one - there is no reason to write a second HTML mapper.
      const deal = parseProductPage(response.data, {
        url: SEARCH_URL,
        merchantDomain: 'costco.ca',
        merchantName: 'Costco Canada',
      });

      return {
        deals: deal ? [deal] : [],
        ...(deal ? {} : { reason: 'no JSON-LD product data on the search page' }),
      };
    },
  };
}

/**
 * Path B2 — the warehouse-price blogs.
 *
 * CoCo West and Costco East publish weekly in-warehouse pricing that Costco
 * itself never puts online. This is the only route to those numbers, and it is
 * why Costco's chain has a path the other composites do not.
 */
export function blogPath(feeds: string[]): CompositePath {
  return {
    id: 'costco-blogs',
    describe: 'CoCo West / Costco East warehouse price posts',
    async run(context: AdapterContext): Promise<CompositePathResult> {
      const deals: RawDeal[] = [];
      const failures: string[] = [];

      for (const feed of feeds) {
        try {
          const response = await context.http.fetchJson<unknown>(feed, { skipRobots: true });
          // The shared WordPress engine, not a second copy of it: these blogs
          // are ordinary WordPress sites and the only Costco-specific part is
          // the note below.
          deals.push(
            ...parseWordPressPosts(response.data, {
              merchantDomain: 'costco.ca',
              merchantName: 'Costco Canada',
            }).map((deal) => ({
              ...deal,
              // Warehouse pricing is regional and time-boxed. Saying so is the
              // difference between a useful tip and a broken promise at the till.
              stockNote:
                'In-warehouse price reported by a Costco blog — varies by region and week.',
            })),
          );
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }

      return {
        deals,
        ...(deals.length === 0
          ? { reason: failures.length > 0 ? failures.join('; ') : 'no posts carried prices' }
          : {}),
      };
    },
  };
}

const BLOG_FEEDS = [
  'https://cocowest.ca/wp-json/wp/v2/posts?per_page=20&_embed=1',
  'https://costcoeast.ca/wp-json/wp/v2/posts?per_page=20&_embed=1',
];

export function createCostcoAdapter(inStorePool: () => RawDeal[] = () => []): SourceAdapter {
  return createCompositeAdapter(CONFIG, [
    nativePath(),
    blogPath(BLOG_FEEDS),
    redflagdealsPath(CONFIG),
    inStorePath(CONFIG, inStorePool),
  ]);
}
