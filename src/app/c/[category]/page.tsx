import { notFound } from 'next/navigation';
import { CATEGORIES, type Category } from '@/lib/db/types';
import { categoryLabel } from '@/lib/format';
import { ListingPage } from '@/components/ListingPage';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  return { title: `${categoryLabel(category)} deals` };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { category } = await params;
  // An unknown category is a 404, not an empty grid pretending to be a real page.
  if (!(CATEGORIES as readonly string[]).includes(category)) notFound();

  return (
    <ListingPage
      title={`${categoryLabel(category)} deals`}
      base={{ categories: [category as Category] }}
      params={await searchParams}
      emptyTitle={`No ${categoryLabel(category).toLowerCase()} deals right now`}
      emptyMessage="This category is empty at the moment. Try another, or widen your filters."
    />
  );
}
