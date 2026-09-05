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
      const repo = new PostgresDealRepository(`${postgresUrl}?options=-c%20search_path%3D${schema}`);
      return { repo, cleanup: async () => repo.close() };
    },
  });
}

for (const backend of backends) {
  defineContractSuite(backend);
}
