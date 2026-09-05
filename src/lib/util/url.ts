/**
 * URL canonicalization — the primary deduplication key.
 *
 * The same product reaches us from RedFlagDeals, an affiliate feed and the
 * retailer's own API with different tracking parameters attached. Unless those
 * collapse to one string, the front page fills up with the same TV three times.
 */

/** Tracking parameters that never identify a product. */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'gclid',
  'gclsrc',
  'dclid',
  'fbclid',
  'msclkid',
  'twclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'srsltid',
  'ref',
  'referrer',
  'referer',
  'source',
  'cmpid',
  'campaign',
  'cm_mmc',
  'cm_sp',
  'irclickid',
  'irgwc',
  'clickid',
  'affid',
  'affiliate',
  'partner',
  'pcrid',
  'sid',
  'siteid',
  'eid',
  '_ga',
  '_gl',
  'icid',
  'intcmp',
  'ecid',
  'trk',
  'trkid',
]);

/**
 * Amazon's `tag` is an affiliate tag, but on other sites `tag` can be meaningful.
 * Stripping it globally would break some product URLs, so it is host-scoped.
 */
const HOST_SCOPED_TRACKING: Record<string, string[]> = {
  'amazon.ca': ['tag', 'linkCode', 'linkId', 'ascsubtag', 'psc', 'th', 'creative', 'creativeASIN'],
  'amazon.com': ['tag', 'linkCode', 'linkId', 'ascsubtag', 'psc', 'th'],
  'bestbuy.ca': ['icmp', 'intl'],
  'walmart.ca': ['athbdg', 'athcpid', 'athstid'],
};

/** Redirect wrappers that hide the real destination behind a query parameter. */
const REDIRECT_WRAPPERS: Array<{ hostPattern: RegExp; param: string }> = [
  { hostPattern: /(^|\.)redflagdeals\.com$/i, param: 'url' },
  { hostPattern: /(^|\.)googleadservices\.com$/i, param: 'adurl' },
  { hostPattern: /(^|\.)doubleclick\.net$/i, param: 'ds_dest_url' },
  { hostPattern: /(^|\.)go\.redirectingat\.com$/i, param: 'url' },
  { hostPattern: /(^|\.)anrdoezrs\.net$/i, param: 'url' },
  { hostPattern: /(^|\.)dpbolvw\.net$/i, param: 'url' },
  { hostPattern: /(^|\.)linksynergy\.com$/i, param: 'murl' },
];

/**
 * Produces a stable canonical form: redirects unwrapped, host lowercased and
 * de-`www`'d, tracking parameters stripped, remaining parameters sorted, fragment
 * dropped, and a trailing slash normalized away.
 *
 * Returns the input unchanged if it is not a parseable absolute URL — callers
 * decide whether that is fatal.
 */
export function canonicalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return input.trim();
  }

  // Unwrap redirect wrappers, repeatedly — they nest in affiliate chains.
  for (let depth = 0; depth < 3; depth += 1) {
    const wrapper = REDIRECT_WRAPPERS.find((entry) => entry.hostPattern.test(url.hostname));
    if (!wrapper) break;

    const target = url.searchParams.get(wrapper.param);
    if (!target) break;

    try {
      url = new URL(decodeURIComponent(target));
    } catch {
      break;
    }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return input.trim();

  // Normalize to https: the same page served over both is one page.
  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  url.username = '';
  url.password = '';
  if (url.port === '80' || url.port === '443') url.port = '';

  const hostScoped = findHostScopedParams(url.hostname);
  const kept: Array<[string, string]> = [];

  for (const [key, value] of url.searchParams) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAMS.has(lower)) continue;
    if (hostScoped.some((param) => param.toLowerCase() === lower)) continue;
    kept.push([key, value]);
  }

  // Sort so parameter order cannot produce two canonical forms of one page.
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  url.search = '';
  for (const [key, value] of kept) url.searchParams.append(key, value);

  let result = url.toString();
  // A trailing slash on a path is not a different page.
  if (url.pathname !== '/' && result.endsWith('/')) result = result.slice(0, -1);
  // Nor is a bare trailing "?" .
  if (result.endsWith('?')) result = result.slice(0, -1);

  return result;
}

function findHostScopedParams(hostname: string): string[] {
  for (const [host, params] of Object.entries(HOST_SCOPED_TRACKING)) {
    if (hostname === host || hostname.endsWith(`.${host}`)) return params;
  }
  return [];
}

/** Registrable-ish domain for merchant resolution: "www.shop.bestbuy.ca" -> "bestbuy.ca". */
export function extractDomain(input: string): string | null {
  try {
    const { hostname } = new URL(input.trim());
    const clean = hostname.toLowerCase().replace(/^www\./, '');

    const parts = clean.split('.');
    if (parts.length <= 2) return clean;

    // Canadian and UK-style two-part public suffixes need three labels kept.
    const twoPartSuffixes = ['co.uk', 'com.au', 'co.nz', 'com.br', 'gc.ca', 'on.ca', 'qc.ca'];
    const lastTwo = parts.slice(-2).join('.');
    if (twoPartSuffixes.includes(lastTwo)) return parts.slice(-3).join('.');

    return lastTwo;
  } catch {
    return null;
  }
}

/** Extracts an Amazon ASIN from any of the URL shapes Amazon uses. */
export function extractAsin(input: string): string | null {
  const patterns = [
    /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /[?&]asin=([A-Z0-9]{10})(?:&|$)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(input);
    const asin = match?.[1];
    // A valid ASIN is 10 alphanumerics and is not all digits unless it is an ISBN.
    if (asin && /^[A-Z0-9]{10}$/i.test(asin)) return asin.toUpperCase();
  }
  return null;
}

/**
 * Applies a merchant's affiliate template, e.g. "{url}?tag=partner-20".
 * Returns the plain URL when no template is configured — we never fabricate one.
 */
export function applyAffiliateTemplate(url: string, template: string | null): string {
  if (!template) return url;
  if (!template.includes('{url}')) return url;
  return template.replace('{url}', encodeURIComponent(url)).replace('%7Burl%7D', url);
}
