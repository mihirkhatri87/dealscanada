import type { SourceAdapter } from './types';

/**
 * The adapter registry.
 *
 * Adding a source means adding one entry here — the pipeline runner never
 * changes. Adapter ids must be unique; a test asserts it, because a collision
 * would silently overwrite one source's run history with another's.
 */

const adapters: SourceAdapter[] = [];

/** Registers an adapter. Throws on a duplicate id rather than shadowing. */
export function register(adapter: SourceAdapter): SourceAdapter {
  if (adapters.some((existing) => existing.id === adapter.id)) {
    throw new Error(`Duplicate source adapter id: ${adapter.id}`);
  }
  adapters.push(adapter);
  return adapter;
}

export function allAdapters(): SourceAdapter[] {
  return [...adapters];
}

/** Adapters that can actually run right now. */
export function enabledAdapters(): SourceAdapter[] {
  return adapters.filter((adapter) => adapter.enabled().enabled);
}

export function getAdapter(id: string): SourceAdapter | undefined {
  return adapters.find((adapter) => adapter.id === id);
}

/** Test-only: restores a clean registry between cases. */
export function resetRegistry(): void {
  adapters.length = 0;
}
