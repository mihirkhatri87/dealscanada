# Affiliate programs

The permitted route into the retailers that refuse a scraper. Eight sources in
`npm run health` report `BLOCKED` — bot protection at the edge — and no amount
of adapter work will change that. Their operators publish the same data to
affiliate networks and hand it over on request.

**This is worth more than access.** An affiliate feed follows the Google product
feed specification, which carries `gtin` and `mpn`. Those are the manufacturer
identifiers `assessDealQuality` requires before it will make any cross-merchant
claim at all — without one, a deal can only ever be `unverified`. So approving
one feed improves the verdicts on products *other* retailers sell too. Coverage
and correctness are the same problem here.

The engine is built and waiting: `src/lib/sources/engines/feed.ts`. Nothing is
needed but a URL.

---

## What only you can do

Applications need a legal entity name, a tax identifier (SIN or business
number), a payee agreement accepted under your name, and verified ownership of
the site you are promoting from. Those are yours to sign — nobody can do it on
your behalf, and a program terminates accounts for misrepresentation on the
application.

Most networks also want the site live at a public URL before they will approve
it. DealsCanada runs locally today, so **deploy first** — `vercel.json` is
already configured — and apply with that URL.

---

## Who to apply to

Confirmed from the retailer's own page:

| Retailer | Network | Source |
|---|---|---|
| MEC | **AvantLink** | [mec.ca affiliate page](https://www.mec.ca/en/explore/mec-affiliate-program) names AvantLink and links [program 18557](https://www.avantlink.com/programs/18557/mountain-equipment-coop-affiliate-program/) |
| Well.ca | **Rakuten Advertising** | well.ca/affiliates |
| Joe Fresh | **CJ Affiliate** | joefresh.com/affiliates |
| Best Buy Canada | own program page | [bestbuy.ca affiliate program](https://www.bestbuy.ca/en-ca/about/affiliate-program/blt82df225e80ec75e9) — apply from there; note commission is ~0.5% and new-customer only, so join for the **feed**, not the revenue |

Reported by directories rather than the retailer, so confirm on application:

| Retailer | Reported network |
|---|---|
| Staples Canada | CJ Affiliate (US program) / FlexOffers / Gen3 as agency |
| Golf Town, Sporting Life | Sporting Life Group (one owner since 2018) — present on Rakuten Canada |
| Memory Express, Children's Place, Little Burgundy | not yet researched |

Applying to **AvantLink, Rakuten Advertising and CJ Affiliate** covers most of
the list. Each is one application to the network, then one per merchant.

---

## Wiring a feed in once approved

The network gives you a product feed URL containing your publisher token.

1. Add it to `AFFILIATE_FEEDS` in `.env`, keyed by the retailer's catalogue id:

   ```
   AFFILIATE_FEEDS={"mec":"https://feeds.avantlink.com/…?token=…"}
   ```

2. Set that retailer's catalogue entry to `engine: 'feed'` and `enabled: true`.
3. `npm run health -- --source=feed:mec`.

Until a URL exists the adapter reports itself skipped and names the key to add,
so a half-finished setup is visible rather than silent.

**The feed URL is a credential.** It goes in `.env`, never in the catalogue and
never in a commit.

---

## What we will not do

We do not work around bot protection — no rotating fingerprints, no residential
proxies, no CAPTCHA solving. Beyond the ethics, it trades a defensible position
for a fragile one: "robots.txt honoured, official feeds first" is the reason a
retailer will talk to us at all, and a publisher caught evading protection is
not one that gets approved afterwards.

The honest cost is recorded rather than hidden. A retailer we cannot read stays
in the catalogue as `blocked` with the reason attached, and its absence makes
verdicts on the products it sells more cautious — never more confident.
