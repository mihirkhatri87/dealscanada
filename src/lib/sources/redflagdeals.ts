import { z } from 'zod';
import { XMLParser } from 'fast-xml-parser';
import type { AdapterContext, AdapterResult, RawDeal, SourceAdapter } from './types';

/**
 * RedFlagDeals — the Canadian deal firehose.
 *
 * The Hot Deals forum is where Canadian deal hunting actually happens, and its
 * topic API exposes structured offer metadata (dealer, price, expiry) plus vote
 * counts, which is community signal no retailer feed can provide.
 *
 * Two paths: the JSON topics API, falling back to the RSS feed when its shape
 * changes. RSS carries far less (no dealer, no votes), so it is a degraded mode
 * that keeps deals flowing rather than an equivalent.
 */

const HOT_DEALS_FORUM_ID = 9;
const API_URL = 'https://forums.redflagdeals.com/api/topics';
const RSS_URL = 'https://forums.redflagdeals.com/feed/forum/9';
const PER_PAGE = 40;

/** Only the fields we use; unknown keys are ignored so extra fields cannot break us. */
const offerSchema = z
  .object({
    dealer_name: z.string().nullish(),
    price: z.union([z.string(), z.number()]).nullish(),
    list_price: z.union([z.string(), z.number()]).nullish(),
    discount_amount: z.union([z.string(), z.number()]).nullish(),
    url: z.string().nullish(),
    expires_at: z.string().nullish(),
    expired: z.union([z.boolean(), z.number()]).nullish(),
  })
  .passthrough();

const topicSchema = z
  .object({
    topic_id: z.union([z.string(), z.number()]),
    title: z.string(),
    web_path: z.string().nullish(),
    post_time: z.string().nullish(),
    total_replies: z.number().nullish(),
    offer: offerSchema.nullish(),
    votes: z
      .object({
        total_up: z.number().nullish(),
        total_down: z.number().nullish(),
      })
      .nullish(),
  })
  .passthrough();

const responseSchema = z.object({ topics: z.array(z.unknown()) }).passthrough();

/** Titles the community has already marked dead. */
const EXPIRED_MARKERS = /\[(?:expired|dead|sold out|ended)\]/i;

export function parseTopicsResponse(payload: unknown): RawDeal[] {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) return [];

  const deals: RawDeal[] = [];

  for (const candidate of parsed.data.topics) {
    const topic = topicSchema.safeParse(candidate);
    if (!topic.success) continue;

    const item = topic.data;

    // Skip what the community has already retired — showing dead deals at the
    // top of the page is the fastest way to lose a deal site's credibility.
    if (EXPIRED_MARKERS.test(item.title)) continue;
    if (item.offer?.expired === true || item.offer?.expired === 1) continue;

    // The presence of an `offer` object is what separates a deal from a
    // discussion thread. A topic without one is a conversation, not a listing,
    // and including it would put "which winter tires are you running?" on the
    // front page next to actual deals.
    if (!item.offer) continue;

    const offerUrl = item.offer.url?.trim();
    const url =
      offerUrl && /^https?:\/\//i.test(offerUrl)
        ? offerUrl
        : item.web_path
          ? // Some real deals link only to the thread. Falling back to it keeps
            // them, and the merchant still resolves from the dealer name.
            absoluteRfdUrl(item.web_path)
          : null;
    if (!url) continue;

    const up = item.votes?.total_up ?? 0;
    const down = item.votes?.total_down ?? 0;

    // The dealer name is the merchant as the community records it; the URL
    // domain is more reliable, so this is only a hint for display.
    const dealer = item.offer?.dealer_name?.trim() || null;

    deals.push({
      sourceId: String(item.topic_id),
      title: item.title,
      url,
      price: item.offer?.price ?? null,
      // list_price is RFD's field for the pre-deal price. It is still only a
      // claim - the verification pass decides whether to believe it.
      priceWas: item.offer?.list_price ?? null,
      merchantName: dealer,
      postedAt: item.post_time ?? null,
      expiresAt: item.offer?.expires_at ?? null,
      // Net votes: a heavily downvoted thread is usually a bad or dead deal.
      votes: Math.max(0, up - down),
      description: null,
    });
  }

  return deals;
}

function absoluteRfdUrl(path: string): string {
  return path.startsWith('http')
    ? path
    : `https://forums.redflagdeals.com${path.startsWith('/') ? '' : '/'}${path}`;
}

/** Degraded fallback: RSS carries no dealer, price or votes. */
export function parseRssFeed(xml: string): RawDeal[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch {
    return [];
  }

  const channel = (document as { rss?: { channel?: { item?: unknown } } })?.rss?.channel;
  if (!channel) return [];

  const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
  const deals: RawDeal[] = [];

  for (const entry of items) {
    const item = entry as { title?: string; link?: string; pubDate?: string; guid?: unknown };
    const title = typeof item.title === 'string' ? item.title : null;
    const link = typeof item.link === 'string' ? item.link : null;
    if (!title || !link) continue;
    if (EXPIRED_MARKERS.test(title)) continue;

    const guid = typeof item.guid === 'string' ? item.guid : String(link);

    deals.push({
      sourceId: guid,
      title,
      url: link,
      postedAt: typeof item.pubDate === 'string' ? item.pubDate : null,
      // RSS has no offer metadata at all. Leaving these null is correct: an
      // invented price would be worse than an absent one.
      price: null,
      priceWas: null,
      votes: 0,
    });
  }

  return deals;
}

export const redflagdealsAdapter: SourceAdapter = {
  id: 'redflagdeals',
  name: 'RedFlagDeals Hot Deals',
  weight: 1.0,

  enabled: () => ({ enabled: true }),

  async fetch(context: AdapterContext): Promise<AdapterResult> {
    const limit = context.limit ?? 120;
    const pages = Math.max(1, Math.ceil(limit / PER_PAGE));
    const collected: RawDeal[] = [];

    try {
      for (let page = 1; page <= pages; page += 1) {
        const url = `${API_URL}?forum_id=${HOT_DEALS_FORUM_ID}&per_page=${PER_PAGE}&page=${page}`;
        // A documented JSON API, not a page to be crawled.
        const response = await context.http.fetchJson<unknown>(url, { skipRobots: true });

        const deals = parseTopicsResponse(response.data);
        context.log(`page ${page}: ${deals.length} deals`);

        collected.push(...deals);
        if (deals.length === 0) break;
        if (collected.length >= limit) break;
      }

      if (collected.length > 0) {
        return { deals: collected.slice(0, limit), path: 'api' };
      }
    } catch (error) {
      context.log('topics API failed, falling back to RSS', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fallback keeps deals flowing when the API shape changes, at the cost of
    // dealer, price and vote data.
    const rss = await context.http.fetchText(RSS_URL, { skipRobots: true });
    const deals = parseRssFeed(rss.data).slice(0, limit);

    return {
      deals,
      path: 'rss',
      reason: deals.length > 0 ? 'topics API unavailable; RSS carries no price or votes' : undefined,
    };
  },
};
