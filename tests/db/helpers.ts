import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SqliteDealRepository } from '@/lib/db/sqlite';
import type { DealInput, MerchantInput, StoreInput } from '@/lib/db/repository';

export function tempSqliteRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dc-test-'));
  const path = join(dir, 'test.db');
  const repo = new SqliteDealRepository(path);
  return {
    repo,
    cleanup: async () => {
      await repo.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function makeMerchant(overrides: Partial<MerchantInput> = {}): MerchantInput {
  const slug = overrides.slug ?? `merchant-${randomUUID().slice(0, 8)}`;
  return {
    id: overrides.id ?? randomUUID(),
    slug,
    name: overrides.name ?? slug,
    domain: overrides.domain ?? `${slug}.ca`,
    logoUrl: null,
    affiliateUrlTemplate: null,
    family: null,
    vertical: null,
    engine: 'jsonld',
    status: 'unverified',
    rateLimitRps: null,
    ...overrides,
  };
}

export function makeStore(overrides: Partial<StoreInput> = {}): StoreInput {
  return {
    id: overrides.id ?? randomUUID(),
    chain: 'canadian-tire',
    sourceStoreId: overrides.sourceStoreId ?? randomUUID().slice(0, 6),
    name: 'Test Store',
    address: '1 Main St',
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M5V 3L9',
    lat: 43.6426,
    lng: -79.3871,
    ...overrides,
  };
}

let dealCounter = 0;

export function makeDeal(overrides: Partial<DealInput> = {}): DealInput {
  dealCounter += 1;
  const id = overrides.id ?? randomUUID();
  const slug = overrides.slug ?? `deal-${dealCounter}-${id.slice(0, 6)}`;
  return {
    id,
    source: 'test',
    sourceId: overrides.sourceId ?? `src-${dealCounter}`,
    slug,
    url: `https://example.ca/p/${slug}`,
    canonicalUrl: `https://example.ca/p/${slug}`,
    title: `Test deal ${dealCounter}`,
    description: 'A test deal',
    imageUrl: null,
    merchantId: null,
    storeId: null,
    category: 'electronics',
    department: 'na',
    brand: null,
    keywords: null,
    sizesAvailable: null,
    productKey: null,
    productKeyStrength: null,
    gtin: null,
    mpn: null,
    asin: null,
    priceNow: 1999,
    priceWas: 3999,
    currency: 'CAD',
    discountPct: 50,
    discountAbs: 2000,
    marketPrice: null,
    marketDiscountPct: null,
    observedLow: null,
    priceRankPct: null,
    verdict: 'unverified',
    evidence: 'none',
    claimSuspect: false,
    qualityNote: null,
    couponCode: null,
    couponNote: null,
    shippingNote: null,
    inStock: true,
    stockNote: null,
    postedAt: new Date().toISOString(),
    expiresAt: null,
    votes: 0,
    heat: 50,
    status: 'active',
    locale: 'en-CA',
    alsoSeenOn: null,
    sourcePath: null,
    ...overrides,
  };
}
