import type { AdapterContext, AdapterResult, RawDeal, SourceAdapter } from '../types';
import type { RetailerConfig } from '../catalogue';
import { extractCouponFrom } from '../../pipeline/coupon';

/**
 * WordPress engine — for the Canadian deal blogs.
 *
 * Smart Canucks, CoCo West and Costco East are editorial sites, not storefronts:
 * they publish posts about deals rather than a product feed. All three run
 * WordPress, whose REST API is public and uniform, so adding another blog is a
 * catalogue entry.
 *
 * The distinction that shapes this engine: a post is an article, and only some
 * articles are deals. A post that names no prices is a roundup, and listing it
 * as a deal with no price would be worse than omitting it — the card would make
 * a claim the post does not support.
 */

export interface WordPressParseOptions {
  merchantDomain: string;
  merchantName?: string;
  /** The retailer a blog writes about, when it writes about only one. */
  subjectDomain?: string;
  subjectName?: string;
  categoryHint?: string;
}

export function parseWordPressPosts(payload: unknown, options: WordPressParseOptions): RawDeal[] {
  if (!Array.isArray(payload)) return [];

  const deals: RawDeal[] = [];
  const seen = new Set<string>();

  for (const entry of payload) {
    if (entry === null || typeof entry !== 'object') continue;
    const post = entry as Record<string, unknown>;

    const id = post['id'];
    const title = rendered(post['title']);
    const link = typeof post['link'] === 'string' ? post['link'] : null;
    if (id === undefined || !title || !link) continue;

    const key = String(id);
    if (seen.has(key)) continue;

    const excerpt = rendered(post['excerpt']);
    const body = `${title} ${excerpt ?? ''} ${rendered(post['content']) ?? ''}`;

    const prices = extractPrices(body);
    if (prices === null) continue;

    seen.add(key);

    // Blogs are where coupon codes actually get published, so the shared
    // extractor earns its keep here more than anywhere else.
    const coupon = extractCouponFrom(title, excerpt);

    deals.push({
      sourceId: `${options.merchantDomain}:${key}`,
      title,
      url: link,
      description: excerpt,
      imageUrl: featuredImage(post),
      price: prices.now,
      priceWas: prices.was,
      currency: 'CAD',
      // The blog is the source; the retailer it writes about is the merchant.
      // Filing these under the blog's own domain would put "Smart Canucks" on a
      // card about a Loblaws sale.
      merchantDomain: options.subjectDomain ?? options.merchantDomain,
      merchantName: options.subjectName ?? options.merchantName ?? null,
      couponCode: coupon.code,
      ...(options.categoryHint ? { categoryHint: options.categoryHint } : {}),
      // Editorial reporting, not a retailer's own feed. Said on the card.
      stockNote: `Reported by ${options.merchantName ?? options.merchantDomain} — confirm in store.`,
      postedAt: typeof post['date_gmt'] === 'string' ? `${post['date_gmt']}Z` : null,
    });
  }

  return deals;
}

/**
 * Finds a before/after pair in post text.
 *
 * Returns null unless two distinct prices are present. One price is a mention,
 * not a deal, and inventing the other would be exactly the fabrication the whole
 * pipeline is built to avoid.
 */
export function extractPrices(text: string): { now: number; was: number } | null {
  const numbers: number[] = [];

  for (const match of text.matchAll(/\$\s?(\d{1,5}(?:[.,]\d{2})?)/g)) {
    const parsed = Number((match[1] ?? '').replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0) numbers.push(parsed);
  }

  if (numbers.length < 2) return null;

  const now = Math.min(...numbers);
  const was = Math.max(...numbers);
  return was > now ? { now, was } : null;
}

function rendered(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  const text = (value as Record<string, unknown>)['rendered'];
  if (typeof text !== 'string') return null;

  const stripped = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#8217;|&#039;|&#39;/g, "'")
    .replace(/&#8211;|&#8212;/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return stripped === '' ? null : stripped;
}

/** The featured image, when the request asked WordPress to embed it. */
export function featuredImage(post: Record<string, unknown>): string | null {
  const embedded = post['_embedded'];
  if (embedded !== null && typeof embedded === 'object') {
    const media = (embedded as Record<string, unknown>)['wp:featuredmedia'];
    if (Array.isArray(media)) {
      for (const item of media) {
        if (item === null || typeof item !== 'object') continue;
        const url = (item as Record<string, unknown>)['source_url'];
        if (typeof url === 'string' && url.trim() !== '') return url;
      }
    }
  }

  // Blogs that do not set a featured image usually still have one inline, and a
  // card with no picture is markedly less useful than one with the wrong crop.
  const content = post['content'];
  if (content !== null && typeof content === 'object') {
    const html = (content as Record<string, unknown>)['rendered'];
    if (typeof html === 'string') {
      const src = /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1];
      if (src) return src;
    }
  }

  return null;
}

/** The posts endpoint, asking WordPress to embed the featured image. */
export function buildPostsUrl(baseUrl: string, perPage: number): string {
  return `${baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/posts?per_page=${perPage}&_embed=1`;
}

export function createWordPressAdapter(config: RetailerConfig): SourceAdapter {
  return {
    id: `wp:${config.id}`,
    name: config.name,
    weight: 0.6,

    enabled: () =>
      config.enabled === false
        ? { enabled: false, reason: 'disabled in catalogue' }
        : { enabled: true },

    async fetch(context: AdapterContext): Promise<AdapterResult> {
      const limit = context.limit ?? 40;
      const url = buildPostsUrl(config.baseUrl, Math.min(50, limit));

      try {
        const response = await context.http.fetchJson<unknown>(url, { skipRobots: true });
        const deals = parseWordPressPosts(response.data, {
          merchantDomain: config.domain,
          merchantName: config.name,
          ...(config.subjectDomain ? { subjectDomain: config.subjectDomain } : {}),
          ...(config.subjectName ? { subjectName: config.subjectName } : {}),
        });

        context.log(`${deals.length} posts carried a price pair`);

        return {
          deals: deals.slice(0, limit),
          path: 'wp-json',
          ...(deals.length === 0
            ? { reason: 'no posts stated both a before and after price' }
            : {}),
        };
      } catch (error) {
        // RSS is the documented fallback when wp-json is disabled, but it
        // carries neither prices nor images - the two things this engine needs -
        // so there is nothing useful to fall back to. Say so plainly.
        return {
          deals: [],
          path: 'wp-json',
          reason: `${error instanceof Error ? error.message : String(error)} (wp-json is required; RSS carries no prices)`,
        };
      }
    },
  };
}
