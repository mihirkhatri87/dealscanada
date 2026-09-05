import { notFound } from 'next/navigation';
import { DEPARTMENTS, type Department } from '@/lib/db/types';
import { departmentLabel } from '@/lib/format';
import { ListingPage } from '@/components/ListingPage';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ department: string }> }) {
  const { department } = await params;
  return { title: `${departmentLabel(department)} deals` };
}

export default async function DepartmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ department: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { department } = await params;
  if (!(DEPARTMENTS as readonly string[]).includes(department) || department === 'na') notFound();

  return (
    <ListingPage
      title={`${departmentLabel(department)}’s deals`}
      base={{ departments: [department as Department] }}
      params={await searchParams}
    />
  );
}
