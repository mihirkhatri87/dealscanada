import Link from 'next/link';
import type { Metadata } from 'next';

/**
 * Under `force-dynamic`, Next flushes the 200 status before a page component can
 * throw notFound(), so these render the correct not-found UI with a 200. The
 * status cannot be retracted mid-stream, but the harm that matters — search
 * engines indexing URLs for categories and deals that do not exist — is fixed
 * directly here.
 */
export const metadata: Metadata = {
  title: 'Not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-xl flex-col items-start gap-3 px-4 py-16">
      <h1 className="text-xl font-bold">Not found</h1>
      <p className="text-sm text-fg-muted">
        Deals expire and get pulled quickly — this one may simply be gone.
      </p>
      <Link href="/" className="text-sm font-medium text-accent hover:underline">
        Browse current deals
      </Link>
    </main>
  );
}
