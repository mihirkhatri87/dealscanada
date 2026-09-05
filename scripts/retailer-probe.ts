#!/usr/bin/env tsx
/**
 * Turns a storefront URL into a catalogue entry.
 *
 * Coverage is the product, and coverage only scales if adding a retailer is a
 * config change. This is the tool that makes that true: it fetches a storefront,
 * recognises the platform from its own fingerprints, finds the sale paths the
 * navigation actually links to, and prints an entry to paste in.
 *
 *   npm run retailer:probe -- https://somestore.ca
 *   npm run retailer:probe -- https://somestore.ca --json
 *   npm run retailer:probe -- --all          # re-probe the catalogue, refresh status
 */
import { HttpClient } from '../src/lib/util/http';
import {
  buildCatalogueEntry,
  detectPlatform,
  findSalePaths,
  findShopifyCollections,
  type ProbeEvidence,
} from '../src/lib/sources/probe';
import { RETAILER_CATALOGUE } from '../src/lib/sources/catalogue-data';
import { parseArgs, renderTable } from '../src/lib/util/cli';

async function gatherEvidence(url: string, http: HttpClient): Promise<ProbeEvidence> {
  const page = await http.fetchText(url, { skipRobots: true });

  // One extra request, and only because a positive answer is conclusive: nothing
  // but Shopify serves a product array at this path.
  let productsJsonOk = false;
  try {
    const products = await http.fetchJson<unknown>(
      `${url.replace(/\/$/, '')}/products.json?limit=1`,
      { skipRobots: true },
    );
    productsJsonOk =
      products.data !== null &&
      typeof products.data === 'object' &&
      Array.isArray((products.data as { products?: unknown }).products);
  } catch {
    productsJsonOk = false;
  }

  return { html: page.data, productsJsonOk };
}

async function probeOne(url: string, http: HttpClient, asJson: boolean): Promise<void> {
  const evidence = await gatherEvidence(url, http);
  const result = detectPlatform(evidence);

  const salePaths =
    result.engine === 'shopify'
      ? findShopifyCollections(evidence.html)
      : findSalePaths(evidence.html, url);

  if (!result.engine) {
    console.error(`Could not recognise a platform at ${url}.`);
    console.error(`  ${result.evidence.join('; ')}`);
    console.error('');
    console.error('The JSON-LD engine may still work. Add an entry with:');
    console.error('  engine: "jsonld", a sale listing path, and a CSS selector for product links.');
    process.exitCode = 1;
    return;
  }

  const entry = buildCatalogueEntry(url, result, salePaths);
  if (!entry) return;

  if (asJson) {
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  console.log(`Detected: ${result.engine}`);
  for (const line of result.evidence) console.log(`  - ${line}`);

  console.log(
    salePaths.length > 0
      ? `\nSale paths found: ${salePaths.join(', ')}`
      : '\nNo sale paths found in the navigation — fill salePaths in by hand.',
  );

  console.log('\nCatalogue entry — paste into src/lib/sources/catalogue-data.ts:\n');
  console.log(
    JSON.stringify(entry, null, 2)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n'),
  );

  if (entry.productLinkSelector?.startsWith('TODO')) {
    console.log(
      '\nThe JSON-LD engine needs a real productLinkSelector. No probe can infer a\n' +
        'good one — open the sale page and find what wraps a product link.',
    );
  }
}

/**
 * Re-probes every catalogue entry.
 *
 * This is the maintenance path: the `status` field is supposed to record what
 * actually works from a Canadian IP, and it is only true if something refreshes
 * it against reality.
 */
async function probeAll(http: HttpClient): Promise<void> {
  const rows: string[][] = [];

  for (const retailer of RETAILER_CATALOGUE) {
    try {
      const evidence = await gatherEvidence(retailer.baseUrl, http);
      const result = detectPlatform(evidence);
      const agrees = result.engine === retailer.engine;

      rows.push([
        retailer.id,
        retailer.engine,
        result.engine ?? 'unknown',
        agrees ? 'ok' : 'MISMATCH',
        '',
      ]);
    } catch (error) {
      rows.push([
        retailer.id,
        retailer.engine,
        '-',
        'unreachable',
        error instanceof Error ? error.message.slice(0, 60) : '',
      ]);
    }
  }

  console.log(renderTable(['RETAILER', 'CONFIGURED', 'DETECTED', 'RESULT', 'DETAIL'], rows));

  const mismatches = rows.filter((row) => row[3] === 'MISMATCH').length;
  console.log(
    `\n${rows.length} probed, ${mismatches} disagreeing with the catalogue. ` +
      'A mismatch is worth investigating, not blindly applying — a storefront can\n' +
      'serve platform markers it no longer runs on.',
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const http = new HttpClient();

  if (args.flags.has('all')) {
    await probeAll(http);
    return;
  }

  const url = args.positional[0];
  if (!url) {
    console.error('Usage: npm run retailer:probe -- https://somestore.ca');
    console.error('       npm run retailer:probe -- --all');
    process.exit(1);
  }

  if (!/^https?:\/\//i.test(url)) {
    console.error(`"${url}" is not an absolute URL. Include the scheme.`);
    process.exit(1);
  }

  await probeOne(url, http, args.flags.has('json'));
}

main().catch((error: unknown) => {
  console.error('Probe failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
