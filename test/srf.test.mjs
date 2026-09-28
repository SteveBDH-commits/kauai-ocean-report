import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSurfZoneForecast, getZoneForecast, expandUgc, SrfParseError } from '../src/srf.mjs';

const REAL = fs.readFileSync(new URL('./fixtures/srf-2026-09-27.txt', import.meta.url), 'utf8');
const kauai = (text) => getZoneForecast(parseSurfZoneForecast(text), 'Kauai');

test('product header, zones and discussion', () => {
  const p = parseSurfZoneForecast(REAL);
  assert.equal(p.product, 'SRFHFO');
  assert.equal(p.issuedAt, '2026-09-27T15:25:00-10:00');
  assert.deepEqual(p.zones.map((z) => z.name), ['Kauai', 'Oahu', 'Big Island Leeward']);
  assert.equal(p.discussion.length, 3);
  assert.match(p.discussion[0], /^A broad area of rough short period east swell/);
  assert.deepEqual(p.warnings, []);
});

test('Kauai zone: ids, issue and expiry times', () => {
  const k = kauai(REAL);
  assert.deepEqual(k.ugc, ['HIZ003', 'HIZ029', 'HIZ030', 'HIZ031']);
  assert.equal(k.issuedAt, '2026-09-27T15:25:00-10:00');
  assert.equal(k.expiresAt, '2026-09-29T02:30:00.000Z');
  assert.deepEqual(k.advisories, ['HIGH SURF ADVISORY FOR EAST FACING SHORES']);
  assert.deepEqual(k.warnings, []);
});

test('Kauai surf table: values, order and period/slot labels', () => {
  const k = kauai(REAL);
  assert.deepEqual(k.surfPeriods, ['Tonight', 'Monday']);
  assert.deepEqual(
    k.surf.east.map((c) => [c.period, c.slot, c.minFt, c.maxFt]),
    [['Tonight', 'PM', 9, 12], ['Tonight', 'AM', 7, 10], ['Monday', 'AM', 6, 8], ['Monday', 'PM', 6, 8]],
  );
  assert.deepEqual(k.surf.south[2], { period: 'Monday', slot: 'AM', minFt: 7, maxFt: 10, raw: '7-10' });
  assert.deepEqual(Object.keys(k.surf).sort(), ['east', 'north', 'south', 'west']);
});

test('zones with fewer shores only report the shores they have', () => {
  const p = parseSurfZoneForecast(REAL);
  assert.deepEqual(Object.keys(getZoneForecast(p, 'Big Island Leeward').surf).sort(), ['south', 'west']);
});

test('period text: weather, temperature, winds, UV, wrapped lines', () => {
  const p = parseSurfZoneForecast(REAL);
  const [tonight, monday] = getZoneForecast(p, 'Kauai').periods;
  assert.equal(tonight.name, 'Tonight');
  assert.equal(tonight.weather, 'Mostly cloudy. Scattered showers.');
  assert.deepEqual(tonight.temperature, { kind: 'low', text: 'In the mid 70s.' });
  assert.equal(monday.temperature.kind, 'high');
  assert.equal(monday.winds, 'East winds around 15 mph.');

  const oahuTonight = getZoneForecast(p, 'Oahu').periods[0];
  assert.equal(oahuTonight.weather, 'Mostly sunny until 6 PM, then mostly cloudy. Isolated showers.');
  assert.equal(getZoneForecast(p, 'Oahu').periods[1].uvIndex, 'Extreme.');

  const bigTonight = getZoneForecast(p, 'Big Island Leeward').periods[0];
  assert.equal(
    bigTonight.winds,
    'West winds around 5 mph, becoming south in the evening, then becoming northeast after midnight.',
  );
});

test('tides: continuation lines, midnight roll-over, negative heights', () => {
  const p = parseSurfZoneForecast(REAL);
  const tonight = getZoneForecast(p, 'Kauai').periods[0];
  const hanalei = tonight.tides.find((t) => t.station === 'Hanalei Bay');
  assert.deepEqual(hanalei.entries.map((e) => [e.type, e.heightFt, e.at]), [
    ['low', 0.1, '2026-09-27T20:32:00-10:00'],
    ['high', 2.2, '2026-09-28T03:52:00-10:00'], // after midnight -> next day
  ]);
  const naw = tonight.tides.find((t) => t.station === 'Nawiliwili');
  assert.equal(naw.entries.length, 3);
  assert.equal(naw.entries[2].at, '2026-09-28T04:53:00-10:00');

  const monday = getZoneForecast(p, 'Kauai').periods[1];
  assert.equal(monday.tides[0].entries[0].at, '2026-09-28T09:43:00-10:00');

  const kona = getZoneForecast(p, 'Big Island Leeward').periods[0].tides[0];
  assert.equal(kona.entries[1].heightFt, -0.1);
});

test('sunrise/sunset only on daytime periods, dated correctly', () => {
  const [tonight, monday] = kauai(REAL).periods;
  assert.equal(tonight.sunrise, null);
  assert.deepEqual(monday.sunrise, { text: '6:28 AM', at: '2026-09-28T06:28:00-10:00' });
  assert.deepEqual(monday.sunset, { text: '6:29 PM', at: '2026-09-28T18:29:00-10:00' });
});

// ---- Variants built from the real text (synthetic edits, clearly edge cases) ----------------------------

test('daytime-issue shape: labels "Today / Tuesday", slots AM PM AM PM', () => {
  const text = REAL
    .replaceAll('Tonight                    Monday', 'Today                      Tuesday')
    .replaceAll('PM     AM                  AM     PM', 'AM     PM                  AM     PM')
    .replaceAll('.TONIGHT...', '.TODAY...')
    .replaceAll('.MONDAY...', '.TUESDAY...');
  const k = kauai(text);
  assert.deepEqual(k.surfPeriods, ['Today', 'Tuesday']);
  assert.deepEqual(k.surf.east.map((c) => `${c.period} ${c.slot}`), ['Today AM', 'Today PM', 'Tuesday AM', 'Tuesday PM']);
  assert.equal(k.periods[0].name, 'Today');
  // Issued Sunday Sep 27, so "Tuesday" is Sep 29
  assert.equal(k.periods[1].tides[0].entries[0].at, '2026-09-29T09:43:00-10:00');
  assert.deepEqual(k.warnings, []);
});

test('no advisory headline -> empty advisories, other zones unaffected', () => {
  const text = REAL.replace('...HIGH SURF ADVISORY FOR EAST FACING SHORES...\n', '');
  const p = parseSurfZoneForecast(text);
  assert.deepEqual(getZoneForecast(p, 'Kauai').advisories, []);
  assert.deepEqual(getZoneForecast(p, 'Oahu').advisories, ['HIGH SURF ADVISORY FOR EAST FACING SHORES']);
});

test('multiple advisory headlines are all captured', () => {
  const text = REAL.replace(
    '...HIGH SURF ADVISORY FOR EAST FACING SHORES...\n',
    '...HIGH SURF ADVISORY FOR EAST FACING SHORES...\n...HIGH SURF WARNING FOR SOUTH FACING SHORES...\n',
  );
  assert.equal(kauai(text).advisories.length, 2);
});

test('odd surf value keeps raw text, nulls numbers, warns (does not throw)', () => {
  const k = kauai(REAL.replace('9-12', 'flat'));
  assert.deepEqual(k.surf.east[0], { period: 'Tonight', slot: 'PM', minFt: null, maxFt: null, raw: 'flat' });
  assert.equal(k.surf.east[1].maxFt, 10);
  assert.equal(k.warnings.length, 1);
  assert.match(k.warnings[0], /flat/);
});

test('wrong number of cells in a row -> that row is nulled with a warning, other rows intact', () => {
  const k = kauai(REAL.replace('9-12', '9 to 12'));
  assert.ok(k.surf.east.every((c) => c.minFt === null));
  assert.equal(k.surf.north[0].maxFt, 6);
  assert.match(k.warnings[0], /east facing: expected 4 values, found 6/);
});

test('structure change (table header renamed) throws instead of publishing wrong data', () => {
  assert.throws(() => parseSurfZoneForecast(REAL.replaceAll('Shores                  Surf', 'Beaches                 Surf')), SrfParseError);
});

test('non-SRF input and error pages throw SrfParseError', () => {
  assert.throws(() => parseSurfZoneForecast('hello'), SrfParseError);
  assert.throws(() => parseSurfZoneForecast('<html><body>503 Service Unavailable</body></html>'), SrfParseError);
  assert.throws(() => parseSurfZoneForecast(''), SrfParseError);
});

test('asking for a zone that is not in the product throws', () => {
  assert.throws(() => getZoneForecast(parseSurfZoneForecast(REAL), 'Molokai'), /Zone "Molokai" not found/);
});

test('CRLF line endings are handled', () => {
  const k = kauai(REAL.replace(/\n/g, '\r\n'));
  assert.equal(k.surf.east[0].maxFt, 12);
});

test('expandUgc', () => {
  assert.deepEqual(expandUgc('HIZ003-029>031'), ['HIZ003', 'HIZ029', 'HIZ030', 'HIZ031']);
  assert.deepEqual(expandUgc('HIZ006-007-009-032>035'), ['HIZ006', 'HIZ007', 'HIZ009', 'HIZ032', 'HIZ033', 'HIZ034', 'HIZ035']);
});
