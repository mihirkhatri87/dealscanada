# Sources: endpoints, failure modes, and how to fix drift

Every adapter here was written against documented response shapes and verified
against committed fixtures. **None has been run against the live web** — the
sandbox this was built in returns 403 for every retailer host. `npm run health`
from a Canadian IP is what closes that gap, and this document is what you use to
act on its output.

Read it as: *when health says X is red, here is what changed and where to fix it.*

---

## How to read `npm run health`

```
source              enabled  http  items  latency  error
redflagdeals        yes      200   38     840ms
bestbuy             yes      403   0      210ms    blocked
shopify:roots       yes      200   61     1.2s
jsonld:staples      yes      200   0      2.1s     no JSON-LD Product found
amazon-paapi        no       -     -      -        credentials not configured
```

Four outcomes, three of which are not bugs:

| Signal | Meaning | Action |
|---|---|---|
| `200` with items | Working | None |
| `no` / `skipped` | Deliberately off — a flag or a missing credential | None. A half-configured integration is not a broken one |
| `403` / `429` | Bot protection or rate limiting | See **Blocked** below. Often nothing to fix in code |
| `200` with 0 items | **The one that means drift.** The endpoint answered and we did not understand it | Fix the selector or the shape. Start here |

A `200` with zero items is the interesting failure: the site is up, we are
allowed in, and our parser is wrong. Everything else is either fine or is
someone else's decision.

---

## Adapters

### `redflagdeals` — the Canadian firehose

**Endpoint:** `forums.redflagdeals.com/api/topics?forum_id=9&per_page=40&page=N`
**Fixture:** `tests/fixtures/redflagdeals/topics.json`

Returns forum topics, only some of which are deals. The adapter requires an
`offer` object on the item — that field is what separates a posted deal from a
discussion thread, and dropping the requirement floods the site with forum chatter.

**Drift looks like:** items parsed drops to near zero while HTTP stays 200 → the
`offer` shape changed. Compare a live topic against the fixture; the mapping is
about fifteen lines.

**Fallback:** RSS, when the JSON shape fails entirely.

---

### `bestbuy` — the best structured before/after prices

**Endpoints:** product search, then a batched offers endpoint by SKU.
**Fixture:** `tests/fixtures/bestbuy/search.json`, `offers.json`

Two calls because the search response carries the product and the offers response
carries `regularPrice` vs `salePrice`. Items with no offer are dropped rather than
emitted at full price.

**Drift looks like:** 403 (bot protection — see below), or products with prices
but no `priceWas`, meaning the offers call is returning a changed shape.

---

### Shopify engine — 24 retailers, one implementation

**Endpoint:** `/products.json` and `/collections/<handle>/products.json?limit=250`
**Fixture:** `tests/fixtures/shopify/products.json`

The highest coverage-per-effort adapter in the project. `compare_at_price` vs
`price` is a native Shopify field, so before/after prices are exact rather than
inferred — no other engine gets prices this clean.

Sale collections are auto-discovered by trying `sale`, `clearance`, `on-sale`,
`outlet`, `markdowns`.

**Drift looks like:** a 404 on `/products.json` → the store disabled the endpoint.
That is a `blocked` status, not a failure; mark it in the catalogue and move on.
Adding a Shopify store is one JSON entry with a base URL.

---

### JSON-LD engine — the universal fallback

**How it works:** fetch a listing page, extract product links with a per-retailer
CSS selector, then parse `application/ld+json` `Product`/`Offer` from each product
page. Falls back to OpenGraph tags when JSON-LD is absent.

**This is where drift concentrates**, because the CSS selector is the fragile part
and every retailer has their own.

**Drift looks like:** 200 with 0 items. Almost always the listing selector. Open
the listing page, find what wraps a product link now, and change the `selector`
field in that retailer's catalogue entry. **No TypeScript involved.**

**Second most common:** links extracted fine, but every product page yields
nothing → the retailer moved from JSON-LD to a client-rendered shape. The OG
fallback usually still works; if not, that retailer needs a different engine.

---

### SFCC engine — 6 retailers, no client id required

**Endpoint:** `/on/demandware.store/Sites-<siteId>-Site/<locale>/Search-UpdateGrid?cgid=<category>&start=&sz=`
**Fixture:** `tests/fixtures/sfcc/search-grid.html`

SFCC's OCAPI and SCAPI interfaces both need a client id issued by the merchant,
and there is no public developer programme to obtain one. So this engine reads
the storefront's own search-grid endpoint — the same request the site makes of
itself when a shopper paginates a category.

SFRA's default tile markup is what makes this an engine rather than six scrapers:
list and sale price are separate elements carrying a `content` attribute with the
raw decimal, so prices survive currency symbols and French-Canadian formatting
without a parser guessing. Rendered text is the fallback for older storefronts.

The **site id is discovered, not configured** — every SFCC page names
`Sites-<id>-Site` somewhere. `sfccSiteId` in the catalogue pins it when discovery
is unreliable, and `sfccLocale` selects `fr_CA`.

**Drift looks like:** "could not resolve the SFCC site id" → the storefront is
blocking the homepage fetch, or is no longer SFCC. A 200 with 0 items → the
storefront customised its tile markup; check whether `.sales .value` and
`.strike-through .value` still exist and add the new selectors to the arrays at
the top of the file.

---

### Gap Inc. engine — 6 brands, the best department data in the catalogue

**Endpoint:** `/resources/productSearch/v1/search?cid=<categoryId>&globalShippingCountryCode=ca&globalShippingCurrencyCode=CAD&locale=en_CA`
**Fixture:** `tests/fixtures/gapinc/category.json`

Gap, Gap Factory, Old Navy, Banana Republic, BR Factory and Athleta run one
platform, so this is one engine and six catalogue entries.

The shipping country and currency parameters are load-bearing: without them the
platform answers with US pricing, which would put USD numbers on the page
labelled CAD.

Department is the reason this engine exists. Gap Inc. file their catalogue under
their own Girls / Boys / Baby / Women / Men navigation, so `salePathDepartments`
maps a category id to a department and the answer comes from the brand rather
than from guessing at a product title.

Two pricing traps are handled explicitly, and both would otherwise invent a
saving:

- **Range prices.** "$20.00 - $60.00 regular" against "$25.00 - $45.00 sale" is
  not a discount — the cheapest variant went *up*. Comparing a range floor to a
  single price is refused; only like-for-like counts.
- **Stacked promotions.** "Extra 50% off" is described, never multiplied into the
  price. The exclusions that decide whether it applies are not in the payload, so
  computing a final price would print a number no page shows. The listed price
  stands, and the note says whether a code is needed.

**Configuration:** category ids go in `salePaths`. A brand without them reports
"no category ids configured" and is *skipped*, not failed — a half-configured
entry is not a broken one, and the message names exactly what to add. Four of the
six are in that state, awaiting ids from a live browse.

**Drift looks like:** 403 → bot protection. A 200 with 0 items → the response
wrapper moved; the engine walks to `ccList` rather than pinning the full path
precisely so a wrapper change does not cost the retailer, so this would mean the
item shape itself changed.

---

### Canadian Tire family engine — 8 banners, and the one key you cannot get

**Endpoint:** `https://apim.canadiantire.ca/v1/search/v2/search?store=&baseStoreId=&categoryCode=`
**Fixture:** `tests/fixtures/hybris/search.json`

Canadian Tire, SportChek, Mark's, Atmosphere, Sports Experts, L'Équipeur, Pro
Hockey Life and PartSource run one Hybris platform, and their sales run across
banners — which is what makes `/family/canadian-tire` worth having.

**The key.** The platform expects an `ocp-apim-subscription-key` header and there
is no public developer programme that issues one; the value is whatever their own
web app ships. Supply one in `CANADIAN_TIRE_API_KEY` and these banners use the
API. Without one they run on the **JSON-LD engine instead** — automatically, at
registration time — so all eight work for the overwhelming majority of installs
that will never have a key. That is why their catalogue entries carry both
`salePaths` (platform category codes) and `jsonLdListingPaths` (real URLs): which
one is read depends on which engine ends up running.

**Pricing is the reason this needed its own engine.** Three of their four common
price shapes produce a wrong headline if mapped naively:

- **Multi-buy.** "2 for $30" is not a $15 item. Dividing through prints a price
  nobody buying one actually pays, and that is most people. The single-unit price
  stands and the offer is described.
- **Member pricing.** A Triangle-member price is real but conditional. As the
  headline it advertises a saving a non-member walking in cannot get, so it is
  labelled, and an item whose *only* discount is member-gated does not enter the
  feed at all.
- **No markdown.** A current price equal to the regular one is the platform
  saying "no sale", not a zero-percent discount.

Their product codes are also **never emitted as an mpn**. The codes are
banner-scoped, and passing one off as a manufacturer part number would let the
verification engine match it against an unrelated retailer's part number and
compare two different products.

**Drift looks like:** 401/403 on the API → the key is missing, wrong, or rotated;
the banner should fall back rather than fail. A 200 with 0 items on the JSON-LD
path → the sale listing URL moved; fix `jsonLdListingPaths` and
`productLinkSelector` in the entry.

---

### `stocktrack` — in-store clearance

**Config-driven** endpoint map, deliberately: this is a small independent site and
its shape is the least certain thing in the project.

Constraints that are not negotiable: **selected stores only**, never a full-chain
crawl; a dedicated low rate limit well below the global one; response caching with
a 240-minute TTL; and `STOCKTRACK_ENABLED=false` stops every request.

**Drift looks like:** anything. Expect one selector-fix commit driven by your first
real `health` run. The selectors live in the adapter's config object at the top of
the file for exactly that reason.

If the site's operator objects, set the flag to false. That is the whole
mitigation, and it is one env var.

---

### Composite adapters — `walmart`, `costco`

**Fixtures:** exercised in `tests/sources/composite.test.ts`

Walmart Canada and Costco both sit behind bot protection, so neither is one
adapter — each is a chain of paths tried in order, and every deal records which
path produced it.

| Retailer | Chain |
|---|---|
| `walmart` | its own clearance API → RedFlagDeals threads → in-store clearance |
| `costco` | costco.ca search → CoCo West / Costco East → RedFlagDeals → in-store |

Three decisions are worth knowing when reading health output:

**Every path runs; the chain does not stop at the first success.** Stopping early
would let the retailer's own feed hide in-store clearance only the store-level
source knows about. Chain order is a quality ranking, so when two paths surface
the same product the earlier one wins — the retailer's own price beats a poster's
report of it.

**A total block is an outcome, not a failure.** Zero deals with a reason naming
every path that was tried, and a green run. The distinction that matters is
"Costco has no deals" versus "we could not look", and the reason string is what
carries it.

**Costco's blogs are not a fallback.** A large share of what people want from
Costco is warehouse-only pricing that never appears online at all, so CoCo West
and Costco East are the *only* route to those numbers. Deals from that path carry
a note saying the price is regional and weekly — a wrong price at the till is
worse than no price.

The in-store path reads clearance the `stocktrack` adapter already collected this
run rather than fetching it again, so adding a composite retailer costs no extra
traffic to a small independent site. That is what the adapter `priority` field is
for: stocktrack runs first, and the pool is cleared at the start of every run so
yesterday's clearance can never be presented as today's.

**Drift looks like:** every path 403 → expected on a blocked IP, and the reason
lists each. `walmart-api` returning 200 with 0 items → their offer payload moved;
the parser walks to the product array rather than pinning a path, so this means
the item shape changed.

---

## Not built yet

These are designed and specified in the PRD but **not in the repository**. Listed
here so `npm run health` showing 66 sources rather than 101 is not a mystery.

| Planned | Story | Why it is not here yet |
|---|---|---|
| Magento engine | S3.12 | Same |
| `amazon-paapi` | S3.6 | Dormant by design — needs Associates credentials that require three qualifying sales first |
| Amazon alternatives (camelcamelcamel) | S3.5 | Next in the queue |

The Canadian Tire, Gap Inc. and Reitmans retailers **are** in the catalogue and
run today on the JSON-LD or Shopify engine. When the family engines land, those
entries change one field.

Two constraints already hold for Amazon, before any adapter exists: no request is
ever made to an amazon.ca product path, and the PA-API adapter will report
"skipped — credentials not configured" rather than failing a run. Scraping
amazon.ca HTML violates their terms, and that will be enforced by a test rather
than left to discipline.

---

## Blocked, and why it usually is not a bug

A `403` from a large retailer is bot protection working as designed, and the
sandbox this was built in gets one from nearly every host. Options, in the order
worth trying:

1. **Accept it.** A blocked retailer is reported and skipped; it never fails the
   run or hides the other forty-eight sources. Check what *did* come back first.
2. **Slow down.** `RATE_LIMIT_RPS` is already conservative; lower it for that
   domain specifically via the catalogue entry.
3. **Apply to an affiliate network.** Rakuten, Impact, CJ and AvantLink are free
   and their product feeds are the *permissioned* version of what scraping
   approximates — better data, no ToS risk, and it monetizes. This is the right
   answer for apparel retailers in particular.
4. **An unblocker proxy**, last and only if a specific blocked source actually
   matters to you. ~$50–70/month, and it does not make the scraping any more
   welcome.

What not to do: rotate user agents to disguise the crawler, or ignore
`robots.txt`. The project identifies itself honestly and honours robots on every
HTML fetch. That is a design commitment, not an oversight to route around.

---

## Adding a retailer

```powershell
npm run retailer:probe -- https://somestore.ca
```

Detects the platform (Shopify via `/products.json`, SFCC via
`/on/demandware.store/`, Magento via a GraphQL probe, Hybris and Gap Inc. via
known markers), finds sale collections, and prints a catalogue entry. Detection
covers all six platforms even though only two engines are implemented — a
detected SFCC store gets a valid entry that runs on the JSON-LD engine until its
own engine lands. `--write`
appends it; `--all` re-probes everything and refreshes each `status`.

If the platform is unrecognised it says so and suggests the JSON-LD engine, which
needs a listing URL and a CSS selector.

**Adding a retailer touches one JSON file.** If you find yourself writing
TypeScript to onboard a store, the engine is missing a capability — add it there,
not in a per-retailer special case.

---

## The rate limiter and robots

Both live in `src/lib/util/http.ts` and apply to every adapter without opt-in:

- Per-domain token bucket, default 1 req/sec, overridable per retailer
- `robots.txt` fetched, parsed, cached, and checked before any HTML scrape — a
  disallowed URL throws `RobotsDisallowedError` and is never fetched
- Retries with exponential backoff on 429 and 5xx only; a 404 is an answer, not a
  thing to retry
- `Retry-After` honoured when present
- ETag / `If-Modified-Since` conditional requests, with an on-disk cache

A test asserts no HTTP request is issued for a robots-disallowed URL. That one is
worth keeping green.
