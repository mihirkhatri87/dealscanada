#!/usr/bin/env tsx
/**
 * Idempotent schema migration. Safe to run repeatedly; running twice is a no-op.
 *
 *   npm run db:migrate
 *   npm run db:reset      # drops the local SQLite file first
 */
import { rmSync } from 'node:fs';
import { createRepository } from '../src/lib/db';
import { env } from '../src/lib/config';

async function main() {
  const reset = process.argv.includes('--reset');

  if (reset) {
    if (env.DATABASE_URL) {
      console.error('--reset only applies to the local SQLite database. Aborting.');
      process.exit(1);
    }
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      rmSync(`${env.SQLITE_PATH}${suffix}`, { force: true });
    }
    console.log(`Removed ${env.SQLITE_PATH}`);
  }

  const repo = await createRepository();
  await repo.migrate();
  console.log(`Schema up to date (${repo.dialect}).`);
  await repo.close();
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
