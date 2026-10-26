# Tellwater (working name)

Tellwater investigates whether a factory's wastewater treatment claim is supported by physical evidence, and says exactly what needs checking next when it cannot tell.

Work in progress for the Meta Global AI Developer Hackathon (Oct 26 to Nov 4, 2026).

**Concept origin.** The concept grew out of a national case competition I competed in with a team. All code in this repository is built during the hackathon.

**Data.** All factory data in this repository is simulated. Parameters in `config/` are illustrative; see the notes in each file.

## Run locally

```bash
python3.14 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/pytest
```
