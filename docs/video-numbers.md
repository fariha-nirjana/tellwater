# The video's numbers, and where each comes from

Every number spoken in the 3-minute video, the record it comes from, and how to check it. `python -m eval.check_numbers` recomputes each one from the files below and fails if any has changed.

## Spoken

| Spoken | The number | Where it comes from |
|---|---|---|
| "the logbook says an aerator was serviced for **under two hours**" | 11:40 to 13:20, 1 hour 40 minutes | Demo case B's handwritten logbook page and maintenance record (`doc:maintenance-1013-1140` in [`data/demo/B/trace.json`](../data/demo/B/trace.json)) |
| "**low power continues**, about **five hours** altogether" | 11:40 to 16:45, 5.08 hours. Plant power averaged 39.2 kW, against the 59.9 kW the inflow needed (the "39.2 vs 59.9" on screen) | Muse Spark's power and water-balance checks in case B (`calc:power_vs_load` and `calc:water_balance` for 11:40 to 16:45, same file) |
| "the outfall sample's BOD is **twice the stated limit**" | 60.9 mg/L against a limit of 30 mg/L (2.03×), sampled at 16:10 | Case B's lab report (`doc:lab-1013-1610`, same file) |
| "the records **support the claim**" (case C, after the factory sends the tank log) | Insufficient evidence before the tank log, supports the claim after it | [`data/demo/C/trace.json`](../data/demo/C/trace.json), then [`data/demo/C/trace-after.json`](../data/demo/C/trace-after.json) |
| "Muse Glimmer **thirty-B**" | 30B parameters | The base model the adapter is trained on, `muse-glimmer-30b` ([`agent/glimmer.py`](../agent/glimmer.py)) |
| "Spark says the claim is contradicted. Glimmer says there isn't enough evidence" (case D) | Contradicts, against insufficient evidence: the two readers disagree, so the finding is held | [`data/demo/D/trace.json`](../data/demo/D/trace.json) and [`data/demo/D/second_reader.json`](../data/demo/D/second_reader.json) |
| "**120 unseen simulated cases**" | 120 cases, 60 from each of two factories, frozen before the test (SHA-256 `c49aa489…`) | [`eval/frozen/test_manifest.json`](../eval/frozen/test_manifest.json) |
| "Spark made **eight** harmful mistakes" | 6 cases cleared too readily and 2 accusations the evidence didn't support | The held-out test, Muse Spark investigating (`test.C4` in [`data/demo/results.json`](../data/demo/results.json)) |
| "Two readers reduced that to **four**" | 3 cleared too readily and 1 accusation | The held-out test, two readers (`test.two_readers`, same file) |
| "while sending **25 cases** to a person" | 25 of 120 cases where the readers disagreed | `test.two_readers.routed_to_a_person`, same file |
| "a pilot with **one factory** and its buyer" | A plan, not a measurement | [README: Why it matters](../README.md#why-it-matters) |

A harmful mistake is a case cleared when it shouldn't have been, or an accusation the evidence didn't support. Asking for a record or a person instead of answering is not counted as one.

## On screen

The edit shows the held-out test's right answers beside the harmful mistakes. These are the "Right answer" row of the [held-out table](../README.md#does-it-hold), also checked by `eval.check_numbers`:

| On screen | From |
|---|---|
| Muse Spark investigating: 100 / 120 | `test.C4.agreement` |
| Muse Glimmer: 91 / 120 | `test.C6.agreement` |
| Muse Spark, everything at once: 103 / 120 | `test.C3.agreement` |
| Muse Spark Open: 99 / 120 | `test.C5.agreement` |
| Two readers: 90 / 120, with 10 clean runs held up | `test.two_readers.agreement` and `.false_escalations` |
