/**
 * Registers every adapter.
 *
 * Imported for side effects by the CLI scripts and cron routes. Keeping
 * registration in one place means the pipeline runner never needs to know what
 * sources exist — and catalogue-driven retailers register themselves from data,
 * so onboarding the next store touches no code at all.
 */
import { register, registerOrReplace } from './registry';
import { redflagdealsAdapter } from './redflagdeals';
import { bestbuyAdapter } from './bestbuy';
import { createShopifyAdapter } from './engines/shopify';
import { createJsonLdAdapter } from './engines/jsonld';
import { createSfccAdapter } from './engines/sfcc';
import { buildStocktrackAdapter, type StocktrackStore } from './stocktrack';
import { RETAILER_CATALOGUE } from './catalogue-data';
import { runnableRetailers } from './catalogue';
import { env } from '../config';

// Bespoke adapters: sources whose value justifies dedicated handling.
register(redflagdealsAdapter);
register(bestbuyAdapter);

// Catalogue-driven retailers. Each entry becomes an adapter through the engine
// it declares, so coverage grows by editing data rather than writing code.
for (const retailer of runnableRetailers(RETAILER_CATALOGUE)) {
  switch (retailer.engine) {
    case 'shopify':
      register(createShopifyAdapter(retailer));
      break;
    case 'sfcc':
      register(createSfccAdapter(retailer));
      break;
    case 'jsonld':
      register(createJsonLdAdapter(retailer));
      break;
    default:
      // Engines still to be implemented (hybris, gapinc, magento) fall through
      // deliberately rather than registering a broken adapter.
      break;
  }
}

/**
 * Registers the in-store clearance adapter for the stores the user has synced.
 *
 * Separate from the static registrations above because it needs data: which
 * stores to scrape comes from the database, and stores only get there through
 * `npm run stores:sync`. That is what keeps this store-scoped rather than a
 * full-chain crawl.
 *
 * Called with an empty list it still registers, and reports "no stores selected"
 * in health — a source that is off for a stateable reason should be visible, not
 * absent. Replaces rather than adds, because a long-lived server calls this on
 * every request and a duplicate-id throw would turn the second one into a 500.
 */
export function registerStocktrack(stores: StocktrackStore[]): void {
  registerOrReplace(buildStocktrackAdapter(stores.slice(0, env.STOCKTRACK_MAX_STORES)));
}
