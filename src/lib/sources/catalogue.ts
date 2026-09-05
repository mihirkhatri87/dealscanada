import { z } from 'zod';

/**
 * The retailer catalogue.
 *
 * Retailers are data, not code. Onboarding one means adding an entry here — no
 * TypeScript, no new adapter file — because coverage across 60+ Canadian stores
 * only scales if adding the 61st costs minutes rather than a session.
 *
 * `status` is set from real `npm run health` output, so the catalogue records
 * what actually works from a Canadian IP rather than what we hoped would.
 */

export const ENGINES = [
  'shopify',
  'sfcc',
  'hybris',
  'gapinc',
  'magento',
  'wordpress',
  'jsonld',
] as const;
export type Engine = (typeof ENGINES)[number];

export const retailerConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  domain: z.string().min(1),
  baseUrl: z.string().url(),
  engine: z.enum(ENGINES),

  /** Brand family, e.g. canadian-tire, gap-inc, reitmans. */
  family: z.string().nullish(),
  vertical: z.string().nullish(),

  /** Engine-specific entry points: Shopify collection handles, listing paths. */
  salePaths: z.array(z.string()).nullish(),
  /**
   * Listing URLs for the JSON-LD engine, when `salePaths` holds something else.
   *
   * The Canadian Tire banners need both: `salePaths` carries platform category
   * codes for the Hybris engine, which are not URLs, so the JSON-LD fallback
   * would have nothing to fetch without this.
   */
  jsonLdListingPaths: z.array(z.string()).nullish(),
  /** CSS selector for product links, used by the JSON-LD engine. */
  productLinkSelector: z.string().nullish(),
  /** Department all this retailer's stock belongs to, when it is single-department. */
  departmentHint: z.string().nullish(),

  /**
   * SFCC site id, e.g. the `RetailerCA` in `Sites-RetailerCA-Site`. Optional: the
   * engine reads it off the storefront when absent, so it is a pin rather than a
   * requirement.
   */
  sfccSiteId: z.string().nullish(),
  /** SFCC locale segment, e.g. en_CA or fr_CA. Defaults to en_CA. */
  sfccLocale: z.string().nullish(),

  /** Gap Inc. locale segment, e.g. en_CA or fr_CA. Defaults to en_CA. */
  gapLocale: z.string().nullish(),
  /**
   * Department per sale path.
   *
   * Apparel departments come from the brand's own navigation - a category id is
   * already "girls" or "men" on their side - so mapping it here beats inferring
   * it from a product title downstream.
   */
  salePathDepartments: z.record(z.string(), z.string()).nullish(),

  /**
   * Hybris platform API base, shared by every Canadian Tire banner. Overridable
   * per entry so a banner that moves to its own host is a data change.
   */
  hybrisApiBase: z.string().url().nullish(),
  /** The banner's baseStoreId on the shared platform. Defaults to the entry id. */
  hybrisBanner: z.string().nullish(),

  /**
   * For blogs: the retailer a publication writes about.
   *
   * A deal blog is the source, not the merchant. Filing its posts under its own
   * domain would put "Costco West Fan Blog" on a card about a Costco sale.
   */
  subjectDomain: z.string().nullish(),
  subjectName: z.string().nullish(),

  /** Per-retailer politeness override. */
  rateLimitRps: z.number().positive().nullish(),
  /** Cap on product pages fetched per run, for engines that crawl. */
  maxProductPages: z.number().positive().nullish(),

  /** verified | unverified | blocked — set from real health output. */
  status: z.enum(['verified', 'unverified', 'blocked']).default('unverified'),
  enabled: z.boolean().default(true),
  /**
   * The bespoke adapter that serves this retailer instead of a catalogue engine.
   *
   * Some retailers are worth dedicated handling - Best Buy's offers endpoint,
   * Walmart's and Costco's fallback chains, Amazon's two permitted routes. Their
   * entries stay in the catalogue so /brands lists them, but are not registered
   * from here; without this field the directory reads that as "not yet live",
   * which is the opposite of the truth.
   */
  coveredBy: z.string().nullish(),

  /** Why a retailer is disabled or blocked, so the decision is auditable. */
  note: z.string().nullish(),
});

export type RetailerConfig = z.infer<typeof retailerConfigSchema>;

export const catalogueSchema = z.array(retailerConfigSchema);

export interface CatalogueValidation {
  valid: RetailerConfig[];
  errors: string[];
}

/**
 * Retailers no crawling engine may ever be pointed at.
 *
 * Amazon's terms forbid scraping their pages. A disabled catalogue entry is not
 * protection - it is one `enabled: true` away from turning the JSON-LD engine
 * loose on amazon.ca - so the prohibition lives in validation, where flipping
 * that flag fails the catalogue instead of shipping a violation.
 *
 * Amazon is covered by dedicated adapters that never fetch an amazon.ca page:
 * the official PA-API, and third-party price trackers that publish their own
 * feeds.
 */
const NO_CRAWL_DOMAINS = ['amazon.ca', 'amazon.com'];

/**
 * Validates a catalogue, reporting every problem rather than throwing on the
 * first. A typo in one entry must not take the other sixty offline.
 */
export function validateCatalogue(input: unknown): CatalogueValidation {
  const errors: string[] = [];
  const valid: RetailerConfig[] = [];

  if (!Array.isArray(input)) {
    return { valid: [], errors: ['catalogue must be an array'] };
  }

  const seenIds = new Set<string>();
  const seenDomains = new Set<string>();

  input.forEach((entry, index) => {
    const result = retailerConfigSchema.safeParse(entry);

    if (!result.success) {
      const label = (entry as { id?: string })?.id ?? `entry ${index}`;
      for (const issue of result.error.issues) {
        errors.push(`${label}: ${issue.path.join('.')} ${issue.message}`);
      }
      return;
    }

    const config = result.data;

    // A duplicate id would silently overwrite one retailer's run history with
    // another's, which is the kind of bug that hides for months.
    if (seenIds.has(config.id)) {
      errors.push(`${config.id}: duplicate id`);
      return;
    }
    if (seenDomains.has(config.domain)) {
      errors.push(`${config.id}: duplicate domain ${config.domain}`);
      return;
    }

    // Enabling a no-crawl retailer fails the catalogue rather than shipping a
    // terms violation. The entry may exist - it belongs in /brands so shoppers
    // see the retailer is covered - it just can never become a crawler.
    if (config.enabled && NO_CRAWL_DOMAINS.includes(config.domain.toLowerCase())) {
      errors.push(
        `${config.id}: ${config.domain} must not be crawled — it is served by the ` +
          'dedicated amazon-paapi and amazon-alt adapters, which never fetch its pages',
      );
      return;
    }

    seenIds.add(config.id);
    seenDomains.add(config.domain);
    valid.push(config);
  });

  return { valid, errors };
}

/** Retailers that should actually be scraped this run. */
export function runnableRetailers(catalogue: RetailerConfig[]): RetailerConfig[] {
  return catalogue.filter((entry) => entry.enabled && entry.status !== 'blocked');
}

export function byFamily(catalogue: RetailerConfig[], family: string): RetailerConfig[] {
  return catalogue.filter((entry) => entry.family === family);
}
