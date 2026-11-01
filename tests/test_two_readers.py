import json

from eval import two_readers


def test_disagreement_goes_to_a_person(tmp_path, monkeypatch):
    monkeypatch.setattr(two_readers, "RUNS", tmp_path)
    cases = {  # case: (justified, C4, C6)
        "a": ("supports", "supports", "supports"),
        "b": ("contradicts", "contradicts", "supports"),
        "c": ("supports", "supports", None),
        "d": ("supports", "supports", "supports"),  # the same answer, but C6's failed validation
    }
    for k, cond in ((1, two_readers.FIRST), (2, two_readers.SECOND)):
        (tmp_path / "s" / cond).mkdir(parents=True)
        rows = [{"case_id": c, "justified": v[0], "predicted": v[k], "kind": "x", "cost": 0.1,
                 "valid": not (c == "d" and k == 2)} for c, v in cases.items()]
        (tmp_path / "s" / cond / "summary.json").write_text(json.dumps({"rows": rows}))
    out = two_readers.run("s")
    assert out["readers_agree"] == 1 and out["routed_to_a_person"] == 3 and out["right_when_they_agree"] == "1/1"
    assert {r["case_id"] for r in out["routed"]} == {"b", "c", "d"}
    assert out["combined"]["missed_problems"] == 0 and out["combined"]["false_escalations"] == 2


def test_each_epoch_has_its_own_runs():
    from agent.glimmer import PUBLISHED_RUNS, runs_folder

    assert runs_folder("glimmer-gaps/epoch2") == PUBLISHED_RUNS == "C6-glimmer-gaps"  # where its saved runs already are
    assert runs_folder("glimmer-reason/epoch1") == "C6-glimmer-reason-epoch1"
    assert runs_folder("glimmer-reason/epoch2") == "C6-glimmer-reason"
