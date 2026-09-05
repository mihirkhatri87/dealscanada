import { env, flags } from '../config';
import { SqliteDealRepository } from './sqlite';
import type { DealRepository } from './repository';

export * from './repository';
export * from './types';

let singleton: DealRepository | null = null;

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

/** Process-wide repository for the web app. Scripts and tests build their own. */
export async function getRepository(): Promise<DealRepository> {
  if (!singleton) singleton = await createRepository();
  return singleton;
}

export { flags };
