import { describe, expect, it } from 'vitest';

// Meta-test: proves the guard in tests/setup.ts actually fires. If this ever passes
// silently, the guard is broken and adapter tests could be hitting the live web.
describe('network guard', () => {
  it('blocks outbound fetch to an external host', async () => {
    await expect(fetch('https://www.bestbuy.ca/api/v2/json/search')).rejects.toThrow(
      /Network access blocked in tests/,
    );
  });

  it('names the offending URL so the failure is actionable', async () => {
    await expect(fetch('https://forums.redflagdeals.com/api/topics')).rejects.toThrow(
      /forums\.redflagdeals\.com/,
    );
  });
});
