import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { splitStatements, translateSchema } from './dialect';
import { boundingBox, buildDealQuery } from './query-builder';
import { haversineKm } from '../util/geo';
import { mapDealWithRelations, summarizeUsage, toDealParams } from './sqlite';
import type {
  AssistantUsageInput,
  AssistantUsageSummary,
  DealInput,
  DealRepository,
  MerchantInput,
  NearQuery,
  SourceRunInput,
  StoreInput,
  StoreWithDistance,
  UpsertResult,
} from './repository';
import type {
  DealQuery,
  DealQueryResult,
  DealWithRelations,
  FacetValue,
  Merchant,
  PricePoint,
  SourceRun,
  Store,
} from './types';

type Row = Record<string, unknown>;

const SELECT_DEAL = `
  SELECT d.*,
         m.id AS m_id, m.slug AS m_slug, m.name AS m_name,
         m.domain AS m_domain, m.logo_url AS m_logo, m.family AS m_family,
         s.id AS s_id, s.name AS s_name, s.chain AS s_chain,
         s.city AS s_city, s.province AS s_province, s.lat AS s_lat, s.lng AS s_lng
  FROM deals d
  LEFT JOIN merchants m ON m.id = d.merchant_id
  LEFT JOIN stores    s ON s.id = d.store_id
`;

/**
 * Postgres implementation.
 *
 * Deliberately mirrors sqlite.ts statement for statement, reusing the shared query
 * builder and row mappers. The contract suite runs against both, so any divergence
 * shows up as a test failure rather than a production surprise.
 */
export class PostgresDealRepository implements DealRepository {
  readonly dialect = 'postgres' as const;
  private sql: postgres.Sql;

  constructor(connectionString: string) {
    this.sql = postgres(connectionString, { onnotice: () => {} });
  }

  async migrate(): Promise<void> {
    const schemaPath = join(process.cwd(), 'src/lib/db/schema.sql');
    const raw = readFileSync(schemaPath, 'utf8');
    const statements = splitStatements(translateSchema(raw, 'postgres'));
    await this.sql.begin(async (tx) => {
      for (const statement of statements) await tx.unsafe(statement);
    });
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  // --- merchants -----------------------------------------------------------

  async upsertMerchants(merchants: MerchantInput[]): Promise<void> {
    if (merchants.length === 0) return;
    const now = new Date().toISOString();
    await this.sql.begin(async (tx) => {
      for (const m of merchants) {
        await tx`
          INSERT INTO merchants (id, slug, name, domain, logo_url, affiliate_url_template,
                                 family, vertical, engine, status, rate_limit_rps,
                                 created_at, updated_at)
          VALUES (${m.id}, ${m.slug}, ${m.name}, ${m.domain}, ${m.logoUrl},
                  ${m.affiliateUrlTemplate}, ${m.family}, ${m.vertical}, ${m.engine},
                  ${m.status}, ${m.rateLimitRps}, ${now}, ${now})
          ON CONFLICT (domain) DO UPDATE SET
            name = EXCLUDED.name,
            logo_url = COALESCE(EXCLUDED.logo_url, merchants.logo_url),
            affiliate_url_template = COALESCE(EXCLUDED.affiliate_url_template,
                                              merchants.affiliate_url_template),
            family = COALESCE(EXCLUDED.family, merchants.family),
            vertical = COALESCE(EXCLUDED.vertical, merchants.vertical),
            engine = COALESCE(EXCLUDED.engine, merchants.engine),
            status = EXCLUDED.status,
            rate_limit_rps = COALESCE(EXCLUDED.rate_limit_rps, merchants.rate_limit_rps),
            updated_at = EXCLUDED.updated_at
        `;
      }
    });
  }

  async getMerchantBySlug(slug: string): Promise<Merchant | null> {
    const rows = await this.sql`SELECT * FROM merchants WHERE slug = ${slug}`;
    return rows[0] ? mapMerchant(rows[0] as Row) : null;
  }

  async getMerchantByDomain(domain: string): Promise<Merchant | null> {
    const rows = await this.sql`SELECT * FROM merchants WHERE domain = ${domain.toLowerCase()}`;
    return rows[0] ? mapMerchant(rows[0] as Row) : null;
  }

  async listMerchants(): Promise<Merchant[]> {
    const rows = await this.sql`SELECT * FROM merchants ORDER BY name ASC`;
    return rows.map((row) => mapMerchant(row as Row));
  }

  // --- stores --------------------------------------------------------------

  async upsertStores(stores: StoreInput[]): Promise<void> {
    if (stores.length === 0) return;
    const now = new Date().toISOString();
    await this.sql.begin(async (tx) => {
      for (const s of stores) {
        await tx`
          INSERT INTO stores (id, chain, source_store_id, name, address, city, province,
                              postal_code, lat, lng, created_at, updated_at)
          VALUES (${s.id}, ${s.chain}, ${s.sourceStoreId}, ${s.name}, ${s.address},
                  ${s.city}, ${s.province}, ${s.postalCode}, ${s.lat}, ${s.lng},
                  ${now}, ${now})
          ON CONFLICT (chain, source_store_id) DO UPDATE SET
            name = EXCLUDED.name,
            address = COALESCE(EXCLUDED.address, stores.address),
            city = COALESCE(EXCLUDED.city, stores.city),
            province = COALESCE(EXCLUDED.province, stores.province),
            postal_code = COALESCE(EXCLUDED.postal_code, stores.postal_code),
            lat = COALESCE(EXCLUDED.lat, stores.lat),
            lng = COALESCE(EXCLUDED.lng, stores.lng),
            updated_at = EXCLUDED.updated_at
        `;
      }
    });
  }

  async findStoresNear(
    lat: number,
    lng: number,
    radiusKm: number,
  ): Promise<StoreWithDistance[]> {
    const box = boundingBox(lat, lng, radiusKm);
    const rows = await this.sql`
      SELECT * FROM stores
      WHERE lat IS NOT NULL AND lng IS NOT NULL
        AND lat BETWEEN ${box.minLat} AND ${box.maxLat}
        AND lng BETWEEN ${box.minLng} AND ${box.maxLng}
    `;
    return rows
      .map((row) => {
        const store = mapStore(row as Row);
        return {
          ...store,
          distanceKm: haversineKm(lat, lng, store.lat as number, store.lng as number),
        };
      })
      .filter((store) => store.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  async getStore(id: string): Promise<Store | null> {
    const rows = await this.sql`SELECT * FROM stores WHERE id = ${id}`;
    return rows[0] ? mapStore(rows[0] as Row) : null;
  }

  // --- deals ---------------------------------------------------------------

  async upsertDeals(deals: DealInput[]): Promise<UpsertResult> {
    if (deals.length === 0) return { inserted: 0, updated: 0, priceChangedDealIds: [] };

    const now = new Date().toISOString();
    let inserted = 0;
    let updated = 0;
    const priceChangedDealIds: string[] = [];

    await this.sql.begin(async (tx) => {
      for (const deal of deals) {
        const prior = (
          await tx`SELECT id, price_now, first_seen_at FROM deals
                   WHERE source = ${deal.source} AND source_id = ${deal.sourceId}`
        )[0] as Row | undefined;

        const p = toDealParams(deal, now, prior);

        if (prior) {
          await tx`
            UPDATE deals SET
              slug = ${p.slug}, url = ${p.url}, canonical_url = ${p.canonicalUrl},
              title = ${p.title}, description = ${p.description}, image_url = ${p.imageUrl},
              merchant_id = ${p.merchantId}, store_id = ${p.storeId},
              category = ${p.category}, department = ${p.department}, brand = ${p.brand},
              sizes_available = ${p.sizesAvailable}, price_now = ${p.priceNow},
              price_was = ${p.priceWas}, currency = ${p.currency},
              discount_pct = ${p.discountPct}, discount_abs = ${p.discountAbs},
              coupon_code = ${p.couponCode}, coupon_note = ${p.couponNote},
              shipping_note = ${p.shippingNote}, in_stock = ${p.inStock},
              stock_note = ${p.stockNote}, posted_at = ${p.postedAt},
              expires_at = ${p.expiresAt}, last_seen_at = ${p.lastSeenAt},
              votes = ${p.votes}, heat = ${p.heat}, status = ${p.status},
              locale = ${p.locale}, also_seen_on = ${p.alsoSeenOn},
              source_path = ${p.sourcePath}
            WHERE id = ${prior['id'] as string}
          `;
          updated += 1;
          if (deal.priceNow !== null && Number(prior['price_now']) !== deal.priceNow) {
            priceChangedDealIds.push(prior['id'] as string);
          }
        } else {
          await tx`
            INSERT INTO deals (id, source, source_id, slug, url, canonical_url, title,
              description, image_url, merchant_id, store_id, category, department, brand,
              sizes_available, price_now, price_was, currency, discount_pct, discount_abs,
              coupon_code, coupon_note, shipping_note, in_stock, stock_note, posted_at,
              expires_at, first_seen_at, last_seen_at, votes, heat, status, locale,
              also_seen_on, source_path)
            VALUES (${p.id}, ${p.source}, ${p.sourceId}, ${p.slug}, ${p.url},
              ${p.canonicalUrl}, ${p.title}, ${p.description}, ${p.imageUrl},
              ${p.merchantId}, ${p.storeId}, ${p.category}, ${p.department}, ${p.brand},
              ${p.sizesAvailable}, ${p.priceNow}, ${p.priceWas}, ${p.currency},
              ${p.discountPct}, ${p.discountAbs}, ${p.couponCode}, ${p.couponNote},
              ${p.shippingNote}, ${p.inStock}, ${p.stockNote}, ${p.postedAt},
              ${p.expiresAt}, ${p.firstSeenAt}, ${p.lastSeenAt}, ${p.votes}, ${p.heat},
              ${p.status}, ${p.locale}, ${p.alsoSeenOn}, ${p.sourcePath})
          `;
          inserted += 1;
          if (deal.priceNow !== null) priceChangedDealIds.push(deal.id);
        }
      }
    });

    return { inserted, updated, priceChangedDealIds };
  }

  async queryDeals(query: DealQuery): Promise<DealQueryResult> {
    const { where, params, orderBy } = buildDealQuery(query, 'postgres');
    const limit = query.limit ?? 48;
    const offset = query.offset ?? 0;

    const rows = await this.sql.unsafe(
      `${SELECT_DEAL} WHERE ${where} ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${
        params.length + 2
      }`,
      [...params, limit, offset] as never[],
    );
    const total = await this.countWhere(where, params);
    return { deals: rows.map((row) => mapDealWithRelations(row as Row)), total };
  }

  async queryDealsNear(query: NearQuery): Promise<DealQueryResult> {
    const box = boundingBox(query.lat, query.lng, query.radiusKm);
    const { where, params, orderBy } = buildDealQuery(query, 'postgres');
    const n = params.length;

    const rows = await this.sql.unsafe(
      `${SELECT_DEAL}
       WHERE ${where}
         AND d.store_id IS NOT NULL
         AND s.lat BETWEEN $${n + 1} AND $${n + 2}
         AND s.lng BETWEEN $${n + 3} AND $${n + 4}
       ORDER BY ${orderBy}`,
      [...params, box.minLat, box.maxLat, box.minLng, box.maxLng] as never[],
    );

    const withDistance = rows
      .map((row) => {
        const deal = mapDealWithRelations(row as Row);
        const store = deal.store;
        const distanceKm =
          store?.lat != null && store.lng != null
            ? haversineKm(query.lat, query.lng, store.lat, store.lng)
            : Number.POSITIVE_INFINITY;
        return { ...deal, distanceKm };
      })
      .filter((deal) => (deal.distanceKm ?? Infinity) <= query.radiusKm);

    withDistance.sort((a, b) => {
      const scoreA = a.heat - (a.distanceKm ?? 0) * 1.5;
      const scoreB = b.heat - (b.distanceKm ?? 0) * 1.5;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return (a.distanceKm ?? 0) - (b.distanceKm ?? 0);
    });

    const limit = query.limit ?? 48;
    const offset = query.offset ?? 0;
    return { deals: withDistance.slice(offset, offset + limit), total: withDistance.length };
  }

  async getDealBySlug(slug: string): Promise<DealWithRelations | null> {
    const rows = await this.sql.unsafe(`${SELECT_DEAL} WHERE d.slug = $1`, [slug] as never[]);
    return rows[0] ? mapDealWithRelations(rows[0] as Row) : null;
  }

  async getDealsByIds(ids: string[]): Promise<DealWithRelations[]> {
    if (ids.length === 0) return [];
    const marks = ids.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await this.sql.unsafe(
      `${SELECT_DEAL} WHERE d.id IN (${marks})`,
      ids as never[],
    );
    return rows.map((row) => mapDealWithRelations(row as Row));
  }

  async countDeals(query: DealQuery): Promise<number> {
    const { where, params } = buildDealQuery(query, 'postgres');
    return this.countWhere(where, params);
  }

  private async countWhere(where: string, params: unknown[]): Promise<number> {
    const rows = await this.sql.unsafe(
      `SELECT COUNT(*) AS n FROM deals d
       LEFT JOIN merchants m ON m.id = d.merchant_id
       LEFT JOIN stores s ON s.id = d.store_id
       WHERE ${where}`,
      params as never[],
    );
    return Number((rows[0] as Row)['n'] ?? 0);
  }

  async facets(
    field: 'category' | 'department' | 'merchant' | 'family' | 'brand',
  ): Promise<FacetValue[]> {
    const column = {
      category: 'd.category',
      department: 'd.department',
      merchant: 'm.slug',
      family: 'm.family',
      brand: 'd.brand',
    }[field];

    const rows = await this.sql.unsafe(
      `SELECT ${column} AS value,
              COALESCE(${field === 'merchant' ? 'm.name' : column}, '') AS label,
              COUNT(*) AS n
       FROM deals d
       LEFT JOIN merchants m ON m.id = d.merchant_id
       WHERE d.status = 'active' AND ${column} IS NOT NULL AND ${column} <> ''
       GROUP BY ${column}${field === 'merchant' ? ', m.name' : ''}
       ORDER BY n DESC`,
      [] as never[],
    );

    return rows.map((row) => {
      const r = row as Row;
      return {
        value: String(r['value']),
        label: String(r['label'] || r['value']),
        count: Number(r['n']),
      };
    });
  }

  async updateHeat(scores: Array<{ id: string; heat: number }>): Promise<void> {
    if (scores.length === 0) return;
    await this.sql.begin(async (tx) => {
      for (const score of scores) {
        await tx`UPDATE deals SET heat = ${score.heat} WHERE id = ${score.id}`;
      }
    });
  }

  async markExpired(now: string): Promise<number> {
    const result = await this.sql`
      UPDATE deals SET status = 'expired'
      WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ${now}
    `;
    return result.count;
  }

  // --- price history -------------------------------------------------------

  async appendPricePoints(
    points: Array<{ dealId: string; price: number; observedAt: string }>,
  ): Promise<void> {
    if (points.length === 0) return;
    await this.sql.begin(async (tx) => {
      for (const point of points) {
        const prior = (
          await tx`SELECT price FROM price_points WHERE deal_id = ${point.dealId}
                   ORDER BY observed_at DESC LIMIT 1`
        )[0] as Row | undefined;
        if (prior && Number(prior['price']) === point.price) continue;
        await tx`
          INSERT INTO price_points (id, deal_id, price, observed_at)
          VALUES (${randomUUID()}, ${point.dealId}, ${point.price}, ${point.observedAt})
        `;
      }
    });
  }

  async getPriceHistory(dealId: string): Promise<PricePoint[]> {
    const rows = await this.sql`
      SELECT price, observed_at FROM price_points
      WHERE deal_id = ${dealId} ORDER BY observed_at ASC
    `;
    return rows.map((row) => {
      const r = row as Row;
      return { price: Number(r['price']), observedAt: String(r['observed_at']) };
    });
  }

  // --- observability -------------------------------------------------------

  async recordSourceRun(run: SourceRunInput): Promise<void> {
    await this.sql`
      INSERT INTO source_runs (id, source, started_at, finished_at, outcome, items_found,
        items_new, items_updated, items_dropped, latency_ms, http_status, source_path, error)
      VALUES (${randomUUID()}, ${run.source}, ${run.startedAt}, ${run.finishedAt ?? null},
        ${run.outcome}, ${run.itemsFound ?? 0}, ${run.itemsNew ?? 0},
        ${run.itemsUpdated ?? 0}, ${run.itemsDropped ?? 0}, ${run.latencyMs ?? null},
        ${run.httpStatus ?? null}, ${run.sourcePath ?? null}, ${run.error ?? null})
    `;
  }

  async getSourceHealth(): Promise<SourceRun[]> {
    const rows = await this.sql`
      SELECT * FROM source_runs r
      WHERE r.started_at = (SELECT MAX(started_at) FROM source_runs WHERE source = r.source)
      ORDER BY r.source ASC
    `;
    return rows.map((row) => mapSourceRun(row as Row));
  }

  // --- assistant -----------------------------------------------------------

  async recordAssistantUsage(usage: AssistantUsageInput): Promise<void> {
    await this.sql`
      INSERT INTO assistant_usage (id, conversation_id, model, input_tokens, output_tokens,
        cache_read_tokens, cache_creation_tokens, tool_calls, latency_ms, created_at)
      VALUES (${randomUUID()}, ${usage.conversationId}, ${usage.model}, ${usage.inputTokens},
        ${usage.outputTokens}, ${usage.cacheReadTokens}, ${usage.cacheCreationTokens},
        ${usage.toolCalls}, ${usage.latencyMs ?? null}, ${new Date().toISOString()})
    `;
  }

  async getAssistantUsageSummary(): Promise<AssistantUsageSummary> {
    const rows = await this.sql`SELECT * FROM assistant_usage`;
    return summarizeUsage(rows.map((row) => row as Row));
  }
}

// --- row mapping (shared shapes, Postgres returns snake_case identically) ---

function mapMerchant(row: Row): Merchant {
  return {
    id: String(row['id']),
    slug: String(row['slug']),
    name: String(row['name']),
    domain: String(row['domain']),
    logoUrl: (row['logo_url'] as string | null) ?? null,
    affiliateUrlTemplate: (row['affiliate_url_template'] as string | null) ?? null,
    family: (row['family'] as string | null) ?? null,
    vertical: (row['vertical'] as string | null) ?? null,
    engine: (row['engine'] as string | null) ?? null,
    status: (row['status'] as Merchant['status']) ?? 'unverified',
    rateLimitRps: row['rate_limit_rps'] == null ? null : Number(row['rate_limit_rps']),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

function mapStore(row: Row): Store {
  return {
    id: String(row['id']),
    chain: String(row['chain']),
    sourceStoreId: String(row['source_store_id']),
    name: String(row['name']),
    address: (row['address'] as string | null) ?? null,
    city: (row['city'] as string | null) ?? null,
    province: (row['province'] as string | null) ?? null,
    postalCode: (row['postal_code'] as string | null) ?? null,
    lat: row['lat'] == null ? null : Number(row['lat']),
    lng: row['lng'] == null ? null : Number(row['lng']),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

function mapSourceRun(row: Row): SourceRun {
  return {
    id: String(row['id']),
    source: String(row['source']),
    startedAt: String(row['started_at']),
    finishedAt: (row['finished_at'] as string | null) ?? null,
    outcome: row['outcome'] as SourceRun['outcome'],
    itemsFound: Number(row['items_found']),
    itemsNew: Number(row['items_new']),
    itemsUpdated: Number(row['items_updated']),
    itemsDropped: Number(row['items_dropped']),
    latencyMs: row['latency_ms'] == null ? null : Number(row['latency_ms']),
    httpStatus: row['http_status'] == null ? null : Number(row['http_status']),
    sourcePath: (row['source_path'] as string | null) ?? null,
    error: (row['error'] as string | null) ?? null,
  };
}
