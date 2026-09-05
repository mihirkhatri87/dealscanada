-- DealsCanada schema.
--
-- Written to run on both SQLite and Postgres. The dialect differences are handled
-- by src/lib/db/dialect.ts, which rewrites the small number of type tokens below.
-- Portable choices made deliberately:
--   * TEXT primary keys (application-generated ids) — no AUTOINCREMENT/SERIAL split
--   * timestamps stored as ISO-8601 TEXT in UTC — no DATETIME/TIMESTAMPTZ split
--   * booleans stored as INTEGER 0/1 — SQLite has no boolean type
--   * money stored as INTEGER cents — never float; $19.99 is 1999
--
-- Prices are cached observations with an observed-at timestamp. They are never
-- presented as authoritative, and price_was is NULL unless a source actually
-- provided one. We do not infer a "before" price.

CREATE TABLE IF NOT EXISTS merchants (
  id                    TEXT PRIMARY KEY,
  slug                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  domain                TEXT NOT NULL UNIQUE,
  logo_url              TEXT,
  affiliate_url_template TEXT,
  -- Brand family: canadian-tire, gap-inc, reitmans, ... Enables /family/[slug].
  family                TEXT,
  -- Retail vertical: electronics, apparel, toys, home, grocery, beauty, sports, ...
  vertical              TEXT,
  -- Ingestion engine: shopify, sfcc, hybris, gapinc, magento, jsonld, native, platform
  engine                TEXT,
  -- verified | unverified | blocked — set from real `npm run health` output.
  status                TEXT NOT NULL DEFAULT 'unverified',
  rate_limit_rps        REAL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_merchants_family ON merchants (family);
CREATE INDEX IF NOT EXISTS idx_merchants_vertical ON merchants (vertical);

CREATE TABLE IF NOT EXISTS stores (
  id              TEXT PRIMARY KEY,
  chain           TEXT NOT NULL,
  source_store_id TEXT NOT NULL,
  name            TEXT NOT NULL,
  address         TEXT,
  city            TEXT,
  province        TEXT,
  postal_code     TEXT,
  lat             REAL,
  lng             REAL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (chain, source_store_id)
);

CREATE INDEX IF NOT EXISTS idx_stores_province_city ON stores (province, city);
CREATE INDEX IF NOT EXISTS idx_stores_latlng ON stores (lat, lng);

CREATE TABLE IF NOT EXISTS deals (
  id             TEXT PRIMARY KEY,
  source         TEXT NOT NULL,
  source_id      TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,

  url            TEXT NOT NULL,
  -- Tracking params stripped, host lowercased, fragment dropped. Dedupe key.
  canonical_url  TEXT NOT NULL,

  title          TEXT NOT NULL,
  description    TEXT,
  image_url      TEXT,

  merchant_id    TEXT REFERENCES merchants (id) ON DELETE SET NULL,
  store_id       TEXT REFERENCES stores (id) ON DELETE SET NULL,

  category       TEXT NOT NULL DEFAULT 'other',
  -- women | men | girls | boys | baby | unisex | na
  department     TEXT NOT NULL DEFAULT 'na',
  brand          TEXT,
  sizes_available TEXT,

  -- Money in integer cents. price_was is NULL when no source provided one.
  price_now      INTEGER,
  price_was      INTEGER,
  currency       TEXT NOT NULL DEFAULT 'CAD',
  discount_pct   REAL,
  discount_abs   INTEGER,

  coupon_code    TEXT,
  coupon_note    TEXT,
  shipping_note  TEXT,
  in_stock       INTEGER NOT NULL DEFAULT 1,
  stock_note     TEXT,

  posted_at      TEXT,
  expires_at     TEXT,
  first_seen_at  TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,

  votes          INTEGER NOT NULL DEFAULT 0,
  heat           REAL NOT NULL DEFAULT 0,
  -- active | expired | dead
  status         TEXT NOT NULL DEFAULT 'active',
  locale         TEXT NOT NULL DEFAULT 'en-CA',

  -- Sources that also carried this deal after dedupe merged them (JSON array).
  also_seen_on   TEXT,
  -- Which path of a composite adapter produced it (walmart/costco diagnostics).
  source_path    TEXT,
  raw            TEXT,

  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_deals_heat ON deals (status, heat DESC);
CREATE INDEX IF NOT EXISTS idx_deals_posted ON deals (status, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_discount ON deals (status, discount_pct DESC);
CREATE INDEX IF NOT EXISTS idx_deals_category ON deals (status, category);
CREATE INDEX IF NOT EXISTS idx_deals_department ON deals (status, department);
CREATE INDEX IF NOT EXISTS idx_deals_merchant ON deals (status, merchant_id);
CREATE INDEX IF NOT EXISTS idx_deals_store ON deals (status, store_id);
CREATE INDEX IF NOT EXISTS idx_deals_canonical ON deals (canonical_url);
CREATE INDEX IF NOT EXISTS idx_deals_coupon ON deals (status, coupon_code);
CREATE INDEX IF NOT EXISTS idx_deals_expires ON deals (status, expires_at);

-- Secondary dedupe key: merchant + normalized title tokens + price bucket.
CREATE INDEX IF NOT EXISTS idx_deals_fingerprint ON deals (merchant_id, title, price_now);

CREATE TABLE IF NOT EXISTS price_points (
  id          TEXT PRIMARY KEY,
  deal_id     TEXT NOT NULL REFERENCES deals (id) ON DELETE CASCADE,
  price       INTEGER NOT NULL,
  observed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_points_deal ON price_points (deal_id, observed_at);

CREATE TABLE IF NOT EXISTS source_runs (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  -- ok | failed | skipped
  outcome       TEXT NOT NULL,
  items_found   INTEGER NOT NULL DEFAULT 0,
  items_new     INTEGER NOT NULL DEFAULT 0,
  items_updated INTEGER NOT NULL DEFAULT 0,
  items_dropped INTEGER NOT NULL DEFAULT 0,
  latency_ms    INTEGER,
  http_status   INTEGER,
  source_path   TEXT,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_source_runs_source ON source_runs (source, started_at DESC);

-- Assistant usage, so cost claims become measurements rather than estimates (S9.6).
CREATE TABLE IF NOT EXISTS assistant_usage (
  id                    TEXT PRIMARY KEY,
  conversation_id       TEXT NOT NULL,
  model                 TEXT NOT NULL,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  tool_calls            INTEGER NOT NULL DEFAULT 0,
  latency_ms            INTEGER,
  created_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assistant_usage_conv
  ON assistant_usage (conversation_id, created_at);
