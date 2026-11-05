# The video's numbers, and where each comes from

Every number in the [3-minute video](https://youtu.be/AQAexZWCw-Q), spoken or on screen, with the record it comes from. `python -m eval.check_numbers` recomputes the ones marked ✓ from the files below and fails if any has changed.

## Spoken

| Spoken | The number | Where it comes from | |
|---|---|---|---|
| "it says one aerator down, for **under two hours**" | 11:40 to 13:20, 1 hour 40 minutes | Demo case B's handwritten logbook page and maintenance record (`doc:maintenance-1013-1140` in [`data/demo/B/trace.json`](../data/demo/B/trace.json)) | ✓ |
| "on the paper it says **two hours**, but it says **five** on the meters" | 11:40 to 16:45 of low power, 5.08 hours (plant power 39.2 kW against the 59.9 kW the inflow needed) | Muse Spark's power and water-balance checks in case B (`calc:power_vs_load` and `calc:water_balance` for 11:40 to 16:45, same file) | ✓ |
| "the water that left the plant was **twice the limit**" | BOD 60.9 mg/L against a limit of 30 mg/L (2.03×), sampled at 16:10 | Case B's lab report (`doc:lab-1013-1610`, same file) | ✓ |
| "The tank rose, **nothing left the outfall**, and the verdict changes" (case C) | Tank level 45% to 71% during the stop; outfall 0 m³ from 13:10 to 15:40; insufficient evidence before the tank log, supports the claim after it | [`data/demo/C/trace.json`](../data/demo/C/trace.json), then [`data/demo/C/trace-after.json`](../data/demo/C/trace-after.json) (`sig:T1@1013-1230..1013-1600`, `calc:water_balance@1013-1310..1013-1540`) | ✓ |
| "Spark says the claim is contradicted. Glimmer says **a record is missing**" (case D) | Contradicts, against insufficient evidence: the two readers disagree, so the finding is held | [`data/demo/D/trace.json`](../data/demo/D/trace.json) and [`data/demo/D/second_reader.json`](../data/demo/D/second_reader.json) | ✓ |
| "gave it **120 new cases** it had never seen" | 120 cases, 60 from each of two factories, frozen before the test (SHA-256 `c49aa489…`) | [`eval/frozen/test_manifest.json`](../eval/frozen/test_manifest.json) | ✓ |
| "Muse Spark was right, or asked for help, **112** times" | 112 of 120 | The held-out test, Muse Spark investigating (`test.C4` in [`data/demo/results.json`](../data/demo/results.json)) | ✓ |
| "Harmful mistakes were made only **8** times" | 6 cases cleared too readily and 2 accusations the evidence didn't support | `test.C4`, same file | ✓ |
| "on plain rules, it'd have been **27** times" | 27 harmful mistakes for rules alone, 20 of them accusations | `test.C1`, same file | ✓ |
| "with our two detectives it was only **4** times" | 3 cleared too readily and 1 accusation | `test.two_readers`, same file | ✓ |
| "**25** cases went to a person for a second eye" | 25 of 120, where the readers disagreed | `test.two_readers.routed_to_a_person`, same file | ✓ |
| "a pilot with a real factory and its buyers" | A plan, not a measurement | [README: Why it matters](../README.md#why-it-matters) | |

A harmful mistake is a case cleared when it shouldn't have been, or an accusation the evidence didn't support. Asking for a record or a person instead of answering is not counted as one.

## On screen only

| On screen | Where it comes from | |
|---|---|---|
| "11:40 → 13:20" and "1 h 40 min" (logbook) | Case B's maintenance record, as above | ✓ |
| "1 h 40" against "5 h 05", and "3 h 25 min the logbook doesn't show" | Case B: 100 logged minutes against 305 minutes of low power | ✓ |
| "BOD 60.9", "Legal limit 30" | Case B's lab report; the limit is the ECR 2023 textile effluent limit for BOD | ✓ |
| "45%" to "71%" holding tank, "0 m³/h" outfall flow | Case C after the tank log, as above | ✓ |
| "Live run · 18× speed" | The live Muse Spark run of case C, recorded from the click (27.0 s) to its last step (141.4 s) and played at a constant 18× (114.4 s in 6.36 s), then at real speed as the verdict changes | |
| "FINE-TUNING · 46 FRESH CASES · Right 22 → 33 · Overclaims on missing records 1 → 4" | Base against fine-tuned Muse Glimmer on the check, check_gaps and check_r3 sets, counted by the rule written before the base model ran ([`eval/frozen/base_glimmer_rule.md`](../eval/frozen/base_glimmer_rule.md)), which counts an invalid run as wrong; `data/demo/results.json` counts every run and gives 34 for the fine-tuned model | |
| "112", "8", "On plain rules: 27", "4", "25 cases went to a person" (results) | The held-out test, as spoken above | ✓ |

## Not from the project

| On screen | Source |
|---|---|
| "2,046" factories around Dhaka served final notices to keep their treatment plants running | The Business Standard, 2025 (also on the site's story page) |
| "2.4 billion litres" of untreated wastewater a day, from 7,000+ factories | [World Bank, Feb 2026](https://www.worldbank.org/en/news/press-release/2026/02/10/world-bank-helps-reduce-dhaka-s-water-pollution) (also in the README) |
| The river photograph in the closing | Bangladesh Nature on Pexels (Pexels License, photo 9265631) |
