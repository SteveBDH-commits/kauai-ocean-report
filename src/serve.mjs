// Local test server for the ocean report.
//
//   node src/serve.mjs            -> http://127.0.0.1:8080
//   PORT=9000 node src/serve.mjs
//
// The page asks this server for /api/ocean-report?source=live (real NWS data, cached 60 s)
// or ?source=sample (bundled real forecast + synthetic alerts, frozen in time).
// Listens on 127.0.0.1 only, so it is not reachable from other machines.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildReport, fetchForecastText } from './build.mjs';
import { fetchAlertsJson } from './alerts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(here, '..', 'public', 'index.html');
const FIXTURES = path.join(here, '..', 'test', 'fixtures');
const PORT = Number(process.env.PORT) || 8080;
const HAS_UA = Boolean(process.env.NWS_USER_AGENT);
const userAgent = process.env.NWS_USER_AGENT || 'KauaiBeachGuide-test (set NWS_USER_AGENT with a contact email)';

// The bundled sample is a real forecast from Sun Sep 27 2026, 3:25 PM HST. Freeze "now" shortly after
// it was issued so the sample always renders as a current forecast.
const SAMPLE_NOW = new Date('2026-09-28T02:00:00Z');

let liveCache = null;
let liveCacheAt = 0;

async function liveReport() {
  if (liveCache && Date.now() - liveCacheAt < 60_000) return liveCache;
  const { report } = await buildReport({
    previous: liveCache,
    getForecastText: () => fetchForecastText({ userAgent }),
    getAlertsJson: () => fetchAlertsJson({ userAgent }),
  });
  if (!HAS_UA) report.notes = ['NWS_USER_AGENT is not set. Set it to something like "KauaiBeachGuide (you@example.com)".'];
  liveCache = report;
  liveCacheAt = Date.now();
  return report;
}

async function sampleReport() {
  const { report } = await buildReport({
    now: SAMPLE_NOW,
    getForecastText: () => fs.readFile(path.join(FIXTURES, 'srf-2026-09-27.txt'), 'utf8'),
    getAlertsJson: async () => JSON.parse(await fs.readFile(path.join(FIXTURES, 'alerts-sample.geojson'), 'utf8')),
  });
  report.demo = { frozenAt: SAMPLE_NOW.toISOString(), note: 'Sample data: real forecast text from Sep 27 2026; alerts are hand-made test data.' };
  return report;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method !== 'GET') {
      res.writeHead(405).end('Method not allowed');
    } else if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(await fs.readFile(PAGE));
    } else if (url.pathname === '/api/ocean-report') {
      const report = url.searchParams.get('source') === 'sample' ? await sampleReport() : await liveReport();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(report));
    } else {
      res.writeHead(404).end('Not found');
    }
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Server error: ${e.message}`);
  }
});

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Try: PORT=9000 node src/serve.mjs` : e);
  process.exit(1);
});

// Open the page in the default browser (used by the double-click launchers via --open).
function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => console.log(`Could not open a browser automatically. Open ${url} yourself.`));
    child.unref();
  } catch {
    console.log(`Could not open a browser automatically. Open ${url} yourself.`);
  }
}

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`Ocean report test page: ${url}`);
  console.log('Leave this window open while you use the page. Close it (or press Ctrl+C) to stop.');
  if (!HAS_UA) console.log('Note: NWS_USER_AGENT is not set (see README). Live fetches may be rejected.');
  if (process.argv.includes('--open')) openBrowser(url);
});
