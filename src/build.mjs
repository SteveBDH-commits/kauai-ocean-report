// Builds ocean-report.json for the Kauai Beach Guide web app.
//
//   node src/build.mjs                      -> fetch live data, write out/ocean-report.json
//   node src/build.mjs --out public/data/ocean-report.json
//   node src/build.mjs --forecast-file test/fixtures/srf-2026-09-27.txt --alerts-file test/fixtures/alerts-sample.geojson
//
// Set NWS_USER_AGENT to something like "KauaiBeachGuide (you@example.com)" - api.weather.gov requires it.
//
// Safety behaviour: if a refresh fails, the last good data is kept but clearly marked "stale", and
// alerts that have since expired are dropped. The front end must show status + timestamps.

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSurfZoneForecast, getZoneForecast } from './srf.mjs';
import { normalizeAlerts, fetchAlertsJson, dropExpiredAlerts } from './alerts.mjs';

export const SRF_TEXT_URL = 'https://tgftp.nws.noaa.gov/data/raw/fz/fzhw52.phfo.srf.hfo.txt';
const LINKS = {
  forecast: 'https://www.weather.gov/hfo/SRF',
  alerts: 'https://api.weather.gov',
  beachSafety: 'https://hawaiibeachsafety.com',
};

export async function fetchForecastText({ userAgent, fetchImpl = fetch, url = SRF_TEXT_URL, timeoutMs = 20000 } = {}) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent || 'KauaiBeachGuide' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Forecast request failed: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trim()) throw new Error('Forecast response was empty');
  return text;
}

/**
 * Pure-ish builder: all I/O is injected so it can be tested offline.
 * Returns { report, refreshed } where refreshed says whether anything was successfully updated.
 */
export async function buildReport({ getForecastText, getAlertsJson, previous = null, now = new Date(), zoneName = 'Kauai' }) {
  const errors = [];
  let forecastOk = false;
  let alertsOk = false;

  // ---- Forecast -----------------------------------------------------------------------------
  let forecast;
  try {
    const parsed = parseSurfZoneForecast(await getForecastText());
    const zone = getZoneForecast(parsed, zoneName);
    const expired = new Date(zone.expiresAt) <= now;
    forecast = {
      status: expired ? 'expired' : 'ok',
      expired,
      fetchedAt: now.toISOString(),
      discussion: parsed.discussion,
      data: zone,
      warnings: [...parsed.warnings, ...zone.warnings],
    };
    forecastOk = true;
  } catch (e) {
    errors.push(`forecast: ${e.message}`);
    if (previous?.forecast?.data) {
      const expired = new Date(previous.forecast.data.expiresAt) <= now;
      forecast = { ...previous.forecast, status: 'stale', expired, error: e.message };
    } else {
      forecast = { status: 'missing', expired: null, fetchedAt: null, discussion: [], data: null, warnings: [], error: e.message };
    }
  }

  // ---- Alerts -------------------------------------------------------------------------------
  const kauaiZones = forecast.data?.ugc ?? previous?.forecast?.data?.ugc ?? [];
  let alerts;
  try {
    const items = normalizeAlerts(await getAlertsJson(), { kauaiZones });
    alerts = { status: 'ok', fetchedAt: now.toISOString(), items };
    alertsOk = true;
  } catch (e) {
    errors.push(`alerts: ${e.message}`);
    if (previous?.alerts?.fetchedAt) {
      alerts = { status: 'stale', fetchedAt: previous.alerts.fetchedAt, items: dropExpiredAlerts(previous.alerts.items || [], now), error: e.message };
    } else {
      alerts = { status: 'missing', fetchedAt: null, items: [], error: e.message };
    }
  }

  return {
    report: {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      zone: zoneName,
      forecast,
      alerts,
      errors,
      links: LINKS,
    },
    refreshed: forecastOk || alertsOk,
  };
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeAtomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, file);
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const out = arg('--out') || 'out/ocean-report.json';
  const forecastFile = arg('--forecast-file');
  const alertsFile = arg('--alerts-file');
  const userAgent = process.env.NWS_USER_AGENT || 'KauaiBeachGuide (set NWS_USER_AGENT with a contact email)';

  const previous = await readJsonIfExists(out);
  const { report, refreshed } = await buildReport({
    previous,
    getForecastText: () => (forecastFile ? fs.readFile(forecastFile, 'utf8') : fetchForecastText({ userAgent })),
    getAlertsJson: async () =>
      alertsFile ? JSON.parse(await fs.readFile(alertsFile, 'utf8')) : fetchAlertsJson({ userAgent }),
  });

  await writeAtomic(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`forecast: ${report.forecast.status}  alerts: ${report.alerts.status} (${report.alerts.items.length})  -> ${out}`);
  for (const e of report.errors) console.error(`  ! ${e}`);
  for (const w of report.forecast.warnings || []) console.error(`  ~ ${w}`);
  process.exitCode = refreshed ? 0 : 1; // non-zero only if nothing at all could be refreshed
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}
