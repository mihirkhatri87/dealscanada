/**
 * Registers every adapter.
 *
 * Imported for side effects by the CLI scripts and cron routes. Keeping
 * registration in one place means the pipeline runner never needs to know what
 * sources exist — and catalogue-driven retailers register themselves from data,
 * so onboarding the next store touches no code at all.
 */
import { register } from './registry';
import { redflagdealsAdapter } from './redflagdeals';
import { bestbuyAdapter } from './bestbuy';
import { createShopifyAdapter } from './engines/shopify';
import { createJsonLdAdapter } from './engines/jsonld';
import { RETAILER_CATALOGUE } from './catalogue-data';
import { runnableRetailers } from './catalogue';

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
    case 'jsonld':
      register(createJsonLdAdapter(retailer));
      break;
    default:
      // Engines still to be implemented (sfcc, hybris, gapinc, magento) fall
      // through deliberately rather than registering a broken adapter.
      break;
  }
}

export {};
