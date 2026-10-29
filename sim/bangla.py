"""Bangla logbook pages: the simulator's English entries in the wording Anika approved.

Mixed Bangla with English digits, as operators write: ETP, pH, units, shift
letters, equipment numbers and work-order IDs stay as they are; the sentences
around them are Bangla. Each entry keeps its English source (`source_en`), and
crossed-out entries, late-entry notes and their times carry over unchanged.
Any entry without an approved wording stops generation: nothing is guessed.

Only logbook pages are localized. Maintenance work orders, meter photos and
lab reports stay as they are. Pages made this way are localized simulator
records, kept beside the English originals.
"""

from __future__ import annotations

import re

HEADER = {"title": "ETP দৈনিক লগবুক", "date": "তারিখ:", "operator": "অপারেটর:", "time": "সময়", "remarks": "মন্তব্য"}
LATE_NOTE = "(লেখা হয়েছে {time}-এ)"  # "(written 17:45)"

EQUIPMENT = {  # (possessive, plain)
    "Aerator 2": ("এরেটর 2-এর", "এরেটর 2"),
    "ETP feed pump": ("ETP ফিড পাম্পের", "ETP ফিড পাম্প"),
}
_EQ = "|".join(re.escape(k) for k in EQUIPMENT)

# The service entry is written when the work starts (and "back in service" when it ends),
# so per the approved rule for that case it reads "being serviced": সার্ভিসিং চলছে।
RULES: list[tuple[re.Pattern, callable]] = [
    (re.compile(r"Shift ([ABC]) start\. ETP running normal\. Outfall pH (\S+)"),
     lambda m: f"শিফট {m[1]} শুরু। ETP স্বাভাবিকভাবে চলছে। আউটফলের পানির pH {m[2]}"),
    (re.compile(r"Shift ([ABC]) start\. ETP stopped\. Outfall pH (\S+)"),
     lambda m: f"শিফট {m[1]} শুরু। ETP বন্ধ। আউটফলের পানির pH {m[2]}"),
    (re.compile(r"Lime dosed (\d+) kg"), lambda m: f"চুন দেওয়া হয়েছে {m[1]} kg"),
    (re.compile(r"ETP stopped for planned maintenance( \(WO-[\w-]+\))?\. Tank taking inflow"),
     lambda m: f"পরিকল্পিত রক্ষণাবেক্ষণের জন্য ETP বন্ধ{m[1] or ''}। ট্যাংকে পানি ঢুকছে।"),
    (re.compile(r"ETP restarted\. Running normal"), lambda m: "ETP আবার চালু হয়েছে। স্বাভাবিকভাবে চলছে।"),
    (re.compile(rf"({_EQ}) serviced\. Other units running"),
     lambda m: f"{EQUIPMENT[m[1]][0]} সার্ভিসিং চলছে। বাকি ইউনিট চালু।"),
    (re.compile(rf"({_EQ}) back in service"), lambda m: f"{EQUIPMENT[m[1]][1]} আবার চালু হয়েছে।"),
    (re.compile(r"Sludge removed from clarifier"), lambda m: "ক্ল্যারিফায়ার থেকে স্লাজ সরানো হয়েছে।"),
]


def to_bangla(text: str) -> str:
    for pattern, wording in RULES:
        if m := pattern.fullmatch(text):
            return wording(m)
    raise ValueError(f"no approved Bangla wording for logbook entry {text!r}")


def localize_logbook(doc) -> None:
    """Turn a logbook document's entries into the approved Bangla, in place, keeping each English source."""
    assert doc.type == "logbook"
    for entry in doc.content["entries"]:
        entry["source_en"] = entry["text"]
        entry["text"] = to_bangla(entry["text"])
    doc.content["language"] = "bn"
