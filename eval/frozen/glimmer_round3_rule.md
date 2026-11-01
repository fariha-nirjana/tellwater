# Muse Glimmer round 3: how the published adapter is chosen, fixed before any reference run and before training

Written on 2 November 2026, after the round 3 training data was built and the judging set `check_r3` was generated and its labels inspected, and before glimmer-gaps, Muse Spark or any round 3 model was run on `check_r3`. Fingerprints of the code, the training data and the judging set are in `glimmer_round3.json`. Nothing here changes after a result is seen.

## The candidates

- **glimmer-gaps/epoch2**: the published adapter today.
- **glimmer-r3/epoch1** and **glimmer-r3/epoch2**: glimmer-gaps' recipe unchanged (one tool call per turn, no reasoning field, LoRA rank 16, learning rate 1e-4, batches of 8, 2 epochs) on a new data recipe: `data/distill/train_round3.jsonl`, 290 investigations balanced by group (kind, gap, tank log, answer; at most 10 each), with guided teacher runs for five kinds where Muse Spark misjudges which missing record matters (the note is never in the data), every targeted example passing `eval/guidance.py`'s grounding check, and calls made after the check budget removed. It tests the recipe as a whole: guidance and balancing are not separated.

## The judging set

**check_r3** (28 cases, seeds 140000-140023, generated before training, never trained on, never the test set): 14 insufficient (4 dilution without ETP inflow, 4 maintenance without outfall flow, 4 maintenance without the tank level log, 2 normal without ETP power); 6 supports with a gap (2 maintenance without ETP power, 2 maintenance without ETP inflow, 1 normal without outfall flow, 1 normal without ETP inflow); 2 clean normal (supports); 2 contradicts with a gap (bypass without outfall flow, shutdown without the tank log); and 4 matched controls: the same scenario (same seed and events) as the first insufficient case of four kinds, with the decisive record restored (dilution -> review_required; maintenance without outfall flow, maintenance without the tank log, normal without ETP power -> supports).

Justified answers, as generated: **11 supports, 14 insufficient, 2 contradicts, 1 review_required**; so **17** cases whose answer is not "supports".

The set is weighted towards the kinds round 3 targets. It is fit for choosing whether this repair worked; it does not show that any adapter is better in general. **check** (the original 8 fresh cases) is a regression check only.

Each candidate runs each case once (condition C6, the frozen investigator, served on Modal; runs kept per adapter in `eval/runs/<set>/C6-<run>[-<epoch>]`). No reruns. Muse Spark (C4, standard) runs `check_r3` once as a reference; it decides nothing.

## Counts (`eval.glimmer_round2.counts`)

- **right**: the answer equals the justified answer and the run is valid. A run with no valid result counts as wrong.
- **overclaims**: "supports" where the justified answer is anything else (out of 17), counted even when the run is invalid.
- **supports right**: right answers among the 11 "supports" cases.
- Complete results only: 28 cases on `check_r3`, 8 on `check`, each once, or the rule is not applied.

"A beats B" means: more right on `check_r3`, or the same number right with fewer overclaims.

## The rule (`python -m eval.glimmer_round3`, tested in `tests/test_glimmer_round3.py`)

1. **Halfway.** When glimmer-r3/epoch1 is saved, it runs `check_r3` while epoch 2 trains. If it does not beat glimmer-gaps/epoch2, training is stopped and glimmer-gaps/epoch2 stays published; the README says round 3 did not improve on glimmer-gaps at epoch 1 and training was stopped under this rule, and that epoch 2 was not evaluated.
2. **The bar.** A glimmer-r3 epoch can be published only if, on `check_r3`, it has **at most 1 overclaim (of 17)** and **no more overclaims than glimmer-gaps**, **at least 8 of the 11 supports cases right**, and it gets **at least 7 of 8 on check**.
3. **The choice.** Of the glimmer-r3 epochs that clear the bar and beat glimmer-gaps/epoch2, the one that beats the other is published (if neither beats the other, epoch2). If none does, glimmer-gaps/epoch2 stays published.
4. Whatever is published is the adapter the held-out test reports as C6 and the two-reader rule uses.

All results are reported, including the ones that lose. Budget gates: Meta for round 3 at most $8.00 in all ($2.54 spent on guided runs, pilot included; ~$5 reserved for the Muse Spark reference), Modal at most $35; the full run starts only if it can start by 20:00 Dhaka on 2 November.

The 11 supports cases are the 6 with a gap, the 2 clean runs and the 3 controls whose answer is supports.
