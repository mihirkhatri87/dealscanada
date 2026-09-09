import postgres from 'postgres';
import { SqliteDealRepository } from '@/lib/db/sqlite';
import { PostgresDealRepository } from '@/lib/db/postgres';
import { defineContractSuite, type Backend } from './contract-suite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const backends: Backend[] = [
  {
    label: 'sqlite',
    create: async () => {
      const dir = mkdtempSync(join(tmpdir(), 'dc-contract-'));
      const repo = new SqliteDealRepository(join(dir, 'test.db'));
      return {
        repo,
        cleanup: async () => {
          await repo.close();
          rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  },
];

// Postgres participates only when a test database is supplied. Absent one, the
// SQLite run still proves the contract; CI supplies TEST_DATABASE_URL so both
// engines are exercised before anything merges.
const postgresUrl = process.env['TEST_DATABASE_URL'];
if (postgresUrl) {
  backends.push({
    label: 'postgres',
    create: async () => {
      const schema = `contract_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // search_path names a schema; it does not bring one into existence. With
      // every schema on the path missing, Postgres refuses the first CREATE
      // TABLE of migrate() with "no schema has been selected to create in" -
      // which failed all 36 Postgres cases and, through them, every CI run this
      // repository has ever had.
      //
      // The admin connection is separate on purpose: it must not carry the
      // search_path, or it would be pointing at the schema it is trying to
      // create and later drop.
      const admin = postgres(postgresUrl, { onnotice: () => {} });
      await admin.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);

      const repo = new PostgresDealRepository(
        `${postgresUrl}?options=-c%20search_path%3D${schema}`,
      );

      return {
        repo,
        cleanup: async () => {
          await repo.close();
          // CASCADE because the tables migrate() created are still in it. A
          // suite that leaves its schemas behind turns a shared test database
          // into a slow one.
          await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
          await admin.end({ timeout: 5 });
        },
      };
    },
  });
}

for (const backend of backends) {
  defineContractSuite(backend);
}
