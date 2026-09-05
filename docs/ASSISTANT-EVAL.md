# Assistant evaluation (S9.7)

Assistant quality is invisible without a number. This is the number.

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
npm run assistant:eval -- --dry-run          # free: resolves labels, calls nothing
npm run assistant:eval                       # ~40 conversations against ASSISTANT_MODEL
npm run assistant:eval -- --models=claude-sonnet-5,claude-opus-5   # bake-off
npm run assistant:eval -- --case=vague-gift --verbose              # one case, full transcript
npm run assistant:eval -- --write-baseline   # record the result for the diff
```

## What it measures

| Metric | Floor | Meaning |
|---|---|---|
| **Top-6 recall** | 85% (M12) | On a request with a right answer, did a labelled deal reach the first six the assistant showed? Position seven is a miss — nobody scrolls to it. |
| **Clarify rate** | 80% | On a deliberately vague request, did it ask instead of guessing? |
| **Inflated anchors recommended** | 0 | Did it ever put a flagged anchor in the top six? A case fails on this even when it also found a good deal. |
| **Cost per conversation** | reported | Measured from real `usage`, not estimated from token shapes. |

The run exits non-zero if any model misses a floor, so CI and a human reading the
terminal reach the same conclusion.

## How the set is built

Forty requests over the offline seed dataset, in `src/lib/assistant/eval/golden.ts`,
covering budget caps, departments ("for my 7-year-old"), merchant exclusion ("not
from Amazon"), brand families, discount depth, verification verdicts, coupon-only,
in-store clearance, use-case phrasing ("going camping this weekend"), and five
requests too vague to answer.

Cases are labelled by seed **`sourceId`** (`seed-27`), not by deal id or slug. Both
of those carry a random suffix minted on each seeding, so labelling by either
would rot silently — every case would score as a permanent miss, which looks
exactly like a model regression and is not one. `tests/assistant/eval.test.ts`
asserts every label still resolves; `--dry-run` re-checks it against a live
seeding before you spend anything.

## The train/test split

Eighteen cases are marked `test`, the rest `train`. The split exists for one
reason: **iterate on `train`, report on `test`.**

A prompt tweaked until all forty cases pass has been fitted to all forty cases,
and its score no longer predicts anything about the forty-first. So:

1. A case fails. Reproduce it alone: `--case=<id> --verbose`.
2. Diagnose from the transcript. The activity lines show which tools it called
   with what — most misses are a filter it never applied, or a store name it
   guessed instead of looking up with `list_facets`.
3. Fix the **cause** — the tool description, the schema, the system prompt, or a
   genuine tool gap. Do not add the answer to the prompt.
4. Re-run `--split=train`.
5. Only then run `--split=test`. If the test recall moved with the train recall,
   the fix generalised. If train improved and test did not, you fitted the set:
   revert and find the real cause.

Move a case between splits only when adding new cases rebalances the halves —
never to get a failing case out of the reported number.

## The bake-off

`--models=claude-sonnet-5,claude-opus-5` runs the identical set against both and
prints a comparison plus a recommendation: the cheapest model that clears both
floors. If neither clears them, it says so and names the highest scorer, without
recommending it — that outcome means the prompt or the tools need work, not that
the floor was set too high.

The shipped default is `claude-sonnet-5`, chosen on the reasoning in PRD §16.2a:
the architecture deliberately removes the hard parts from the model (strict tool
schemas guarantee argument validity; the grounding layer makes a hallucinated
price structurally impossible). The bake-off is what turns that reasoning into a
measurement. If Sonnet misses the recall floor, the story closes by changing
`ASSISTANT_MODEL` — not by lowering the floor.

## Honest limits

- **The clarify metric is a heuristic.** A reply counts as clarifying if it
  contains a question. A reply that both searches and ends in a question passes,
  which is the lenient reading. The report prints the surfaced count next to each
  clarify case so you can see whether it also quietly committed to an answer.
- **The set runs against seed data**, not live scrapes. It measures whether the
  assistant can find what is there — not whether what is there is any good. Deal
  quality is the verification engine's job, measured separately.
- **Recall is not satisfaction.** A case passes when a labelled deal is in the top
  six; it says nothing about whether the explanation alongside it was useful.
  Read `--verbose` transcripts periodically; the number will not catch prose that
  is technically correct and unhelpful.
- **Prices in `MODEL_PRICING` are list rates as of early 2026** and change. The
  token counts are measured; the dollars they are multiplied by are not.

## Baseline

`docs/assistant-eval-baseline.json` records the last committed run: date, model,
per-metric scores, and the pass/fail of every case. Commit it after a run you
believe, so the next run's regression shows up in a diff rather than in memory.

It is not committed yet — this sandbox has no API key, so no honest baseline can
be recorded from here. The first `--write-baseline` run on a machine with a key
creates it.
