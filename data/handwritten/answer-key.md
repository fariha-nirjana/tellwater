# Handwritten pages: what is actually on each photo

The pages were copied from a fixed script of four logbook pages. Three people wrote these pages, and where a page differs from the script, the page wins: this file is the answer key Muse Spark's reading is scored against.

Photos here are 2048 px on the long side, the size Muse Spark is sent. Readings and scores from two runs are in `results.json`; rerun with `python -m eval.handwriting --run run3`.

| File | Script page | Date | Operator | Language |
|---|---|---|---|---|
| page1.jpg | 1 | 14/10/2026 | R. Karim | English |
| page2.jpg | 2 | 15/10/2026 | S. Akter | English |
| page3.jpg | 3 | 16/10/2026 | M. Hossain | Bangla |
| page4.jpg | 4 | 17/10/2026 | N. Islam | Bangla |
| page5.jpg | 4, dim light, angled | 17/10/2026 | N. Islam | Bangla |
| page6.jpg | 6, demo case B's logbook | 13/10/2026 | R. Karim | English |

`[struck: …]` marks writing that is crossed out on the page.

## Page 1 (English, an ordinary day)

| Time | Remarks |
|---|---|
| 06:00 | Shift A start. ETP running normal. Outfall pH 7.3 |
| [struck: 06:25] | [struck: Lime dosed 30 kg] |
| 06:30 | Lime dosed 35 kg |
| 09:45 | Sludge removed from clarifier |
| 14:00 | Shift B start. ETP running normal. Outfall pH 7.4 |
| 14:25 | Lime dosed 40 kg |
| 22:00 | Shift C start. ETP running [struck: ab] normal. Outfall pH 7.2 |
| 22:20 | Lime dosed 30 kg |

Differs from the script: the struck line is at 06:25 (script 06:20), and the kept dose is at 06:30 (script 06:25; the last digit is written over). A false start before "normal" at 22:00 is struck out.

## Page 2 (English, a maintenance stop)

| Time | Remarks |
|---|---|
| 06:00 | Shift A start. ETP running normal. Outfall pH 7.5 |
| 06:25 | Lime dosed 35 kg |
| 11:40 | ETP stopped for planned maintenance (WO-1015-07). Tank taking inflow |
| 14:00 | Shift B start. ETP stopped. Outfall pH 7.6 |
| 14:20 | ETP restarted. Running normal |
| 15:10 | Aerator 2 serviced. Other units running (written 17:45) |
| 16:30 | Aerator back in service |
| 22:00 | Shift C start. ETP running normal. Outfall pH 7.3 |

Differs from the script: 16:30 says "Aerator", not "Aerator 2". The late note is written at normal size.

## Page 3 (Bangla, an ordinary day)

| সময় | মন্তব্য |
|---|---|
| 06:00 | শিফট A শুরু। ETP স্বাভাবিকভাবে চলছে। আউটফলের পানির pH 7.4 |
| [struck: 06:25] | [struck: চুন দেওয়া হয়েছে 35 kg] |
| 06:30 | চুন দেওয়া হয়েছে 35 kg |
| 09:45 | ক্ল্যারিফায়ার থেকে স্লাজ সরানো হয়েছে। |
| 14:00 | শিফট B শুরু। [struck: EFT] ETP স্বাভাবিকভাবে চলছে। আউটফলের পানির pH 7.3 |
| 14:25 | চুন দেওয়া হয়েছে 40 kg |
| 22:00 | শিফট C শুরু। [struck: EFT] ETP স্বাভাবিকভাবে চলছে। আউটফলের পানির pH 7.2 |

Differs from the script: the struck line is 06:25 and 35 kg (script 06:20 and 25 kg), so both lines carry the same dose. The kept dose is at 06:30 (script 06:25). At 14:00 and 22:00, "EFT" is struck and "ETP" is written above it.

## Page 4 (Bangla, a stop and a repair); page 5 is the same page

| সময় | মন্তব্য |
|---|---|
| 06:00 | শিফট A শুরু। ETP স্বাভাবিকভাবে চলছে। আউটফলের পানির pH 7.5 |
| 06:25 | চুন দেওয়া হয়েছে 30 kg |
| 12:30 | পরিকল্পিত রক্ষণাবেক্ষণের জন্য ETP বন্ধ ([struck: ETP] WO-1017-12)। ট্যাংকে পানি ঢুকছে। |
| 14:00 | শিফট B শুরু। ETP বন্ধ। আউটফলের পানির pH 7.3 |
| 15:40 | ETP আবার চালু হয়েছে। স্বাভাবিকভাবে চলছে। |
| 16:10 | ETP ফিড পাম্পের সার্ভিসিং চলছে। বাকি ইউনিট চালু। (লেখা হয়েছে 18:05-এ) |
| 17:30 | ETP ফিড পাম্প আবার চালু হয়েছে। |
| 22:00 | শিফট C শুরু। ETP স্বাভাবিকভাবে চলছে। আউটফলের পানির pH 7.4 |

Differs from the script: a stray "ETP" inside the bracket is struck. The late note's time is written over; the writer confirmed it is 18:05.

Hard to read: the restart is 15:40 (confirmed by the writer), but the 5 is shaped like a 6 and it looks like 16:40. A reading of 16:40 counts as a misread, though an understandable one; it is worth noting whether the model flags it as out of order next to 16:10.

## Page 6 (English, demo case B's logbook)

Copied by hand from case B's simulated page, every entry the same, no slips. It replaces the rendered page in demo case B (`python -m api.demo real`); its line boxes for highlighting are in `page6-lines.json`. Page 6 is not part of the reading measurement above.

| Time | Remarks |
|---|---|
| 06:00 | Shift A start. ETP running normal. Outfall pH 7.3 |
| 06:25 | Lime dosed 35 kg |
| 11:40 | Aerator 2 serviced. Other units running |
| 13:20 | Aerator 2 back in service |
| 14:00 | Shift B start. ETP running normal. Outfall pH 7.3 |
| 14:25 | Lime dosed 40 kg |
| 22:00 | Shift C start. ETP running normal. Outfall pH 7.5 |
| 22:25 | Lime dosed 45 kg |
