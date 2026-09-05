/**
 * The entire SQLite/Postgres difference, in one file.
 *
 * schema.sql is written in the SQLite dialect because that is the zero-setup local
 * default. Running it on Postgres needs a handful of token rewrites — not a second
 * schema file that can drift from the first.
 */

export type Dialect = 'sqlite' | 'postgres';

/** Rewrites the SQLite-dialect schema for Postgres. Identity on SQLite. */
export function translateSchema(sql: string, dialect: Dialect): string {
  if (dialect === 'sqlite') return sql;

  return (
    sql
      // Postgres has no unqualified INTEGER-as-boolean idiom problem, but it does
      // reject `REAL` defaults on some paths and needs explicit types elsewhere.
      .replace(/\bINTEGER\b/g, 'BIGINT')
      .replace(/\bREAL\b/g, 'DOUBLE PRECISION')
      // Postgres supports IF NOT EXISTS on both, so the DDL carries over as-is.
      .replace(/\bTEXT PRIMARY KEY\b/g, 'TEXT PRIMARY KEY')
  );
}

/**
 * Positional placeholder for a given dialect.
 * SQLite (better-sqlite3) uses `?`; Postgres uses `$1`, `$2`, ...
 */
export function placeholder(dialect: Dialect, index: number): string {
  return dialect === 'sqlite' ? '?' : `$${index}`;
}

/** Builds `?, ?, ?` or `$1, $2, $3` for a row of `count` values starting at `from`. */
export function placeholders(dialect: Dialect, count: number, from = 1): string {
  return Array.from({ length: count }, (_, i) => placeholder(dialect, from + i)).join(', ');
}

/**
 * Splits a schema file into individual statements.
 *
 * Comments are stripped BEFORE splitting on semicolons — a prose comment may itself
 * contain a semicolon, and splitting first would leave its tail masquerading as SQL.
 * Beyond that the schema contains no semicolons inside string literals or procedural
 * bodies, and a test asserts the statement count and shape.
 */
export function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  return withoutComments
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
