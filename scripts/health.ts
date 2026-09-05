#!/usr/bin/env tsx
/**
 * Source health check.
 *
 * This is the single most important command in the project for anyone running it
 * outside the build sandbox. Every adapter is written against documented response
 * shapes but cannot be verified against the live web from the build environment,
 * so this is what proves which sources actually reach and parse from a real
 * Canadian IP - and its output is exactly what is needed to fix any that drifted.
 *
 *   npm run health
 *   npm run health -- --source=bestbuy
 *   npm run health -- --json
 */
import { allAdapters, getAdapter } from '../src/lib/sources/registry';
import '../src/lib/sources/all';
import { HttpClient } from '../src/lib/util/http';
import { getList, parseArgs, renderTable } from '../src/lib/util/cli';
import type { SourceAdapter } from '../src/lib/sources/types';

interface Probe {
  source: string;
  status: 'ok' | 'blocked' | 'empty' | 'skipped' | 'error';
  items: number;
  latencyMs: number;
  path: string;
  detail: string;
}

const PROBE_LIMIT = 5;
const PROBE_TIMEOUT_MS = 20_000;

async function probe(adapter: SourceAdapter, http: HttpClient): Promise<Probe> {
  const started = Date.now();

  const gate = adapter.enabled();
  if (!gate.enabled) {
    // Not a failure. A dormant integration is a configuration state.
    return {
      source: adapter.id,
      status: 'skipped',
      items: 0,
      latencyMs: 0,
      path: '-',
      detail: gate.reason,
    };
  }

  try {
    const result = await Promise.race([
      adapter.fetch({
        http,
        limit: PROBE_LIMIT,
        log: () => {},
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('probe timed out')), PROBE_TIMEOUT_MS),
      ),
    ]);

    const latencyMs = Date.now() - started;

    if (result.deals.length === 0) {
      return {
        source: adapter.id,
        status: 'empty',
        items: 0,
        latencyMs,
        path: result.path ?? '-',
        detail: result.reason ?? 'reachable but parsed no items - selectors may have drifted',
      };
    }

    return {
      source: adapter.id,
      status: 'ok',
      items: result.deals.length,
      latencyMs,
      path: result.path ?? '-',
      detail: result.deals[0]?.title.slice(0, 44) ?? '',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A 403 is the signature of bot protection, which is a different problem from
    // a broken adapter and deserves a different label.
    const blocked = /403|blocked|forbidden|robots/i.test(message);

    return {
      source: adapter.id,
      status: blocked ? 'blocked' : 'error',
      items: 0,
      latencyMs: Date.now() - started,
      path: '-',
      detail: message.slice(0, 70),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const asJson = args.flags.has('json');
  const requested = getList(args, 'source');

  let adapters = allAdapters();
  if (requested?.length) {
    adapters = requested.map((id) => {
      const adapter = getAdapter(id);
      if (!adapter) throw new Error(`Unknown source "${id}"`);
      return adapter;
    });
  }

  if (adapters.length === 0) {
    console.log('No adapters registered yet.');
    return;
  }

  const http = new HttpClient();

  // Probes run concurrently but stay rate-limited per domain by the HTTP client.
  const results = await Promise.all(adapters.map((adapter) => probe(adapter, http)));
  results.sort((a, b) => a.source.localeCompare(b.source));

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const symbol: Record<Probe['status'], string> = {
      ok: 'ok',
      empty: 'EMPTY',
      blocked: 'BLOCKED',
      error: 'ERROR',
      skipped: 'skipped',
    };

    console.log(
      renderTable(
        ['SOURCE', 'STATUS', 'ITEMS', 'LATENCY', 'PATH', 'DETAIL'],
        results.map((r) => [
          r.source,
          symbol[r.status],
          String(r.items),
          `${r.latencyMs}ms`,
          r.path,
          r.detail,
        ]),
      ),
    );

    const ok = results.filter((r) => r.status === 'ok').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const broken = results.length - ok - skipped;

    console.log(`\n${ok} healthy, ${broken} needing attention, ${skipped} not configured.`);

    if (broken > 0) {
      console.log(
        '\nSend this table back and the failing adapters can be corrected -\n' +
          'BLOCKED means bot protection, EMPTY means the endpoint responded but\n' +
          'its shape changed, ERROR means the request itself failed.',
      );
    }
  }

  // Non-zero only if everything that could run failed - one dead retailer is not
  // a reason to fail a CI job or a cron.
  const attempted = results.filter((r) => r.status !== 'skipped');
  if (attempted.length > 0 && attempted.every((r) => r.status !== 'ok')) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error('Health check failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
