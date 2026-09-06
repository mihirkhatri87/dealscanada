import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The web app's shared repository has to arrive migrated.
 *
 * This is the first-deploy failure, and it is a deadlock rather than a plain
 * error: a container boots against an empty volume, every request throws
 * "no such table: source_runs", the platform's health check fails, and the
 * platform then refuses to route to the machine — including to the one route
 * that would have run the migration. The app cannot become reachable enough to
 * fix itself, so the schema has to exist before the first request is served.
 */
describe('getRepository', () => {
  let directory: string;
  const originalPath = process.env['SQLITE_PATH'];
  const originalUrl = process.env['DATABASE_URL'];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'dc-singleton-'));
    process.env['SQLITE_PATH'] = join(directory, 'deals.db');
    // A DATABASE_URL in the ambient environment would send this down the
    // Postgres path and quietly test nothing.
    delete process.env['DATABASE_URL'];
    vi.resetModules();
  });

  afterEach(async () => {
    const { getRepository } = await import('@/lib/db');
    await (await getRepository()).close().catch(() => {});

    if (originalPath === undefined) delete process.env['SQLITE_PATH'];
    else process.env['SQLITE_PATH'] = originalPath;
    if (originalUrl !== undefined) process.env['DATABASE_URL'] = originalUrl;

    rmSync(directory, { recursive: true, force: true });
    vi.resetModules();
  });

  it('returns a repository whose schema already exists', async () => {
    const { getRepository } = await import('@/lib/db');
    const repository = await getRepository();

    // Reads the table whose absence took the deployment down.
    await expect(repository.getSourceHealth()).resolves.toBeDefined();
    expect(existsSync(process.env['SQLITE_PATH'] as string)).toBe(true);
  });

  it('migrates once when concurrent requests race a cold start', async () => {
    // A cold start does not get one tidy first request; it gets everything that
    // was waiting. Caching the promise rather than the resolved repository is
    // what stops those all running their own migration.
    const { getRepository } = await import('@/lib/db');

    const [first, second, third] = await Promise.all([
      getRepository(),
      getRepository(),
      getRepository(),
    ]);

    expect(second).toBe(first);
    expect(third).toBe(first);
    await expect(first.listStores(1)).resolves.toBeDefined();
  });
});
