import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { splitStatements } from './dialect';
import { boundingBox, buildDealQuery } from './query-builder';
import { haversineKm } from '../util/geo';
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
  Deal,
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
         m.id   AS m_id,  m.slug AS m_slug, m.name AS m_name,
         m.domain AS m_domain, m.logo_url AS m_logo, m.family AS m_family,
         s.id   AS s_id,  s.name AS s_name, s.chain AS s_chain,
         s.city AS s_city, s.province AS s_province, s.lat AS s_lat, s.lng AS s_lng
  FROM deals d
  LEFT JOIN merchants m ON m.id = d.merchant_id
  LEFT JOIN stores    s ON s.id = d.store_id
`;

export class SqliteDealRepository implements DealRepository {
  readonly dialect = 'sqlite' as const;
  private db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  async migrate(): Promise<void> {
    const schemaPath = join(process.cwd(), 'src/lib/db/schema.sql');
    const sql = readFileSync(schemaPath, 'utf8');
    const statements = splitStatements(sql);
    const run = this.db.transaction(() => {
      for (const statement of statements) this.db.exec(statement);
    });
    run();
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // --- merchants -----------------------------------------------------------

  async upsertMerchants(merchants: MerchantInput[]): Promise<void> {
    if (merchants.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO merchants (id, slug, name, domain, logo_url, affiliate_url_template,
                             family, vertical, engine, status, rate_limit_rps,
                             created_at, updated_at)
      VALUES (@id, @slug, @name, @domain, @logoUrl, @affiliateUrlTemplate,
              @family, @vertical, @engine, @status, @rateLimitRps, @now, @now)
      ON CONFLICT (domain) DO UPDATE SET
        name = excluded.name,
        logo_url = COALESCE(excluded.logo_url, merchants.logo_url),
        affiliate_url_template = COALESCE(excluded.affiliate_url_template,
                                          merchants.affiliate_url_template),
        family = COALESCE(excluded.family, merchants.family),
        vertical = COALESCE(excluded.vertical, merchants.vertical),
        engine = COALESCE(excluded.engine, merchants.engine),
        status = excluded.status,
        rate_limit_rps = COALESCE(excluded.rate_limit_rps, merchants.rate_limit_rps),
        updated_at = excluded.updated_at
    `);
    const run = this.db.transaction((rows: MerchantInput[]) => {
      for (const row of rows) {
        stmt.run({
          id: row.id,
          slug: row.slug,
          name: row.name,
          domain: row.domain,
          logoUrl: row.logoUrl,
          affiliateUrlTemplate: row.affiliateUrlTemplate,
          family: row.family,
          vertical: row.vertical,
          engine: row.engine,
          status: row.status,
          rateLimitRps: row.rateLimitRps,
          now,
        });
      }
    });
    run(merchants);
  }

  async getMerchantBySlug(slug: string): Promise<Merchant | null> {
    const row = this.db.prepare('SELECT * FROM merchants WHERE slug = ?').get(slug) as
      | Row
      | undefined;
    return row ? mapMerchant(row) : null;
  }

  async getMerchantByDomain(domain: string): Promise<Merchant | null> {
    const row = this.db
      .prepare('SELECT * FROM merchants WHERE domain = ?')
      .get(domain.toLowerCase()) as Row | undefined;
    return row ? mapMerchant(row) : null;
  }

  async listMerchants(): Promise<Merchant[]> {
    const rows = this.db.prepare('SELECT * FROM merchants ORDER BY name ASC').all() as Row[];
    return rows.map(mapMerchant);
  }

  // --- stores --------------------------------------------------------------

  async upsertStores(stores: StoreInput[]): Promise<void> {
    if (stores.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO stores (id, chain, source_store_id, name, address, city, province,
                          postal_code, lat, lng, created_at, updated_at)
      VALUES (@id, @chain, @sourceStoreId, @name, @address, @city, @province,
              @postalCode, @lat, @lng, @now, @now)
      ON CONFLICT (chain, source_store_id) DO UPDATE SET
        name = excluded.name,
        address = COALESCE(excluded.address, stores.address),
        city = COALESCE(excluded.city, stores.city),
        province = COALESCE(excluded.province, stores.province),
        postal_code = COALESCE(excluded.postal_code, stores.postal_code),
        lat = COALESCE(excluded.lat, stores.lat),
        lng = COALESCE(excluded.lng, stores.lng),
        updated_at = excluded.updated_at
    `);
    const run = this.db.transaction((rows: StoreInput[]) => {
      for (const row of rows) stmt.run({ ...row, now });
    });
    run(stores);
  }

  async findStoresNear(
    lat: number,
    lng: number,
    radiusKm: number,
  ): Promise<StoreWithDistance[]> {
    const box = boundingBox(lat, lng, radiusKm);
    const rows = this.db
      .prepare(
        `SELECT * FROM stores
         WHERE lat IS NOT NULL AND lng IS NOT NULL
           AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
      )
      .all(box.minLat, box.maxLat, box.minLng, box.maxLng) as Row[];

    // Exact distance in JS: SQLite is not guaranteed to ship trig functions.
    return rows
      .map((row) => {
        const store = mapStore(row);
        return {
          ...store,
          distanceKm: haversineKm(lat, lng, store.lat as number, store.lng as number),
        };
      })
      .filter((store) => store.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  async getStore(id: string): Promise<Store | null> {
    const row = this.db.prepare('SELECT * FROM stores WHERE id = ?').get(id) as Row | undefined;
    return row ? mapStore(row) : null;
  }

  // --- deals ---------------------------------------------------------------

  async upsertDeals(deals: DealInput[], observedAt?: string): Promise<UpsertResult> {
    if (deals.length === 0) return { inserted: 0, updated: 0, priceChanged: [] };

    const now = observedAt ?? new Date().toISOString();
    const existing = this.db.prepare(
      'SELECT id, price_now, first_seen_at FROM deals WHERE source = ? AND source_id = ?',
    );
    const insert = this.db.prepare(`
      INSERT INTO deals (id, source, source_id, slug, url, canonical_url, title,
        description, image_url, merchant_id, store_id, product_key, product_key_strength,
        gtin, mpn, asin, category, department, brand,
        sizes_available, price_now, price_was, currency, discount_pct, discount_abs,
        market_price, market_discount_pct, observed_low, price_rank_pct, verdict,
        evidence, claim_suspect, quality_note,
        coupon_code, coupon_note, shipping_note, in_stock, stock_note, posted_at,
        expires_at, first_seen_at, last_seen_at, votes, heat, status, locale,
        also_seen_on, source_path)
      VALUES (@id, @source, @sourceId, @slug, @url, @canonicalUrl, @title,
        @description, @imageUrl, @merchantId, @storeId, @productKey, @productKeyStrength,
        @gtin, @mpn, @asin, @category, @department, @brand,
        @sizesAvailable, @priceNow, @priceWas, @currency, @discountPct, @discountAbs,
        @marketPrice, @marketDiscountPct, @observedLow, @priceRankPct, @verdict,
        @evidence, @claimSuspect, @qualityNote,
        @couponCode, @couponNote, @shippingNote, @inStock, @stockNote, @postedAt,
        @expiresAt, @firstSeenAt, @lastSeenAt, @votes, @heat, @status, @locale,
        @alsoSeenOn, @sourcePath)
    `);
    const update = this.db.prepare(`
      UPDATE deals SET
        slug = @slug, url = @url, canonical_url = @canonicalUrl, title = @title,
        description = @description, image_url = @imageUrl, merchant_id = @merchantId,
        store_id = @storeId, category = @category, department = @department,
        brand = @brand, sizes_available = @sizesAvailable, price_now = @priceNow,
        product_key = @productKey, product_key_strength = @productKeyStrength,
        gtin = @gtin, mpn = @mpn, asin = @asin,
        market_price = @marketPrice, market_discount_pct = @marketDiscountPct,
        observed_low = @observedLow, price_rank_pct = @priceRankPct,
        verdict = @verdict, evidence = @evidence, claim_suspect = @claimSuspect,
        quality_note = @qualityNote,
        price_was = @priceWas, currency = @currency, discount_pct = @discountPct,
        discount_abs = @discountAbs, coupon_code = @couponCode, coupon_note = @couponNote,
        shipping_note = @shippingNote, in_stock = @inStock, stock_note = @stockNote,
        posted_at = @postedAt, expires_at = @expiresAt, last_seen_at = @lastSeenAt,
        votes = @votes, heat = @heat, status = @status, locale = @locale,
        also_seen_on = @alsoSeenOn, source_path = @sourcePath
      WHERE id = @id
    `);

    let inserted = 0;
    let updated = 0;
    const priceChanged: Array<{ dealId: string; price: number }> = [];

    const run = this.db.transaction((rows: DealInput[]) => {
      for (const deal of rows) {
        const prior = existing.get(deal.source, deal.sourceId) as Row | undefined;
        const params = toDealParams(deal, now, prior);

        if (prior) {
          update.run({ ...params, id: prior['id'] as string });
          updated += 1;
          if (deal.priceNow !== null && Number(prior['price_now']) !== deal.priceNow) {
            priceChanged.push({ dealId: prior['id'] as string, price: deal.priceNow });
          }
        } else {
          insert.run(params);
          inserted += 1;
          if (deal.priceNow !== null) priceChanged.push({ dealId: deal.id, price: deal.priceNow });
        }
      }
    });
    run(deals);

    return { inserted, updated, priceChanged };
  }

  async queryDeals(query: DealQuery): Promise<DealQueryResult> {
    const { where, params, orderBy } = buildDealQuery(query, 'sqlite');
    const limit = query.limit ?? 48;
    const offset = query.offset ?? 0;

    const rows = this.db
      .prepare(`${SELECT_DEAL} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Row[];

    const total = this.countSync(where, params);
    return { deals: rows.map(mapDealWithRelations), total };
  }

  async queryDealsNear(query: NearQuery): Promise<DealQueryResult> {
    const box = boundingBox(query.lat, query.lng, query.radiusKm);
    const { where, params, orderBy } = buildDealQuery(query, 'sqlite');

    const rows = this.db
      .prepare(
        `${SELECT_DEAL}
         WHERE ${where}
           AND d.store_id IS NOT NULL
           AND s.lat BETWEEN ? AND ? AND s.lng BETWEEN ? AND ?
         ORDER BY ${orderBy}`,
      )
      .all(...params, box.minLat, box.maxLat, box.minLng, box.maxLng) as Row[];

    const withDistance = rows
      .map((row) => {
        const deal = mapDealWithRelations(row);
        const store = deal.store;
        const distanceKm =
          store?.lat != null && store.lng != null
            ? haversineKm(query.lat, query.lng, store.lat, store.lng)
            : Number.POSITIVE_INFINITY;
        return { ...deal, distanceKm };
      })
      .filter((deal) => (deal.distanceKm ?? Infinity) <= query.radiusKm);

    // Local ranking blends heat with proximity: a hot deal 30 km away should not
    // outrank a good one 2 km away, but distance alone is not the whole story.
    withDistance.sort((a, b) => {
      const scoreA = a.heat - (a.distanceKm ?? 0) * 1.5;
      const scoreB = b.heat - (b.distanceKm ?? 0) * 1.5;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return (a.distanceKm ?? 0) - (b.distanceKm ?? 0);
    });

    const limit = query.limit ?? 48;
    const offset = query.offset ?? 0;
    return {
      deals: withDistance.slice(offset, offset + limit),
      total: withDistance.length,
    };
  }

  async getDealBySlug(slug: string): Promise<DealWithRelations | null> {
    const row = this.db.prepare(`${SELECT_DEAL} WHERE d.slug = ?`).get(slug) as Row | undefined;
    return row ? mapDealWithRelations(row) : null;
  }

  async getDealsByIds(ids: string[]): Promise<DealWithRelations[]> {
    if (ids.length === 0) return [];
    const marks = ids.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`${SELECT_DEAL} WHERE d.id IN (${marks})`)
      .all(...ids) as Row[];
    return rows.map(mapDealWithRelations);
  }

  async countDeals(query: DealQuery): Promise<number> {
    const { where, params } = buildDealQuery(query, 'sqlite');
    return this.countSync(where, params);
  }

  private countSync(where: string, params: unknown[]): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM deals d
         LEFT JOIN merchants m ON m.id = d.merchant_id
         LEFT JOIN stores s ON s.id = d.store_id
         WHERE ${where}`,
      )
      .get(...params) as Row;
    return Number(row['n'] ?? 0);
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

    const rows = this.db
      .prepare(
        `SELECT ${column} AS value,
                COALESCE(${field === 'merchant' ? 'm.name' : column}, '') AS label,
                COUNT(*) AS n
         FROM deals d
         LEFT JOIN merchants m ON m.id = d.merchant_id
         WHERE d.status = 'active' AND ${column} IS NOT NULL AND ${column} <> ''
         GROUP BY ${column}
         ORDER BY n DESC`,
      )
      .all() as Row[];

    return rows.map((row) => ({
      value: String(row['value']),
      label: String(row['label'] || row['value']),
      count: Number(row['n']),
    }));
  }

  async updateHeat(scores: Array<{ id: string; heat: number }>): Promise<void> {
    if (scores.length === 0) return;
    const stmt = this.db.prepare('UPDATE deals SET heat = ? WHERE id = ?');
    const run = this.db.transaction((rows: Array<{ id: string; heat: number }>) => {
      for (const row of rows) stmt.run(row.heat, row.id);
    });
    run(scores);
  }

  async markExpired(now: string): Promise<number> {
    const result = this.db
      .prepare(
        `UPDATE deals SET status = 'expired'
         WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?`,
      )
      .run(now);
    return result.changes;
  }

  async markDead(before: string): Promise<number> {
    // Expired deals stay expired rather than being re-labelled: "this sale
    // ended" is a more useful thing to tell a visitor than "we stopped seeing
    // it", and only the first is something we actually know.
    const result = this.db
      .prepare(`UPDATE deals SET status = 'dead' WHERE status = 'active' AND last_seen_at < ?`)
      .run(before);
    return result.changes;
  }

  async prunePricePoints(before: string): Promise<number> {
    const result = this.db
      .prepare(
        `DELETE FROM price_points
         WHERE observed_at < ?
           AND id NOT IN (
             SELECT id FROM (
               SELECT id, ROW_NUMBER() OVER (
                 PARTITION BY deal_id ORDER BY observed_at DESC, id DESC
               ) AS rank FROM price_points
             ) WHERE rank = 1
           )`,
      )
      .run(before);
    return result.changes;
  }

  // --- price history -------------------------------------------------------

  async appendPricePoints(
    points: Array<{ dealId: string; price: number; observedAt: string }>,
  ): Promise<void> {
    if (points.length === 0) return;
    // Only append when the price actually differs from the latest observation —
    // re-running a scrape with unchanged prices must not grow the history.
    const latest = this.db.prepare(
      'SELECT price FROM price_points WHERE deal_id = ? ORDER BY observed_at DESC LIMIT 1',
    );
    const insert = this.db.prepare(
      'INSERT INTO price_points (id, deal_id, price, observed_at) VALUES (?, ?, ?, ?)',
    );
    const run = this.db.transaction(
      (rows: Array<{ dealId: string; price: number; observedAt: string }>) => {
        for (const row of rows) {
          const prior = latest.get(row.dealId) as Row | undefined;
          if (prior && Number(prior['price']) === row.price) continue;
          insert.run(randomUUID(), row.dealId, row.price, row.observedAt);
        }
      },
    );
    run(points);
  }

  async getPriceHistory(dealId: string): Promise<PricePoint[]> {
    const rows = this.db
      .prepare(
        'SELECT price, observed_at FROM price_points WHERE deal_id = ? ORDER BY observed_at ASC',
      )
      .all(dealId) as Row[];
    return rows.map((row) => ({
      price: Number(row['price']),
      observedAt: String(row['observed_at']),
    }));
  }

  async getPriceHistoryByProductKeys(
    productKeys: string[],
  ): Promise<Map<string, Array<{ price: number; observedAt: string; merchantId: string | null }>>> {
    const result = new Map<
      string,
      Array<{ price: number; observedAt: string; merchantId: string | null }>
    >();
    if (productKeys.length === 0) return result;

    // Chunked because SQLite caps host parameters and a full run can carry
    // thousands of distinct products.
    const CHUNK = 400;
    for (let i = 0; i < productKeys.length; i += CHUNK) {
      const chunk = productKeys.slice(i, i + CHUNK);
      const marks = chunk.map(() => '?').join(', ');
      const rows = this.db
        .prepare(
          `SELECT d.product_key AS product_key, d.merchant_id AS merchant_id,
                  p.price AS price, p.observed_at AS observed_at
           FROM price_points p
           JOIN deals d ON d.id = p.deal_id
           WHERE d.product_key IN (${marks})
           ORDER BY p.observed_at ASC`,
        )
        .all(...chunk) as Row[];

      for (const row of rows) {
        const key = String(row['product_key']);
        const bucket = result.get(key) ?? [];
        bucket.push({
          price: Number(row['price']),
          observedAt: String(row['observed_at']),
          merchantId: (row['merchant_id'] as string | null) ?? null,
        });
        result.set(key, bucket);
      }
    }

    return result;
  }

  // --- observability -------------------------------------------------------

  async recordSourceRun(run: SourceRunInput): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO source_runs (id, source, started_at, finished_at, outcome,
           items_found, items_new, items_updated, items_dropped, latency_ms,
           http_status, source_path, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        run.source,
        run.startedAt,
        run.finishedAt ?? null,
        run.outcome,
        run.itemsFound ?? 0,
        run.itemsNew ?? 0,
        run.itemsUpdated ?? 0,
        run.itemsDropped ?? 0,
        run.latencyMs ?? null,
        run.httpStatus ?? null,
        run.sourcePath ?? null,
        run.error ?? null,
      );
  }

  async getSourceHealth(): Promise<SourceRun[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM source_runs r
         WHERE r.started_at = (
           SELECT MAX(started_at) FROM source_runs WHERE source = r.source
         )
         ORDER BY r.source ASC`,
      )
      .all() as Row[];
    return rows.map(mapSourceRun);
  }

  // --- assistant -----------------------------------------------------------

  async recordAssistantUsage(usage: AssistantUsageInput): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO assistant_usage (id, conversation_id, model, input_tokens,
           output_tokens, cache_read_tokens, cache_creation_tokens, tool_calls,
           latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        usage.conversationId,
        usage.model,
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheReadTokens,
        usage.cacheCreationTokens,
        usage.toolCalls,
        usage.latencyMs ?? null,
        new Date().toISOString(),
      );
  }

  async getAssistantUsageSummary(): Promise<AssistantUsageSummary> {
    const rows = this.db.prepare('SELECT * FROM assistant_usage').all() as Row[];
    return summarizeUsage(rows);
  }
}

// --- row mapping -----------------------------------------------------------

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

export function mapDealWithRelations(row: Row): DealWithRelations {
  const deal: Deal = {
    id: String(row['id']),
    source: String(row['source']),
    sourceId: String(row['source_id']),
    slug: String(row['slug']),
    url: String(row['url']),
    canonicalUrl: String(row['canonical_url']),
    title: String(row['title']),
    description: (row['description'] as string | null) ?? null,
    imageUrl: (row['image_url'] as string | null) ?? null,
    merchantId: (row['merchant_id'] as string | null) ?? null,
    storeId: (row['store_id'] as string | null) ?? null,
    category: row['category'] as Deal['category'],
    department: row['department'] as Deal['department'],
    brand: (row['brand'] as string | null) ?? null,
    sizesAvailable: parseJsonArray(row['sizes_available']),
    productKey: (row['product_key'] as string | null) ?? null,
    productKeyStrength: (row['product_key_strength'] as Deal['productKeyStrength']) ?? null,
    gtin: (row['gtin'] as string | null) ?? null,
    mpn: (row['mpn'] as string | null) ?? null,
    asin: (row['asin'] as string | null) ?? null,
    priceNow: row['price_now'] == null ? null : Number(row['price_now']),
    priceWas: row['price_was'] == null ? null : Number(row['price_was']),
    currency: String(row['currency'] ?? 'CAD'),
    discountPct: row['discount_pct'] == null ? null : Number(row['discount_pct']),
    discountAbs: row['discount_abs'] == null ? null : Number(row['discount_abs']),
    marketPrice: row['market_price'] == null ? null : Number(row['market_price']),
    marketDiscountPct:
      row['market_discount_pct'] == null ? null : Number(row['market_discount_pct']),
    observedLow: row['observed_low'] == null ? null : Number(row['observed_low']),
    priceRankPct: row['price_rank_pct'] == null ? null : Number(row['price_rank_pct']),
    verdict: (row['verdict'] as Deal['verdict']) ?? 'unverified',
    evidence: (row['evidence'] as Deal['evidence']) ?? 'none',
    claimSuspect: Number(row['claim_suspect']) === 1,
    qualityNote: (row['quality_note'] as string | null) ?? null,
    couponCode: (row['coupon_code'] as string | null) ?? null,
    couponNote: (row['coupon_note'] as string | null) ?? null,
    shippingNote: (row['shipping_note'] as string | null) ?? null,
    inStock: Number(row['in_stock']) === 1,
    stockNote: (row['stock_note'] as string | null) ?? null,
    postedAt: (row['posted_at'] as string | null) ?? null,
    expiresAt: (row['expires_at'] as string | null) ?? null,
    firstSeenAt: String(row['first_seen_at']),
    lastSeenAt: String(row['last_seen_at']),
    votes: Number(row['votes'] ?? 0),
    heat: Number(row['heat'] ?? 0),
    status: row['status'] as Deal['status'],
    locale: String(row['locale'] ?? 'en-CA'),
    alsoSeenOn: parseJsonArray(row['also_seen_on']),
    sourcePath: (row['source_path'] as string | null) ?? null,
  };

  return {
    ...deal,
    merchant: row['m_id']
      ? {
          id: String(row['m_id']),
          slug: String(row['m_slug']),
          name: String(row['m_name']),
          domain: String(row['m_domain']),
          logoUrl: (row['m_logo'] as string | null) ?? null,
          family: (row['m_family'] as string | null) ?? null,
        }
      : null,
    store: row['s_id']
      ? {
          id: String(row['s_id']),
          name: String(row['s_name']),
          chain: String(row['s_chain']),
          city: (row['s_city'] as string | null) ?? null,
          province: (row['s_province'] as string | null) ?? null,
          lat: row['s_lat'] == null ? null : Number(row['s_lat']),
          lng: row['s_lng'] == null ? null : Number(row['s_lng']),
        }
      : null,
  };
}

function parseJsonArray(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

export function toDealParams(deal: DealInput, now: string, prior?: Row) {
  return {
    id: deal.id,
    source: deal.source,
    sourceId: deal.sourceId,
    slug: deal.slug,
    url: deal.url,
    canonicalUrl: deal.canonicalUrl,
    title: deal.title,
    description: deal.description,
    imageUrl: deal.imageUrl,
    merchantId: deal.merchantId,
    storeId: deal.storeId,
    category: deal.category,
    department: deal.department,
    brand: deal.brand,
    sizesAvailable: deal.sizesAvailable ? JSON.stringify(deal.sizesAvailable) : null,
    productKey: deal.productKey,
    productKeyStrength: deal.productKeyStrength,
    gtin: deal.gtin,
    mpn: deal.mpn,
    asin: deal.asin,
    priceNow: deal.priceNow,
    priceWas: deal.priceWas,
    currency: deal.currency,
    discountPct: deal.discountPct,
    discountAbs: deal.discountAbs,
    marketPrice: deal.marketPrice,
    marketDiscountPct: deal.marketDiscountPct,
    observedLow: deal.observedLow,
    priceRankPct: deal.priceRankPct,
    verdict: deal.verdict,
    evidence: deal.evidence,
    claimSuspect: deal.claimSuspect ? 1 : 0,
    qualityNote: deal.qualityNote,
    couponCode: deal.couponCode,
    couponNote: deal.couponNote,
    shippingNote: deal.shippingNote,
    inStock: deal.inStock ? 1 : 0,
    stockNote: deal.stockNote,
    postedAt: deal.postedAt,
    expiresAt: deal.expiresAt,
    // First sighting is preserved across updates; a deal does not get younger.
    firstSeenAt: (prior?.['first_seen_at'] as string | undefined) ?? now,
    lastSeenAt: now,
    votes: deal.votes,
    heat: deal.heat ?? 0,
    status: deal.status,
    locale: deal.locale,
    alsoSeenOn: deal.alsoSeenOn ? JSON.stringify(deal.alsoSeenOn) : null,
    sourcePath: deal.sourcePath,
  };
}

export function summarizeUsage(rows: Row[]): AssistantUsageSummary {
  const byModel: AssistantUsageSummary['byModel'] = {};
  const conversations = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  for (const row of rows) {
    const model = String(row['model']);
    conversations.add(String(row['conversation_id']));
    const input = Number(row['input_tokens']);
    const output = Number(row['output_tokens']);
    inputTokens += input;
    outputTokens += output;
    cacheReadTokens += Number(row['cache_read_tokens']);
    cacheCreationTokens += Number(row['cache_creation_tokens']);

    const bucket = byModel[model] ?? { turns: 0, inputTokens: 0, outputTokens: 0 };
    bucket.turns += 1;
    bucket.inputTokens += input;
    bucket.outputTokens += output;
    byModel[model] = bucket;
  }

  const cacheable = cacheReadTokens + inputTokens;
  return {
    conversations: conversations.size,
    turns: rows.length,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheHitRate: cacheable === 0 ? 0 : cacheReadTokens / cacheable,
    byModel,
  };
}
