import * as cheerio from 'cheerio';
type Tile = ReturnType<ReturnType<typeof cheerio.load>>;
import type { AdapterContext, AdapterResult, RawDeal, SourceAdapter } from '../types';
import type { RetailerConfig } from '../catalogue';
import { parseProductPage } from './jsonld';

/**
 * Salesforce Commerce Cloud (Demandware) engine.
 *
 * A large share of mid-size and large Canadian apparel and footwear banners run
 * SFCC. Its OCAPI and SCAPI interfaces both require a client id issued by the
 * merchant, and there is no public developer programme to get one — so this
 * engine reads the storefront's own search-grid endpoint, which is the same
 * response a shopper's browser receives when it paginates a category.
 *
 * That endpoint returns SFRA product tiles, and SFRA's tile markup is the reason
 * this is worth an engine rather than a per-retailer scraper: list price and
 * sale price are separate, machine-readable elements with a `content` attribute
 * carrying the unformatted number. Where a storefront has customised its tiles
 * beyond recognition, the per-product JSON-LD fallback still applies.
 */

export interface SfccParseOptions {
  baseUrl: string;
  merchantDomain: string;
  merchantName?: string;
  departmentHint?: string;
}

/**
 * SFRA's default price markup, in the order worth trying.
 *
 * `content` is preferred over the rendered text everywhere: it carries an
 * unformatted number, so it survives currency symbols, thousands separators, and
 * French-Canadian formatting without a parser guessing.
 */
const SALE_PRICE_SELECTORS = ['.sales .value', '.price-sales .value', '.sales'];
const LIST_PRICE_SELECTORS = [
  '.strike-through .value',
  '.price-standard .value',
  '.list .value',
  '.strike-through',
];

const TILE_SELECTORS = ['.product-tile', '.product[data-pid]', '.grid-tile', '.product-grid-tile'];
const NAME_SELECTORS = ['.pdp-link a', '.link', '.product-name a', '.name-link', '.tile-body a'];

export function parseSfccGrid(html: string, options: SfccParseOptions): RawDeal[] {
  const $ = cheerio.load(html);
  const base = options.baseUrl.replace(/\/$/, '');
  const deals: RawDeal[] = [];
  const seen = new Set<string>();

  const tiles = $(TILE_SELECTORS.join(', '));

  tiles.each((_, element) => {
    const tile = $(element);

    // The product id sits on the tile, a descendant, or a wrapper, depending on
    // how the storefront nests its grid. All three shapes appear in the wild.
    const pid =
      tile.attr('data-pid') ??
      tile.find('[data-pid]').first().attr('data-pid') ??
      tile.closest('[data-pid]').attr('data-pid') ??
      null;

    const link = firstMatch(tile, NAME_SELECTORS);
    const href = link?.attr('href') ?? null;
    const title = cleanText(link?.text() ?? tile.find('.product-name').first().text());

    if (!title || !href) return;

    const url = absolute(href, base);
    if (!url) return;

    const sale = priceFrom(tile, SALE_PRICE_SELECTORS);
    const list = priceFrom(tile, LIST_PRICE_SELECTORS);

    // Full-price items are storefront, not deal feed. A list price at or below
    // the sale price is SFCC's way of saying "no markdown", not a saving.
    if (sale === null) return;
    const priceWas = list !== null && list > sale ? list : null;
    if (priceWas === null) return;

    // Keyed on the URL rather than the product id, because the tile selectors
    // deliberately overlap - a grid that wraps `.product-tile` inside
    // `.product[data-pid]` matches twice, and only the URL is the same both
    // times. Paginated grids also repeat products across page boundaries.
    if (seen.has(url)) return;
    seen.add(url);

    deals.push({
      sourceId: `${options.merchantDomain}:${pid ?? url}`,
      title,
      url,
      description: null,
      imageUrl: imageFrom(tile, base),
      price: sale,
      priceWas,
      currency: 'CAD',
      merchantDomain: options.merchantDomain,
      merchantName: options.merchantName ?? null,
      // The tile's own refinement data, not a guess from the title: the site
      // knows which department it filed this under and we should use its answer.
      departmentHint: options.departmentHint ?? null,
      brand: cleanText(tile.find('.product-brand, .brand').first().text()) || null,
      mpn: pid,
      inStock: !/out of stock|sold out|épuisé/i.test(tile.text()),
      postedAt: null,
    });
  });

  return deals;
}

/**
 * Reads a price from the first matching selector.
 *
 * Prefers the `content` attribute, which SFRA populates with the raw decimal.
 * Falling back to rendered text means parsing "1 299,99 $", which the money
 * parser handles but which loses to an exact number whenever one is available.
 */
function priceFrom(tile: Tile, selectors: string[]): number | null {
  for (const selector of selectors) {
    const node = tile.find(selector).first();
    if (node.length === 0) continue;

    const content = node.attr('content');
    if (content) {
      const parsed = Number(content);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

    const text = node.text().replace(/[^\d.,]/g, '');
    const normalized = text.includes(',') && !text.includes('.') ? text.replace(',', '.') : text;
    const parsed = Number(normalized.replace(/,/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function firstMatch(tile: Tile, selectors: string[]): Tile | null {
  for (const selector of selectors) {
    const node = tile.find(selector).first();
    if (node.length > 0) return node;
  }
  return null;
}

function imageFrom(tile: Tile, base: string): string | null {
  const image = tile.find('img').first();
  // Lazy-loaded grids put the real URL in data-src and a placeholder in src.
  const source = image.attr('data-src') ?? image.attr('data-original') ?? image.attr('src') ?? null;
  return source ? absolute(source, base) : null;
}

function absolute(href: string, base: string): string | null {
  try {
    return new URL(href, `${base}/`).toString();
  } catch {
    return null;
  }
}

function cleanText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Builds the search-grid URL for one page.
 *
 * `cgid` is the category the catalogue entry names; `start`/`sz` are SFRA's own
 * pagination parameters, so this is the request the storefront makes of itself.
 */
export function buildGridUrl(
  baseUrl: string,
  siteId: string,
  locale: string,
  category: string,
  start: number,
  size: number,
): string {
  const base = baseUrl.replace(/\/$/, '');
  const params = new URLSearchParams({
    cgid: category,
    start: String(start),
    sz: String(size),
  });
  return `${base}/on/demandware.store/Sites-${siteId}-Site/${locale}/Search-UpdateGrid?${params.toString()}`;
}

/**
 * Reads the SFCC site id from a storefront URL.
 *
 * Every SFCC page links to `/on/demandware.store/Sites-<id>-Site/...` somewhere -
 * a form action, an analytics beacon, a locale switcher - so the id can be found
 * rather than configured, which is one less thing to keep correct by hand.
 */
export function detectSiteId(html: string): string | null {
  return /Sites-([A-Za-z0-9_-]+)-Site/.exec(html)?.[1] ?? null;
}

const DEFAULT_PAGE_SIZE = 48;

export function createSfccAdapter(config: RetailerConfig): SourceAdapter {
  return {
    id: `sfcc:${config.id}`,
    name: config.name,
    weight: 0.5,

    enabled: () =>
      config.enabled === false
        ? { enabled: false, reason: 'disabled in catalogue' }
        : { enabled: true },

    async fetch(context: AdapterContext): Promise<AdapterResult> {
      const limit = context.limit ?? 200;
      const base = config.baseUrl.replace(/\/$/, '');
      const categories = config.salePaths?.length ? config.salePaths : ['sale'];
      const locale = config.sfccLocale ?? 'en_CA';

      let siteId = config.sfccSiteId ?? null;
      const collected: RawDeal[] = [];
      let lastError: string | undefined;

      // Resolve the site id once, from the storefront itself, when the catalogue
      // entry does not pin one.
      if (!siteId) {
        try {
          const home = await context.http.fetchText(base);
          siteId = detectSiteId(home.data);
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      if (!siteId) {
        return {
          deals: [],
          path: 'search-grid',
          reason: `could not resolve the SFCC site id${lastError ? `: ${lastError}` : ''}`,
        };
      }

      for (const category of categories) {
        if (collected.length >= limit) break;

        const url = buildGridUrl(base, siteId, locale, category, 0, DEFAULT_PAGE_SIZE);

        try {
          const response = await context.http.fetchText(url);
          const deals = parseSfccGrid(response.data, {
            baseUrl: base,
            merchantDomain: config.domain,
            merchantName: config.name,
            departmentHint: config.departmentHint ?? undefined,
          });

          context.log(`category ${category}: ${deals.length} deals`);
          collected.push(...deals);
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      if (collected.length === 0) {
        return {
          deals: [],
          path: 'search-grid',
          reason: lastError
            ? `no products from ${categories.join(', ')}; last error: ${lastError}`
            : `no discounted products in ${categories.join(', ')}`,
        };
      }

      return { deals: collected.slice(0, limit), path: 'search-grid' };
    },
  };
}

/**
 * Parses a single SFCC product page when the grid markup is unrecognisable.
 *
 * SFCC storefronts ship JSON-LD on product pages by default, so the universal
 * engine is a real fallback here rather than a theoretical one.
 */
export function parseSfccProductPage(html: string, options: SfccParseOptions): RawDeal | null {
  return parseProductPage(html, {
    url: options.baseUrl,
    merchantDomain: options.merchantDomain,
    ...(options.merchantName ? { merchantName: options.merchantName } : {}),
    ...(options.departmentHint ? { departmentHint: options.departmentHint } : {}),
  });
}
