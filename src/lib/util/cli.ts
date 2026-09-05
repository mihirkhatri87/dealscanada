/**
 * Minimal argument parsing.
 *
 * Deliberately dependency-free and Windows-safe: no shell-only syntax, and
 * `--flag=value`, `--flag value` and bare `--flag` all work, because npm on
 * PowerShell mangles quoting in ways that surprise people.
 */

export interface ParsedArgs {
  flags: Set<string>;
  values: Map<string, string>;
  positional: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    const body = arg.slice(2);
    if (body === '') continue;

    const eq = body.indexOf('=');
    if (eq !== -1) {
      values.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }

    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      values.set(body, next);
      i += 1;
    } else {
      flags.add(body);
    }
  }

  return { flags, values, positional };
}

export function getNumber(args: ParsedArgs, key: string): number | undefined {
  const raw = args.values.get(key);
  if (raw === undefined) return undefined;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`--${key} must be a number, got "${raw}"`);
  }
  return value;
}

export function getList(args: ParsedArgs, key: string): string[] | undefined {
  const raw = args.values.get(key);
  if (raw === undefined) return undefined;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Fixed-width table rendering, so health output stays readable in a terminal. */
export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  );

  const line = (cells: string[]) =>
    cells
      .map((cell, i) => (cell ?? '').padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd();

  const divider = widths.map((width) => '-'.repeat(width)).join('  ');

  return [line(headers), divider, ...rows.map(line)].join('\n');
}
