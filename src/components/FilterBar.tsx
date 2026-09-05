'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { CATEGORIES, DEPARTMENTS, type DealSort } from '@/lib/db/types';
import { categoryLabel, departmentLabel } from '@/lib/format';
import type { FacetValue } from '@/lib/db/types';

/**
 * Filters and sort.
 *
 * All state lives in the URL query string, so a filtered view is shareable, the
 * back button behaves, and — importantly for the shopping assistant — the exact
 * same filter object can be handed between the assistant and normal browsing in
 * either direction.
 */

const SORTS: Array<{ value: DealSort; label: string }> = [
  { value: 'hottest', label: 'Hottest' },
  { value: 'best-verified', label: 'Best verified' },
  { value: 'newest', label: 'Newest' },
  { value: 'biggest-drop', label: 'Biggest drop' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
];

export function FilterBar({ merchants }: { merchants: FacetValue[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    // A filter change always returns to the first page; staying on page 4 of a
    // narrower result set is how people end up staring at an empty grid.
    next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  }

  function toggleInList(key: string, value: string) {
    const current = (params.get(key) ?? '').split(',').filter(Boolean);
    const next = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value];
    update({ [key]: next.join(',') });
  }

  const activeCategories = (params.get('category') ?? '').split(',').filter(Boolean);
  const activeDepartments = (params.get('department') ?? '').split(',').filter(Boolean);
  const verifiedOnly = params.get('verified') === '1';
  const couponOnly = params.get('coupon') === '1';
  const inStockOnly = params.get('instock') === '1';
  const hideSuspect = params.get('hidesuspect') === '1';
  const minDiscount = params.get('mindiscount') ?? '';
  const sort = (params.get('sort') as DealSort) ?? 'hottest';

  const activeCount =
    activeCategories.length +
    activeDepartments.length +
    [verifiedOnly, couponOnly, inStockOnly, hideSuspect].filter(Boolean).length +
    (minDiscount ? 1 : 0) +
    (params.get('merchant') ? 1 : 0);

  return (
    <div className="flex flex-col gap-3 rounded border border-border bg-bg-raised p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Sort</span>
        <select
          value={sort}
          onChange={(event) => update({ sort: event.target.value })}
          className="rounded-sm border border-border bg-bg px-2 py-1 text-sm"
          aria-label="Sort deals"
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <span className="ml-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">
          Min discount
        </span>
        <select
          value={minDiscount}
          onChange={(event) => update({ mindiscount: event.target.value })}
          className="rounded-sm border border-border bg-bg px-2 py-1 text-sm"
          aria-label="Minimum discount"
        >
          <option value="">Any</option>
          <option value="25">25%+</option>
          <option value="40">40%+</option>
          <option value="50">50%+</option>
          <option value="70">70%+</option>
        </select>

        {merchants.length > 0 && (
          <>
            <span className="ml-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">
              Store
            </span>
            <select
              value={params.get('merchant') ?? ''}
              onChange={(event) => update({ merchant: event.target.value })}
              className="max-w-[12rem] rounded-sm border border-border bg-bg px-2 py-1 text-sm"
              aria-label="Filter by store"
            >
              <option value="">All stores</option>
              {merchants.map((merchant) => (
                <option key={merchant.value} value={merchant.value}>
                  {merchant.label} ({merchant.count})
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Toggle
          active={verifiedOnly}
          onClick={() => update({ verified: verifiedOnly ? null : '1' })}
          tone="deal"
        >
          Verified deals only
        </Toggle>
        <Toggle
          active={hideSuspect}
          onClick={() => update({ hidesuspect: hideSuspect ? null : '1' })}
          tone="hot"
        >
          Hide inflated claims
        </Toggle>
        <Toggle active={couponOnly} onClick={() => update({ coupon: couponOnly ? null : '1' })}>
          Has coupon code
        </Toggle>
        <Toggle active={inStockOnly} onClick={() => update({ instock: inStockOnly ? null : '1' })}>
          In stock
        </Toggle>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.filter((category) => category !== 'other').map((category) => (
          <Toggle
            key={category}
            active={activeCategories.includes(category)}
            onClick={() => toggleInList('category', category)}
          >
            {categoryLabel(category)}
          </Toggle>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">For</span>
        {DEPARTMENTS.filter((department) => department !== 'na' && department !== 'unisex').map(
          (department) => (
            <Toggle
              key={department}
              active={activeDepartments.includes(department)}
              onClick={() => toggleInList('department', department)}
            >
              {departmentLabel(department)}
            </Toggle>
          ),
        )}

        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => router.push(pathname)}
            className="ml-auto text-xs font-medium text-accent underline-offset-2 hover:underline"
          >
            Clear all ({activeCount})
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({
  active,
  onClick,
  children,
  tone = 'accent',
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: 'accent' | 'deal' | 'hot';
}) {
  const activeClasses = {
    accent: 'border-accent bg-accent-subtle text-accent',
    deal: 'border-deal bg-deal-subtle text-deal',
    hot: 'border-hot bg-hot-subtle text-hot',
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-sm border px-2 py-0.5 text-xs transition-colors ${
        active
          ? activeClasses
          : 'border-border text-fg-muted hover:border-border-strong hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}
