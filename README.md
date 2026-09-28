# Kauai ocean report builder

Fetches official NWS Honolulu data and writes one JSON file (`ocean-report.json`) for the Kauai Beach Guide web app.

**Sources**
- Surf Zone Forecast (product SRFHFO): surf height per shore (N/E/S/W) by AM/PM, weather, winds, tides (Hanalei Bay, Nawiliwili), sunrise/sunset, advisory headlines, forecaster discussion.
- Active alerts from `api.weather.gov` (High Surf, Small Craft, etc.), filtered to Kauai.

## Quick start (test page)
Needs Node.js 20 or newer (nodejs.org, LTS) installed once. After that, no typing:

- **Windows:** double-click `start-windows.bat`.
- **Mac:** double-click `start-mac.command`. (If macOS refuses because the file came from a download, right-click it, choose Open, then Open again.)

Before the first run, open the launcher in a text editor and replace `add-your-email@example.com` with your real email.
NWS asks people who use its data service to identify themselves. Save, then double-click.

A black/terminal window opens (leave it open; closing it stops the page) and your browser opens the test page at
http://127.0.0.1:8080. The page runs only on your own computer.

On the page:
- **Live from NWS** is the real test. Both status pills should say "Current" and "Problems found" should not appear.
- **Sample data** checks the page itself using a saved real forecast (works offline).

What to look for on the first live run:
- The alert text matches what weather.gov/hfo shows for Kauai right now.
- Surf numbers match the Kauai section of https://www.weather.gov/hfo/SRF
- If anything looks wrong, expand "Raw JSON" at the bottom of the page and save it; that is what to bring back.

Prefer a terminal? `npm test` runs the 29 automated tests (no internet needed, expect "pass 29, fail 0"), and
`npm start` starts the page (set `NWS_USER_AGENT` first; `PORT=9000 npm start` if port 8080 is busy).

## Sharing it with someone else
See `PUBLISHING.md`: it publishes the page to a web link (GitHub Pages) that refreshes itself every ~30 minutes.

## Command line (no page)
Requires Node 20+. No dependencies.

    npm test                                   # 29 tests, fully offline
    export NWS_USER_AGENT="KauaiBeachGuide (your-email@example.com)"   # required by api.weather.gov
    node src/build.mjs --out public/data/ocean-report.json

Offline demo with the bundled samples:

    node src/build.mjs --forecast-file test/fixtures/srf-2026-09-27.txt --alerts-file test/fixtures/alerts-sample.geojson

Schedule it every 30-60 minutes (cron, GitHub Actions, Netlify/Cloudflare scheduled function, etc.).
Exit code is 1 only if *nothing* could be refreshed, so a scheduler can alert you.

## Output
`forecast.status` and `alerts.status` are each `ok`, `expired`, `stale` (refresh failed; last good data kept) or `missing`.
The web app MUST show the status, the issue time (`forecast.data.issuedAt`) and a link to the official source,
and must not present `stale`/`expired`/`missing` data as current. Forecast times are Hawaii Standard Time (UTC-10).

## Safety behaviour
- Parser never guesses: if the product's structure changes it throws, and the previous good report is kept (marked `stale`).
- An odd single value (e.g. "flat") keeps its raw text, nulls the numbers and adds an entry to `forecast.warnings`.
- On a failed alerts refresh, previously fetched alerts are kept but marked `stale`, and any that have ended are dropped.

## What has and hasn't been verified
- VERIFIED against a real forecast (issued Sun Sep 27 2026, fixture trimmed to 3 zones): all parsing incl. wrapped lines, midnight tide roll-over, negative tides, expiry from the zone code.
- SYNTHETIC: `alerts-sample.geojson` was built by hand from the documented API shape. The first real run must be checked against a live response (field names, zone codes, and whether Kauai's surf advisories match on zone or on area name).
- NOT YET TESTED: the GitHub Actions workflow (YAML checked, never run on GitHub) and the static page against a real GitHub Pages site.
- NOT YET TESTED: live network fetch (the build sandbox couldn't reach weather.gov). Do a first run on your own machine.
- Only the daytime (AM/PM) column order and one advisory shape were exercised via edited copies of the real text; capture a few more real forecasts (morning issue, no advisory, advisory + warning) and add them as fixtures.
