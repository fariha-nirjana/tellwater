# Two readers: the rule, fixed before the held-out test

Written on 31 October 2026, before any held-out test case was run. It is committed with the frozen investigator (`investigator.json`) and is not changed after the results are seen.

## The rule

Two models investigate every case with the same frozen investigator (same prompt, tools, checks and evidence):

- **Muse Spark** (`muse-spark-1.3`, Meta Model API): condition C4.
- **Muse Glimmer 30B distilled from Muse Spark**: condition C6, the adapter whose weights are published.

If both reach the same answer, that answer stands. If they reach different answers, or either returns no valid result, neither answer is used: the case becomes **review required**, and a person decides with both readings in front of them.

Nothing else is combined: no voting, no confidence threshold, no tie-breaks by model.

## What is reported

From `python -m eval.two_readers test`, next to C4 alone:

- how often the two readers agree;
- how many cases go to a person because they disagree;
- how often the agreed answer matches the justified answer;
- for the combined system: real problems passed as fine, false escalations and unsupported accusations, with the same definitions as every other condition.

A disagreement on a clean run counts as a false escalation: it costs a reviewer's time, and it is reported that way.

## Why

The investigator never certifies on its own: a person signs every record. Two independently run models that disagree are a plain signal that a case is not settled by the evidence the way either model thinks, so it needs a person first. The second reader is an open model a factory or auditor can run on their own hardware, so the same check can run without plant data leaving the site.
