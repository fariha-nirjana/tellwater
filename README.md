# Tellwater

**A garment's label can lead back to its water.** Tellwater checks a factory's claim that a batch's wastewater was treated, against the plant's own physical records, the way a careful auditor would, and shows every step. When the records can't settle it, it says so and asks for the one record that would.

Built for the Meta Global AI Developer Hackathon (Oct 26 to Nov 4, 2026), Indie track, problem statement *Build for Your World*.

**Live demo:** https://fariha-nirjana--tellwater-web.us-east.modal.run (prototype on simulated records; live Muse Spark runs are capped per visitor per day)

---

## Why this exists

Bangladesh's garment industry runs on dyeing, and dyeing runs on water. Factories keep logbooks and maintenance records; meters record power and flow; labs sample the outfall. Buyers mostly have to take the paperwork at its word, and the EU's coming digital product passports for textiles will carry whatever a factory declares.

> “The gap is not necessarily a lack of documentation; it is the difficulty of connecting the documents with real operating conditions.”
> — Rajib Singha, Vice President, Human Resources & Administration, Pearl Global Industries Ltd (formerly Group General Manager, HR & Compliance, Sterling Group). Quoted with permission.

Tellwater connects them. Its answer is meant to help honest factories prove it: a factory missing one record is asked for exactly that record, and its passport changes when it arrives.

## What it does

1. **The claim.** A batch's logbook says what happened (“Aerator 2 serviced 11:40–13:20, other units running”). Tellwater treats it as a claim to test, never a fact or an instruction.
2. **The investigation.** Muse Spark chooses one check at a time from a small set of tools (signal windows, water balances, power against load, replay detection, reading a meter photo against the feed, lab results), says why before each check, and keeps competing explanations open (normal operation, maintenance, shutdown, bypass, aeration cut, dilution, meter fault) until the evidence settles them. All arithmetic is done in code; the model interprets. Every citation in its finding is validated against the evidence it actually retrieved.
3. **Four possible answers.** *Evidence supports the treatment claim*, *Evidence contradicts the claim*, *Review required*, or *Insufficient evidence* with a precise evidence request. Every answer states its scope.
4. **A person decides.** A reviewer approves, changes or sends back the finding, with a written reason.
5. **The passport.** The decision is signed: SHA-256 fingerprints of every record the investigation could see and of the investigation itself, under an Ed25519 signature. The passport re-checks both every time it opens and names anything that changed. Each garment's QR code is a GS1 Digital Link (the format product passports use); the signed record can be embedded in any passport. Buyers can read it in ten languages (machine translation by Muse Spark, refused unless every number survives).

**Why a batch, not a garment?** Garments don't make wastewater; dye runs do. Fabric is dyed in lots and cut into many garments later, and a run's water mixes in the equalization tank with its neighbours before treatment, so there is no “this shirt's water”. Each assessment covers one dye run over its treatment window (production shifted by the plant's residence time), and every garment cut from that run carries the answer.

## How Meta's models are used

| Model | Role |
|---|---|
| **Muse Spark** (`muse-spark-1.3`, Meta Model API) | The investigator: tool use over the case, reading handwritten logbook photos, meter photos and lab reports itself (no transcription is given), keeping the explanations ledger. Also the thread guide (answers only from a case's investigation; citations it cannot back are removed) and the passport's translations. |
| **Muse Spark, vision** | Finds where each logbook line is on the photo so the interface can highlight it. Measured: padding the photo to a square takes lines placed right from **34% to 99.5%** (60 pages, 442 lines). |
| **Muse Spark Open** (open weights, on Fireworks) | The same investigation on open weights, for comparison. |
| **Muse Glimmer** (distilled, Fireworks serverless training) | Fine-tuned (LoRA) on 127 correct Muse Spark investigations, never the test set. Right answer on 8 of 8 fresh cases. |

## Results so far

All data is simulated: a physics-based simulator of a knit dyehouse (production, equalization tank, ETP with aeration, outfall, meters with noise, gaps, faults and tampering) and a document renderer (handwritten logbook photos, work orders, meter photos, lab reports). Each case is scored against its **justified** answer: what the available evidence can support, computed by a deterministic oracle, which may be weaker than what really happened. Guessing right without the evidence counts as an error.

Development set (60 cases, factory A):

| | C1 rules on sensors | C2 rules + document reading | C3 Muse Spark, everything at once | **C4 Muse Spark investigator** | C5 Muse Spark Open investigator |
|---|---|---|---|---|---|
| Agreement with the justified answer | 34 / 60 | 42 / 60 | 56 / 60 | **56 / 60** | 54 / 60 |
| Unsupported accusations | 11 | 9 | 0 | **0** | 0 |
| Missed problems | 1 | 0 | 0 | **0** | 0 |

- **More records:** with 3, 14 and 45 days of history, giving the model everything (C3) costs $0.10, $0.27 and $0.85 a case and stops fitting in context at about 70 days; the investigator (C4) stays at $0.18 to $0.23.
- **Fresh cases:** Muse Glimmer distilled, 8 of 8; a second, differently built factory (factory B), 10 of 10 after one general fix (the first run's miss is stated on the results page).
- **Held-out test set:** 120 cases (factories A and B), generated and frozen before any test run, SHA-256 `c49aa489…` in [`eval/frozen/test_manifest.json`](eval/frozen/test_manifest.json). **Results pending.**

## What we don't claim

- No compliance certification. An assessment covers one batch, its treatment window and the records it rests on, and says what it does not measure.
- No inference of intent. Missing evidence is a gap, not proof of wrongdoing.
- Simulated data only. Parameters are illustrative, with published sources marked in [`config/`](config/); a real deployment needs a pilot with a factory's own meters, logbooks and lab tests.
- Constant-volume treatment assumption in the plant model.
- One tuning case where our labelling rules and the investigator disagree: we kept our rules.

## Built during the hackathon

Every line of code in this repository was written during the hackathon, from Oct 26, 2026 (see the commit history). The concept and field research come from my earlier case-competition entry, AquaTrace (first runner-up), which I led with a team; no code from it was reused. Tellwater is a new name for new software built on that idea.

## Run it

Requires Python 3.14 and Node 20+.

```bash
python3.14 -m venv .venv
.venv/bin/pip install -e ".[dev]"
cp .env.example .env              # add MODEL_API_KEY (Meta Model API) for live runs
.venv/bin/pytest                  # 87 tests

.venv/bin/uvicorn api.app:app --port 8000
cd web && npm install && npx vite # http://localhost:5173
```

Saved investigations ship with the repo, so everything except live runs, the guide and translations works without a key. Rendering Bangla logbook pages needs Pillow's Raqm layout (`brew install fribidi`, then run with `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib`).

Evaluation:

```bash
.venv/bin/python -m eval.caseset dev              # generate the development set
.venv/bin/python -m eval.run_set dev C4           # run a condition and score it
.venv/bin/python -m api.demo results              # refresh the results page's snapshot
```

Deploy (Modal): `cd web && npx vite build && cd .. && .venv/bin/modal deploy deploy/modal_app.py`, with a Modal secret `tellwater` holding `MODEL_API_KEY` and `PASSPORT_SIGNING_KEY`.

## Repository

| Path | What it holds |
|---|---|
| `sim/` | Simulator, scenarios, document renderer, oracle (justified labels), Bangla logbook pages |
| `core/` | Physics: water balances, power model, treatment window |
| `agent/` | The investigator: tools, loop, prompts, citation validator, model clients (Muse Spark, Muse Spark Open, Muse Glimmer) |
| `eval/` | Case sets, frozen test manifest, conditions C1 to C6, metrics, line-finding measurement, distillation |
| `api/` | The demo's API: cases, live runs, guide, factory response, review, passport, translation, demo caps |
| `passport/` | The signed passport record (fingerprints, Ed25519, GS1 Digital Link) |
| `web/` | The interface (React) |
| `deploy/` | The Modal app |

## Credits and licences

- Fonts: Courier Prime, Caveat, Kalam, Reenie Beanie, DSEG7, Atma, Galada and Noto Sans Bengali (SIL Open Font License), Homemade Apple (Apache License 2.0); licence files in [`assets/fonts/`](assets/fonts/). Manrope and DM Sans via Google Fonts (OFL).
- Photographs in the story section: Unsplash (Unsplash License), image IDs 1770196035129-0a0affd4a519 and 1716462301593-5e075f013998; contextual only, not from any factory.
- Plant parameters: published Bangladesh textile ETP figures, including *Water and electricity consumption patterns with effluent quality in the textile processing industry of Bangladesh*, RSC Advances, doi:10.1039/D5RA05917H; the ECR 2023 textile effluent limit for BOD.
- Software: FastAPI, pandas, NumPy, Pillow, cryptography, the OpenAI Python client (for OpenAI-compatible endpoints), React, Vite, qrcode; Fireworks' cookbook (Apache-2.0) installed separately for Muse Glimmer training, not vendored.
- Interface design iterations explored with AI design tools and rebuilt here on the real engine.

Made by Fariha Tasnim (Nirjana).
