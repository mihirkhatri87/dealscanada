import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildStocktrackAdapter,
  parseClearancePage,
  type StocktrackStore,
} from '@/lib/sources/stocktrack';
import type { AdapterContext } from '@/lib/sources/types';

const html = readFileSync(join(process.cwd(), 'tests/fixtures/stocktrack/clearance.html'), 'utf8');

const stores: StocktrackStore[] = [
  { id: 'store-ct-yonge', chain: 'canadian-tire', name: 'Canadian Tire — Yonge' },
  { id: 'store-ct-leaside', chain: 'canadian-tire', name: 'Canadian Tire — Leaside' },
  { id: 'store-sc-eaton', chain: 'sportchek', name: 'SportChek — Eaton Centre' },
  { id: 'store-wm-dufferin', chain: 'walmart', name: 'Walmart — Dufferin' },
  { id: 'store-ct-vaughan', chain: 'canadian-tire', name: 'Canadian Tire — Vaughan' },
  { id: 'store-extra-1', chain: 'walmart', name: 'Walmart — Extra 1' },
  { id: 'store-extra-2', chain: 'walmart', name: 'Walmart — Extra 2' },
];

function context(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    http: { fetchText: vi.fn(), fetchJson: vi.fn() } as unknown as AdapterContext['http'],
    log: () => {},
    ...overrides,
  };
}

describe('parseClearancePage', () => {
  const items = parseClearancePage(html);

  it('extracts clearance rows with both prices', () => {
    // Five rows: one has no title (a spacer) and is skipped.
    expect(items).toHaveLength(4);

    const drill = items.find((item) => item.title.includes('Drill'));
    expect(drill?.clearancePrice).toBe('$49.99');
    expect(drill?.regularPrice).toBe('$129.99');
    expect(drill?.aisle).toBe('42');
  });

  it('skips rows with no product name', () => {
    expect(items.every((item) => item.title.length >= 3)).toBe(true);
  });

  it('keeps a row whose prices are missing rather than guessing them', () => {
    const empty = items.find((item) => item.title.includes('No prices'));
    expect(empty).toBeDefined();
    expect(empty?.clearancePrice).toBeNull();
  });

  it('returns an empty array on unrecognisable markup', () => {
    expect(parseClearancePage('<html><body>nothing</body></html>')).toEqual([]);
    expect(parseClearancePage('')).toEqual([]);
  });
});

describe('stocktrack adapter', () => {
  it('is skipped, not failed, when no stores are selected', () => {
    expect(buildStocktrackAdapter([]).enabled()).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('no stores selected'),
    });
  });

  it('scrapes only the stores the user selected', async () => {
    const fetchText = vi.fn().mockResolvedValue({ data: html });
    await buildStocktrackAdapter(stores).fetch(
      context({
        http: { fetchText } as unknown as AdapterContext['http'],
        storeIds: ['store-ct-yonge'],
      }),
    );

    // Exactly one page, for the one store chosen — never a chain-wide crawl.
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(fetchText.mock.calls[0]?.[0]).toContain('store-ct-yonge');
  });

  it('caps the number of stores per run', async () => {
    const fetchText = vi.fn().mockResolvedValue({ data: html });
    await buildStocktrackAdapter(stores).fetch(
      context({ http: { fetchText } as unknown as AdapterContext['http'] }),
    );

    // Seven stores available, but the configured cap is five.
    expect(fetchText.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('requests long-lived caching, the politeness lever that matters most', async () => {
    const fetchText = vi.fn().mockResolvedValue({ data: html });
    await buildStocktrackAdapter(stores).fetch(
      context({
        http: { fetchText } as unknown as AdapterContext['http'],
        storeIds: ['store-ct-yonge'],
      }),
    );

    expect(fetchText.mock.calls[0]?.[1]?.cacheTtlMinutes).toBeGreaterThanOrEqual(60);
  });

  it('tags every deal with its store so it can be shown by distance', async () => {
    const fetchText = vi.fn().mockResolvedValue({ data: html });
    const result = await buildStocktrackAdapter(stores).fetch(
      context({
        http: { fetchText } as unknown as AdapterContext['http'],
        storeIds: ['store-ct-yonge'],
      }),
    );

    expect(result.deals.length).toBeGreaterThan(0);
    expect(result.deals.every((deal) => deal.storeId === 'store-ct-yonge')).toBe(true);
    expect(result.deals[0]?.merchantDomain).toBe('canadiantire.ca');
  });

  it('records stock and aisle, which is why in-store data is useful at all', async () => {
    const fetchText = vi.fn().mockResolvedValue({ data: html });
    const result = await buildStocktrackAdapter(stores).fetch(
      context({
        http: { fetchText } as unknown as AdapterContext['http'],
        storeIds: ['store-ct-yonge'],
      }),
    );

    const drill = result.deals.find((deal) => deal.title.includes('Drill'));
    expect(drill?.stockNote).toContain('3 in stock');
    expect(drill?.stockNote).toContain('Aisle 42');

    const soldOut = result.deals.find((deal) => deal.title.includes('NordicTrack'));
    expect(soldOut?.inStock).toBe(false);
  });

  it('distinguishes an unreachable site from a drifted one', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    const unreachable = await buildStocktrackAdapter(stores).fetch(
      context({
        http: { fetchText: failing } as unknown as AdapterContext['http'],
        storeIds: ['store-ct-yonge'],
      }),
    );
    expect(unreachable.reason).toContain('failed to load');

    const empty = vi.fn().mockResolvedValue({ data: '<html><body>redesigned</body></html>' });
    const drifted = await buildStocktrackAdapter(stores).fetch(
      context({
        http: { fetchText: empty } as unknown as AdapterContext['http'],
        storeIds: ['store-ct-yonge'],
      }),
    );
    expect(drifted.reason).toContain('selectors may have drifted');
  });

  it('never throws when the site is entirely unavailable', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      buildStocktrackAdapter(stores).fetch(
        context({ http: { fetchText: failing } as unknown as AdapterContext['http'] }),
      ),
    ).resolves.toMatchObject({ deals: [] });
  });
});
