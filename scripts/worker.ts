#!/usr/bin/env tsx
/**
 * The local scheduler.
 *
 * Runs the pipeline on a cron schedule for as long as the process lives. This is
 * the "leave it running on your desktop" path; the hosted equivalent is
 * POST /api/cron/scrape.
 *
 *   npm run worker
 *   npm run worker -- --schedule="0 * * * *"
 *   npm run worker -- --now            # run once immediately, then on schedule
 *
 * Ctrl-C finishes the run in flight before exiting, because killing a process
 * mid-transaction is how a database ends up half-written.
 */
import cron from 'node-cron';
import { createRepository } from '../src/lib/db';
import { allAdapters } from '../src/lib/sources/registry';
import '../src/lib/sources/all';
import { runPipeline } from '../src/lib/pipeline/run';
import { parseArgs } from '../src/lib/util/cli';
import { env } from '../src/lib/config';
import type { DealRepository } from '../src/lib/db/repository';
import { RunGuard } from '../src/lib/pipeline/run-guard';

async function scrapeOnce(repo: DealRepository): Promise<void> {
  const started = new Date();
  console.log(`\n[${started.toISOString()}] starting run`);

  const summary = await runPipeline({
    adapters: allAdapters(),
    repo,
    concurrency: env.SCRAPE_CONCURRENCY,
  });

  const failed = summary.sources.filter((source) => source.outcome === 'failed').length;
  console.log(
    `[${new Date().toISOString()}] done in ${(summary.durationMs / 1000).toFixed(1)}s — ` +
      `${summary.totalFound} found, ${summary.totalNew} new, ${summary.totalUpdated} updated, ` +
      `${summary.verified} verified, ${summary.suspectAnchors} anchors flagged` +
      (failed > 0 ? `, ${failed} source(s) failed` : ''),
  );

  if (summary.reaped) {
    console.log(
      `  retired ${summary.reaped.expired} expired, ${summary.reaped.dead} unseen; ` +
        `pruned ${summary.reaped.prunedPricePoints} price point(s)`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const schedule = args.values.get('schedule') ?? env.SCRAPE_CRON;

  if (!cron.validate(schedule)) {
    console.error(`Invalid cron schedule: "${schedule}"`);
    console.error('Five fields, e.g. "*/30 * * * *" for every thirty minutes.');
    process.exit(1);
  }

  const repo = await createRepository();
  await repo.migrate();

  const guard = new RunGuard();
  let shuttingDown = false;

  const task = cron.schedule(schedule, () => {
    if (shuttingDown) return;
    void guard
      .run(() => scrapeOnce(repo))
      .then((result) => {
        if (result === null) {
          console.log(
            `[${new Date().toISOString()}] previous run still going — skipped ` +
              `(${guard.skippedCount} total)`,
          );
        }
      })
      .catch((error: unknown) => {
        // A failed run must not take the scheduler down with it. Tomorrow's
        // scrape is worth more than a clean stack trace today.
        console.error(`[${new Date().toISOString()}] run failed:`, error);
      });
  });

  console.log(`Worker started. Schedule: ${schedule}`);
  console.log('Ctrl-C to stop (finishes the run in flight first).');

  if (args.flags.has('now')) {
    await guard.run(() => scrapeOnce(repo)).catch((error: unknown) => {
      console.error('Initial run failed:', error);
    });
  }

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n${signal} received.`);
    task.stop();

    if (guard.isRunning) {
      console.log('Waiting for the run in flight to finish...');
      while (guard.isRunning) await new Promise((resolve) => setTimeout(resolve, 250));
    }

    await repo.close();
    console.log('Stopped cleanly.');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('Worker failed to start:', error);
  process.exit(1);
});
