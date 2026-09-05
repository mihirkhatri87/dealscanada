/**
 * Registers every adapter.
 *
 * Imported for side effects by the CLI scripts and cron routes. Keeping
 * registration in one place means the pipeline runner never needs to know what
 * sources exist — and catalogue-driven retailers register themselves from data,
 * so onboarding the next store touches no code at all.
 */
import { register, registerOrReplace } from './registry';
import { inStoreDeals } from './in-store-pool';
import { redflagdealsAdapter } from './redflagdeals';
import { bestbuyAdapter } from './bestbuy';
import { createWalmartAdapter } from './walmart';
import { createCostcoAdapter } from './costco';
import { createShopifyAdapter } from './engines/shopify';
import { createJsonLdAdapter } from './engines/jsonld';
import { createSfccAdapter } from './engines/sfcc';
import { createGapIncAdapter } from './engines/gapinc';
import { createHybrisAdapter } from './engines/hybris';
import { buildStocktrackAdapter, type StocktrackStore } from './stocktrack';
import { RETAILER_CATALOGUE } from './catalogue-data';
import { runnableRetailers } from './catalogue';
import { env, flags } from '../config';

// Bespoke adapters: sources whose value justifies dedicated handling.
register(redflagdealsAdapter);
register(bestbuyAdapter);

// Walmart and Costco read the in-store clearance the store-level source
// collected this run rather than fetching it again - see ./in-store-pool.ts.
register(createWalmartAdapter(inStoreDeals));
register(createCostcoAdapter(inStoreDeals));

// Catalogue-driven retailers. Each entry becomes an adapter through the engine
// it declares, so coverage grows by editing data rather than writing code.
for (const retailer of runnableRetailers(RETAILER_CATALOGUE)) {
  // The Canadian Tire family is the one place the catalogue's declared engine is
  // not the final word. Their platform needs a subscription key with no public
  // way to obtain one, so a banner declaring `hybris` runs on the JSON-LD engine
  // until a key exists - which is what keeps those nine retailers working at all
  // for the overwhelming majority of installs that will never have one.
  const engine =
    retailer.engine === 'hybris' && !flags.canadianTireApiEnabled ? 'jsonld' : retailer.engine;

  switch (engine) {
    case 'shopify':
      register(createShopifyAdapter(retailer));
      break;
    case 'sfcc':
      register(createSfccAdapter(retailer));
      break;
    case 'gapinc':
      register(createGapIncAdapter(retailer));
      break;
    case 'hybris':
      register(createHybrisAdapter(retailer));
      break;
    case 'jsonld':
      register(createJsonLdAdapter(retailer));
      break;
    default:
      // The Magento engine is still to be implemented; entries declaring it fall
      // through deliberately rather than registering a broken adapter.
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
