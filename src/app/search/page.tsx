import { ListingPage } from '@/components/ListingPage';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : '';
  return { title: q ? `“${q}” deals` : 'Search' };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim() : '';

  return (
    <ListingPage
      title={q ? `Results for “${q}”` : 'Search deals'}
      base={{}}
      params={params}
      emptyTitle={q ? `Nothing matches “${q}”` : 'Search for something'}
      emptyMessage={
        q
          ? 'Try a shorter phrase, a brand name, or a store name. Search covers titles, descriptions, brands and stores.'
          : 'Enter a product, brand or store in the search box above.'
      }
    />
  );
}
