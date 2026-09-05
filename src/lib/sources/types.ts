import { z } from 'zod';
import type { HttpClient } from '../util/http';

/**
 * The one adapter contract.
 *
 * Adding a source is a single file implementing this — the pipeline runner never
 * changes. Adapters return RawDeal, deliberately loose, because sources disagree
 * about everything; normalization is the pipeline's job, not the adapter's.
 */

export const rawDealSchema = z.object({
  /** Stable id within the source, used for the (source, source_id) upsert key. */
  sourceId: z.string().min(1),
  title: z.string().min(1),
  url: z.string().min(1),

  description: z.string().nullish(),
  imageUrl: z.string().nullish(),

  /** Prices as the source gave them: string or number, either convention. */
  price: z.union([z.string(), z.number()]).nullish(),
  priceWas: z.union([z.string(), z.number()]).nullish(),
  currency: z.string().nullish(),

  merchantName: z.string().nullish(),
  merchantDomain: z.string().nullish(),
  brand: z.string().nullish(),

  /* Manufacturer identifiers. These are what make honest cross-merchant price
   * comparison possible, so every engine that can supply them should. */
  gtin: z.string().nullish(),
  mpn: z.string().nullish(),
  asin: z.string().nullish(),

  /** Category/department as the source labels them; hints, not decisions. */
  categoryHint: z.string().nullish(),
  departmentHint: z.string().nullish(),

  couponCode: z.string().nullish(),
  shippingNote: z.string().nullish(),
  inStock: z.boolean().nullish(),
  stockNote: z.string().nullish(),
  sizesAvailable: z.array(z.string()).nullish(),

  postedAt: z.string().nullish(),
  expiresAt: z.string().nullish(),
  votes: z.number().nullish(),

  /** Set by store-scoped adapters (stocktrack). */
  storeId: z.string().nullish(),
  /** Which path of a composite adapter produced this (walmart/costco). */
  sourcePath: z.string().nullish(),
});

export type RawDeal = z.infer<typeof rawDealSchema>;

export interface AdapterContext {
  http: HttpClient;
  /** Caps how much an adapter fetches; honoured by every adapter. */
  limit?: number;
  /** Stores the user selected — only stocktrack and store-scoped adapters use it. */
  storeIds?: string[];
  log: (message: string, meta?: Record<string, unknown>) => void;
}

export interface AdapterResult {
  deals: RawDeal[];
  /** Which path produced the data, for composite adapters. */
  path?: string;
  /** Set when an adapter completed but produced nothing for a stateable reason. */
  reason?: string;
}

export interface SourceAdapter {
  /** Unique across the registry; a test asserts uniqueness. */
  readonly id: string;
  readonly name: string;
  /** Per-source trust, feeding the heat score. */
  readonly weight?: number;

  /**
   * Whether this adapter can run. A missing credential or a disabled flag returns
   * a reason and the runner records "skipped" — never "failed". A half-configured
   * integration is not a broken one.
   */
  enabled(): { enabled: true } | { enabled: false; reason: string };

  fetch(context: AdapterContext): Promise<AdapterResult>;
}

/**
 * Validates a batch of raw deals, dropping invalid items with a counted reason
 * rather than failing the whole source. One malformed row from a retailer must
 * not cost us the other 200.
 */
export function validateRawDeals(
  items: unknown[],
  onDrop?: (reason: string) => void,
): RawDeal[] {
  const valid: RawDeal[] = [];

  for (const item of items) {
    const result = rawDealSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      onDrop?.(result.error.issues[0]?.message ?? 'invalid shape');
    }
  }

  return valid;
}
