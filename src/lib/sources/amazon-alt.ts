import type { AdapterContext, AdapterResult, RawDeal, SourceAdapter } from './types';
import { extractAsin } from '../util/url';

/**
 * Amazon.ca deals, without touching amazon.ca.
 *
 * Amazon is the retailer people most want on a Canadian deal site and the one we
 * are least able to scrape: their terms forbid it, so no adapter in this project
 * fetches an amazon.ca product page. A test enforces that rather than leaving it
 * to discipline.
 *
 * What is permitted is third-party price trackers that publish their own feeds.
 * camelcamelcamel does exactly that, and its top-drops feed is the closest thing
 * to an Amazon deal firehose available without credentials.
 *
 * The data is second-hand and the cards say so. A tracker's snapshot can be
 * minutes or hours stale, and Amazon repricing is fast — presenting one of these
 * as a confirmed current price would be the site's most common lie.
 */

const FEEDS = [
  'https://ca.camelcamelcamel.com/top_drops/feed',
  'https://ca.camelcamelcamel.com/top_absolute_drops/feed',
];

/** Never fetched. Present so the guard test has something to assert against. */
export const FORBIDDEN_HOST = 'amazon.ca';

/**
 * Amazon's image CDN. Not amazon.ca: this serves static assets, so hotlinking one
 * is not the page scrape the guard above forbids - it is the same thing the deal
 * card already does for the ~100 other merchant CDNs in the catalogue.
 *
 * Its robots.txt names only Baiduspider, Googlebot-Image, GPTBot and CCBot, and
 * carries no wildcard group, so our agent matches no group and nothing here is
 * disallowed. We therefore do NOT skip the robots check: letting it run costs one
 * cached fetch, and means we stop on our own the day Amazon adds a rule that does
 * cover us.
 */
const IMAGE_HOST = 'm.media-amazon.com';

/**
 * Faster than the global 1 rps default, which would spend 100 seconds probing a
 * 100-item feed and blow the adapter's timeout. This is hyperscale CDN
 * infrastructure serving static JPEGs, not a small site we could inconvenience.
 */
const IMAGE_PROBE_RPS = 8;

/**
 * The product image for an ASIN.
 *
 * The /images/P/ path is keyed by ASIN rather than by the internal image id that
 * every other Amazon image URL carries, which is what makes it the only image we
 * can name without an API key or a product-page fetch. The _SCLZZZZZZZ_ transform
 * asks for the largest rendition available.
 */
export function amazonImageUrl(asin: string): string {
  return 'https://' + IMAGE_HOST + '/images/P/' + asin + '.01._SCLZZZZZZZ_.jpg';
}

/**
 * Anything smaller than this is the placeholder, not a photograph.
 *
 * An ASIN with no image answers 200 with a 43-byte transparent GIF rather than a
 * 404, so the status code cannot be the test. Stored unchecked, those rows would
 * claim an image that paints nothing - and the API hands that claim to every
 * consumer, not only to the card that happens to degrade gracefully.
 */
const PLACEHOLDER_MAX_BYTES = 1000;

export function isRealImage(status: number, headers: Record<string, string>): boolean {
  if (status !== 200) return false;

  const type = (headers['content-type'] ?? '').toLowerCase();
  if (!type.startsWith('image/')) return false;
  // The placeholder is the only GIF this path serves; real renditions are JPEG.
  if (type.startsWith('image/gif')) return false;

  const bytes = Number(headers['content-length']);
  return Number.isFinite(bytes) ? bytes > PLACEHOLDER_MAX_BYTES : true;
}

export function parseCamelFeed(xml: string): RawDeal[] {
  const deals: RawDeal[] = [];
  const seen = new Set<string>();

  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = match[1] ?? '';

    const link = tag(item, 'link');
    const title = tag(item, 'title');
    if (!link || !title) continue;

    // The ASIN is the identity that makes an Amazon deal comparable with the
    // same product at Best Buy or Walmart. Without one the row is unmergeable,
    // so it is not worth carrying.
    const asin = extractAsin(link) ?? extractAsin(item);
    if (!asin || seen.has(asin)) continue;

    const prices = extractPrices(`${title} ${tag(item, 'description') ?? ''}`);
    if (prices.now === null || prices.was === null || prices.was <= prices.now) continue;

    seen.add(asin);

    deals.push({
      sourceId: `camel:${asin}`,
      // Canonical amazon.ca URL, built from the ASIN rather than followed. The
      // link is where a shopper goes; we never request it ourselves.
      url: `https://www.amazon.ca/dp/${asin}`,
      title: cleanTitle(title),
      description: null,
      imageUrl: imageFrom(item),
      price: prices.now,
      priceWas: prices.was,
      currency: 'CAD',
      merchantDomain: 'amazon.ca',
      merchantName: 'Amazon.ca',
      asin,
      // Said on every card. A price tracker's snapshot is not Amazon's current
      // price, and Amazon reprices faster than any feed refreshes.
      stockNote: 'Price reported by a third-party tracker — confirm on Amazon before buying.',
      postedAt: tag(item, 'pubDate'),
    });
  }

  return deals;
}

const MONEY = String.raw`(?:CDN\$|\$|CAD\s?)\s?(\d{1,6}(?:[.,]\d{2})?)`;

/**
 * Words the feeds use to mark which number is which.
 *
 * String.raw throughout: in a plain template literal `\s` silently becomes `s`,
 * which produces a marker that never matches and a parser that quietly falls
 * back to guessing.
 */
const CURRENT_MARKERS = [
  String.raw`now\s*` + MONEY,
  String.raw`dropped\s+to\s*` + MONEY,
  String.raw`\bto\s*` + MONEY,
];
const PREVIOUS_MARKERS = [
  String.raw`was\s*` + MONEY,
  String.raw`previously\s*` + MONEY,
  String.raw`from\s*` + MONEY,
  String.raw`regular(?:ly)?\s*` + MONEY,
];

/**
 * Pulls the current and previous price out of a feed entry.
 *
 * These feeds state prices in prose rather than fields, so both numbers have to
 * come from the text — and the labels have to be read rather than assumed.
 * Taking the smaller number as the current price seems safe on a *drop* feed and
 * is not: "Now $59.99, previously $49.99" would be inverted into an advertised
 * saving on an item whose price went UP. Manufacturing a discount out of a price
 * rise is the precise failure this whole site exists to prevent.
 *
 * So labelled numbers win. Min/max is the fallback only when the entry labels
 * nothing, and even then the caller rejects the pair unless it is a real drop.
 */
function extractPrices(text: string): { now: number | null; was: number | null } {
  const labelledNow = firstLabelled(text, CURRENT_MARKERS);
  const labelledWas = firstLabelled(text, PREVIOUS_MARKERS);

  if (labelledNow !== null && labelledWas !== null) {
    return { now: labelledNow, was: labelledWas };
  }

  const numbers: number[] = [];
  for (const match of text.matchAll(new RegExp(MONEY, 'gi'))) {
    const parsed = Number((match[1] ?? '').replace(',', ''));
    if (Number.isFinite(parsed) && parsed > 0) numbers.push(parsed);
  }

  if (numbers.length < 2) return { now: null, was: null };

  // One side labelled is still better than neither: pair it with the number
  // furthest from it in the right direction.
  if (labelledNow !== null) return { now: labelledNow, was: Math.max(...numbers) };
  if (labelledWas !== null) return { now: Math.min(...numbers), was: labelledWas };

  return { now: Math.min(...numbers), was: Math.max(...numbers) };
}

function firstLabelled(text: string, markers: string[]): number | null {
  for (const marker of markers) {
    const match = new RegExp(marker, 'i').exec(text);
    const raw = match?.[1];
    if (!raw) continue;
    const parsed = Number(raw.replace(',', ''));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function tag(item: string, name: string): string | null {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(item);
  const value = match?.[1]?.trim();
  if (!value) return null;

  return decode(value.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')).trim() || null;
}

function imageFrom(item: string): string | null {
  const enclosure = /<enclosure[^>]*url="([^"]+)"/i.exec(item)?.[1];
  if (enclosure) return enclosure;

  const embedded = /<img[^>]*src="([^"]+)"/i.exec(item)?.[1];
  return embedded ? decode(embedded) : null;
}

function decode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Strips the price and percentage the feed appends to every headline.
 *
 * The live format is "Name - down 21.13% ($6.76) to $25.23 from $31.99", which
 * is where both prices come from - so the suffix has to survive extractPrices
 * and be removed only for display. Leaving it on produced card titles that
 * restated a stale price in prose right next to the parsed one.
 *
 * The bare "- N% drop" form below it is the older shape, kept because it costs
 * one alternation and the feeds are not versioned.
 */
function cleanTitle(title: string): string {
  return title
    .replace(/\s*[-–]\s*down\s+[\d.]+%.*$/i, '')
    .replace(/\s*[-–]\s*\d+%\s*(?:price\s*)?drop.*$/i, '')
    .replace(/\s*\((?:was|now)[^)]*\)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export const amazonAltAdapter: SourceAdapter = {
  id: 'amazon-alt',
  name: 'Amazon.ca via price trackers',
  weight: 0.6,

  enabled: () => ({ enabled: true }),

  async fetch(context: AdapterContext): Promise<AdapterResult> {
    const limit = context.limit ?? 100;
    const collected: RawDeal[] = [];
    const failures: string[] = [];

    for (const feed of FEEDS) {
      if (collected.length >= limit) break;

      try {
        const response = await context.http.fetchText(feed, { skipRobots: true });
        const deals = parseCamelFeed(response.data);
        context.log(`${feed}: ${deals.length} deals`);
        collected.push(...deals);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    // Dedupe across the two feeds, which overlap heavily by design.
    const seen = new Set<string>();
    const unique = collected.filter((deal) => {
      const key = deal.asin ?? deal.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (unique.length === 0) {
      return {
        deals: [],
        path: 'camelcamelcamel',
        reason: failures.length > 0 ? failures.join('; ') : 'feeds carried no priced drops',
      };
    }

    const selected = unique.slice(0, limit);
    await attachImages(selected, context);

    return { deals: selected, path: 'camelcamelcamel' };
  },
};

/**
 * Fills in the image the feed does not carry.
 *
 * The live feeds ship no images at all - no enclosure, no img in the description,
 * just two "Useful URLs" links - so every Amazon card rendered as bare merchant
 * initials. The ASIN we already parsed is enough to name the image directly, so
 * the fallback costs one HEAD per deal and no product-page fetch.
 *
 * Best-effort throughout: a probe that fails leaves imageUrl null, which is
 * precisely where the card already was. An image is not worth failing a run over.
 */
async function attachImages(deals: RawDeal[], context: AdapterContext): Promise<void> {
  const pending = deals.filter(
    (deal): deal is RawDeal & { asin: string } =>
      !deal.imageUrl && typeof deal.asin === 'string' && deal.asin !== '',
  );
  if (pending.length === 0) return;

  context.http.setDomainRate(IMAGE_HOST, IMAGE_PROBE_RPS);

  // The limiter spaces these per host however many we start at once, so there is
  // no separate concurrency pool to write here.
  await Promise.all(
    pending.map(async (deal) => {
      const url = amazonImageUrl(deal.asin);
      try {
        const { status, headers } = await context.http.head(url);
        if (isRealImage(status, headers)) deal.imageUrl = url;
      } catch {
        // Robots refusal, timeout, CDN hiccup: every one of them means "no
        // image", not "no deal".
      }
    }),
  );

  const resolved = deals.filter((deal) => deal.imageUrl).length;
  context.log(`images: ${resolved}/${deals.length} resolved`);
}
