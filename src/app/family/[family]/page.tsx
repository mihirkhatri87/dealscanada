import { familyLabel } from '@/lib/format';
import { ListingPage } from '@/components/ListingPage';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ family: string }> }) {
  const { family } = await params;
  return { title: `${familyLabel(family)} deals` };
}

/**
 * Brand-family pages exist because these retailers run shared promotions. A
 * Canadian Tire sale usually means a SportChek and Mark's sale too, and seeing
 * them together is how a shopper actually experiences that.
 */
export default async function FamilyPage({
  params,
  searchParams,
}: {
  params: Promise<{ family: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { family } = await params;

  return (
    <ListingPage
      title={`${familyLabel(family)} deals`}
      subtitle="Every banner in this group, together — they usually run promotions in step."
      base={{ families: [family] }}
      params={await searchParams}
      emptyTitle={`No ${familyLabel(family)} deals right now`}
      emptyMessage="None of the banners in this group have active deals at the moment."
    />
  );
}
