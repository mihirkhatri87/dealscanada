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

export const ENGINES = ['shopify', 'sfcc', 'hybris', 'gapinc', 'magento', 'jsonld'] as const;
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

  /** Per-retailer politeness override. */
  rateLimitRps: z.number().positive().nullish(),
  /** Cap on product pages fetched per run, for engines that crawl. */
  maxProductPages: z.number().positive().nullish(),

  /** verified | unverified | blocked — set from real health output. */
  status: z.enum(['verified', 'unverified', 'blocked']).default('unverified'),
  enabled: z.boolean().default(true),
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
