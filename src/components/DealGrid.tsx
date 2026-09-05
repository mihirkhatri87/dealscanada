import type { DealWithRelations } from '@/lib/db/types';
import { DealCard, DealCardSkeleton } from './DealCard';

/**
 * The shared grid.
 *
 * Column counts are chosen so items fill the row at each breakpoint rather than
 * leaving one card stranded on a line of its own.
 */
export function DealGrid({ deals, now }: { deals: DealWithRelations[]; now?: Date }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {deals.map((deal) => (
        <DealCard key={deal.id} deal={deal} now={now} />
      ))}
    </div>
  );
}

export function DealGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <DealCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Distinct, actionable empty states — never a bare "no results". */
export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded border border-dashed border-border bg-bg-raised px-6 py-14 text-center">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="max-w-prose text-sm text-fg-muted">{message}</p>
      {action}
    </div>
  );
}
