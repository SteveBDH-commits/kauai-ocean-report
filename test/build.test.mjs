import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildReport } from '../src/build.mjs';

const SRF = fs.readFileSync(new URL('./fixtures/srf-2026-09-27.txt', import.meta.url), 'utf8');
const ALERTS = JSON.parse(fs.readFileSync(new URL('./fixtures/alerts-sample.geojson', import.meta.url), 'utf8'));
const ok = { getForecastText: async () => SRF, getAlertsJson: async () => ALERTS };
const boom = (msg) => async () => { throw new Error(msg); };

const T1 = new Date('2026-09-28T02:00:00Z'); // Sun 4:00 PM HST

test('happy path', async () => {
  const { report, refreshed } = await buildReport({ ...ok, now: T1 });
  assert.equal(refreshed, true);
  assert.equal(report.forecast.status, 'ok');
  assert.equal(report.forecast.data.name, 'Kauai');
  assert.equal(report.alerts.status, 'ok');
  assert.deepEqual(report.alerts.items.map((a) => a.event), ['High Surf Advisory', 'Special Weather Statement', 'Small Craft Advisory']);
  assert.deepEqual(report.errors, []);
});

test('a forecast that has passed its expiry time is flagged expired', async () => {
  const { report } = await buildReport({ ...ok, now: new Date('2026-09-30T00:00:00Z') });
  assert.equal(report.forecast.status, 'expired');
  assert.equal(report.forecast.expired, true);
});

test('forecast refresh fails -> last good forecast kept, marked stale; alerts still refresh', async () => {
  const first = (await buildReport({ ...ok, now: T1 })).report;
  const { report, refreshed } = await buildReport({
    getForecastText: boom('HTTP 503'),
    getAlertsJson: async () => ALERTS,
    previous: first,
    now: new Date('2026-09-28T03:00:00Z'),
  });
  assert.equal(refreshed, true);
  assert.equal(report.forecast.status, 'stale');
  assert.equal(report.forecast.fetchedAt, first.forecast.fetchedAt); // NOT re-stamped as fresh
  assert.deepEqual(report.forecast.data, first.forecast.data);
  assert.match(report.forecast.error, /503/);
  assert.equal(report.alerts.status, 'ok');
});

test('garbled forecast (parse error) is treated like a failed fetch, not published', async () => {
  const first = (await buildReport({ ...ok, now: T1 })).report;
  const { report } = await buildReport({
    getForecastText: async () => SRF.replaceAll('Shores                  Surf', 'Beaches                 Surf'),
    getAlertsJson: async () => ALERTS,
    previous: first,
    now: new Date('2026-09-28T03:00:00Z'),
  });
  assert.equal(report.forecast.status, 'stale');
  assert.deepEqual(report.forecast.data, first.forecast.data);
});

test('alerts refresh fails -> previous alerts kept as stale, expired ones dropped', async () => {
  const first = (await buildReport({ ...ok, now: T1 })).report;
  const { report } = await buildReport({
    getForecastText: async () => SRF,
    getAlertsJson: boom('timeout'),
    previous: first,
    now: new Date('2026-09-28T16:30:00Z'), // 06:30 HST Monday: surf advisory ended, statement expired
  });
  assert.equal(report.alerts.status, 'stale');
  assert.equal(report.alerts.fetchedAt, first.alerts.fetchedAt);
  assert.deepEqual(report.alerts.items.map((a) => a.event), ['Small Craft Advisory']);
});

test('nothing works and nothing to fall back on -> "missing", refreshed=false', async () => {
  const { report, refreshed } = await buildReport({ getForecastText: boom('down'), getAlertsJson: boom('down'), now: T1 });
  assert.equal(refreshed, false);
  assert.equal(report.forecast.status, 'missing');
  assert.equal(report.forecast.data, null);
  assert.equal(report.alerts.status, 'missing');
  assert.equal(report.errors.length, 2);
});
