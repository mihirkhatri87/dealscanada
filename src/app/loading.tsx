import { DealGridSkeleton } from '@/components/DealGrid';

export default function Loading() {
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6">
      <div className="h-6 w-40 animate-pulse rounded bg-bg-inset" />
      <div className="h-32 animate-pulse rounded border border-border bg-bg-raised" />
      <DealGridSkeleton />
    </main>
  );
}
