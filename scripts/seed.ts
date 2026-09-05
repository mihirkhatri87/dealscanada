#!/usr/bin/env tsx
/**
 * Seeds a realistic offline dataset.
 *
 * The point is that the entire UI - front page, filters, deal detail with price
 * history, coupons, near-me, brand families, and every deal-verification verdict
 * - is reviewable with no network access at all. Screenshots and design work
 * should never be blocked on a scraper reaching a retailer.
 *
 *   npm run seed
 *   npm run seed -- --reset
 */
import { createRepository } from '../src/lib/db';
import { ALL_MERCHANT_SEEDS, merchantIdForDomain, seedToMerchantInput } from '../src/lib/sources/merchants';
import { buildSeedDeals, buildSeedStores } from '../src/lib/seed/data';
import { parseArgs } from '../src/lib/util/cli';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = await createRepository();
  await repo.migrate();

  if (args.flags.has('reset')) {
    console.log('Reset requested: run `npm run db:reset` first for a clean database.');
  }

  await repo.upsertMerchants(ALL_MERCHANT_SEEDS.map(seedToMerchantInput));

  const stores = buildSeedStores();
  await repo.upsertStores(stores);

  const { deals, priceHistory } = buildSeedDeals(merchantIdForDomain, stores);
  const result = await repo.upsertDeals(deals);

  // Price history is what makes the detail-page chart and the "lowest in N days"
  // verdict real rather than decorative.
  const points = priceHistory.map((point) => ({
    dealId: point.dealId,
    price: point.price,
    observedAt: point.observedAt,
  }));
  await repo.appendPricePoints(points);

  // A plausible health record so the staleness banner and /api/health have data.
  const now = new Date().toISOString();
  for (const source of ['redflagdeals', 'bestbuy', 'shopify:roots', 'stocktrack']) {
    await repo.recordSourceRun({
      source,
      startedAt: now,
      finishedAt: now,
      outcome: 'ok',
      itemsFound: 40,
      itemsNew: 12,
      latencyMs: 850,
    });
  }

  const total = await repo.countDeals({});
  console.log(`Seeded ${result.inserted} new / ${result.updated} updated deals`);
  console.log(`  ${stores.length} stores, ${points.length} price observations`);
  console.log(`  ${total} active deals in the database`);
  console.log('\nRun `npm run dev` and open http://localhost:3000');

  await repo.close();
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
