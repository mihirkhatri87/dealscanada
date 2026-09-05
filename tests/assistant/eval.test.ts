import { describe, expect, it } from 'vitest';
import { GOLDEN_SET } from '@/lib/assistant/eval/golden';
import {
  askedClarifyingQuestion,
  costCents,
  MODEL_PRICING,
  RECALL_FLOOR,
  CLARIFY_FLOOR,
  scoreCase,
  summarize,
  surfacedDealIds,
  type CaseResult,
} from '@/lib/assistant/eval/score';
import { buildSeedDeals, buildSeedStores } from '@/lib/seed/data';
import { merchantIdForDomain } from '@/lib/sources/merchants';
import type { AssistantEvent } from '@/lib/assistant/engine';
import type { DealWithRelations } from '@/lib/db/types';

/**
 * The eval itself cannot run here — it calls the real API. What can be tested,
 * and matters more, is that the labels are honest and the scoring is not.
 */

const SEED_SOURCE_IDS = new Set(
  buildSeedDeals(merchantIdForDomain, buildSeedStores()).deals.map((deal) => deal.sourceId),
);

describe('the golden set', () => {
  it('labels only deals that exist in the seed dataset', () => {
    // A label pointing at a deal that was renamed or removed silently scores as
    // a permanent miss, which looks like a model regression and is not one.
    for (const evalCase of GOLDEN_SET) {
      for (const sourceId of [...evalCase.acceptable, ...(evalCase.mustNotRecommend ?? [])]) {
        expect(SEED_SOURCE_IDS.has(sourceId), `${evalCase.id} references ${sourceId}`).toBe(true);
      }
    }
  });

  it('has unique case ids', () => {
    const ids = GOLDEN_SET.map((evalCase) => evalCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is large enough for a percentage to mean anything', () => {
    expect(GOLDEN_SET.length).toBeGreaterThanOrEqual(40);
  });

  it('splits into train and test, so a fix can be validated on unseen cases', () => {
    const test = GOLDEN_SET.filter((evalCase) => evalCase.split === 'test');
    const train = GOLDEN_SET.filter((evalCase) => evalCase.split === 'train');

    expect(test.length).toBeGreaterThanOrEqual(10);
    expect(train.length).toBeGreaterThanOrEqual(10);
    // Both kinds appear in both halves, or the test split cannot detect a
    // regression in the half it lacks.
    for (const half of [test, train]) {
      expect(half.some((evalCase) => evalCase.kind === 'find')).toBe(true);
      expect(half.some((evalCase) => evalCase.kind === 'clarify')).toBe(true);
    }
  });

  it('covers every request shape the PRD names', () => {
    const requests = GOLDEN_SET.map((evalCase) =>
      `${evalCase.request} ${evalCase.probes}`.toLowerCase(),
    );
    const covered = (pattern: RegExp) => requests.some((request) => pattern.test(request));

    expect(covered(/budget|under \$|no more than|cannot go over/), 'budget').toBe(true);
    expect(covered(/department|7-year-old|my son|baby|women|men/), 'department').toBe(true);
    expect(covered(/not from amazon|exclusion/), 'merchant exclusion').toBe(true);
    expect(covered(/50% off|discount/), 'discount depth').toBe(true);
    expect(covered(/coupon|promo code/), 'coupon').toBe(true);
    expect(covered(/near me|in-store|in store|clearance/), 'local').toBe(true);
    expect(
      GOLDEN_SET.some((evalCase) => evalCase.kind === 'clarify'),
      'vague',
    ).toBe(true);
  });

  it('gives every find case at least one acceptable answer, and clarify cases none', () => {
    for (const evalCase of GOLDEN_SET) {
      if (evalCase.kind === 'find') {
        expect(evalCase.acceptable.length, evalCase.id).toBeGreaterThan(0);
      } else {
        // A vague case with a "right answer" is not vague.
        expect(evalCase.acceptable, evalCase.id).toEqual([]);
      }
    }
  });

  it('guards the inflated-anchor cases explicitly', () => {
    const guarded = GOLDEN_SET.filter((evalCase) => (evalCase.mustNotRecommend ?? []).length > 0);
    expect(guarded.length).toBeGreaterThanOrEqual(3);
  });
});

function deal(id: string): DealWithRelations {
  return { id } as DealWithRelations;
}

function patch(...ids: string[]): AssistantEvent {
  return { type: 'patch', patch: { deals: ids.map(deal) } };
}

function done(overrides: Partial<NonNullable<AssistantEvent['usage']>> = {}): AssistantEvent {
  return {
    type: 'done',
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 4000,
      cacheCreationTokens: 0,
      toolCalls: 2,
      ...overrides,
    },
  };
}

const ids = new Map([
  ['seed-0', 'd0'],
  ['seed-3', 'd3'],
  ['seed-9', 'd9'],
]);

describe('surfaced ranking', () => {
  it('ranks by first appearance, because that is the order the user sees', () => {
    const events = [patch('a', 'b'), patch('b', 'c')];
    expect(surfacedDealIds(events)).toEqual(['a', 'b', 'c']);
  });

  it('ignores events that are not patches', () => {
    expect(surfacedDealIds([{ type: 'text', text: 'd1 d2' }, done()])).toEqual([]);
  });
});

describe('scoring a find case', () => {
  const findCase = {
    id: 'c',
    request: 'r',
    kind: 'find' as const,
    acceptable: ['seed-0'],
    probes: '',
    split: 'train' as const,
  };

  it('passes when an acceptable deal reaches the top six', () => {
    const result = scoreCase({
      evalCase: findCase,
      events: [patch('x', 'y', 'z', 'd0'), done()],
      idBySourceId: ids,
      model: 'claude-sonnet-5',
    });

    expect(result.passed).toBe(true);
    expect(result.hitRank).toBe(4);
  });

  it('fails when the right deal is shown but below the cut', () => {
    // Position seven is not "found" — nobody scrolls to it.
    const result = scoreCase({
      evalCase: findCase,
      events: [patch('a', 'b', 'c', 'e', 'f', 'g', 'd0'), done()],
      idBySourceId: ids,
      model: 'claude-sonnet-5',
    });

    expect(result.passed).toBe(false);
    expect(result.hitRank).toBeNull();
  });

  it('fails a case that surfaces a flagged anchor even when it also finds a good deal', () => {
    // Leading with an inflated anchor is the exact failure the site exists to
    // prevent; finding something good alongside it does not cancel that out.
    const result = scoreCase({
      evalCase: { ...findCase, mustNotRecommend: ['seed-3'] },
      events: [patch('d0', 'd3'), done()],
      idBySourceId: ids,
      model: 'claude-sonnet-5',
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(['d3']);
  });

  it('treats a label pointing at a missing deal as unmatchable, not as a pass', () => {
    const result = scoreCase({
      evalCase: { ...findCase, acceptable: ['seed-does-not-exist'] },
      events: [patch('d0'), done()],
      idBySourceId: ids,
      model: 'claude-sonnet-5',
    });

    expect(result.passed).toBe(false);
  });
});

describe('scoring a clarify case', () => {
  const vague = {
    id: 'v',
    request: 'I need a gift',
    kind: 'clarify' as const,
    acceptable: [],
    probes: '',
    split: 'train' as const,
  };

  it('passes when the assistant asks instead of guessing', () => {
    const result = scoreCase({
      evalCase: vague,
      events: [
        { type: 'text', text: 'Happy to help — who is it for, and what is your budget?' },
        done(),
      ],
      idBySourceId: ids,
      model: 'claude-sonnet-5',
    });

    expect(result.passed).toBe(true);
    expect(result.clarified).toBe(true);
  });

  it('fails when it confidently answers an unanswerable request', () => {
    const result = scoreCase({
      evalCase: vague,
      events: [patch('d0'), { type: 'text', text: 'Here is a great TV.' }, done()],
      idBySourceId: ids,
      model: 'claude-sonnet-5',
    });

    expect(result.passed).toBe(false);
  });

  it('records what it showed, so a lenient pass is visible to a human', () => {
    const result = scoreCase({
      evalCase: vague,
      events: [patch('d0'), { type: 'text', text: 'Here are some. Who is it for?' }, done()],
      idBySourceId: ids,
      model: 'claude-sonnet-5',
    });

    expect(result.passed).toBe(true);
    expect(result.surfacedCount).toBe(1);
  });
});

describe('question detection', () => {
  it('detects a trailing question', () => {
    expect(askedClarifyingQuestion('What is your budget?')).toBe(true);
  });

  it('detects a question followed by more prose', () => {
    expect(askedClarifyingQuestion('Who is it for? That changes a lot.')).toBe(true);
  });

  it('does not count a statement', () => {
    expect(askedClarifyingQuestion('Here are three options for you.')).toBe(false);
  });
});

describe('cost', () => {
  it('prices a turn from real usage', () => {
    // 1000 input + 500 output + 4000 cache reads on Sonnet 5.
    const cents = costCents('claude-sonnet-5', {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 4000,
      cacheCreationTokens: 0,
      toolCalls: 0,
    });

    expect(cents).toBeCloseTo(0.2 + 0.5 + 0.08, 6);
  });

  it('charges cache reads far less than fresh input, which is the whole point', () => {
    const price = MODEL_PRICING['claude-sonnet-5']!;
    expect(price.cacheRead).toBeLessThan(price.input / 5);
  });

  it('reports an unknown model as unpriced rather than free', () => {
    // A confident $0.00 for a model we have no price for is worse than "n/a".
    expect(
      costCents('some-future-model', {
        inputTokens: 10_000,
        outputTokens: 10_000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        toolCalls: 0,
      }),
    ).toBeNull();
  });
});

describe('the report', () => {
  function result(overrides: Partial<CaseResult>): CaseResult {
    return {
      caseId: 'c',
      kind: 'find',
      split: 'train',
      passed: true,
      hitRank: 1,
      surfacedCount: 3,
      violations: [],
      clarified: false,
      costCents: 1,
      toolCalls: 2,
      ...overrides,
    };
  }

  it('scores recall over find cases only, so clarify cases cannot inflate it', () => {
    const report = summarize('claude-sonnet-5', [
      result({ passed: true }),
      result({ passed: false }),
      result({ kind: 'clarify', passed: true, clarified: true }),
      result({ kind: 'clarify', passed: true, clarified: true }),
    ]);

    expect(report.recall).toBe(0.5);
    expect(report.clarifyRate).toBe(1);
  });

  it('reports the test split separately, which is the number that counts', () => {
    const report = summarize('claude-sonnet-5', [
      result({ split: 'train', passed: false }),
      result({ split: 'test', passed: true }),
    ]);

    expect(report.recall).toBe(0.5);
    expect(report.recallTest).toBe(1);
  });

  it('refuses to total a spend it cannot fully price', () => {
    const report = summarize('unknown', [result({ costCents: 1 }), result({ costCents: null })]);
    expect(report.totalCostCents).toBeNull();
    expect(report.meanCostCents).toBeNull();
  });

  it('holds the floors the PRD states', () => {
    expect(RECALL_FLOOR).toBe(0.85);
    expect(CLARIFY_FLOOR).toBe(0.8);
  });
});
