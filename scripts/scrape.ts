#!/usr/bin/env tsx
/**
 * Ingest deals from every enabled source.
 *
 *   npm run scrape
 *   npm run scrape -- --source=redflagdeals --limit=40 --verbose
 *   npm run scrape -- --dry-run          # parse and report, write nothing
 *   npm run scrape -- --family=canadian-tire
 */
import { createRepository } from '../src/lib/db';
import { allAdapters, getAdapter } from '../src/lib/sources/registry';
import '../src/lib/sources/all';
import { runPipeline } from '../src/lib/pipeline/run';
import { getList, getNumber, parseArgs } from '../src/lib/util/cli';
import { env } from '../src/lib/config';

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const dryRun = args.flags.has('dry-run');
  const verbose = args.flags.has('verbose');
  const limit = getNumber(args, 'limit');
  const sources = getList(args, 'source');
  const families = getList(args, 'family');
  const storeIds = getList(args, 'store');

  let adapters = allAdapters();

  if (sources?.length) {
    adapters = sources.map((id) => {
      const adapter = getAdapter(id);
      if (!adapter) {
        const available = allAdapters()
          .map((a) => a.id)
          .join(', ');
        throw new Error(`Unknown source "${id}". Available: ${available || '(none registered)'}`);
      }
      return adapter;
    });
  }

  if (families?.length) {
    adapters = adapters.filter((adapter) =>
      families.some((family) => adapter.id.includes(family)),
    );
  }

  if (adapters.length === 0) {
    console.error('No adapters selected. Nothing to do.');
    process.exit(1);
  }

  console.log(
    `Scraping ${adapters.length} source(s)${dryRun ? ' [DRY RUN - nothing will be written]' : ''}`,
  );

  const repo = await createRepository();
  await repo.migrate();

  const summary = await runPipeline({
    adapters,
    repo,
    limit,
    storeIds,
    dryRun,
    verbose,
    concurrency: env.SCRAPE_CONCURRENCY,
  });

  console.log('\nPer source:');
  for (const source of summary.sources) {
    const status =
      source.outcome === 'ok' ? 'ok' : source.outcome === 'skipped' ? 'skipped' : 'FAILED';
    const detail = source.error ? ` - ${source.error}` : '';
    console.log(
      `  ${source.source.padEnd(20)} ${status.padEnd(8)} ` +
        `${String(source.itemsFound).padStart(5)} found  ` +
        `${String(source.itemsDropped).padStart(4)} dropped  ` +
        `${String(source.latencyMs).padStart(6)}ms${detail}`,
    );

    if (verbose && Object.keys(source.dropReasons).length > 0) {
      for (const [reason, count] of Object.entries(source.dropReasons)) {
        console.log(`      dropped ${count}x: ${reason}`);
      }
    }
  }

  console.log('\nRun summary:');
  console.log(`  found      ${summary.totalFound}`);
  console.log(`  new        ${summary.totalNew}`);
  console.log(`  updated    ${summary.totalUpdated}`);
  console.log(`  dropped    ${summary.totalDropped}`);
  console.log(`  merged     ${summary.merged} duplicate(s) collapsed`);

  // The verification numbers are the ones that matter: they say how much of this
  // run is corroborated rather than taken on a retailer's word.
  console.log('\nDeal verification:');
  console.log(`  compared across merchants  ${summary.comparedAcrossMerchants}`);
  console.log(`  verified as genuine deals  ${summary.verified}`);
  console.log(`  inflated anchors flagged   ${summary.suspectAnchors}`);

  console.log(`\nCompleted in ${(summary.durationMs / 1000).toFixed(1)}s`);

  await repo.close();

  // Non-zero only when every source failed - a partial run is still a useful run.
  const attempted = summary.sources.filter((s) => s.outcome !== 'skipped');
  if (attempted.length > 0 && attempted.every((s) => s.outcome === 'failed')) {
    console.error('\nEvery attempted source failed.');
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error('Scrape failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
