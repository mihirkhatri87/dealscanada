#!/usr/bin/env tsx
/**
 * Runs the golden evaluation set against a live model (S9.7).
 *
 * Assistant quality is invisible without a measurement, and this is it: forty
 * real shopping requests over the seed dataset, scored for whether the intended
 * deal reached the top six, whether a vague request got a question instead of a
 * guess, and what the answer cost.
 *
 *   npm run assistant:eval
 *   npm run assistant:eval -- --split=test
 *   npm run assistant:eval -- --models=claude-sonnet-5,claude-opus-5   # bake-off
 *   npm run assistant:eval -- --case=vague-gift --verbose
 *   npm run assistant:eval -- --write-baseline
 *   npm run assistant:eval -- --dry-run           # resolve labels, spend nothing
 *
 * This command spends money — a full run is roughly 40 conversations. It prints
 * the estimated spend and requires --yes to skip the confirmation pause.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SqliteDealRepository } from '../src/lib/db/sqlite';
import {
  ALL_MERCHANT_SEEDS,
  merchantIdForDomain,
  seedToMerchantInput,
} from '../src/lib/sources/merchants';
import { buildSeedDeals, buildSeedStores } from '../src/lib/seed/data';
import { runAssistant, type AssistantEvent } from '../src/lib/assistant/engine';
import { GOLDEN_SET, type EvalCase } from '../src/lib/assistant/eval/golden';
import {
  CLARIFY_FLOOR,
  RECALL_FLOOR,
  scoreCase,
  summarize,
  type CaseResult,
  type ModelReport,
} from '../src/lib/assistant/eval/score';
import { env } from '../src/lib/config';
import { parseArgs } from '../src/lib/util/cli';

const BASELINE_PATH = 'docs/assistant-eval-baseline.json';

/** Toronto, so the location-dependent cases have somewhere to be. */
const EVAL_LOCATION = { lat: 43.6532, lng: -79.3832, label: 'Toronto, ON' };

async function seedTempDatabase() {
  const dir = mkdtempSync(join(tmpdir(), 'dc-eval-'));
  const repo = new SqliteDealRepository(join(dir, 'eval.db'));
  await repo.migrate();

  await repo.upsertMerchants(ALL_MERCHANT_SEEDS.map(seedToMerchantInput));
  const stores = buildSeedStores();
  await repo.upsertStores(stores);

  const { deals, priceHistory } = buildSeedDeals(merchantIdForDomain, stores);
  await repo.upsertDeals(deals);
  await repo.appendPricePoints(priceHistory);

  // Seed deal ids are minted fresh on every seeding, so the golden set labels by
  // the stable sourceId and we resolve it here.
  const idBySourceId = new Map(deals.map((deal) => [deal.sourceId, deal.id]));

  return {
    repo,
    idBySourceId,
    cleanup: async () => {
      await repo.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function runCase(
  evalCase: EvalCase,
  model: string,
  repo: SqliteDealRepository,
  idBySourceId: Map<string, string>,
  verbose: boolean,
): Promise<CaseResult> {
  const events: AssistantEvent[] = [];

  try {
    for await (const event of runAssistant({
      messages: [{ role: 'user', content: evalCase.request }],
      toolContext: { repo, seenDealIds: new Set<string>(), location: EVAL_LOCATION },
      model,
    })) {
      events.push(event);
    }
  } catch (error) {
    // A thrown run is a failed case, not a failed suite — one bad turn should
    // not cost the other thirty-nine.
    return {
      caseId: evalCase.id,
      kind: evalCase.kind,
      split: evalCase.split,
      passed: false,
      hitRank: null,
      surfacedCount: 0,
      violations: [],
      clarified: false,
      costCents: null,
      toolCalls: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const result = scoreCase({ evalCase, events, idBySourceId, model });

  if (verbose) {
    const text = events
      .filter((event) => event.type === 'text')
      .map((event) => event.text ?? '')
      .join('');
    console.log(`\n--- ${evalCase.id} (${model}) ---`);
    console.log(`> ${evalCase.request}`);
    for (const event of events.filter((event) => event.type === 'activity')) {
      console.log(`  → ${event.activity}`);
    }
    console.log(text.trim());
  }

  return result;
}

function formatCents(cents: number | null): string {
  return cents === null ? '  n/a' : `$${(cents / 100).toFixed(4)}`;
}

function printReport(report: ModelReport): void {
  console.log(`\n${report.model}`);
  console.log('-'.repeat(report.model.length));

  for (const result of report.cases) {
    const mark = result.passed ? 'pass' : 'FAIL';
    const detail =
      result.kind === 'clarify'
        ? `${result.clarified ? 'asked' : 'guessed'}, showed ${result.surfacedCount}`
        : result.hitRank !== null
          ? `rank ${result.hitRank}`
          : `missed (${result.surfacedCount} shown)`;
    const flag = result.violations.length > 0 ? '  ANCHOR SURFACED' : '';
    const error = result.error ? `  error: ${result.error}` : '';
    console.log(
      `  ${mark}  ${result.caseId.padEnd(26)} ${detail.padEnd(24)} ` +
        `${formatCents(result.costCents)}${flag}${error}`,
    );
  }

  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  console.log('');
  console.log(
    `  top-6 recall (all find cases)  ${pct(report.recall)}   floor ${pct(RECALL_FLOOR)}`,
  );
  console.log(`  top-6 recall (test split only) ${pct(report.recallTest)}`);
  console.log(
    `  clarified when vague           ${pct(report.clarifyRate)}   floor ${pct(CLARIFY_FLOOR)}`,
  );
  console.log(`  inflated anchors recommended   ${report.violations}   floor 0`);
  console.log(`  mean cost per conversation     ${formatCents(report.meanCostCents)}`);
  console.log(`  total spend                    ${formatCents(report.totalCostCents)}`);
  console.log(`  mean tool calls                ${report.meanToolCalls.toFixed(1)}`);
}

function printBakeOff(reports: ModelReport[]): void {
  if (reports.length < 2) return;

  console.log('\nBake-off');
  console.log('========');
  console.log(
    `  ${'model'.padEnd(30)} ${'recall'.padEnd(9)} ${'test'.padEnd(9)} ` +
      `${'clarify'.padEnd(9)} ${'anchors'.padEnd(9)} cost/conv`,
  );
  for (const report of reports) {
    const pct = (value: number) => `${(value * 100).toFixed(1)}%`.padEnd(9);
    console.log(
      `  ${report.model.padEnd(30)} ${pct(report.recall)} ${pct(report.recallTest)} ` +
        `${pct(report.clarifyRate)} ${String(report.violations).padEnd(9)} ` +
        `${formatCents(report.meanCostCents)}`,
    );
  }

  // State a recommendation rather than leaving the operator to squint at a
  // table. Cheapest model that clears both floors wins; recall only breaks a tie
  // when neither does.
  const passing = reports.filter(
    (report) => report.recall >= RECALL_FLOOR && report.clarifyRate >= CLARIFY_FLOOR,
  );
  const ranked = (passing.length > 0 ? passing : reports).slice().sort((a, b) => {
    if (passing.length > 0) return (a.meanCostCents ?? Infinity) - (b.meanCostCents ?? Infinity);
    return b.recall - a.recall;
  });

  const winner = ranked[0];
  if (!winner) return;

  console.log('');
  if (passing.length > 0) {
    console.log(
      `  Recommendation: ASSISTANT_MODEL=${winner.model} — clears both floors at the ` +
        `lowest measured cost per conversation.`,
    );
  } else {
    console.log(
      `  Recommendation: none of the tested models clears the floors. ` +
        `${winner.model} scored highest (${(winner.recall * 100).toFixed(1)}% recall). ` +
        `Fix the prompt or tools — do not lower the floor.`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const dryRun = args.flags.has('dry-run');

  if (!env.ANTHROPIC_API_KEY && !dryRun) {
    console.error(
      'ANTHROPIC_API_KEY is not set. The eval calls the real API — it cannot run offline.',
    );
    console.error('\n  PowerShell:  $env:ANTHROPIC_API_KEY = "sk-ant-..."; npm run assistant:eval');
    process.exit(1);
  }

  const models = (args.values.get('models') ?? env.ASSISTANT_MODEL)
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  const split = args.values.get('split');
  const only = args.values.get('case');
  const verbose = args.flags.has('verbose');

  let cases = GOLDEN_SET;
  if (split) cases = cases.filter((evalCase) => evalCase.split === split);
  if (only) cases = cases.filter((evalCase) => evalCase.id === only);

  if (cases.length === 0) {
    console.error('No cases matched. Check --split (train|test) and --case.');
    process.exit(1);
  }

  if (dryRun) {
    // Seeds, resolves every label, and reports — without spending anything. This
    // is what catches a rotted label before a paid run does.
    const { idBySourceId, cleanup } = await seedTempDatabase();
    let unresolved = 0;

    for (const evalCase of cases) {
      const labels = [...evalCase.acceptable, ...(evalCase.mustNotRecommend ?? [])];
      const missing = labels.filter((sourceId) => !idBySourceId.has(sourceId));
      if (missing.length > 0) {
        unresolved += missing.length;
        console.error(`  ${evalCase.id}: unresolved label(s) ${missing.join(', ')}`);
      }
    }

    await cleanup();
    console.log(
      `Dry run: ${cases.length} case(s), ${models.length} model(s), ` +
        `${unresolved} unresolved label(s). No API calls made.`,
    );
    process.exit(unresolved === 0 ? 0 : 1);
  }

  const runs = cases.length * models.length;
  console.log(
    `Running ${cases.length} case(s) against ${models.length} model(s) = ${runs} conversations.`,
  );
  console.log(
    'This calls the real API and costs real money (roughly $0.01-0.03 per conversation).\n',
  );

  const { repo, idBySourceId, cleanup } = await seedTempDatabase();
  const reports: ModelReport[] = [];

  try {
    for (const model of models) {
      const results: CaseResult[] = [];
      for (const [index, evalCase] of cases.entries()) {
        process.stdout.write(`\r  ${model}: ${index + 1}/${cases.length}   `);
        results.push(await runCase(evalCase, model, repo, idBySourceId, verbose));
      }
      process.stdout.write('\r');
      reports.push(summarize(model, results));
    }
  } finally {
    await cleanup();
  }

  for (const report of reports) printReport(report);
  printBakeOff(reports);

  if (args.flags.has('write-baseline')) {
    const baseline = {
      recordedAt: new Date().toISOString(),
      caseCount: cases.length,
      split: split ?? 'all',
      models: reports.map((report) => ({
        model: report.model,
        recall: report.recall,
        recallTest: report.recallTest,
        clarifyRate: report.clarifyRate,
        violations: report.violations,
        meanCostCents: report.meanCostCents,
        meanToolCalls: report.meanToolCalls,
        cases: report.cases.map((result) => ({
          caseId: result.caseId,
          passed: result.passed,
          hitRank: result.hitRank,
        })),
      })),
    };
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(
      `\nBaseline written to ${BASELINE_PATH} — commit it so regressions show in a diff.`,
    );
  }

  // The floors are the gate. A run that misses one exits non-zero so CI and a
  // human reading the terminal reach the same conclusion.
  const failed = reports.filter(
    (report) =>
      report.recall < RECALL_FLOOR || report.clarifyRate < CLARIFY_FLOOR || report.violations > 0,
  );

  if (failed.length > 0) {
    console.error(
      `\n${failed.length} model(s) below the floors: ${failed.map((report) => report.model).join(', ')}`,
    );
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error('Eval failed:', error);
  process.exit(1);
});
