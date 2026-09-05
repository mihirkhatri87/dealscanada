#!/usr/bin/env tsx
/**
 * Resolves store locations near a place and records them.
 *
 *   npm run stores:sync -- --postal=M5V3L9
 *   npm run stores:sync -- --city=Calgary --radius=40
 *
 * Postal codes resolve against a bundled FSA table, so this needs no geocoding
 * service and no API key, and no coordinate leaves the machine.
 */
import { createRepository } from '../src/lib/db';
import { resolveLocation } from '../src/lib/util/fsa';
import { haversineKm } from '../src/lib/util/geo';
import { getNumber, parseArgs, renderTable } from '../src/lib/util/cli';
import { SEED_STORE_DIRECTORY } from '../src/lib/seed/stores';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const place = args.values.get('postal') ?? args.values.get('city');
  const radiusKm = getNumber(args, 'radius') ?? 25;

  if (!place) {
    console.error('Usage: npm run stores:sync -- --postal=M5V3L9 [--radius=25]');
    console.error('   or: npm run stores:sync -- --city=Toronto');
    process.exit(1);
  }

  const location = resolveLocation(place);
  if (!location) {
    console.error(`Could not resolve "${place}". Use a Canadian postal code or a major city.`);
    process.exit(1);
  }

  console.log(`Resolved "${place}" to ${location.label} (${location.precision} precision)`);

  // The directory is a bundled list today. When the stocktrack store-list
  // endpoint is confirmed against a real Canadian IP, this is where a live
  // fetch slots in - the rest of the pipeline does not change.
  const nearby = SEED_STORE_DIRECTORY.filter(
    // A store without coordinates cannot be ranked by distance, so it is not a
    // candidate for a proximity sync.
    (store): store is typeof store & { lat: number; lng: number } =>
      store.lat !== null && store.lng !== null,
  )
    .map((store) => ({
      store,
      distanceKm: haversineKm(location.lat, location.lng, store.lat, store.lng),
    }))
    .filter((entry) => entry.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  if (nearby.length === 0) {
    console.log(`\nNo stores in the bundled directory within ${radiusKm} km of ${location.label}.`);
    console.log('The directory currently covers major metropolitan areas only.');
    process.exit(0);
  }

  const repo = await createRepository();
  await repo.migrate();
  await repo.upsertStores(nearby.map((entry) => entry.store));

  console.log(
    `\n${renderTable(
      ['STORE', 'CHAIN', 'CITY', 'DISTANCE'],
      nearby.map((entry) => [
        entry.store.name,
        entry.store.chain,
        entry.store.city ?? '',
        `${entry.distanceKm.toFixed(1)} km`,
      ]),
    )}`,
  );

  console.log(`\n${nearby.length} store(s) recorded.`);
  console.log('Next: npm run scrape -- --source=stocktrack');

  await repo.close();
}

main().catch((error: unknown) => {
  console.error('Store sync failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
