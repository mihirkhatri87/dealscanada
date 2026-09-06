import { env, flags } from '../config';
import { SqliteDealRepository } from './sqlite';
import type { DealRepository } from './repository';

export * from './repository';
export * from './types';

let singleton: Promise<DealRepository> | null = null;

/**
 * Selects the storage engine from DATABASE_URL presence alone.
 *
 * Postgres is loaded lazily so a SQLite-only install never pays for the driver,
 * and so `postgres` staying uninstalled cannot break the default path.
 */
export async function createRepository(options?: {
  sqlitePath?: string;
  databaseUrl?: string;
}): Promise<DealRepository> {
  const databaseUrl = options?.databaseUrl ?? env.DATABASE_URL;

  if (databaseUrl) {
    const { PostgresDealRepository } = await import('./postgres');
    return new PostgresDealRepository(databaseUrl);
  }

  return new SqliteDealRepository(options?.sqlitePath ?? env.SQLITE_PATH);
}

/**
 * Process-wide repository for the web app. Scripts and tests build their own.
 *
 * Migrates on first use, because a deployed container has no other opportunity
 * to. A fresh volume starts empty, `npm run db:migrate` is a developer command
 * that never runs in the image, and the one route that did call `migrate()` is
 * the scrape endpoint — which a platform will not route to, because the health
 * check it gates on is itself failing for want of the schema. That deadlock is
 * what a first deploy actually looks like: the machine boots, every request
 * throws "no such table", and the app never becomes reachable enough to fix
 * itself.
 *
 * Safe to do on every cold start: schema.sql is `CREATE ... IF NOT EXISTS`
 * throughout, so this is a no-op against a database that already has it.
 *
 * The promise rather than the repository is cached, so that concurrent first
 * requests — which is exactly what a cold start gets — await one migration
 * instead of racing to run several. A failure clears the cache rather than
 * poisoning the process with a rejected promise it would hand to every later
 * caller.
 */
export async function getRepository(): Promise<DealRepository> {
  if (!singleton) {
    singleton = (async () => {
      const repository = await createRepository();
      await repository.migrate();
      return repository;
    })();

    singleton.catch(() => {
      singleton = null;
    });
  }

  return singleton;
}

export { flags };
