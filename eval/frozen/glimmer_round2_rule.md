# Muse Glimmer round 2: how the published adapter is chosen, fixed before training

Written on 1 November 2026, after the round 2 training cases and the judging set were generated and before any round 2 model was trained or run on the judging set. It is not changed after the results are seen.

## The candidates

- **glimmer-gaps/epoch2**: the adapter published today (round 1 data plus `train_gaps`, no reasoning).
- **glimmer-reason/epoch1** and **glimmer-reason/epoch2**: round 2, trained to reason before each step (`eval.distill_data --reasoning`; teacher `muse-spark-1.3-contributor` on `train_reason`), learning rate 2e-4, 2 epochs, everything else as glimmer-gaps.

## The judging sets

- **check_reason** (16 cases, seed 130000, generated before training, never trained on): 8 insufficient (4 without the tank level log, 4 without a record that decides it: outfall flow or ETP inflow in two dilution runs, outfall flow in a maintenance stop, ETP power in a normal run), 4 honest runs with a gap (supports), 2 clean runs (supports), 2 contradicts with a gap.
- **check** (the original 8 fresh cases).

Each candidate runs each case once (condition C6, the frozen investigator, served on Modal). No reruns. Each adapter's runs are kept in their own folder (`eval/runs/<set>/C6-glimmer-reason-epoch1`, `C6-glimmer-reason`, `C6-glimmer-gaps`), so no result is overwritten or reused by another epoch. Muse Spark (C4, standard) runs check_reason once as a reference; it does not decide anything.

## Counts

- **right**: the answer equals the justified answer.
- **overclaims**: "supports" where the justified answer is anything else (out of 10 on check_reason).
- **unneeded asks**: "insufficient" where the justified answer is "supports" (out of 6).
- A run with no valid result (it failed validation, or ended with no answer) counts as wrong, whatever its status. An overclaim counts even when the run is invalid.

"A beats B" means: more right on check_reason, or the same number right with fewer overclaims.

## The rule

1. **Halfway.** When glimmer-reason/epoch1 is saved, it runs check_reason while epoch 2 trains. If it does not beat glimmer-gaps/epoch2, training is stopped and glimmer-gaps/epoch2 stays published. The README then says: round 2 did not improve on glimmer-gaps at epoch 1, and training was stopped under the rule set before training. Epoch 2 was not evaluated, so this does not show that it would not have improved.
2. **The bar.** A glimmer-reason epoch can be published only if, on check_reason, it has at most 1 overclaim and at least 5 of 6 supports right, and it gets at least 7 of 8 on check.
3. **The choice.** Of the glimmer-reason epochs that clear the bar and beat glimmer-gaps/epoch2, the one that beats the other is published (if neither beats the other, epoch2). If none does, glimmer-gaps/epoch2 stays published.
4. Whatever is published is the adapter the held-out test reports as C6 and the two-reader rule uses.

`python -m eval.glimmer_round2` (halfway) and `--final` apply these counts and this rule to the saved runs. All results are reported, including the ones that lose.
