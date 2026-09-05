import type Anthropic from '@anthropic-ai/sdk';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { getRepository } from '@/lib/db';
import { env, flags } from '@/lib/config';
import { runAssistant } from '@/lib/assistant/engine';
import { LOCATION_COOKIE, decodeLocation } from '@/lib/location';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const requestSchema = z.object({
  conversationId: z.string().min(1).max(100),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
});

/**
 * POST /api/assistant — Server-Sent Events.
 *
 * The API key lives only here. Tool execution and UI patches travel on the same
 * stream, because the assistant drives the results canvas: a tool call and the
 * render it causes are one event, not two systems kept in sync.
 */
export async function POST(request: Request) {
  if (!flags.assistantEnabled) {
    return Response.json(
      {
        error: 'assistant_disabled',
        message: 'The assistant is not configured. Set ANTHROPIC_API_KEY to enable it.',
      },
      { status: 503 },
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Bad request' },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const location = decodeLocation(cookieStore.get(LOCATION_COOKIE)?.value);
  const repo = await getRepository();

  const messages: Anthropic.MessageParam[] = parsed.data.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  const encoder = new TextEncoder();
  const seenDealIds = new Set<string>();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        for await (const event of runAssistant({
          messages,
          toolContext: {
            repo,
            seenDealIds,
            location: location
              ? { lat: location.lat, lng: location.lng, label: location.label }
              : null,
          },
          signal: request.signal,
        })) {
          send(event);

          if (event.type === 'done' && event.usage) {
            // Recording real usage is what turns the cost estimates in the PRD
            // into measurements. `npm run assistant:usage` reads this.
            await repo.recordAssistantUsage({
              conversationId: parsed.data.conversationId,
              model: env.ASSISTANT_MODEL,
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
              cacheReadTokens: event.usage.cacheReadTokens,
              cacheCreationTokens: event.usage.cacheCreationTokens,
              toolCalls: event.usage.toolCalls,
            });
          }
        }
      } catch (error) {
        send({
          type: 'error',
          message:
            error instanceof Error && error.name === 'AbortError'
              ? ''
              : 'The assistant stopped unexpectedly. Browsing and filters still work.',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
