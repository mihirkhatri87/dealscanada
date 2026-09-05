import type { Engine } from './catalogue';

/**
 * Platform detection for retailer onboarding.
 *
 * Coverage is the product, and coverage scales only if adding a store is a
 * catalogue entry rather than a scraper. This is what turns a URL into that
 * entry: fetch the storefront, recognise the platform from its own fingerprints,
 * and emit a config someone can paste in.
 *
 * Detection is separated from fetching so it is testable against fixtures rather
 * than against the live web — the same reason every adapter here is.
 */

export interface ProbeEvidence {
  /** The storefront HTML. */
  html: string;
  /** Whether GET /products.json returned a Shopify-shaped payload. */
  productsJsonOk?: boolean;
  /** Response headers, lowercased. */
  headers?: Record<string, string>;
  /** Cookie names observed on the response. */
  cookies?: string[];
}

export interface ProbeResult {
  engine: Engine | null;
  /** Why this platform was chosen, so a wrong answer is arguable rather than opaque. */
  evidence: string[];
  /** Extra catalogue fields the fingerprints revealed. */
  hints: Record<string, string>;
}

/**
 * Identifies the platform behind a storefront.
 *
 * Ordered by how specific each fingerprint is. `/products.json` answering with a
 * product array is conclusive — nothing but Shopify serves that — so it is
 * checked first; the generic markers come last, where a false positive costs
 * least.
 */
export function detectPlatform(evidence: ProbeEvidence): ProbeResult {
  const html = evidence.html;
  const cookies = (evidence.cookies ?? []).map((cookie) => cookie.toLowerCase());
  const found: string[] = [];
  const hints: Record<string, string> = {};

  if (evidence.productsJsonOk) {
    return {
      engine: 'shopify',
      evidence: ['/products.json returned a product array'],
      hints,
    };
  }

  if (/Powered by Shopify|cdn\.shopify\.com|Shopify\.theme/i.test(html)) {
    return { engine: 'shopify', evidence: ['Shopify markers in the page'], hints };
  }

  // SFCC's storefront URLs are unmistakable, and they carry the site id we need.
  const siteId = /Sites-([A-Za-z0-9_-]+)-Site/.exec(html)?.[1];
  if (siteId || /\/on\/demandware\.store\//i.test(html) || cookies.includes('dwsid')) {
    if (siteId) {
      hints['sfccSiteId'] = siteId;
      found.push(`site id ${siteId}`);
    }
    found.push('demandware storefront URLs');
    return { engine: 'sfcc', evidence: found, hints };
  }

  if (/gapcanada|oldnavy|bananarepublic|athleta|brfactory|gapfactory/i.test(html)) {
    return { engine: 'gapinc', evidence: ['Gap Inc. brand markers'], hints };
  }

  if (/ocp-apim-subscription-key|apim\.canadiantire\.ca/i.test(html)) {
    return { engine: 'hybris', evidence: ['Canadian Tire platform markers'], hints };
  }

  if (/\/wp-json\/|wp-content\/(?:themes|plugins)\//i.test(html)) {
    return { engine: 'wordpress', evidence: ['WordPress paths in the page'], hints };
  }

  if (/Magento|mage\/|static\/version\d+\//i.test(html)) {
    return { engine: 'magento', evidence: ['Magento markers'], hints };
  }

  // JSON-LD is not a platform, it is a fallback — but knowing the page has it
  // is the difference between "try the universal engine" and "this needs work".
  if (/application\/ld\+json/i.test(html)) {
    return {
      engine: 'jsonld',
      evidence: ['no platform recognised, but the page publishes JSON-LD'],
      hints,
    };
  }

  return { engine: null, evidence: ['no platform fingerprints and no JSON-LD'], hints };
}

/**
 * Sale and clearance paths the page actually links to.
 *
 * Guessing `/sale` and hoping is how a catalogue entry ends up reporting 404s
 * forever; a link the storefront's own navigation contains is a path that
 * exists.
 */
export function findSalePaths(html: string, baseUrl: string): string[] {
  const found = new Set<string>();
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const href = match[1];
    if (!href) continue;

    let url: URL;
    try {
      url = new URL(href, `${origin}/`);
    } catch {
      continue;
    }

    if (url.origin !== origin) continue;
    if (!/\b(sale|clearance|outlet|deals|markdown|solde|liquidation)\b/i.test(url.pathname)) {
      continue;
    }
    // Deep product links inside a sale section are not entry points.
    if (url.pathname.split('/').filter(Boolean).length > 3) continue;

    found.add(url.pathname);
    if (found.size >= 5) break;
  }

  return [...found];
}

/** Shopify collection handles worth trying, from links the page contains. */
export function findShopifyCollections(html: string): string[] {
  const found = new Set<string>();

  for (const match of html.matchAll(/\/collections\/([a-z0-9-]+)/gi)) {
    const handle = match[1]?.toLowerCase();
    if (!handle) continue;
    if (/sale|clearance|outlet|markdown|final|last-chance/.test(handle)) found.add(handle);
    if (found.size >= 6) break;
  }

  return [...found];
}

export interface CatalogueDraft {
  id: string;
  name: string;
  domain: string;
  baseUrl: string;
  engine: Engine;
  status: 'unverified';
  vertical?: string;
  salePaths?: string[];
  productLinkSelector?: string;
  sfccSiteId?: string;
}

/** Turns a probe into an entry someone can paste into the catalogue. */
export function buildCatalogueEntry(
  url: string,
  result: ProbeResult,
  salePaths: string[],
): CatalogueDraft | null {
  if (!result.engine) return null;

  const parsed = new URL(url);
  const domain = parsed.hostname.replace(/^www\./, '');
  const id = domain.replace(/\.(ca|com|co)$/, '').replace(/[^a-z0-9]+/gi, '-');

  const draft: CatalogueDraft = {
    id,
    name: id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    domain,
    baseUrl: parsed.origin,
    engine: result.engine,
    status: 'unverified',
  };

  if (salePaths.length > 0) draft.salePaths = salePaths;
  if (result.hints['sfccSiteId']) draft.sfccSiteId = result.hints['sfccSiteId'];

  // The JSON-LD engine cannot run without a selector, and no probe can infer a
  // good one. Leaving a placeholder is honest: it makes the entry visibly
  // incomplete rather than silently broken.
  if (result.engine === 'jsonld') {
    draft.productLinkSelector = 'TODO: CSS selector for product links';
  }

  return draft;
}
