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

    // Title and excerpt only. The body is where a roundup lists thirty other
    // products, and a price taken from there would caption this card with a
    // number describing something its headline does not name.
    const prices = extractPrices(`${title} ${excerpt ?? ''}`);
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

/** Marks the neighbouring higher number as the pre-sale price. */
const WAS_MARKER =
  /\b(?:reg|reg\.|regular|regularly|was|orig|orig\.|originally|retail|list|compare|compared at|value|instead of|down from)\b/i;
/** Marks the neighbouring lower number as what a shopper pays today. */
const NOW_MARKER = /\b(?:now|sale|only|just|deal|for)\b|→|->|»/i;

/** How much text may sit between two numbers before they stop being a pair. */
const PAIR_GAP_LIMIT = 40;

function toAmount(raw: string): number | null {
  const cleaned = raw.trim();
  // "19,99" is a decimal comma; "1,299.99" is a thousands comma.
  const normalized =
    /,\d{2}$/.test(cleaned) && !/\.\d{2}$/.test(cleaned)
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Finds a before/after pair the post actually states as a pair.
 *
 * The previous version took the smallest and largest dollar amounts anywhere in
 * the post. On a single-product post that happens to be right, and on a roundup
 * it is a fabrication: "Costco Sale Items for September 4-6" lists dozens of
 * unrelated products, and pairing the cheapest with the most expensive produced
 * cards like "Best Buy Canada: Labour Day Sale — $70.00, was $400.00". An 82%
 * saving on something nobody can buy, with a headline for a product name. That
 * is the inflated anchor this project exists to call out, published by us.
 *
 * Two numbers are a before/after only if the post writes them as one: adjacent,
 * close together, with the language of a markdown between them - "$19.99 (reg.
 * $39.99)", "was $39.99, now $19.99". Prices from separate sentences are
 * separate products.
 *
 * Scanned over the title and excerpt alone, never the body, because the card is
 * captioned with the title. A price lifted from paragraph nine of a roundup
 * describes something the headline does not name, and the two together read as
 * a claim about a product that was never on offer at that price.
 */
export function extractPrices(text: string): { now: number; was: number } | null {
  const found: Array<{ value: number; start: number; end: number }> = [];

  for (const match of text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})*(?:[.,]\d{2})?|\d{1,5}(?:[.,]\d{2})?)/g)) {
    const value = toAmount(match[1] ?? '');
    if (value === null || match.index === undefined) continue;
    found.push({ value, start: match.index, end: match.index + match[0].length });
  }

  if (found.length < 2) return null;

  for (let index = 0; index < found.length - 1; index += 1) {
    const left = found[index]!;
    const right = found[index + 1]!;

    const gap = text.slice(left.end, right.start);
    if (gap.length > PAIR_GAP_LIMIT) continue;
    // A digit between them means a third amount we failed to parse; the two are
    // then not actually adjacent.
    if (/\d/.test(gap)) continue;

    // "$19.99 (reg. $39.99)"
    if (WAS_MARKER.test(gap) && right.value > left.value) {
      return { now: left.value, was: right.value };
    }

    // "was $39.99, now $19.99" - the marker for the higher number sits before it.
    if (NOW_MARKER.test(gap) && left.value > right.value) {
      const lead = text.slice(Math.max(0, left.start - 24), left.start);
      if (WAS_MARKER.test(lead)) return { now: right.value, was: left.value };
    }
  }

  return null;
}

function codePoint(code: number): string {
  // An out-of-range entity is malformed markup, not a character. Dropping it to
  // a space keeps the title readable rather than throwing on the whole post.
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return ' ';
  return String.fromCodePoint(code);
}

function rendered(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  const text = (value as Record<string, unknown>)['rendered'];
  if (typeof text !== 'string') return null;

  const stripped = text
    .replace(/<[^>]*>/g, ' ')
    // Numeric entities generally, rather than the handful that had been listed:
    // WordPress emits &#038; for an ampersand, which was reaching deal titles
    // verbatim as "Costco Flyer &#038; Costco Sale Items".
    .replace(/&#(\d+);/g, (_, code: string) => codePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => codePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Last, so a decoded "&amp;amp;" does not become a stray entity.
    .replace(/&amp;/g, '&')
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
