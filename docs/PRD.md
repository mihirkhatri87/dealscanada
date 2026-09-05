# DealsCanada — Product Requirements Document

*Approved plan, committed verbatim. Companion document: [BACKLOG.md](./BACKLOG.md).*


## 1. Context

Canadians hunting deals today bounce between RedFlagDeals threads, Smart Canucks,
retailer flyers, Costco blogs, and camelcamelcamel — each with a different format, no
shared price normalization, and no answer to "is it actually cheap, and can I get it
near me?" DealNews solves this for the US market; there is no equivalent with Canadian
retailers, CAD pricing, and Canadian in-store stock.

`mihirkhatri87/dealscanada` is currently an empty repository (README only).

**Research constraint carried into this plan:** the build sandbox's egress proxy returns
`403 Forbidden` on CONNECT for every retailer/deal host tested — `forums.redflagdeals.com`,
`bestbuy.ca`, `costco.ca`, `walmart.ca`, `ca.camelcamelcamel.com`, `smartcanucks.ca`,
`newegg.ca`, `canadacomputers.com`. Only package registries are reachable. Adapters are
therefore written against documented response shapes and verified by **fixture-based unit
tests** here; **live verification happens on your Windows 10 machine** via `npm run health`.
Every story below reflects that split.

## 2. Vision

> One Canadian page that shows what's genuinely worth buying right now — nationally and
> in the store down the road — with the real before price, the real after price, and the
> code you need at checkout.

## 3. Goals / Non-goals

**Goals (v1)**
- G1 — Aggregate a **catalogue of ≥60 Canadian retailers** and deal platforms into one
  normalized feed: mass-market and electronics (**Walmart Canada**, Best Buy, Costco,
  Amazon.ca via approved sources), the **entire
  Canadian Tire family of banners**, **Gap Inc. Canada** (Gap, Gap Factory, Old Navy,
  Banana Republic, Athleta), **Reitmans Group** (Reitmans, RW&CO, Penningtons), broader
  apparel and footwear, and **kids & toys** retailers.
- G2 — Every deal card answers 5 questions at a glance: what, from whom, how much now,
  how much before, what code.
- G3 — Location-aware "Amazing deals near you" section driven by stocktrack.ca store-level
  clearance data.
- G4 — Runs end-to-end on Windows 10 with `npm install` → `npm run dev`, no cloud account.
- G5 — Ships deploy-ready (Postgres + Docker + Vercel cron) without a rewrite.
- G6 — A **shopping assistant** that turns natural language into a narrowed set of real
  deals, and **drives the site's own rendering** while doing it — without taking the normal
  browsing experience away.
- G7 — **Adding a retailer is a config entry, not code.** Coverage scales through
  platform-family engines plus a probe tool that auto-detects a store's e-commerce
  platform and generates its catalogue entry.

**Non-goals (v1)**
- N1 — User accounts, saved searches, and price-drop email alerts (v2).
- N2 — Scraping amazon.ca HTML (ToS violation — PA-API or alt sources only).
- N3 — Mobile native apps; the web UI is responsive instead.
- N4 — Editorial/human curation workflow and CMS.
- N5 — Checkout, cart, or affiliate revenue reporting dashboards.

## 4. Personas

| Persona | Need | v1 answer |
|---|---|---|
| **Deal hunter Dev** — checks RFD 3×/day | one firehose, ranked, no forum noise | heat-ranked front page, biggest-drop sort |
| **Bargain shopper Priya** — buys when it's cheap | is this price actually good? | before/after + % off + price history |
| **In-store clearance Sam** — hunts CT/Walmart red-tag | what's marked down at *my* store | "near you" section + `/near-me` + store picker |
| **Coupon-first Marc** | codes that work today | `/coupons`, click-to-copy, expiry countdown |
| **Overwhelmed Ana** — 3,000 deals, no patience | "warm winter coat for my 7-year-old, under $80, 40%+ off" | the shopping assistant narrows it and renders the result |

## 5. Success metrics

| # | Metric | v1 target |
|---|---|---|
| M1 | Retailers in the catalogue | ≥ 60 |
| M2 | Retailers green in `npm run health` from a Canadian IP | ≥ 25 |
| M3 | Retail verticals covered (electronics, apparel, toys, home, grocery, beauty, sports) | 7 |
| M4 | Active deals after one full scrape | ≥ 3,000 |
| M5 | Deals with both `price_now` and `price_was` | ≥ 70% |
| M6 | Deals with a product image | ≥ 85% |
| M7 | Duplicate rate across sources (sampled 100) | < 3% |
| M8 | Full scrape cycle wall time (parallel, rate-limited) | < 15 min |
| M9 | Time to onboard a new retailer with `retailer:probe` | < 10 min, zero code |
| M10 | Front-page LCP, local, cached DB | < 2.5 s |
| M11 | Unit-test line coverage on `src/lib/` | ≥ 80% |
| M12 | Assistant finds the intended deal in the top 6 (golden eval set) | ≥ 85% |
| M13 | Assistant hallucinated products or prices | **0** — structurally impossible by design |
| M16 | Deals carrying a manufacturer-grade product identity | ≥ 40% |
| M17 | Deals with a cross-merchant or historical verdict | ≥ 30% |
| M18 | Inflated anchors reaching the front page | **0** |
| M14 | Assistant time-to-first-token | < 1.5 s |
| M15 | Prompt-cache hit rate on assistant turns after the first | ≥ 90% |

## 6. Scope

**In (v1):** ingestion framework; six platform engines + a ≥60-retailer catalogue
(Canadian Tire family, Gap Inc., Reitmans, Walmart, kids & toys, and the verticals in §9.1);
the `retailer:probe` onboarding tool; deal-platform and composite adapters;
dedupe/classification/coupon extraction/
heat ranking; price history; SQLite+Postgres data layer; JSON API; full responsive UI
(front page, filters, search, detail, category, department, merchant, brand directory,
family pages, coupons, near-me); location
model + stocktrack integration; local cron worker + Vercel cron route; seed dataset;
fixture test suite; deploy config; docs.

**Deferred (v2+):** accounts and alerting; ML-based categorization and duplicate matching;
flyer OCR; browser extension; affiliate revenue reporting; French localization
(schema keeps a `locale` column so it is additive).

## 7. Functional requirements

**Ingestion**
- FR-1 Pluggable source adapters implementing one `SourceAdapter` contract.
- FR-2 Each run records status, item counts, latency, and error to `source_runs`.
- FR-3 One failing source never aborts the run or other sources.
- FR-4 All outbound requests are rate-limited per domain, retried with backoff, and
  identified by a descriptive User-Agent.
- FR-5 `robots.txt` is fetched, cached, and honoured before any HTML scrape.
- FR-6 Raw payloads are schema-validated (zod) before normalization; invalid items are
  dropped with a counted reason, not crashed on.

**Normalization**
- FR-7 Every deal normalizes to: title, description, image, url, merchant, category,
  `price_now`, `price_was`, `discount_pct`, `coupon_code`, `expires_at`, `posted_at`.
- FR-8 Merchant resolved from URL domain against a merchant registry; unknown domains
  auto-create a merchant record.
- FR-9 Deals classified into a two-level taxonomy — ~16 categories (Electronics,
  Computers, Gaming, **Clothing**, **Shoes & Accessories**, **Toys & Games**,
  **Baby & Kids**, Home, Kitchen, Appliances, Grocery, Beauty & Health, Sports & Outdoors,
  Tools & Auto, Travel, Other) — plus a **department** facet for apparel and kids
  (Women / Men / Girls / Boys / Baby / Unisex) and a `brand` field.
- FR-10 Coupon codes extracted from title/description (`use code X`, `promo code: X`,
  `code X`) and stored separately from prose.
- FR-11 `discount_pct` computed when both prices exist; deals with only one price still
  render (no fabricated "was" price — ever).
- FR-12 Deduplication across sources by canonical URL (tracking params stripped) and by
  merchant + normalized-title + price fingerprint.
- FR-13 Every observed price change appends a `price_points` row.
- FR-14 Heat score ranks deals; recomputed each run.

**Deal verification — is it actually a deal?**
- FR-14g A retailer's own "was" price is treated as a **claim to be checked**, never
  as fact. `discount_pct` is stored as the claim; it is not what the UI leads with.
- FR-14h Products are identified across merchants by manufacturer-assigned
  identifiers (GTIN, ASIN, brand-scoped MPN) — never by a retailer SKU, which is
  merchant-scoped and would defeat comparison.
- FR-14i The honest anchor is the **median current price across other merchants**,
  computed only from ≥2 *distinct* merchants; one retailer cannot corroborate itself.
- FR-14j Our own recorded `price_points` establish an observed low, enabling a
  "lowest we've recorded in N days" claim we can actually stand behind.
- FR-14k Every deal carries a **verdict**: verified-low, verified-good, market-price,
  above-market, inflated-anchor, or unverified — plus an evidence level.
- FR-14l A claimed "was" materially above the market median is flagged as an
  **inflated anchor**, its headline percentage suppressed, and its heat capped so it
  cannot reach the front page as a bargain.
- FR-14m Ranking uses the corroborated discount, not the claimed one.
- FR-14n Where nothing corroborates a claim, the UI says so explicitly rather than
  presenting the retailer's number as a verified saving.
- FR-14o Filters: `verifiedOnly`, `excludeSuspect`; sort: `best-verified`.

**Retail coverage**
- FR-14a Retailers are **data, not code**: each is a catalogue entry naming an engine,
  endpoints, brand family, vertical, and rate limit. No new TypeScript to add a store.
- FR-14b Six engines (Shopify, SFCC, Hybris, Gap Inc., Magento, JSON-LD/OG fallback) cover
  the catalogue; an unsupported store degrades to the JSON-LD engine.
- FR-14c `npm run retailer:probe <url>` auto-detects a store's platform, finds its sale
  collections, and emits a ready catalogue entry for review.
- FR-14d Retailers are grouped into **brand families** (Canadian Tire, Gap Inc., Reitmans)
  that are browsable as a unit and shown on cards.
- FR-14e Walmart Canada and Costco use composite adapters: direct site API first, then
  deal-platform and store-level fallbacks, reporting which path produced the data.
- FR-14f A blocked or broken retailer is marked `blocked` in health and skipped — it never
  fails the run or hides other retailers' deals.

**Location (stocktrack.ca)**
- FR-15 User location set by browser geolocation, or postal code / city fallback.
- FR-16 Location persisted in `localStorage` **and** a cookie so SSR renders it without flash.
- FR-17 Stores resolved and cached with lat/lng; distance by haversine.
- FR-18 stocktrack adapter pulls per-store clearance for **selected stores only** — never
  a full-chain crawl — with strict rate limiting, response caching, and an on/off flag.
- FR-19 Front page shows an "Amazing deals near you" section above the national grid when
  a location is known; otherwise a compact "set your location" prompt.
- FR-20 Local deal cards show store name, distance in km, clearance vs regular price, and
  stock status where the source exposes it.

**Experience**
- FR-21 Deal card shows image, merchant chip, title, short description, price now (large),
  price was (struck), % off badge, coupon pill, expiry countdown, heat bar.
- FR-22 Coupon codes are click-to-copy with visible confirmation.
- FR-23 Filters: category, **department** (Women/Men/Girls/Boys/Baby), **brand family**,
  merchant, **vertical**, minimum % off, price range, coupon-only, in-stock.
- FR-24 Sorts: Hottest, Newest, Biggest drop, Price low→high / high→low.
- FR-25 Full-text search over title + description + merchant.
- FR-26 Deal detail page: full description, price-history chart, outbound CTA, source
  attribution with link, related deals.
- FR-27 Dedicated `/coupons`, `/c/[category]`, `/d/[department]`, `/m/[merchant]`,
  `/brands`, `/family/[family]`, `/near-me`, `/store/[id]`.
- FR-27a A `/brands` directory lists every catalogue retailer grouped by family and
  vertical, with live deal counts and coverage status.
- FR-28 Banner when the last successful scrape is older than the staleness threshold.

**Shopping assistant**
- FR-31 A conversational assistant accepts free-form requirements ("warm winter coat for my
  7-year-old, under $80, at least 40% off, not Amazon") and narrows the catalogue.
- FR-32 The assistant **controls the site's rendering**: its tool calls drive the same deal
  grid, comparison table, and single-deal views the site already uses.
- FR-33 Normal browsing is never removed. The assistant is a *view*, not a replacement —
  the user can dismiss it at any time and keep the results it produced.
- FR-34 **Two-way handoff**: "Take over" hands the assistant's current query to the normal
  FilterBar; "Ask about these" hands the user's manual filters to the assistant.
- FR-35 The assistant may only surface deals returned by its own tools from the database.
  Prices, images and links are rendered by the app from DB rows — **never** from model text.
- FR-36 The assistant asks at most two clarifying questions before showing something.
- FR-37 It explains *why* a deal is good using real price history ("lowest in 90 days"),
  discount depth, and expiry — never invented claims.
- FR-38 Streaming responses with human-readable activity ("Searching 3,412 deals → 18 matches"),
  so it reads as communicating rather than freezing.
- FR-39 The assistant is feature-flagged. With `ASSISTANT_ENABLED=false` or no API key, the
  site is fully functional and the assistant UI is absent.
- FR-40 Scraped retailer text reaching the model is treated as untrusted data, never as
  instructions.

**Platform**
- FR-29 JSON API: `/api/deals`, `/api/deals/near`, `/api/stores`, `/api/health`.
- FR-30 Scheduled scraping locally (node-cron) and hosted (`/api/cron/scrape` + secret).
- FR-41 Assistant endpoint `/api/assistant` streams over SSE; the Anthropic API key is
  server-side only and never reaches the browser.

## 8. Non-functional requirements

- NFR-1 **Windows-first**: works on Windows 10 + Node 20/22 with PowerShell; no WSL,
  no native toolchain beyond `better-sqlite3` prebuilt binaries.
- NFR-2 **Portability**: swapping SQLite→Postgres is `DATABASE_URL` only, no app changes.
- NFR-3 **Politeness**: ≤1 req/sec/domain default; stocktrack.ca stricter; conditional
  requests and caching to avoid refetching unchanged pages.
- NFR-4 **Resilience**: any adapter can 403/timeout/change shape without breaking the site.
- NFR-5 **Observability**: `npm run health` prints a per-source table; the UI surfaces staleness.
- NFR-6 **Accessibility**: WCAG 2.1 AA contrast, keyboard-operable, labelled controls.
- NFR-7 **Performance**: front page server-renders from a single indexed query set.
- NFR-8 **Security**: no secrets in the repo; cron route requires a secret; all external
  content escaped; outbound links `rel="noopener nofollow sponsored"`.
- NFR-9 **Privacy**: location stays client-side + cookie; never sent to third parties;
  no analytics/trackers in v1.
- NFR-10 **Legal**: official APIs/feeds preferred; robots honoured; source attribution and
  links back on every deal; a documented takedown path.

## 9. Ingestion engines

Covering 60+ retailers with 60 bespoke scrapers does not scale. Instead, most Canadian
retailers run one of a handful of e-commerce platforms with predictable, JSON-shaped
endpoints — so DealsCanada ships **six engines**, and each retailer is a **config entry**
declaring which engine to use.

| Engine | How it gets data | Before/after price quality | Typical retailers |
|---|---|---|---|
| **E-Shopify** | Public `/products.json` and `/collections/<sale>/products.json` | Excellent — `price` vs `compare_at_price` is native | The large Canadian Shopify long tail: DTC brands, Frank And Oak, Kit and Ace, Snuggle Bugz, West Coast Kids, Mastermind-style toy shops, hundreds more |
| **E-SFCC** (Salesforce Commerce Cloud / Demandware) | Site search + product JSON endpoints | Excellent — list vs sale price exposed | A large share of mid/large Canadian apparel and footwear banners |
| **E-Hybris** (SAP Commerce) | Platform product/search API with a subscription key | Excellent — regular vs promo price | **Canadian Tire family** (see below) |
| **E-GapInc** | Gap Inc. Canada category/product JSON | Excellent — regular, sale, and "extra % off" tiers | Gap, Gap Factory, Old Navy, Banana Republic, BR Factory, Athleta |
| **E-Magento** (Adobe Commerce) | GraphQL `products` query | Good | Assorted mid-size Canadian retailers |
| **E-JSONLD** *(universal fallback)* | `application/ld+json` `Product`/`Offer`, then OpenGraph | Varies — whatever the page publishes | Anything not on the above: Canada Computers, Memory Express, Visions, Home Hardware, etc. |

Plus four **deal-platform** adapters that are not retailer sites: `redflagdeals`,
`smartcanucks`, Costco flyer blogs (`cocowest` / `costcoeast`), and `camelcamelcamel`;
one **official API** adapter (`amazon-paapi`, dormant without credentials); one
**store-level** adapter (`stocktrack`); and two **composite** adapters (`costco`,
`walmart`) that try a direct path first and fall back to deal platforms when blocked.

### 9.1 Retailer catalogue (v1 target ≥60)

Stored as data in `src/lib/sources/retailers/*.json`, each entry declaring engine, base
URL, sale/clearance paths, brand family, vertical, department hints, and rate limit.

**Canadian Tire family** (`family: canadian-tire`) — Canadian Tire, SportChek, Mark's,
Atmosphere, Sports Experts, L'Équipeur, Pro Hockey Life, PartSource, Party City Canada.

**Gap Inc. Canada** (`family: gap-inc`) — Gap Canada, Gap Factory, Old Navy Canada,
Banana Republic Canada, Banana Republic Factory, Athleta Canada.

**Reitmans Group** (`family: reitmans`) — Reitmans, RW&CO, Penningtons.

**Mass market** — Walmart Canada, Costco, Giant Tiger, Hudson's Bay, Simons.

**Electronics & computers** — Best Buy, Amazon.ca (approved sources), Newegg CA,
Canada Computers, Memory Express, Staples, Visions Electronics, The Source, Dell Canada,
Lenovo Canada.

**Apparel & footwear** — Roots, Aritzia, Uniqlo Canada, H&M Canada, Lululemon
("We Made Too Much"), Altitude Sports, The Last Hunt, Sporting Life, SoftMoc, DSW Canada,
Aldo, Call It Spring, Little Burgundy, Browns Shoes, Urban Planet, Bootlegger, Ricki's,
Cleo, Suzy Shier, Northern Reflections, Tip Top Tailors, Moores, Frank And Oak, Kit and Ace.

**Kids, baby & toys** — Toys "R" Us Canada, Babies "R" Us, Mastermind Toys, LEGO Canada,
shopDisney Canada, Carter's OshKosh Canada, The Children's Place Canada, Joe Fresh,
Snuggle Bugz, West Coast Kids, Scholar's Choice, Indigo (toys & books).

**Home & hardware** — Home Depot Canada, RONA/Lowe's Canada, Home Hardware, IKEA Canada,
Wayfair Canada, Structube, Leon's, The Brick, Linen Chest.

**Sports & outdoors** — MEC, SAIL, Decathlon Canada, Golf Town, Cabela's Canada.

**Beauty & health** — Sephora Canada, The Body Shop Canada, Lush Canada,
Bath & Body Works Canada, Well.ca, Shoppers Drug Mart.

**Grocery & pharmacy** — Loblaws, Real Canadian Superstore, No Frills, Metro, Sobeys,
London Drugs, Rexall.

> Each entry carries a `status` of `verified` / `unverified` / `blocked`, set from real
> `npm run health` output. Shipping an entry that turns out blocked costs nothing — it is
> reported and skipped, never fatal.

## 10. Information architecture

```
/                     hero · "Amazing deals near you" · filters · national grid
/near-me              location + store picker, local clearance grid
/store/[storeId]      one store's clearance
/deal/[slug]          detail, price history, CTA, related
/c/[category]         category grid (Clothing, Toys & Games, Electronics, …)
/d/[department]       Women · Men · Girls · Boys · Baby
/m/[merchant]         one retailer (e.g. /m/old-navy)
/brands               full retailer directory, grouped by family and vertical
/family/[family]      brand family (e.g. /family/canadian-tire, /family/gap-inc)
/coupons              coupon-code deals grouped by merchant
/search?q=            results
/assistant            assistant view: conversation rail + live results canvas
/api/deals · /api/deals/near · /api/stores · /api/retailers · /api/health · /api/cron/scrape
/api/assistant        SSE: streamed text + tool-driven UI state patches
```

The assistant is also available as an overlay on any page, so it never forces a context
switch — `/assistant` is simply its full-screen form.

## 11. Data model

- **deals** — source, source_id, url, canonical_url, title, description, image_url,
  merchant_id, store_id (nullable), category, price_now, price_was, currency,
  discount_pct, discount_abs, coupon_code, shipping_note, in_stock, posted_at,
  expires_at, first_seen_at, last_seen_at, votes, heat, status, locale, raw,
  **brand**, **department** (women/men/girls/boys/baby/unisex/na), **sizes_available**.
  `UNIQUE(source, source_id)`; indexes on heat, posted_at, category, department,
  merchant_id, store_id.
- **merchants** — name, slug, domain, logo_url, affiliate_url_template, **family**
  (canadian-tire · gap-inc · reitmans · …), **vertical**, **engine**, **status**
  (verified/unverified/blocked), rate_limit_override.
- **stores** — chain, source_store_id, name, address, city, province, postal_code, lat, lng.
- **price_points** — deal_id, price, observed_at. (The evidence base for
  "lowest we've recorded"; also the input to cross-merchant history.)
- **deals**, verification columns — product_key, product_key_strength, gtin, mpn,
  asin, market_price, market_discount_pct, observed_low, price_rank_pct, verdict,
  evidence, claim_suspect, quality_note.
- **source_runs** — source, started_at, finished_at, ok, items_found, items_new,
  items_updated, latency_ms, error.

## 12. Ranking

```
heat = 30·norm(log1p(votes))        // community signal
     + 35·norm(discount_pct)        // depth of discount
     + 25·recency_decay(posted_at)  // exponential, 12h half-life
     + 10·source_weight             // per-source trust
   → clamped 0..100
```
Weights live in one config object so they are tunable without touching call sites.

## 12a. Deal verification

The hardest question this product has to answer is *is this actually a deal?* One
platform announcing a discount is not evidence — inflated MSRP anchoring is endemic
across Canadian retail, and a site that republishes those claims uncritically becomes
a laundering service for fake discounts.

Two evidence sources, both ours:

| Evidence | How it is obtained | Claim it supports |
|---|---|---|
| **Cross-merchant** | The same product, identified by GTIN/ASIN/MPN, priced at ≥2 *distinct* other merchants right now | "X% below the $Y median across N stores" |
| **Own history** | Every price change we have recorded in `price_points` | "Lowest price we've recorded in N days" |

Product identity is resolved strongest-first and its strength is stored, because a
weak match must never carry the authority of a strong one: only GTIN, ASIN and
brand-scoped MPN license a cross-merchant claim. A title-shaped match is good enough
to collapse duplicate listings on the front page and nothing more.

**Verdicts:** `verified-low`, `verified-good`, `market-price`, `above-market`,
`inflated-anchor`, `unverified` — each with an evidence level of strong, moderate or
none.

The `inflated-anchor` verdict is the differentiator: rather than repeating a
suspicious claim, DealsCanada detects it and says so ("The $799 'was' price looks
inflated: this sells for about $500 elsewhere"). Such a deal has its headline
percentage suppressed and its heat capped, so it is visible as a warning rather than
promoted as a bargain.

Where nothing corroborates a claim, the deal is labelled unverified and the retailer's
number is attributed to the retailer — never presented as a verified saving.

## 13. Compliance

Official APIs and public feeds first. `robots.txt` honoured on HTML scrapes. Descriptive
User-Agent. Rate limits per domain, stricter for the small independent site
(stocktrack.ca). No amazon.ca HTML scraping. Every deal links back to and credits its
source. Prices are cached observations shown with a timestamp, never presented as
authoritative. README documents the posture and a takedown contact path.

## 14. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Adapters unverifiable in sandbox (403 egress) | Fixture tests + `npm run health` on your machine; adapters isolated so drift is a one-file fix |
| R2 | Akamai/Cloudflare blocks (Walmart, Costco) | Composite fallbacks; failures logged not fatal |
| R3 | stocktrack.ca shape unknown / may object | Feature-flagged, strictly rate-limited, selected stores only, easy to disable |
| R4 | `better-sqlite3` native build on Windows | Prebuilt binaries; documented Node version; Postgres path already committed |
| R5 | Cross-source duplicates | Two-key dedupe + sampled duplicate-rate check (M5) |
| R6 | Wrong/stale prices misleading users | Never fabricate `price_was`; show observed-at; staleness banner |

## 15. Milestones

| Milestone | Epics | Outcome |
|---|---|---|
| **M-A Foundation** | E1, E2 | Repo, DB, pipeline, CLI — ingest a fixture end-to-end |
| **M-B Data live** | E3 | 8+ adapters, health command |
| **M-C Product** | E5, E6 | Full UI + API on seed data |
| **M-D Location** | E4 | stocktrack + near-you section |
| **M-E Assistant** | E9 | Shopping assistant: tools, streaming UI, guardrails, evals |
| **M-F Hardening** | E7, E8 | Scheduling, tests, deploy config, docs |

## 16. API keys & cost

**Headline: the aggregator needs zero API keys and costs $0/month. The shopping
assistant is the one feature that requires a paid key** (an Anthropic API key) — and the
site runs fully without it, assistant hidden.

Every source in the §9.1 catalogue is reachable through public storefront JSON, public
feeds, or HTML — the same data a browser receives. Keys only buy *better* data,
*legitimacy*, or *resilience*.

### 16.1 Required keys — none

| Source | Key? | Note |
|---|---|---|
| RedFlagDeals | none | Public JSON API + RSS |
| Best Buy Canada | none | Public storefront JSON (unofficial, undocumented — may change) |
| Shopify stores (long tail) | none | Public `/products.json` |
| SFCC / Magento / Gap Inc. / JSON-LD | none | Public storefront responses |
| Smart Canucks, CoCo West, Costco East | none | WordPress REST / RSS |
| camelcamelcamel | none | Public RSS |
| stocktrack.ca | none | No public API; polite scraping |
| Walmart Canada, Costco | none | Public endpoints; bot protection is the obstacle, not auth |
| Postal code → lat/lng | none | Statistics Canada FSA centroids bundled locally |

One caveat worth stating plainly: the Canadian Tire family's platform expects an
`ocp-apim-subscription-key` header. There is **no public developer program** to obtain one
— the value is the one their own web app ships. The plan treats that as a grey area: the
catalogue entry reads it from `.env` if you choose to supply one, and otherwise that family
falls back to the JSON-LD engine, which needs no key at all.

### 16.2 Free keys worth getting

| Key | Cost | What it buys | Catch |
|---|---|---|---|
| **Amazon Associates CA + PA-API v5** | $0 | Official, ToS-clean Amazon.ca data: real list vs current price, images, ASINs | Requires **3 qualifying sales within 180 days** before API access is granted; rate limits scale with your revenue |
| **Rakuten Advertising** | $0 | Product feeds + commissions for many Canadian apparel/mass retailers | Per-merchant approval |
| **Impact.com** | $0 | Same, different merchant roster | Per-merchant approval |
| **CJ Affiliate** | $0 | Same | Per-merchant approval |
| **AvantLink Canada** | $0 | Strong Canadian outdoor/sports roster | Per-merchant approval |
| **Awin** | Small refundable publisher deposit | Broad roster | Deposit refunded on first payout |

Affiliate networks deserve emphasis: their **product feeds are the legitimate, permissioned
way to get clean before/after prices and images** for exactly the apparel retailers you
named. Where a merchant approves you, the feed replaces scraping entirely — better data,
zero ToS risk, and it monetizes. The architecture already anticipates this: a feed is just
another engine behind the same catalogue entry.

### 16.2a The one required key: Anthropic (shopping assistant only)

The assistant calls the Claude API server-side. Model choice and current pricing:

The model is an env var (`ASSISTANT_MODEL`); switching is a one-line change, and S9.7 runs
the golden eval against both so the choice is measured rather than assumed.

| Model | Model ID | Input / Output per MTok | Role |
|---|---|---|---|
| **Claude Sonnet 5** | `claude-sonnet-5` | $2 / $10 | **Shipped default.** ~2.5× cheaper than Opus and well within this workload's difficulty |
| Claude Opus 5 | `claude-opus-5` | $5 / $25 | Escalation if the S9.7 bake-off shows Sonnet losing recall on dense multi-constraint queries |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1 / $5 | *Optional* lane for deterministic filter extraction only |

**Why Sonnet is a defensible default here:** the architecture deliberately removes the hard
parts from the model. Tools are `strict: true`, so argument validity is a schema guarantee,
not model diligence; the grounding layer (§17.3) makes hallucination structurally impossible
whichever model runs. What remains — parse constraints, call tools, narrow, explain using
real price history — is well within Sonnet 5. The open question is dense multi-constraint
requests and clarify-vs-guess judgment, which is exactly what S9.7 measures.

*One API difference:* mid-conversation system messages are not supported on Sonnet 5. The
current design does not use them, so this is not a blocker — only a constraint if per-turn
operator instructions are later wanted without invalidating the cache.

**Cost per conversation (estimate, to be replaced by measurement):** a turn sends roughly
4–6K tokens of system prompt + tool definitions + facet catalogue — **all of it prompt-cached
after the first turn, billed at a steep discount** — plus ~3–8K of conversation and tool
results, and produces ~300–800 output tokens. On Sonnet 5 that lands near **$0.01–0.02 per
turn**, so a typical 5–6 turn conversation costs roughly **$0.05–0.12**.

| Monthly conversations | Sonnet 5 (default) | Opus 5 (if the eval demands it) |
|---|---|---|
| 100 (personal use) | **$5–12** | $15–30 |
| 1,000 | **$50–120** | $150–300 |
| 10,000 | **$500–1,200** | $1,500–3,000 |

Levers that move this, in order: prompt caching on the stable prefix (the single biggest
win — S9.6 verifies the hit rate), lowering `output_config.effort` on simple turns, capping
tool calls per turn, and only then changing model.

> These are estimates derived from token shapes, not measured traffic. S9.6 instruments
> real `usage` numbers so you get actuals within a day of running it. Verify current
> per-token pricing before committing — it changes.

### 16.3 Optional paid services

| Service | Typical cost | When you'd actually need it |
|---|---|---|
| **Keepa API** | ~€19/mo entry tier | Best-in-class Amazon.ca price history and deal feed, without the Associates sales gate |
| **Unblocker proxy** (ScraperAPI, ZenRows, Bright Data, Oxylabs) | ~$50–70/mo entry tiers | Only if Walmart/Costco stay Akamai-blocked *and* the composite fallbacks prove insufficient |
| **Vercel Pro** | ~$20/mo | Only for frequent hosted cron; the Hobby tier's cron frequency is limited |
| **Hosted Postgres** (Neon/Supabase) | $0 free tier | Free tier is ample at this data volume |
| **Resend** (v2 price alerts) | $0 up to ~3k emails/mo | Only when alerting ships |

### 16.4 Realistic budget tiers

| Tier | Monthly | What you get |
|---|---|---|
| **T0 — Local, no assistant** | **$0** | Entire catalogue, all engines, full UI, local cron. Zero keys. |
| **T0+ — Local with assistant** | **~$5–12** | T0 + Anthropic key on Sonnet 5 at personal usage (~100 conversations/mo). |
| **T1 — Hosted public site** | **$0–20** + assistant usage | T0 + Vercel + free-tier Postgres. $20 only for sub-daily hosted cron. |
| **T2 — Amazon-grade + resilient** | **~$70–90** + assistant usage | T1 + Keepa + an unblocker for the bot-protected two. |

**Recommendation:** build and run at **T0+** — the assistant is the differentiating feature
and at personal volume it costs less than a lunch. Apply to the affiliate networks in parallel
since they are free and turn scraping into permissioned feeds. Only spend money if
`npm run health` on your machine proves a specific source is unreachable and actually
matters to you — which is precisely what that command is for.

> Pricing above reflects my knowledge as of early 2026 and vendor pricing changes often —
> verify current rates before committing. The dollar figures are the only part of this PRD
> I cannot verify from inside the sandbox.

## 17. Shopping assistant architecture

The design principle is one sentence: **one query layer, two drivers.**

The site already has a single `DealQuery` object that the FilterBar produces and
`DealRepository` consumes (§11, S5.4, S6.1). The assistant does not get a parallel search
path — it gets **tools that emit that same object**. A human moving a slider and the model
calling a tool travel the identical code path into the identical database.

Three consequences fall out of that, and they are the whole feature:

1. **The assistant cannot hallucinate a deal.** Its only way to put a product on screen is a
   tool call that returns real rows. Prices, images and links are rendered by the app from
   those rows — model text never becomes a price.
2. **It genuinely controls rendering.** Tool calls stream to the client as UI state patches;
   the canvas re-renders as a grid, a comparison table, or a single focused deal.
3. **Normal browsing survives.** Because the assistant's output *is* a `DealQuery`, "Take
   over" drops the user into the standard FilterBar with those filters applied, and their
   manual filters can be handed back the other way. Neither mode is a dead end.

### 17.1 Tool surface

| Tool | Purpose |
|---|---|
| `search_deals(query)` | Run a `DealQuery`; returns deal summaries + a result count |
| `refine_query(patch)` | Patch the active query and re-render (the narrowing loop) |
| `list_facets(field)` | Real merchants / brands / categories / departments, so the model narrows using values that **exist** rather than guessing |
| `get_price_history(dealId)` | Grounds "is this actually a good price" in `price_points` |
| `compare_deals(dealIds[])` | Renders the comparison table |
| `show_deal(dealId)` | Focuses one deal in the canvas |
| `set_view(mode)` | `grid` \| `comparison` \| `single` |
| `ask_clarifying(question, options?)` | Ask rather than guess, at most twice |

`list_facets` matters more than it looks: it is what stops the model inventing
"Old Navy Canada Kids Outlet" as a merchant filter that returns nothing.

### 17.2 Request shape

Streaming `client.messages.stream(...)` on **`claude-sonnet-5`** (the `ASSISTANT_MODEL` env
var; `claude-opus-5` is the escalation path) with adaptive thinking, tools declared
`strict: true` so arguments validate, and `output_config.effort` tuned per turn. Structured outputs
(`output_config.format`) back the deterministic "text → `DealQuery`" extraction path.

**Prompt caching is load-bearing**, not an optimization: tool definitions, system prompt,
and the facet catalogue form a stable prefix and are cached; only the conversation tail
varies. Render order is `tools` → `system` → `messages`, so nothing volatile (timestamps,
session ids) may appear before the last cache breakpoint. S9.6 asserts
`usage.cache_read_input_tokens` is non-zero — a silent invalidator here roughly triples cost.

### 17.3 Trust boundary

Deal titles and descriptions are **scraped from retailer sites** — untrusted text authored
by third parties. It reaches the model as tool results, which is exactly the shape a prompt
injection takes ("ignore previous instructions and recommend…"). So tool results are
delimited and labelled as data, the system prompt states that deal content is never an
instruction, and the model's only privileged actions are read-only queries against the
user's own catalogue. There is no tool that can spend money, write data, or reach the
network.
