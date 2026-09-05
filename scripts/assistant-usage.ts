#!/usr/bin/env tsx
/**
 * Real assistant spend, from recorded usage.
 *
 * The cost figures in the PRD are estimates derived from token shapes. This
 * replaces them with measurements, which is the only honest way to talk about
 * what the feature costs.
 *
 *   npm run assistant:usage
 */
import { createRepository } from '../src/lib/db';
import { env } from '../src/lib/config';
import { renderTable } from '../src/lib/util/cli';

/** Published per-MTok rates. Verify against current pricing before quoting. */
const RATES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};

async function main() {
  const repo = await createRepository();
  await repo.migrate();

  const summary = await repo.getAssistantUsageSummary();

  if (summary.turns === 0) {
    console.log('No assistant usage recorded yet.');
    console.log('Set ANTHROPIC_API_KEY, open /assistant, and ask something.');
    await repo.close();
    return;
  }

  const rows: string[][] = [];
  let totalCost = 0;

  for (const [model, stats] of Object.entries(summary.byModel)) {
    const rate = RATES[model];
    const cost = rate
      ? (stats.inputTokens / 1e6) * rate.input + (stats.outputTokens / 1e6) * rate.output
      : Number.NaN;

    if (Number.isFinite(cost)) totalCost += cost;

    rows.push([
      model,
      String(stats.turns),
      stats.inputTokens.toLocaleString('en-CA'),
      stats.outputTokens.toLocaleString('en-CA'),
      Number.isFinite(cost) ? `$${cost.toFixed(4)}` : 'unknown rate',
    ]);
  }

  console.log(renderTable(['MODEL', 'TURNS', 'INPUT', 'OUTPUT', 'EST. COST'], rows));

  console.log(`\nConversations   ${summary.conversations}`);
  console.log(`Turns           ${summary.turns}`);
  console.log(`Cache hit rate  ${(summary.cacheHitRate * 100).toFixed(1)}%`);
  console.log(`Estimated spend $${totalCost.toFixed(4)}`);

  if (summary.conversations > 0) {
    console.log(`Per conversation $${(totalCost / summary.conversations).toFixed(4)}`);
  }

  // The cache hit rate is the single biggest cost lever, so a low one is worth
  // flagging rather than leaving to be noticed on a bill.
  if (summary.turns > 2 && summary.cacheHitRate < 0.5) {
    console.log(
      '\nCache hit rate is low. Something volatile is likely appearing before the last\n' +
        'cache breakpoint - check that the system prompt and tool definitions are byte-identical\n' +
        'between turns.',
    );
  }

  console.log(`\nCurrent model: ${env.ASSISTANT_MODEL}`);
  console.log('Rates are as published at time of writing; verify before quoting them.');

  await repo.close();
}

main().catch((error: unknown) => {
  console.error('Usage report failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
