#!/usr/bin/env tsx
/**
 * Retire deals without running a scrape.
 *
 *   npm run reap
 *   npm run reap -- --dry-run              # report, write nothing
 *   npm run reap -- --dead-after-hours=24  # stricter than the configured default
 *
 * Retirement normally happens at the end of a pipeline run, which is the right
 * default: absence is only evidence a deal has gone when at least one source
 * actually worked that run. But that couples cleanup to scraping, and the case
 * where cleanup matters most is precisely the one where scraping has stopped -
 * a catalogue where every row still reads 'active' because nothing has run to
 * say otherwise.
 *
 * Running this is a deliberate act by someone who knows the scrapes are not
 * arriving, so it treats absence as evidence without asking whether a source
 * succeeded. That is safe to get wrong: `status` is overwritten on upsert, so
 * anything retired here comes straight back the next time a source returns it.
 */
import { createRepository } from '../src/lib/db';
import { reap } from '../src/lib/pipeline/reap';
import { getNumber, parseArgs } from '../src/lib/util/cli';
import { env } from '../src/lib/config';

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const dryRun = args.flags.has('dry-run');
  const deadAfterHours = getNumber(args, 'dead-after-hours') ?? env.DEAD_AFTER_HOURS;
  const priceHistoryDays = getNumber(args, 'price-history-days') ?? env.PRICE_HISTORY_DAYS;

  if (deadAfterHours <= 0) throw new Error('--dead-after-hours must be greater than 0');
  if (priceHistoryDays <= 0) throw new Error('--price-history-days must be greater than 0');

  const repo = await createRepository();
  await repo.migrate();

  const now = new Date();
  const deadBefore = new Date(now.getTime() - deadAfterHours * 3_600_000).toISOString();

  // seenWithinDays: 0 turns off the read-path freshness window, so these are
  // row counts rather than what a visitor would see.
  const active = await repo.countDeals({ statuses: ['active'], seenWithinDays: 0 });
  const listed = await repo.countDeals({ statuses: ['active'] });
  const surviving = await repo.countDeals({
    statuses: ['active'],
    seenWithinDays: deadAfterHours / 24,
  });

  console.log(`Reaping (${repo.dialect})\n`);
  console.log(`  active rows              ${active}`);
  console.log(`  of those, listed today   ${listed}  (seen within ${env.DEAL_FRESHNESS_DAYS}d)`);
  console.log(`  unseen since ${deadBefore.slice(0, 16)}  ${active - surviving}`);

  if (dryRun) {
    // Expiry and pruning are counted by the write path as it does the work, so
    // there is no honest way to preview them from here. Say so rather than
    // printing a zero that reads like a finding.
    console.log('\nDry run — nothing written.');
    console.log('Expiry and price-point pruning are not previewed; run without --dry-run.');
    await repo.close();
    return;
  }

  const summary = await reap({ repo, now, deadAfterHours, priceHistoryDays });

  console.log('\nRetired:');
  console.log(`  expired (retailer's own date)  ${summary.expired}`);
  console.log(`  unseen (absence inferred)      ${summary.dead}`);
  console.log(`  price points pruned            ${summary.prunedPricePoints}`);

  const remaining = await repo.countDeals({ statuses: ['active'], seenWithinDays: 0 });
  const remainingListed = await repo.countDeals({ statuses: ['active'] });
  console.log('\nAfter:');
  console.log(`  active rows              ${remaining}`);
  console.log(`  listed                   ${remainingListed}`);

  if (remainingListed === 0) {
    console.log(
      '\nNothing is listed. That is the correct result when no source has returned\n' +
        'anything recently — run `npm run scrape` from a Canadian IP to refill, and\n' +
        '`npm run health` if sources are failing.',
    );
  }

  await repo.close();
}

main().catch((error: unknown) => {
  console.error('Reap failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
