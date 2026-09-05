'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';

export function Pagination({
  page,
  total,
  pageSize,
}: {
  page: number;
  total: number;
  pageSize: number;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  if (lastPage <= 1) return null;

  const href = (target: number) => {
    const next = new URLSearchParams(params.toString());
    if (target <= 1) next.delete('page');
    else next.set('page', String(target));
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <nav className="flex items-center justify-between gap-3 pt-2" aria-label="Pagination">
      {page > 1 ? (
        <Link
          href={href(page - 1)}
          className="rounded-sm border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-accent hover:text-accent"
          rel="prev"
        >
          ← Previous
        </Link>
      ) : (
        <span />
      )}

      <span className="text-sm tabular-nums text-fg-muted">
        Page {page} of {lastPage}
      </span>

      {page < lastPage ? (
        <Link
          href={href(page + 1)}
          className="rounded-sm border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-accent hover:text-accent"
          rel="next"
        >
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
