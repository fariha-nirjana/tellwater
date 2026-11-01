"""The round 3 rule picks the published adapter exactly as eval/frozen/glimmer_round3_rule.md says."""

import json

from eval import glimmer_round3 as r3


def _c(right, over, sup):
    return {"right": right, "overclaims": over, "supports_right": sup}


def _run(monkeypatch, capsys, table, final=True):
    monkeypatch.setattr(r3, "counts", lambda s, a: table[(s, a)])
    monkeypatch.setattr("sys.argv", ["x", "--final"] if final else ["x"])
    r3.main()
    return json.loads(capsys.readouterr().out)


def _table(gaps, e1, e2, check1=8, check2=8):
    return {("check_r3", r3.INCUMBENT): gaps, ("check_r3", r3.CANDIDATES[0]): e1, ("check_r3", r3.CANDIDATES[1]): e2,
            ("check", r3.CANDIDATES[0]): _c(check1, 0, 3), ("check", r3.CANDIDATES[1]): _c(check2, 0, 3)}


def test_halfway(monkeypatch, capsys):
    t = _table(_c(20, 1, 8), _c(21, 1, 8), _c(0, 0, 0))
    assert _run(monkeypatch, capsys, t, final=False)["halfway"].startswith("continue")
    t = _table(_c(20, 1, 8), _c(20, 1, 9), _c(0, 0, 0))  # same right, same overclaims: does not beat
    assert _run(monkeypatch, capsys, t, final=False)["halfway"].startswith("stop")


def test_final_choice(monkeypatch, capsys):
    gaps = _c(20, 1, 8)
    assert _run(monkeypatch, capsys, _table(gaps, _c(22, 0, 9), _c(23, 0, 9)))["published"] == r3.CANDIDATES[1]
    assert _run(monkeypatch, capsys, _table(gaps, _c(23, 0, 9), _c(22, 0, 9)))["published"] == r3.CANDIDATES[0]
    # beats the incumbent but too many overclaims, too few supports right, or fails the regression check
    assert _run(monkeypatch, capsys, _table(gaps, _c(24, 2, 9), _c(24, 2, 9)))["published"] == r3.INCUMBENT
    assert _run(monkeypatch, capsys, _table(gaps, _c(24, 0, 7), _c(24, 0, 7)))["published"] == r3.INCUMBENT
    assert _run(monkeypatch, capsys, _table(gaps, _c(24, 0, 9), _c(24, 0, 9), 6, 6))["published"] == r3.INCUMBENT
    # no more overclaims than the incumbent
    assert _run(monkeypatch, capsys, _table(_c(20, 0, 8), _c(24, 1, 9), _c(24, 1, 9)))["published"] == r3.INCUMBENT
