import { describe, expect, it } from 'vitest';
import { RunGuard } from '@/lib/pipeline/run-guard';
import { runPipeline } from '@/lib/pipeline/run';
import { tempSqliteRepo } from '../db/helpers';
import type { SourceAdapter } from '@/lib/sources/types';

/**
 * Scheduling failures are the quiet kind: two pipelines writing the same rows,
 * or a hosted run killed mid-write because it never checked the clock. Both are
 * cheap to prevent and expensive to diagnose after the fact.
 */

describe('the overlap guard', () => {
  it('skips a tick while a run is still going', async () => {
    const guard = new RunGuard();
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = guard.run(async () => {
      await blocked;
      return 'first';
    });

    // The scheduler fires again mid-run: skipped, not queued. The next tick is
    // minutes away, and two writers is worse than one missed cycle.
    const second = await guard.run(async () => 'second');
    expect(second).toBeNull();
    expect(guard.skippedCount).toBe(1);

    release();
    expect(await first).toBe('first');
  });

  it('runs again once the previous one finishes', async () => {
    const guard = new RunGuard();
    expect(await guard.run(async () => 'a')).toBe('a');
    expect(await guard.run(async () => 'b')).toBe('b');
    expect(guard.skippedCount).toBe(0);
  });

  it('releases the lock when a run throws, so one failure is not permanent', async () => {
    const guard = new RunGuard();
    await expect(
      guard.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(guard.isRunning).toBe(false);
    expect(await guard.run(async () => 'recovered')).toBe('recovered');
  });
});

function slowAdapter(id: string, ms: number): SourceAdapter {
  return {
    id,
    name: id,
    weight: 1,
    enabled: () => ({ enabled: true }),
    fetch: async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { deals: [] };
    },
  };
}

describe('the hosted run budget', () => {
  it('reports adapters it never started, rather than omitting them', async () => {
    // A truncated run that looks complete is the failure mode here: the operator
    // sees "12 sources ok" and no sign that four never ran.
    const ctx = tempSqliteRepo();
    await ctx.repo.migrate();

    const summary = await runPipeline({
      adapters: [
        slowAdapter('slow-1', 60),
        slowAdapter('slow-2', 60),
        slowAdapter('slow-3', 60),
        slowAdapter('slow-4', 60),
      ],
      repo: ctx.repo,
      concurrency: 1,
      deadlineMs: 80,
    });

    const skipped = summary.sources.filter((source) => source.outcome === 'skipped');
    expect(skipped.length).toBeGreaterThan(0);
    for (const source of skipped) expect(source.error).toBe('deadline exceeded');

    await ctx.cleanup();
  });

  it('runs everything when the budget is ample', async () => {
    const ctx = tempSqliteRepo();
    await ctx.repo.migrate();

    const summary = await runPipeline({
      adapters: [slowAdapter('a', 1), slowAdapter('b', 1)],
      repo: ctx.repo,
      concurrency: 2,
      deadlineMs: 30_000,
    });

    expect(summary.sources.every((source) => source.outcome === 'ok')).toBe(true);
    await ctx.cleanup();
  });

  it('is unbounded when no budget is given, so a local run is never cut short', async () => {
    const ctx = tempSqliteRepo();
    await ctx.repo.migrate();

    const summary = await runPipeline({
      adapters: [slowAdapter('a', 20)],
      repo: ctx.repo,
    });

    expect(summary.sources[0]?.outcome).toBe('ok');
    await ctx.cleanup();
  });
});

describe('data-dependent registration', () => {
  it('replaces rather than duplicates, so a long-lived server can re-register', async () => {
    // A duplicate-id throw would turn the second request to the cron route into
    // a 500 — the adapter is rebuilt from the user's stores on every call.
    const { registerOrReplace, allAdapters, resetRegistry } =
      await import('@/lib/sources/registry');

    resetRegistry();
    const first = slowAdapter('stocktrack', 0);
    const second = slowAdapter('stocktrack', 0);

    registerOrReplace(first);
    registerOrReplace(second);

    const registered = allAdapters().filter((adapter) => adapter.id === 'stocktrack');
    expect(registered).toHaveLength(1);
    expect(registered[0]).toBe(second);

    resetRegistry();
  });
});

describe('adapter run order', () => {
  it('runs a higher-priority adapter before the ones that read its output', async () => {
    // The store-level source publishes in-store clearance that the composite
    // adapters read. With equal priority, bounded concurrency could run the
    // composites first and hand them an empty pool — a silent wrong answer,
    // since an empty pool looks exactly like "no local clearance today".
    const ctx = tempSqliteRepo();
    await ctx.repo.migrate();

    const order: string[] = [];
    const recording = (id: string, priority?: number): SourceAdapter => ({
      id,
      name: id,
      weight: 1,
      ...(priority === undefined ? {} : { priority }),
      enabled: () => ({ enabled: true }),
      fetch: async () => {
        order.push(id);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { deals: [] };
      },
    });

    await runPipeline({
      adapters: [recording('reader-a'), recording('reader-b'), recording('provider', 10)],
      repo: ctx.repo,
      concurrency: 1,
    });

    expect(order[0]).toBe('provider');
    await ctx.cleanup();
  });
});
