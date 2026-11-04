"""Open the interface a judge sees at http://localhost:5173 in a real browser (Chromium), page by page.

Each page must load with no script error and no failed API call, and show what it is for. A screenshot of
each is saved to the folder given as the first argument. Used by .github/workflows/judge-path.yml.
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173/"
# (page, text that must appear on it, case-insensitive)
PAGES = [
    ("#/", "tellwater"),
    ("#/case/B", "contradicts"),
    ("#/case/C", "tank"),
    ("#/passport/B", "passport"),
    ("#/trace", "trace"),
    ("#/factory", "factory"),
    ("#/how", "muse spark"),
    ("#/results", "120"),
]


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "screens")
    out.mkdir(parents=True, exist_ok=True)
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(f"script error: {e}"))
        page.on("console", lambda m: errors.append(f"console error: {m.text}") if m.type == "error" else None)
        page.on("response", lambda r: errors.append(f"{r.status} {r.url}") if "/api/" in r.url and r.status >= 400 else None)
        for route, text in PAGES:
            errors.clear()
            page.goto(BASE + route)
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(1500)  # let the page's own animations and API calls settle
            body = page.inner_text("body").lower()
            name = route.strip("#/").replace("/", "-") or "home"
            page.screenshot(path=str(out / f"{name}.png"))
            problems = list(errors) + ([] if text in body else [f"'{text}' is not on the page"])
            print(f"{'ok  ' if not problems else 'FAIL'} {route}" + "".join(f"\n       {x}" for x in problems))
            failures += problems
        browser.close()
    print("All pages load in a real browser." if not failures else f"{len(failures)} problem(s).")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
