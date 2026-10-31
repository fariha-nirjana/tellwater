import json

from eval import two_readers


def test_disagreement_goes_to_a_person(tmp_path, monkeypatch):
    monkeypatch.setattr(two_readers, "RUNS", tmp_path)
    cases = {  # case: (justified, C4, C6)
        "a": ("supports", "supports", "supports"),
        "b": ("contradicts", "contradicts", "supports"),
        "c": ("supports", "supports", None),
    }
    for k, cond in ((1, "C4"), (2, "C6")):
        (tmp_path / "s" / cond).mkdir(parents=True)
        rows = [{"case_id": c, "justified": v[0], "predicted": v[k], "kind": "x", "cost": 0.1} for c, v in cases.items()]
        (tmp_path / "s" / cond / "summary.json").write_text(json.dumps({"rows": rows}))
    out = two_readers.run("s")
    assert out["readers_agree"] == 1 and out["routed_to_a_person"] == 2 and out["right_when_they_agree"] == "1/1"
    assert {r["case_id"] for r in out["routed"]} == {"b", "c"}
    assert out["combined"]["missed_problems"] == 0 and out["combined"]["false_escalations"] == 1
