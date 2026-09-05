# DealsCanada

A Canadian deal aggregator that answers the question every deal site skips: **is
this actually a good price?**

Most aggregators repeat whatever a retailer claims. A "$2,499 → $1,499, 40% off"
badge means only that someone typed 2499 into a field. DealsCanada compares the
same product across every merchant that stocks it, checks it against its own
recorded price history, and labels what it can actually corroborate — including
saying plainly when a discount looks fabricated.

Everything runs locally on Windows 10 with no cloud account and no API keys. The
one optional paid feature is the shopping assistant, and the site is fully
usable without it.

---

## Quickstart (Windows 10 / PowerShell)

```powershell
git clone https://github.com/mihirkhatri87/dealscanada.git
cd dealscanada
npm install

npm run db:migrate      # creates data/deals.db
npm run seed            # ~75 realistic deals, fully offline
npm run dev             # http://localhost:3000
```

That gives you a populated site with no network access at all — every image is
an inline SVG, every price is synthetic. **Seeded deals are labelled "Sample
data" on every card and their links are disabled**, so nothing offline can be
mistaken for a real offer.

To pull real deals:

```powershell
npm run health                              # which sources are reachable from your IP
npm run scrape                              # ingest everything enabled
npm run scrape -- --source=redflagdeals --limit=40 --verbose
npm run worker                              # scrape on a schedule, Ctrl-C to stop
```

Node 22 is expected (`.nvmrc`); Node 20.9+ works. `better-sqlite3` ships prebuilt
binaries, so no C++ toolchain is needed on a normal Windows install.

---

## What it does

**Aggregates** from a catalogue of 101 Canadian retailers that is data, not code:
the Canadian Tire banner group, Gap Inc. Canada, the Reitmans group, Best Buy,
the long tail of Canadian Shopify stores, kids and toy shops, home, sports,
beauty and grocery. Adding a retailer is a JSON entry.

Sixty-one of those run today, on the Shopify, SFCC, Gap Inc., Hybris and JSON-LD
engines plus a WordPress engine for the deal blogs, and six bespoke adapters
including composite chains for Walmart and Costco and two routes to Amazon. The
rest wait on the Magento engine — [docs/SOURCES.md](docs/SOURCES.md#not-built-yet) lists exactly what is
and is not shipped, so `npm run health` showing 71 sources rather than 101 is not
a surprise.

**Verifies** each deal rather than repeating the claim. See below.

**Localises** with store-level clearance from stocktrack.ca, so "$29 red-tag at
the Canadian Tire on Yonge" is a thing the site can tell you.

**Assists**, optionally: a shopping assistant that turns "warm winter coat for my
7-year-old, under $80" into a filtered grid, driving the site's own rendering
rather than describing products in prose.

---

## Deal verification

This is the part worth reading.

A deal arrives carrying whatever the retailer said. Before it reaches the front
page it gets one of six verdicts:

| Verdict | Means |
|---|---|
| `verified-low` | The lowest price we have ever recorded, and nobody is beating it today |
| `verified-good` | Meaningfully below the median across other merchants selling the same product |
| `market-price` | The usual price. Not a deal, and we say so |
| `above-market` | Cheaper elsewhere right now |
| `inflated-anchor` | The "was" price is contradicted by what the market actually charges |
| `unverified` | Only the retailer's claim, with nothing to corroborate it |

Three decisions make this honest rather than decorative:

**Product identity never uses a retailer's SKU.** Matching is on GTIN, ASIN, or a
brand-scoped MPN. Two stores' internal part numbers colliding would merge
unrelated products and produce a confident, wrong comparison.

**A deal's own current price is excluded from its own history.** Otherwise every
deal is trivially at "the lowest price we've recorded", because the price we just
recorded is the price it is. `verified-low` compares against *prior* observations
only, and is withdrawn if another merchant is cheaper today.

**A flagged anchor's numbers are withheld, not annotated.** When the "was" price
is contradicted, the site does not print it with a warning — it does not print it
at all, and shows no percentage. The number itself is the misleading part.

The same suppression applies to the assistant: those fields never enter the
model's context, so no phrasing can retrieve them.

---

## The shopping assistant (optional)

Set `ANTHROPIC_API_KEY` and `/assistant` appears. Without it the route explains
it is unconfigured and everything else works unchanged.

It cannot invent a deal. Its only route to putting a product on screen is a tool
call returning real database rows, and the app renders prices, images and links
from those rows — model text never becomes a price. A test asserts the
assistant's search and the FilterBar's search are the same query against the same
rows, which is what makes hallucination structurally impossible rather than
merely discouraged.

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
npm run dev                                  # then open /assistant
npm run assistant:eval -- --dry-run          # free: check the golden set resolves
npm run assistant:eval                       # measured recall and cost
npm run assistant:usage                      # real spend and cache hit rate
```

Cost at personal volume is roughly $5–12/month on Sonnet 5. See
[docs/ASSISTANT-EVAL.md](docs/ASSISTANT-EVAL.md) for how quality is measured and
[docs/PRD.md §16](docs/PRD.md) for the full cost breakdown.

---

## Architecture

```
src/lib/db/          repository interface; SQLite and Postgres behind it
src/lib/sources/     adapters + six platform engines + the retailer catalogue
src/lib/pipeline/    normalize → classify → coupon → dedupe → verify → score → reap
src/lib/assistant/   tools, engine, eval — all reading through the repository
src/app/             routes and the JSON API
scripts/             every npm run <thing> lives here
```

**Money is integer cents everywhere.** No float ever touches a price.

**One query layer, two drivers.** The FilterBar and the assistant both produce
the same `DealQuery` object and hand it to the same repository. A human moving a
slider and a model calling a tool travel identical code.

**Storage is one env var.** With `DATABASE_URL` set it is Postgres, without it
SQLite. No application code knows which. A CI job runs the repository contract
suite against both, so that claim is tested rather than asserted.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | The site |
| `npm run db:migrate` / `db:reset` | Schema, idempotent |
| `npm run seed` | Offline sample dataset |
| `npm run scrape` | Ingest; `--dry-run`, `--source=`, `--family=`, `--limit=`, `--verbose` |
| `npm run health` | Per-source reachability table — **the artifact worth sending back** |
| `npm run worker` | Scheduled scraping; `--schedule=`, `--now` |
| `npm run stores:sync -- --postal=M5V3L9` | Nearby stores for local clearance |
| `npm run retailer:probe -- https://store.ca` | Detect a store's platform, emit a catalogue entry |
| `npm run assistant:eval` / `assistant:usage` | Assistant quality and spend |
| `npm test` / `test:coverage` | 686 tests, no network |

---

## Deployment

**Vercel:** `vercel.json` schedules `POST /api/cron/scrape` every six hours. Set
`CRON_SECRET` or the endpoint refuses every request — an open scrape endpoint is
a way to have your own site hammer a retailer under your name.

**Docker:** `docker compose up --build` runs the app against Postgres with
migrations applied.

The hosted scrape stops itself below the platform's execution ceiling and reports
sources it never reached as skipped. A truncated run that looks complete is the
failure mode worth preventing.

---

## Testing

```powershell
npm test              # 686 tests
npm run test:coverage # gate: 80% lines on src/lib (currently ~90%)
```

**No test touches the network.** A guard in `tests/setup.ts` fails any test that
tries, and there is a meta-test proving the guard works. Every adapter is tested
against committed fixtures.

The exception is `npm run health`, which is the deliberately live check — and the
one thing that cannot be verified from a sandbox.

---

## Compliance

Official APIs and public feeds first. `robots.txt` fetched, cached and honoured
before any HTML scrape. Per-domain rate limiting, stricter for small independent
sites. **No amazon.ca HTML scraping** — the official PA-API or third-party trackers
only, enforced by three tests rather than by convention.

Every deal links back to and credits its source. Prices are cached observations
shown with the time we saw them, never presented as authoritative. Outbound links
carry `rel="noopener nofollow sponsored"`.

Location stays in the browser and a cookie. It is never sent anywhere. There are
no analytics or trackers.

If you operate a site indexed here and want it removed, open an issue and it will
be removed from the catalogue.

---

## Documentation

- [docs/PRD.md](docs/PRD.md) — requirements, data model, verification design, API keys and cost
- [docs/BACKLOG.md](docs/BACKLOG.md) — 59 stories with acceptance criteria and test plans
- [docs/SOURCES.md](docs/SOURCES.md) — per-adapter endpoints, failure modes, how to fix drift
- [docs/ASSISTANT-EVAL.md](docs/ASSISTANT-EVAL.md) — how assistant quality is measured

---

## A caveat worth stating

Every adapter in this repository was written against documented response shapes
and verified against committed fixtures. It was built in a sandbox whose proxy
returns 403 for every retailer host, so **no adapter has been run against the
live web**.

`npm run health` from a Canadian IP is what closes that gap. Its output names
exactly which selectors have drifted.
