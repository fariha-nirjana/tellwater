"""The README's trust numbers and the video's spoken numbers match the committed results (eval/check_numbers.py)."""

from eval import check_numbers


def test_readme_and_video_numbers_match_the_results(capsys):
    assert check_numbers.main() == 0, capsys.readouterr().out


def test_a_wrong_number_in_the_readme_is_caught(tmp_path, monkeypatch, capsys):
    text = check_numbers.README.read_text(encoding="utf-8")
    wrong = text.replace("It was right, or asked, 112 times", "It was right, or asked, 114 times", 1)
    wrong = wrong.replace("| Muse Spark | 112 | 8 |", "| Muse Spark | 112 | 6 |", 1)
    assert wrong != text
    readme = tmp_path / "README.md"
    readme.write_text(wrong, encoding="utf-8")
    monkeypatch.setattr(check_numbers, "README", readme)
    assert check_numbers.main() == 1
    out = capsys.readouterr().out
    assert "MISMATCH  Muse Spark: harmful: 8  (README/source says: 6)" in out
    assert "MISMATCH  Muse Spark, right or asked and harmful" in out
