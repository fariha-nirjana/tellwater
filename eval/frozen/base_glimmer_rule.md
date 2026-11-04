# What the fine-tune added: base Muse Glimmer against the published adapter, fixed before any run

Written on 4 November 2026, before base Muse Glimmer was run on any of the sets below. It is committed before the first call and not changed after a result is seen. The held-out test is not used: it was run once and stays as it is.

## What is compared

- **Base Muse Glimmer 30B** (condition C6b): the open base model with no fine-tuning, the same frozen investigator (prompt, tools, checks, validation), sampled on Fireworks (`accounts/fireworks/models/muse-glimmer-30b`, temperature 0).
- **glimmer-gaps/epoch2** (condition C6): the published adapter. Its runs on these sets already exist (`eval/runs/<set>/C6-glimmer-gaps/`), each made once before this rule, and are used as they are.

## The sets, chosen for what the fine-tune was built to fix

The fine-tune was meant to teach two things: following the investigator's tool-and-citation format, and not claiming "supports" when a record that decides the case is missing. The sets are the fresh ones built to measure exactly that, never trained on, never the test set:

- **check_gaps** (10): the missing-record weakness the gaps retrain targeted (6 insufficient, 4 supports).
- **check** (8): the general fresh-case check.
- **check_r3** (28): fresh cases weighted to missing records that decide the case, with matched controls (14 insufficient, 11 supports, 2 contradicts, 1 review required).

46 cases in all. Base Muse Glimmer runs each case once (`python -m eval.run_set <set> C6b`, results in `eval/runs/<set>/C6b/`). The first case is a one-case smoke test and counts as that case's run; no case is rerun.

## Measures (per set and over all 46)

- **Valid runs**: the run ended with an answer that passed citation validation.
- **Right**: valid, and the answer equals the justified answer.
- **Right, or asked**: right, or a valid answer of "insufficient" or "review required" (it asked for a record or a person).
- **Harmful mistakes**: "supports" or "contradicts" where the justified answer is something else (cleared or accused wrongly), counted even if the run is invalid.
- **Overclaims on missing-record cases**: "supports" on the 20 cases (6 in check_gaps, 14 in check_r3) whose justified answer is "insufficient".
- **Requests naming the right record**: of the cases where it asked and the justified answer is "insufficient", how many requests name the missing record (`eval.metrics` `request_hits`).

A run with no answer, or one that failed validation, is neither right nor "right, or asked".

## What is reported

All of it, per set and pooled, whichever way it goes. The primary measure is **overclaims on missing-record cases**; the others are reported beside it.

- If the published adapter has fewer overclaims on missing-record cases than base Muse Glimmer, the README and video say that the fine-tune taught it to ask, with both numbers ("overclaims X -> Y").
- If not, the README says in one line that the fine-tune's measured effect is the targeted gaps retrain, and gives these numbers too.

Neither outcome changes the published adapter, the held-out results or the two-reader rule. Cost: about $0.47 a case on Fireworks at list price, about $22 for the 46.
