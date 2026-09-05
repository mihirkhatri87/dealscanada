import type { AssistantEvent } from '../engine';
import type { EvalCase } from './golden';

/**
 * Scoring for the golden set.
 *
 * Kept free of both the network and the SDK so it is unit-testable: the runner
 * produces an event stream, this decides what that stream was worth. Every
 * judgement here is mechanical — no model grades another model's output, because
 * a grader that can be wrong turns a regression into an argument.
 */

/** Per-MTok list prices, in cents, as of early 2026. Verify before quoting. */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  'claude-sonnet-5': { input: 200, output: 1000, cacheRead: 20, cacheWrite: 250 },
  'claude-opus-5': { input: 500, output: 2500, cacheRead: 50, cacheWrite: 625 },
  'claude-haiku-4-5-20251001': { input: 100, output: 500, cacheRead: 10, cacheWrite: 125 },
};

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  toolCalls: number;
}

/**
 * Cost of one turn in cents.
 *
 * An unknown model costs `null` rather than zero: reporting a confident $0.00 for
 * a model we have no price for is worse than reporting that we do not know.
 */
export function costCents(model: string, usage: TurnUsage): number | null {
  const price = MODEL_PRICING[model];
  if (!price) return null;

  const perToken = (rate: number, tokens: number) => (rate * tokens) / 1_000_000;

  return (
    perToken(price.input, usage.inputTokens) +
    perToken(price.output, usage.outputTokens) +
    perToken(price.cacheRead, usage.cacheReadTokens) +
    perToken(price.cacheWrite, usage.cacheCreationTokens)
  );
}

/**
 * The deals the assistant put in front of the user, in the order it showed them.
 *
 * Ranking is the order of first appearance across patches: what the user sees
 * first is what the assistant is recommending, regardless of how many later
 * searches also happened to contain it.
 */
export function surfacedDealIds(events: AssistantEvent[]): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    if (event.type !== 'patch') continue;
    for (const deal of event.patch?.deals ?? []) {
      if (seen.has(deal.id)) continue;
      seen.add(deal.id);
      ordered.push(deal.id);
    }
  }

  return ordered;
}

export function assistantText(events: AssistantEvent[]): string {
  return events
    .filter((event) => event.type === 'text')
    .map((event) => event.text ?? '')
    .join('');
}

/**
 * Did the assistant ask rather than guess?
 *
 * A heuristic, and worth being honest about its edge: a reply that both searches
 * and ends in a question counts as clarifying. That is the lenient reading. The
 * report therefore prints the surfaced count alongside, so a human can see
 * whether a "clarified" case also quietly committed to an answer.
 */
export function askedClarifyingQuestion(text: string): boolean {
  return /\?\s*$|\?["'”)]?\s*$|\?\s+\S/.test(text.trim());
}

export interface CaseResult {
  caseId: string;
  kind: EvalCase['kind'];
  split: EvalCase['split'];
  passed: boolean;
  /** Rank (1-based) of the first acceptable deal, or null if none was surfaced. */
  hitRank: number | null;
  surfacedCount: number;
  /** Flagged-anchor deals the assistant surfaced despite the label forbidding it. */
  violations: string[];
  clarified: boolean;
  costCents: number | null;
  toolCalls: number;
  error?: string;
}

export interface ScoreInput {
  evalCase: EvalCase;
  events: AssistantEvent[];
  /** Seed `sourceId` → the deal id it was given on this seeding. */
  idBySourceId: Map<string, string>;
  model: string;
  topN?: number;
}

export function scoreCase(input: ScoreInput): CaseResult {
  const { evalCase, events, idBySourceId, model } = input;
  const topN = input.topN ?? 6;

  const surfaced = surfacedDealIds(events);
  const top = surfaced.slice(0, topN);
  const text = assistantText(events);

  const acceptableIds = new Set(
    evalCase.acceptable.map((sourceId) => idBySourceId.get(sourceId)).filter(Boolean) as string[],
  );
  const forbiddenIds = new Set(
    (evalCase.mustNotRecommend ?? [])
      .map((sourceId) => idBySourceId.get(sourceId))
      .filter(Boolean) as string[],
  );

  const hitIndex = top.findIndex((id) => acceptableIds.has(id));
  const violations = top.filter((id) => forbiddenIds.has(id));
  const clarified = askedClarifyingQuestion(text);

  const done = events.find((event) => event.type === 'done');
  const usage = done?.usage ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    toolCalls: 0,
  };

  const errorEvent = events.find((event) => event.type === 'error' && (event.message ?? '') !== '');

  // A forbidden deal in the top N fails the case outright, even when an
  // acceptable one is also present. Leading with an inflated anchor is the
  // failure this site exists to prevent; finding a good deal alongside it does
  // not cancel that out.
  const passed =
    violations.length === 0 && (evalCase.kind === 'clarify' ? clarified : hitIndex >= 0);

  return {
    caseId: evalCase.id,
    kind: evalCase.kind,
    split: evalCase.split,
    passed,
    hitRank: hitIndex >= 0 ? hitIndex + 1 : null,
    surfacedCount: surfaced.length,
    violations,
    clarified,
    costCents: costCents(model, usage),
    toolCalls: usage.toolCalls,
    ...(errorEvent?.message ? { error: errorEvent.message } : {}),
  };
}

export interface ModelReport {
  model: string;
  cases: CaseResult[];
  recall: number;
  recallTest: number;
  clarifyRate: number;
  violations: number;
  meanCostCents: number | null;
  totalCostCents: number | null;
  meanToolCalls: number;
}

export function summarize(model: string, cases: CaseResult[]): ModelReport {
  const finds = cases.filter((result) => result.kind === 'find');
  const clarifies = cases.filter((result) => result.kind === 'clarify');
  const findsTest = finds.filter((result) => result.split === 'test');
  const priced = cases
    .map((result) => result.costCents)
    .filter((cost): cost is number => cost !== null);

  const rate = (subset: CaseResult[]) =>
    subset.length === 0 ? 0 : subset.filter((result) => result.passed).length / subset.length;

  const totalCost =
    priced.length === cases.length && priced.length > 0
      ? priced.reduce((sum, cost) => sum + cost, 0)
      : null;

  return {
    model,
    cases,
    recall: rate(finds),
    recallTest: rate(findsTest),
    clarifyRate: rate(clarifies),
    violations: cases.reduce((sum, result) => sum + result.violations.length, 0),
    meanCostCents: totalCost === null ? null : totalCost / cases.length,
    totalCostCents: totalCost,
    meanToolCalls:
      cases.length === 0
        ? 0
        : cases.reduce((sum, result) => sum + result.toolCalls, 0) / cases.length,
  };
}

/** The floors from the PRD (M12, S9.7). Falling below one fails the run. */
export const RECALL_FLOOR = 0.85;
export const CLARIFY_FLOOR = 0.8;
