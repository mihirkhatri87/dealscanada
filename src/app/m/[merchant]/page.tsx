import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getRepository } from '@/lib/db';
import { familyLabel } from '@/lib/format';
import { ListingPage } from '@/components/ListingPage';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ merchant: string }> }) {
  const { merchant } = await params;
  const repo = await getRepository();
  const found = await repo.getMerchantBySlug(merchant);
  return { title: found ? `${found.name} deals` : 'Store not found' };
}

export default async function MerchantPage({
  params,
  searchParams,
}: {
  params: Promise<{ merchant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { merchant } = await params;
  const repo = await getRepository();
  const found = await repo.getMerchantBySlug(merchant);
  if (!found) notFound();

  return (
    <ListingPage
      title={`${found.name} deals`}
      subtitle={
        found.family ? (
          <>
            Part of the{' '}
            <Link href={`/family/${found.family}`} className="text-accent hover:underline">
              {familyLabel(found.family)}
            </Link>
          </>
        ) : undefined
      }
      base={{ merchantSlugs: [merchant] }}
      params={await searchParams}
      emptyTitle={`No ${found.name} deals right now`}
      emptyMessage={
        found.status === 'blocked'
          ? 'This retailer is currently unreachable for us, so its deals are not being collected.'
          : 'We have not found any active deals from this store yet.'
      }
    />
  );
}
