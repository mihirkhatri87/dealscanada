import { flags } from '@/lib/config';
import { AssistantView } from '@/components/AssistantView';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Shopping assistant',
  description: 'Describe what you want and narrow thousands of Canadian deals down to a few.',
};

export default function AssistantPage() {
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight">Shopping assistant</h1>
        <p className="max-w-prose text-sm text-fg-muted">
          Describe what you&rsquo;re after in plain language. The assistant filters the same
          database you browse, so anything it shows you is a real listing you can also find by hand
          — and it will tell you when a discount is only the retailer&rsquo;s claim.
        </p>
      </div>

      <AssistantView enabled={flags.assistantEnabled} />
    </main>
  );
}
