/**
 * Guards against overlapping scheduled runs.
 *
 * A scrape can outlast its own interval — a slow retailer, a long backoff — and
 * two pipelines writing the same rows at once is the kind of bug that only shows
 * up under load. Skipping is the right answer, not queueing: the next tick is
 * minutes away, and a queue of stale runs is worse than a missed one.
 */
export class RunGuard {
  private running = false;
  private skipped = 0;

  get isRunning(): boolean {
    return this.running;
  }

  get skippedCount(): number {
    return this.skipped;
  }

  /** Runs `task`, or returns null if a run is already in flight. */
  async run<T>(task: () => Promise<T>): Promise<T | null> {
    if (this.running) {
      this.skipped += 1;
      return null;
    }

    this.running = true;
    try {
      return await task();
    } finally {
      // Released even when the task throws: one failed run must not lock the
      // scheduler out permanently.
      this.running = false;
    }
  }
}
