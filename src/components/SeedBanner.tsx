/**
 * Site-wide sample-data notice.
 *
 * Shown whenever seeded rows are present. The seed set is deliberately realistic
 * so the interface can be reviewed offline, and that realism is exactly the risk:
 * a fabricated price that reads as a scraped one is the same deception this
 * product exists to expose. So it is labelled everywhere it appears.
 */
export function SeedBanner({ seedCount, total }: { seedCount: number; total: number }) {
  if (seedCount === 0) return null;

  const allSeed = seedCount === total;

  return (
    <p className="rounded border border-warn/40 bg-warn-subtle px-3 py-2 text-sm text-warn">
      <strong className="font-semibold">
        {allSeed ? 'Showing sample data.' : `${seedCount} of ${total} deals are sample data.`}
      </strong>{' '}
      These prices were generated to demonstrate the interface and are not real. Run{' '}
      <code className="font-mono text-xs">npm run scrape</code> to replace them with live deals.
    </p>
  );
}
