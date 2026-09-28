import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeAlerts, dropExpiredAlerts } from '../src/alerts.mjs';

const GJ = JSON.parse(fs.readFileSync(new URL('./fixtures/alerts-sample.geojson', import.meta.url), 'utf8'));
const KAUAI_ZONES = ['HIZ003', 'HIZ029', 'HIZ030', 'HIZ031'];

test('keeps Kauai alerts (by zone or by area name), drops Maui-only and Test alerts', () => {
  const items = normalizeAlerts(GJ, { kauaiZones: KAUAI_ZONES });
  const events = items.map((a) => a.event).sort();
  assert.deepEqual(events, ['High Surf Advisory', 'Small Craft Advisory', 'Special Weather Statement']);
  assert.ok(!items.some((a) => a.id === 'urn:test:3')); // Maui/Molokai
  assert.ok(!items.some((a) => a.event === 'Tsunami Warning')); // status: Test
});

test('marine alert with a PHZ zone is still caught via its area name', () => {
  const items = normalizeAlerts(GJ, { kauaiZones: [] }); // no zone list at all
  assert.ok(items.some((a) => a.event === 'Small Craft Advisory'));
  assert.ok(items.some((a) => a.event === 'High Surf Advisory')); // areaDesc mentions Kauai
});

test('sorted most severe first; ocean-relevant flag', () => {
  const items = normalizeAlerts(GJ, { kauaiZones: KAUAI_ZONES });
  assert.equal(items[0].event, 'High Surf Advisory');
  const byEvent = Object.fromEntries(items.map((a) => [a.event, a.oceanRelevant]));
  assert.deepEqual(byEvent, { 'High Surf Advisory': true, 'Small Craft Advisory': true, 'Special Weather Statement': false });
});

test('rejects a response that is not a FeatureCollection', () => {
  assert.throws(() => normalizeAlerts({ title: 'error' }), /not a GeoJSON FeatureCollection/);
});

test('empty feature list is a valid "no alerts" answer', () => {
  assert.deepEqual(normalizeAlerts({ features: [] }), []);
});

test('dropExpiredAlerts uses ends, falling back to expires', () => {
  const items = normalizeAlerts(GJ, { kauaiZones: KAUAI_ZONES });
  const at = (iso) => dropExpiredAlerts(items, new Date(iso)).map((a) => a.event).sort();
  assert.equal(at('2026-09-28T01:00:00Z').length, 3);
  assert.deepEqual(at('2026-09-28T16:30:00Z'), ['Small Craft Advisory']); // 06:30 HST Monday
});
