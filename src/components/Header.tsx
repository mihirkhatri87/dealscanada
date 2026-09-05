import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';
import { categoryLabel } from '@/lib/format';

const NAV_CATEGORIES = [
  'electronics',
  'computers',
  'gaming',
  'clothing',
  'toys-games',
  'baby-kids',
  'home',
  'kitchen',
];

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <Link href="/" className="text-base font-bold tracking-tight">
          Deals<span className="text-accent">Canada</span>
        </Link>

        <form action="/search" className="order-3 w-full sm:order-none sm:w-auto sm:flex-1">
          <label htmlFor="site-search" className="sr-only">
            Search deals
          </label>
          <input
            id="site-search"
            type="search"
            name="q"
            placeholder="Search deals, brands or stores"
            className="w-full rounded border border-border bg-bg-raised px-3 py-1.5 text-sm placeholder:text-fg-subtle focus:border-accent focus:outline-none"
          />
        </form>

        <nav className="flex items-center gap-2 text-sm" aria-label="Primary">
          <Link href="/coupons" className="text-fg-muted hover:text-fg">
            Coupons
          </Link>
          <Link href="/brands" className="text-fg-muted hover:text-fg">
            Stores
          </Link>
          <Link href="/near-me" className="text-fg-muted hover:text-fg">
            Near me
          </Link>
          <ThemeToggle />
        </nav>
      </div>

      <div className="mx-auto max-w-7xl overflow-x-auto px-4 pb-2">
        <nav className="flex gap-1.5 whitespace-nowrap" aria-label="Categories">
          {NAV_CATEGORIES.map((category) => (
            <Link
              key={category}
              href={`/c/${category}`}
              className="rounded-sm border border-border px-2 py-0.5 text-xs text-fg-muted transition-colors hover:border-accent hover:text-accent"
            >
              {categoryLabel(category)}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
