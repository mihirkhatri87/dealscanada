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
          deals.push(...parseWordPressPosts(response.data));
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

/**
 * Maps WordPress posts to deals.
 *
 * These are editorial posts, not a product feed, so a post yields a deal only
 * when it actually states both prices. A post about a sale with no numbers in it
 * is an article, and listing it as a deal with no price would be worse than
 * omitting it.
 */
export function parseWordPressPosts(payload: unknown): RawDeal[] {
  if (!Array.isArray(payload)) return [];

  const deals: RawDeal[] = [];

  for (const entry of payload) {
    if (entry === null || typeof entry !== 'object') continue;
    const post = entry as Record<string, unknown>;

    const id = post['id'];
    const title = rendered(post['title']);
    const link = typeof post['link'] === 'string' ? post['link'] : null;
    if (id === undefined || !title || !link) continue;

    const body = `${title} ${rendered(post['excerpt']) ?? ''} ${rendered(post['content']) ?? ''}`;
    const prices = extractPrices(body);
    if (prices.length < 2) continue;

    // The highest number is the before price and the lowest the after; a post
    // may quote several, and the pair that matters is the widest spread.
    const price = Math.min(...prices);
    const was = Math.max(...prices);
    if (was <= price) continue;

    deals.push({
      sourceId: `costco-blog:${String(id)}`,
      title,
      url: link,
      description: rendered(post['excerpt']),
      imageUrl: featuredImage(post),
      price,
      priceWas: was,
      currency: 'CAD',
      merchantDomain: 'costco.ca',
      merchantName: 'Costco Canada',
      // Warehouse pricing is regional and time-boxed. Saying so on the card is
      // the difference between a useful tip and a broken promise at the till.
      stockNote: 'In-warehouse price reported by a Costco blog — varies by region and week.',
      postedAt: typeof post['date_gmt'] === 'string' ? `${post['date_gmt']}Z` : null,
    });
  }

  return deals;
}

function extractPrices(text: string): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(/\$\s?(\d{1,4}(?:[.,]\d{2})?)/g)) {
    const parsed = Number((match[1] ?? '').replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0) found.push(parsed);
  }
  return found;
}

function rendered(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  const text = (value as Record<string, unknown>)['rendered'];
  if (typeof text !== 'string') return null;

  const stripped = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#8217;|&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return stripped === '' ? null : stripped;
}

function featuredImage(post: Record<string, unknown>): string | null {
  const embedded = post['_embedded'];
  if (embedded === null || typeof embedded !== 'object') return null;

  const media = (embedded as Record<string, unknown>)['wp:featuredmedia'];
  if (!Array.isArray(media)) return null;

  for (const item of media) {
    if (item === null || typeof item !== 'object') continue;
    const url = (item as Record<string, unknown>)['source_url'];
    if (typeof url === 'string' && url.trim() !== '') return url;
  }
  return null;
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
