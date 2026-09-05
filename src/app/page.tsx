export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">DealsCanada</h1>
      <p className="mt-3 max-w-prose text-fg-muted">
        Canadian deal aggregator. The scaffold is in place — the deal grid, filters and
        shopping assistant arrive with epics E5, E6 and E9.
      </p>
      <div className="mt-8 flex flex-wrap gap-2">
        <span className="rounded-DEFAULT bg-deal-subtle px-3 py-1 text-sm font-medium text-deal">
          −47%
        </span>
        <span className="rounded-DEFAULT bg-hot-subtle px-3 py-1 text-sm font-medium text-hot">
          Hot
        </span>
        <span className="rounded-DEFAULT border border-border bg-bg-raised px-3 py-1 text-sm text-fg-muted">
          Coupon code
        </span>
      </div>
    </main>
  );
}
