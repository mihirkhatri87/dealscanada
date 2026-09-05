import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { placeholders, splitStatements, translateSchema } from '@/lib/db/dialect';

const schema = readFileSync(join(process.cwd(), 'src/lib/db/schema.sql'), 'utf8');

describe('splitStatements', () => {
  it('strips comments before splitting, so a semicolon in prose cannot leak', () => {
    const sql = `
      -- money is stored as cents; $19.99 is 1999
      CREATE TABLE a (id TEXT);
      CREATE TABLE b (id TEXT);
    `;
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements.every((s) => !s.includes('$19.99'))).toBe(true);
  });

  it('produces only CREATE statements from the real schema', () => {
    const statements = splitStatements(schema);
    expect(statements.length).toBeGreaterThan(10);
    expect(statements.every((s) => s.toUpperCase().startsWith('CREATE'))).toBe(true);
  });

  it('declares every table the data model requires', () => {
    const tables = splitStatements(schema)
      .filter((s) => /CREATE TABLE/i.test(s))
      .map((s) => /CREATE TABLE IF NOT EXISTS (\w+)/i.exec(s)?.[1]);
    expect(tables).toEqual(
      expect.arrayContaining([
        'merchants',
        'stores',
        'deals',
        'price_points',
        'source_runs',
        'assistant_usage',
      ]),
    );
  });
});

describe('translateSchema', () => {
  it('is identity for sqlite', () => {
    expect(translateSchema(schema, 'sqlite')).toBe(schema);
  });

  it('rewrites sqlite types for postgres', () => {
    const translated = translateSchema('CREATE TABLE a (n INTEGER, r REAL)', 'postgres');
    expect(translated).toContain('BIGINT');
    expect(translated).toContain('DOUBLE PRECISION');
    expect(translated).not.toContain('INTEGER');
  });
});

describe('placeholders', () => {
  it('emits question marks for sqlite and ordinals for postgres', () => {
    expect(placeholders('sqlite', 3)).toBe('?, ?, ?');
    expect(placeholders('postgres', 3)).toBe('$1, $2, $3');
    expect(placeholders('postgres', 2, 5)).toBe('$5, $6');
  });
});
