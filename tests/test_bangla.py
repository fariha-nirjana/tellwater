import pytest

from sim import bangla


def test_approved_wording_with_each_records_own_values():
    assert bangla.to_bangla("Shift B start. ETP stopped. Outfall pH 7.2") == "শিফট B শুরু। ETP বন্ধ। আউটফলের পানির pH 7.2"
    assert bangla.to_bangla("Lime dosed 40 kg") == "চুন দেওয়া হয়েছে 40 kg"
    assert (bangla.to_bangla("ETP stopped for planned maintenance (WO-1013-43). Tank taking inflow")
            == "পরিকল্পিত রক্ষণাবেক্ষণের জন্য ETP বন্ধ (WO-1013-43)। ট্যাংকে পানি ঢুকছে।")
    assert bangla.to_bangla("Aerator 2 back in service") == "এরেটর 2 আবার চালু হয়েছে।"


def test_unapproved_text_is_never_guessed():
    with pytest.raises(ValueError):
        bangla.to_bangla("Blower 3 tripped")


def test_localized_page_keeps_sources_and_marks():
    class Doc:
        type = "logbook"
        content = {"entries": [{"time": "06:20", "text": "Lime dosed 25 kg", "crossed_out": True},
                               {"time": "09:45", "text": "Sludge removed from clarifier", "late": True, "written": "17:45"}]}

    bangla.localize_logbook(Doc)
    first, second = Doc.content["entries"]
    assert Doc.content["language"] == "bn" and first["source_en"] == "Lime dosed 25 kg" and first["crossed_out"]
    assert second["written"] == "17:45" and second["text"] == "ক্ল্যারিফায়ার থেকে স্লাজ সরানো হয়েছে।"
