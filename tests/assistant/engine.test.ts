import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAssistant, SYSTEM_PROMPT } from '@/lib/assistant/engine';
import { makeDeal, makeMerchant, tempSqliteRepo } from '../db/helpers';
import type { DealRepository } from '@/lib/db/repository';
import type { AssistantEvent } from '@/lib/assistant/engine';

/**
 * Engine tests run against a scripted client rather than the live API: they must
 * be deterministic, free, and runnable with no key — the network guard would
 * reject a real call anyway.
 */

let repo: DealRepository;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  const ctx = tempSqliteRepo();
  repo = ctx.repo;
  cleanup = ctx.cleanup;
  await repo.migrate();
  await repo.upsertMerchants([
    makeMerchant({ id: 'm-bb', slug: 'best-buy', domain: 'bestbuy.ca', name: 'Best Buy' }),
  ]);
  await repo.upsertDeals([
    makeDeal({ sourceId: 'x', slug: 'tv', title: 'Samsung TV', merchantId: 'm-bb' }),
  ]);
});

afterEach(async () => {
  await cleanup();
});

/** Builds a client that replays a scripted sequence of assistant messages. */
function scriptedClient(script: Array<Record<string, unknown>>) {
  let call = 0;
  return {
    messages: {
      stream: () => {
        const message = script[Math.min(call, script.length - 1)];
        call += 1;
        return {
          on: (event: string, handler: (delta: string) => void) => {
            if (event === 'text') {
              const text = (message?.['content'] as Array<{ type: string; text?: string }>)
                ?.filter((block) => block.type === 'text')
                .map((block) => block.text ?? '')
                .join('');
              if (text) setTimeout(() => handler(text), 0);
            }
          },
          finalMessage: async () => message,
        };
      },
    },
  } as never;
}

function baseUsage() {
  return {
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 400,
    cache_creation_input_tokens: 0,
  };
}

async function collect(generator: AsyncGenerator<AssistantEvent>): Promise<AssistantEvent[]> {
  const events: AssistantEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

describe('runAssistant', () => {
  it('streams text and finishes', async () => {
    const client = scriptedClient([
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Here are two options.' }],
        usage: baseUsage(),
      },
    ]);

    const events = await collect(
      runAssistant({
        messages: [{ role: 'user', content: 'hi' }],
        toolContext: { repo, seenDealIds: new Set() },
        client,
      }),
    );

    expect(events.some((event) => event.type === 'text')).toBe(true);
    expect(events[events.length - 1]?.type).toBe('done');
  });

  it('executes a tool call and emits both activity and a UI patch', async () => {
    const client = scriptedClient([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 't1', name: 'search_deals', input: {} }],
        usage: baseUsage(),
      },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Found one.' }],
        usage: baseUsage(),
      },
    ]);

    const events = await collect(
      runAssistant({
        messages: [{ role: 'user', content: 'show me tvs' }],
        toolContext: { repo, seenDealIds: new Set() },
        client,
      }),
    );

    const activity = events.find((event) => event.type === 'activity');
    const patch = events.find((event) => event.type === 'patch');

    expect(activity?.activity).toContain('Searched deals');
    expect(patch?.patch?.deals?.length).toBeGreaterThan(0);
    // Tool execution and the render it causes arrive on one stream.
    expect(events.indexOf(activity!)).toBeLessThan(events.indexOf(patch!) + 1);
  });

  it('accumulates usage including cache reads, so spend can be measured', async () => {
    const client = scriptedClient([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: baseUsage() },
    ]);

    const events = await collect(
      runAssistant({
        messages: [{ role: 'user', content: 'hi' }],
        toolContext: { repo, seenDealIds: new Set() },
        client,
      }),
    );

    const done = events.find((event) => event.type === 'done');
    expect(done?.usage?.inputTokens).toBe(100);
    expect(done?.usage?.cacheReadTokens).toBe(400);
  });

  it('stops at the tool-call budget rather than spending without bound', async () => {
    // A model that only ever calls tools would loop forever without this.
    const client = scriptedClient([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 't1', name: 'search_deals', input: {} }],
        usage: baseUsage(),
      },
    ]);

    const events = await collect(
      runAssistant({
        messages: [{ role: 'user', content: 'loop' }],
        toolContext: { repo, seenDealIds: new Set() },
        client,
        maxToolCalls: 2,
      }),
    );

    const activities = events.filter((event) => event.type === 'activity');
    expect(activities.length).toBe(2);
    expect(events[events.length - 1]?.type).toBe('done');

    // Ending silently would look like the assistant simply stopped answering.
    const text = events
      .filter((event) => event.type === 'text')
      .map((event) => event.text)
      .join('');
    expect(text).toContain('search limit');
  });

  it('reports a refusal as a message rather than throwing', async () => {
    const client = scriptedClient([{ stop_reason: 'refusal', content: [], usage: baseUsage() }]);

    const events = await collect(
      runAssistant({
        messages: [{ role: 'user', content: 'something disallowed' }],
        toolContext: { repo, seenDealIds: new Set() },
        client,
      }),
    );

    const error = events.find((event) => event.type === 'error');
    expect(error?.message).toContain('can’t help');
  });

  it('degrades with a usable message when the API errors', async () => {
    const client = {
      messages: {
        stream: () => {
          throw new Error('boom');
        },
      },
    } as never;

    const events = await collect(
      runAssistant({
        messages: [{ role: 'user', content: 'hi' }],
        toolContext: { repo, seenDealIds: new Set() },
        client,
      }),
    );

    const error = events.find((event) => event.type === 'error');
    // Says what still works, rather than leaving the user stranded.
    expect(error?.message).toContain('filters above still work');
  });

  it('stops immediately when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const events = await collect(
      runAssistant({
        messages: [{ role: 'user', content: 'hi' }],
        toolContext: { repo, seenDealIds: new Set() },
        client: scriptedClient([{ stop_reason: 'end_turn', content: [], usage: baseUsage() }]),
        signal: controller.signal,
      }),
    );

    expect(events).toEqual([expect.objectContaining({ type: 'done' })]);
  });
});

describe('system prompt', () => {
  it('names every verdict, so the model can explain them accurately', () => {
    for (const verdict of [
      'verified-low',
      'verified-good',
      'market-price',
      'above-market',
      'inflated-anchor',
      'unverified',
    ]) {
      expect(SYSTEM_PROMPT).toContain(verdict);
    }
  });

  it('instructs the model to check facets before filtering by a name', () => {
    expect(SYSTEM_PROMPT).toContain('list_facets');
  });
});
