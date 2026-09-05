'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DealQuery, DealWithRelations } from '@/lib/db/types';
import { toSearchParams } from '@/lib/query-params';
import { DealGrid } from './DealGrid';
import { DealCard } from './DealCard';
import { VerdictBadge } from './VerdictBadge';
import { formatCents } from '@/lib/format';

/**
 * The assistant view: conversation rail plus a live results canvas.
 *
 * The canvas renders the same DealCard the front page does. That is deliberate —
 * an assistant with its own card component is how its output drifts away from
 * what browsing shows.
 *
 * The handoff runs both ways. "Take over" hands the assistant's current query to
 * the normal FilterBar; the query it emits is the same object the URL encodes,
 * so neither direction needs translation.
 */

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  activities?: string[];
}

const STARTERS = [
  'Warm winter coat for my 7-year-old, under $80',
  'Best verified laptop deal right now',
  'Anything with a coupon code under $50',
  'Show me deals that are actually the lowest price recorded',
];

export function AssistantView({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [deals, setDeals] = useState<DealWithRelations[]>([]);
  const [query, setQuery] = useState<DealQuery | null>(null);
  const [view, setView] = useState<'grid' | 'comparison' | 'single'>('grid');

  const abortRef = useRef<AbortController | null>(null);
  const conversationId = useRef(
    `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    railRef.current?.scrollTo({ top: railRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed === '' || streaming) return;

      setError(null);
      setInput('');

      const history: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
      setMessages([...history, { role: 'assistant', content: '', activities: [] }]);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch('/api/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            conversationId: conversationId.current,
            messages: history.map(({ role, content }) => ({ role, content })),
          }),
        });

        if (!response.ok || !response.body) {
          const detail = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(detail?.message ?? 'The assistant is unavailable right now.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            let event: {
              type: string;
              text?: string;
              activity?: string;
              patch?: { deals?: DealWithRelations[]; query?: DealQuery; view?: string };
              message?: string;
            };
            try {
              event = JSON.parse(line.slice(6));
            } catch {
              continue;
            }

            if (event.type === 'text' && event.text) {
              setMessages((current) => {
                const next = [...current];
                const last = next[next.length - 1];
                if (last?.role === 'assistant') {
                  next[next.length - 1] = { ...last, content: last.content + event.text };
                }
                return next;
              });
            }

            if (event.type === 'activity' && event.activity) {
              setMessages((current) => {
                const next = [...current];
                const last = next[next.length - 1];
                if (last?.role === 'assistant') {
                  next[next.length - 1] = {
                    ...last,
                    activities: [...(last.activities ?? []), event.activity as string],
                  };
                }
                return next;
              });
            }

            // The canvas follows the conversation: a tool call and the render it
            // causes arrive as one event.
            if (event.type === 'patch' && event.patch) {
              if (event.patch.deals) setDeals(event.patch.deals);
              if (event.patch.query) setQuery(event.patch.query);
              if (event.patch.view) setView(event.patch.view as typeof view);
            }

            if (event.type === 'error' && event.message) setError(event.message);
          }
        }
      } catch (caught) {
        if (caught instanceof Error && caught.name !== 'AbortError') setError(caught.message);
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, streaming],
  );

  function takeOver() {
    // Hand the assistant's query to normal browsing. Because it is the same
    // object the URL encodes, this is a redirect rather than a translation.
    const params = query ? toSearchParams(query) : new URLSearchParams();
    router.push(`/?${params.toString()}`);
  }

  if (!enabled) {
    return (
      <div className="rounded border border-dashed border-border bg-bg-raised p-6">
        <h2 className="text-base font-semibold">The assistant is not configured</h2>
        <p className="mt-2 max-w-prose text-sm text-fg-muted">
          Set <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> to enable it. Everything
          else on the site — browsing, filters, verification — works without it.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <section className="flex min-h-[26rem] max-h-[calc(100vh-9rem)] flex-col gap-3 rounded border border-border bg-bg-raised p-3 lg:min-h-[32rem]">
        <div ref={railRef} className="flex-1 space-y-3 overflow-y-auto">
          {messages.length === 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-fg-muted">
                Describe what you&rsquo;re after and I&rsquo;ll narrow it down. I can only show
                deals that are actually in the database — I don&rsquo;t make them up.
              </p>
              <div className="flex flex-col gap-1.5">
                {STARTERS.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => void send(starter)}
                    className="rounded-sm border border-border px-2.5 py-1.5 text-left text-xs text-fg-muted transition-colors hover:border-accent hover:text-accent"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <div key={index} className="flex flex-col gap-1.5">
              {message.role === 'user' ? (
                <p className="ml-auto max-w-[85%] rounded-lg bg-accent px-3 py-1.5 text-sm text-accent-fg">
                  {message.content}
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {/* Tool calls surface as readable activity, never raw JSON. */}
                  {message.activities?.map((activity, activityIndex) => (
                    <p
                      key={activityIndex}
                      className="flex items-center gap-1.5 text-xs text-fg-subtle"
                    >
                      <span aria-hidden="true">→</span>
                      {activity}
                    </p>
                  ))}
                  {message.content && (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {message.content}
                      {streaming && index === messages.length - 1 && (
                        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-fg align-middle" />
                      )}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}

          {error && (
            <p role="status" className="rounded-sm bg-warn-subtle px-2 py-1.5 text-xs text-warn">
              {error}
            </p>
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
          className="flex gap-2"
        >
          <label htmlFor="assistant-input" className="sr-only">
            Ask the assistant
          </label>
          <input
            id="assistant-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="What are you looking for?"
            disabled={streaming}
            className="min-w-0 flex-1 rounded border border-border bg-bg px-3 py-1.5 text-sm placeholder:text-fg-subtle focus:border-accent focus:outline-none disabled:opacity-60"
          />
          {streaming ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-hot hover:text-hot"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={input.trim() === ''}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              Ask
            </button>
          )}
        </form>

        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setDeals([]);
              setQuery(null);
              setError(null);
            }}
            className="text-xs text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
          >
            Start over
          </button>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {deals.length > 0
              ? `${deals.length} ${deals.length === 1 ? 'deal' : 'deals'}`
              : 'Results'}
          </h2>
          {deals.length > 0 && (
            <button
              type="button"
              onClick={takeOver}
              className="rounded-sm border border-border px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-accent hover:text-accent"
              title="Continue with these filters in normal browsing"
            >
              Take over these filters →
            </button>
          )}
        </div>

        {deals.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded border border-dashed border-border bg-bg-raised px-6 py-16 text-center">
            <p className="text-sm text-fg-muted">
              Results appear here as the assistant searches.
            </p>
            <p className="max-w-sm text-xs text-fg-subtle">
              These are the same deal cards you get by browsing — the assistant filters the same
              database, it does not have a separate one.
            </p>
          </div>
        ) : view === 'comparison' ? (
          <ComparisonTable deals={deals} />
        ) : view === 'single' && deals[0] ? (
          <div className="max-w-sm">
            <DealCard deal={deals[0]} />
          </div>
        ) : (
          <DealGrid deals={deals} />
        )}
      </section>
    </div>
  );
}

function ComparisonTable({ deals }: { deals: DealWithRelations[] }) {
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">Side-by-side comparison of the selected deals</caption>
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-fg-subtle">
            <th scope="col" className="px-3 py-2 font-medium">
              Deal
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Store
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Price
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Verdict
            </th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id} className="border-t border-border">
              <td className="px-3 py-2">
                <a href={`/deal/${deal.slug}`} className="font-medium hover:text-accent">
                  {deal.title}
                </a>
              </td>
              <td className="px-3 py-2 text-fg-muted">{deal.merchant?.name ?? '—'}</td>
              <td className="px-3 py-2 font-mono tabular-nums">
                {formatCents(deal.priceNow, deal.currency)}
              </td>
              <td className="px-3 py-2">
                <VerdictBadge verdict={deal.verdict} evidence={deal.evidence} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
