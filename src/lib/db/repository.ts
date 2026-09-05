import type {
  Deal,
  DealQuery,
  DealQueryResult,
  DealWithRelations,
  FacetValue,
  Merchant,
  PricePoint,
  RunOutcome,
  SourceRun,
  Store,
} from './types';

/** Input for creating or updating a merchant. */
export type MerchantInput = Omit<Merchant, 'createdAt' | 'updatedAt'>;

/** Input for creating or updating a store. */
export type StoreInput = Omit<Store, 'createdAt' | 'updatedAt'>;

/** A deal ready to persist. Bookkeeping timestamps are managed by the repository. */
export type DealInput = Omit<Deal, 'firstSeenAt' | 'lastSeenAt' | 'heat'> & {
  heat?: number;
};

export interface UpsertResult {
  inserted: number;
  updated: number;
  /**
   * Deals whose price changed this run, as PERSISTED id plus the new price.
   *
   * The id is deliberately paired with the price here rather than returned alone:
   * normalization mints a fresh UUID every run, so a caller holding its own id
   * would look up the wrong row and silently record no price history at all.
   */
  priceChanged: Array<{ dealId: string; price: number }>;
}

export interface SourceRunInput {
  source: string;
  startedAt: string;
  finishedAt?: string | null;
  outcome: RunOutcome;
  itemsFound?: number;
  itemsNew?: number;
  itemsUpdated?: number;
  itemsDropped?: number;
  latencyMs?: number | null;
  httpStatus?: number | null;
  sourcePath?: string | null;
  error?: string | null;
}

export interface NearQuery extends DealQuery {
  lat: number;
  lng: number;
  radiusKm: number;
}

export interface StoreWithDistance extends Store {
  distanceKm: number;
}

export interface AssistantUsageInput {
  conversationId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  toolCalls: number;
  latencyMs?: number | null;
}

export interface AssistantUsageSummary {
  conversations: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** cacheRead / (cacheRead + uncached input) across turns after the first. */
  cacheHitRate: number;
  byModel: Record<string, { turns: number; inputTokens: number; outputTokens: number }>;
}

/**
 * The single data-access surface.
 *
 * No SQL exists outside src/lib/db. Both the FilterBar path and the shopping
 * assistant's tools go through this interface — which is what makes the assistant
 * structurally incapable of surfacing a deal that is not in the database.
 */
export interface DealRepository {
  readonly dialect: 'sqlite' | 'postgres';

  migrate(): Promise<void>;
  close(): Promise<void>;

  // --- merchants -----------------------------------------------------------
  upsertMerchants(merchants: MerchantInput[]): Promise<void>;
  getMerchantBySlug(slug: string): Promise<Merchant | null>;
  getMerchantByDomain(domain: string): Promise<Merchant | null>;
  listMerchants(): Promise<Merchant[]>;

  // --- stores --------------------------------------------------------------
  upsertStores(stores: StoreInput[]): Promise<void>;
  findStoresNear(lat: number, lng: number, radiusKm: number): Promise<StoreWithDistance[]>;
  getStore(id: string): Promise<Store | null>;

  // --- deals ---------------------------------------------------------------
  upsertDeals(deals: DealInput[]): Promise<UpsertResult>;
  queryDeals(query: DealQuery): Promise<DealQueryResult>;
  queryDealsNear(query: NearQuery): Promise<DealQueryResult>;
  getDealBySlug(slug: string): Promise<DealWithRelations | null>;
  getDealsByIds(ids: string[]): Promise<DealWithRelations[]>;
  countDeals(query: DealQuery): Promise<number>;
  facets(field: 'category' | 'department' | 'merchant' | 'family' | 'brand'): Promise<FacetValue[]>;
  updateHeat(scores: Array<{ id: string; heat: number }>): Promise<void>;
  markExpired(now: string): Promise<number>;

  // --- price history -------------------------------------------------------
  appendPricePoints(points: Array<{ dealId: string; price: number; observedAt: string }>): Promise<void>;
  getPriceHistory(dealId: string): Promise<PricePoint[]>;
  /**
   * Price history grouped by product identity rather than by deal.
   *
   * This is what makes "lowest we've recorded" a cross-merchant claim: the same
   * product sold by three retailers contributes all three price series.
   */
  getPriceHistoryByProductKeys(
    productKeys: string[],
  ): Promise<Map<string, Array<{ price: number; observedAt: string; merchantId: string | null }>>>;

  // --- observability -------------------------------------------------------
  recordSourceRun(run: SourceRunInput): Promise<void>;
  getSourceHealth(): Promise<SourceRun[]>;

  // --- assistant -----------------------------------------------------------
  recordAssistantUsage(usage: AssistantUsageInput): Promise<void>;
  getAssistantUsageSummary(): Promise<AssistantUsageSummary>;
}
