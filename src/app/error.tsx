'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-xl flex-col items-start gap-3 px-4 py-16">
      <h1 className="text-xl font-bold">Something went wrong loading deals</h1>
      <p className="text-sm text-fg-muted">
        This is usually temporary. If it persists, the database may not be migrated yet — run{' '}
        <code className="rounded-sm bg-bg-inset px-1 py-0.5 font-mono text-xs">
          npm run db:migrate
        </code>{' '}
        and{' '}
        <code className="rounded-sm bg-bg-inset px-1 py-0.5 font-mono text-xs">npm run seed</code>.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90"
      >
        Try again
      </button>
    </main>
  );
}
