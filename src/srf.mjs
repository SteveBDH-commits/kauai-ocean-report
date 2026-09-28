// Parser for the NWS Honolulu "Surf Zone Forecast for Hawaii" (product SRFHFO / WMO header FZHW52 PHFO).
//
// Design rules:
//  * Never guess. If the overall structure isn't what we expect, throw SrfParseError so the caller keeps
//    the last good data instead of publishing something wrong.
//  * If a single cell/value is odd, keep the raw text, null the numbers, and record a warning.
//  * Times in the product are Hawaii Standard Time (UTC-10, no daylight saving).

export class SrfParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SrfParseError';
  }
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const HST_OFFSET_HOURS = 10;

const WMO_RE = /^(\w{6}) (\w{4}) (\d{2})(\d{2})(\d{2})\s*$/;
const ISSUE_RE = /^(\d{1,2})(\d{2}) (AM|PM) HST \w{3} (\w{3}) (\d{1,2}) (\d{4})\s*$/;
const UGC_RE = /^([A-Z]{2}Z[\dA-Z>-]*?)-(\d{2})(\d{2})(\d{2})-\s*$/;
const PERIOD_RE = /^\.([A-Z][A-Z ]*?)\.\.\.\s*$/;
const ADVISORY_RE = /^\.\.\.(.+?)\.\.\.\s*$/;
const KEY_RE = /^([A-Za-z][A-Za-z ]*?)\.{3,}\s*(.*)$/;
const STATION_RE = /^\s+([A-Za-z][A-Za-z '-]*?)\.{2,}\s*(.*)$/;
const TIDE_RE = /(High|Low)\s+(-?\d+(?:\.\d+)?)\s+feet\s+(\d{1,2}:\d{2})\s+([AP]M)\s+HST/g;
const FACING_ROW_RE = /^(North|East|South|West)\s+Facing\s+(.*)$/;

const pad = (n) => String(n).padStart(2, '0');

// "Naive" HST wall-clock times are kept in a Date whose UTC fields hold the HST wall-clock values.
// This makes day roll-over arithmetic trivial and avoids any dependence on the server's time zone.
const naive = (y, mo, d, h = 0, mi = 0) => new Date(Date.UTC(y, mo, d, h, mi));
const fmtHst = (dt) =>
  `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:00-10:00`;
const hstToInstant = (dt) => new Date(dt.getTime() + HST_OFFSET_HOURS * 3600 * 1000);
const to24 = (h12, ampm) => (Number(h12) % 12) + (ampm === 'PM' ? 12 : 0);

function parseIssueLine(line) {
  const m = ISSUE_RE.exec(line.trim());
  if (!m) return null;
  const [, hh, mm, ampm, mon, day, year] = m;
  if (!(mon in MONTHS)) return null;
  const dt = naive(Number(year), MONTHS[mon], Number(day), to24(hh, ampm), Number(mm));
  return { naive: dt, iso: fmtHst(dt), instant: hstToInstant(dt) };
}

/** Expand a UGC zone string such as "HIZ003-029>031" into ["HIZ003","HIZ029","HIZ030","HIZ031"]. */
export function expandUgc(ugc) {
  const out = [];
  let prefix = null;
  for (const token of ugc.split('-')) {
    const m = /^(?:([A-Z]{2}Z))?(\d{3})(?:>(\d{3}))?$/.exec(token);
    if (!m) continue;
    if (m[1]) prefix = m[1];
    if (!prefix) continue;
    const from = Number(m[2]);
    const to = m[3] ? Number(m[3]) : from;
    for (let n = from; n <= to; n++) out.push(`${prefix}${String(n).padStart(3, '0')}`);
  }
  return out;
}

const titleCase = (s) =>
  s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, 'of');

function unwrapParagraphs(lines) {
  return lines
    .join('\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function periodBaseDate(key, issued) {
  const first = key.split(' ')[0];
  const y = issued.naive.getUTCFullYear();
  const mo = issued.naive.getUTCMonth();
  const d = issued.naive.getUTCDate();
  if (['TODAY', 'TONIGHT', 'REST', 'THIS', 'LATE'].includes(first)) return naive(y, mo, d);
  const wd = WEEKDAYS.indexOf(first);
  if (wd >= 0) {
    let diff = (wd - issued.naive.getUTCDay() + 7) % 7;
    if (diff === 0) diff = 7;
    return naive(y, mo, d + diff);
  }
  return null;
}

function clockToNaive(base, timeText, ampm, dayOffset = 0) {
  const [h, m] = timeText.split(':').map(Number);
  return naive(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + dayOffset, to24(h, ampm), m);
}

function parseTides(text, base, warnings, label, station) {
  const entries = [];
  let dayOffset = 0;
  let prevMinutes = -1;
  for (const m of text.matchAll(TIDE_RE)) {
    const [, type, height, clock, ampm] = m;
    const minutes = to24(clock.split(':')[0], ampm) * 60 + Number(clock.split(':')[1]);
    // Listed times ascend through the period; a drop (e.g. 09:54 PM -> 04:53 AM) means we crossed midnight.
    if (prevMinutes >= 0 && minutes < prevMinutes) dayOffset += 1;
    prevMinutes = minutes;
    entries.push({
      type: type.toLowerCase(),
      heightFt: Number(height),
      timeText: `${clock} ${ampm}`,
      at: base ? fmtHst(clockToNaive(base, clock, ampm, dayOffset)) : null,
    });
  }
  if (!entries.length) warnings.push(`${label}: no tide entries parsed for ${station} ("${text}")`);
  return entries;
}

function parseSection(key, bodyLines, issued, warnings) {
  const label = titleCase(key);
  const base = periodBaseDate(key, issued);
  if (!base) warnings.push(`Period "${key}": could not work out its date; tide/sun times will have at:null`);

  const fields = {};
  const stations = [];
  let cur = null;
  let curStation = null;

  for (const raw of bodyLines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^\S/.test(line)) {
      const m = KEY_RE.exec(line);
      if (!m) {
        warnings.push(`Period "${key}": unrecognised line "${line}"`);
        cur = null;
        continue;
      }
      cur = m[1].trim();
      curStation = null;
      if (cur !== 'Tides') fields[cur] = m[2].trim();
    } else if (cur === 'Tides') {
      const sm = STATION_RE.exec(line);
      if (sm) {
        curStation = { station: sm[1].trim(), text: sm[2].trim() };
        stations.push(curStation);
      } else if (curStation) {
        curStation.text += ' ' + line.trim(); // continuation line: more tide entries for the same station
      } else {
        warnings.push(`Period "${key}": tide line before any station: "${line}"`);
      }
    } else if (cur) {
      fields[cur] += ' ' + line.trim(); // wrapped text (weather / winds)
    }
  }

  const clock = (text) => {
    const m = /(\d{1,2}:\d{2})\s+([AP]M)/.exec(text || '');
    if (!m) return null;
    return { text: `${m[1]} ${m[2]}`, at: base ? fmtHst(clockToNaive(base, m[1], m[2])) : null };
  };

  let temperature = null;
  if (fields['Low Temperature'] != null) temperature = { kind: 'low', text: fields['Low Temperature'] };
  else if (fields['High Temperature'] != null) temperature = { kind: 'high', text: fields['High Temperature'] };

  return {
    key,
    name: label,
    weather: fields['Weather'] ?? null,
    temperature,
    winds: fields['Winds'] ?? null,
    uvIndex: fields['UV Index'] ?? null,
    tides: stations.map((s) => ({ station: s.station, entries: parseTides(s.text, base, warnings, label, s.station) })),
    sunrise: clock(fields['Sunrise']),
    sunset: clock(fields['Sunset']),
  };
}

function parseSurfCell(raw, warnings, ctx) {
  let m = /^(\d+)-(\d+)$/.exec(raw);
  if (m) return { minFt: Number(m[1]), maxFt: Number(m[2]), raw };
  m = /^(\d+)$/.exec(raw);
  if (m) return { minFt: Number(m[1]), maxFt: Number(m[1]), raw };
  warnings.push(`${ctx}: surf value "${raw}" is not a number or range; numbers left null`);
  return { minFt: null, maxFt: null, raw };
}

function parseZone(ugcMatch, name, lines, issued, expiresAt) {
  const warnings = [];
  const tableStart = lines.findIndex((l) => /^\s*Shores\s+Surf/.test(l));
  if (tableStart < 0) throw new SrfParseError(`Zone "${name}": surf table header not found`);

  // Period labels sit on the nearest non-blank, non-rule line above "Shores  Surf".
  let li = tableStart - 1;
  while (li >= 0 && (!lines[li].trim() || /^_+\s*$/.test(lines[li].trim()))) li--;
  if (li < 0) throw new SrfParseError(`Zone "${name}": surf table period labels not found`);
  const labels = lines[li].trim().split(/\s{2,}/);

  const slotLine = lines[tableStart + 1] || '';
  if (!/^\s*(?:(?:AM|PM)\s*)+$/.test(slotLine)) throw new SrfParseError(`Zone "${name}": AM/PM slot line not found`);
  const slots = slotLine.trim().split(/\s+/);
  if (!labels.length || slots.length % labels.length !== 0) {
    throw new SrfParseError(`Zone "${name}": ${slots.length} slots do not divide evenly into ${labels.length} periods`);
  }
  const perPeriod = slots.length / labels.length;

  const firstPeriod = lines.findIndex((l) => PERIOD_RE.test(l));
  const tableEnd = firstPeriod < 0 ? lines.length : firstPeriod;

  const advisories = lines
    .slice(0, tableStart)
    .map((l) => ADVISORY_RE.exec(l.trim()))
    .filter(Boolean)
    .map((m) => m[1].trim());

  const surf = {};
  for (const line of lines.slice(tableStart + 2, tableEnd)) {
    const m = FACING_ROW_RE.exec(line.trim());
    if (!m) continue;
    const facing = m[1].toLowerCase();
    const tokens = m[2].trim().split(/\s+/);
    if (tokens.length !== slots.length) {
      warnings.push(`${facing} facing: expected ${slots.length} values, found ${tokens.length} ("${m[2].trim()}")`);
      surf[facing] = slots.map((slot, i) => ({ period: labels[Math.floor(i / perPeriod)], slot, minFt: null, maxFt: null, raw: null }));
      continue;
    }
    surf[facing] = tokens.map((tok, i) => ({
      period: labels[Math.floor(i / perPeriod)],
      slot: slots[i],
      ...parseSurfCell(tok, warnings, `${facing} facing`),
    }));
  }
  if (!Object.keys(surf).length) throw new SrfParseError(`Zone "${name}": no surf rows found`);

  // Period sections (.TONIGHT..., .MONDAY..., etc.)
  const periods = [];
  if (firstPeriod >= 0) {
    let key = null;
    let body = [];
    const flush = () => key && periods.push(parseSection(key, body, issued, warnings));
    for (const line of lines.slice(firstPeriod)) {
      const pm = PERIOD_RE.exec(line);
      if (pm) {
        flush();
        key = pm[1].trim();
        body = [];
      } else if (key) body.push(line);
    }
    flush();
  }

  const ugcRaw = ugcMatch[1];
  return {
    name,
    ugcRaw,
    ugc: expandUgc(ugcRaw),
    issuedAt: issued.iso,
    expiresAt: expiresAt.toISOString(),
    advisories,
    surfPeriods: labels,
    surf,
    periods,
    warnings,
  };
}

/**
 * Parse the whole product. Returns { product, wmoHeader, issuedAt, discussion, zones[] }.
 * Throws SrfParseError if this doesn't look like an SRF product at all.
 */
export function parseSurfZoneForecast(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const productWarnings = [];

  const wmoIdx = lines.findIndex((l) => l.trim());
  const wmo = wmoIdx >= 0 ? WMO_RE.exec(lines[wmoIdx]) : null;
  if (!wmo) throw new SrfParseError('Not an NWS text product: WMO header line not found');
  if (!lines.some((l) => /^SRFHFO\s*$/.test(l.trim()))) throw new SrfParseError('Not the SRFHFO product');

  const ugcIdxs = [];
  lines.forEach((l, i) => UGC_RE.test(l.trim()) && ugcIdxs.push(i));
  if (!ugcIdxs.length) throw new SrfParseError('No forecast zones found in product');

  const head = lines.slice(0, ugcIdxs[0]);
  let productIssued = null;
  for (const l of head) {
    productIssued = parseIssueLine(l);
    if (productIssued) break;
  }
  if (!productIssued) throw new SrfParseError('Product issue time not found');

  const dIdx = head.findIndex((l) => /^\.DISCUSSION\.\.\.\s*$/.test(l.trim()));
  const discussion = dIdx >= 0 ? unwrapParagraphs(head.slice(dIdx + 1)) : [];

  // Cross-check the issue time against the WMO header (day/hour/minute in UTC). Warn, don't fail.
  const [, , , dd, hh, mm] = wmo;
  const diffs = [-1, 0, 1].map((off) => {
    const i = productIssued.instant;
    const cand = Date.UTC(i.getUTCFullYear(), i.getUTCMonth() + off, Number(dd), Number(hh), Number(mm));
    return Math.abs(cand - i.getTime()) / 60000;
  });
  if (Math.min(...diffs) > 10) productWarnings.push('Issue time in body disagrees with WMO header time');

  const zones = [];
  ugcIdxs.forEach((start, n) => {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].trim() === '$$') { end = i; break; }
    }
    if (n + 1 < ugcIdxs.length) end = Math.min(end, ugcIdxs[n + 1]);

    const ugcMatch = UGC_RE.exec(lines[start].trim());
    const name = (lines[start + 1] || '').trim().replace(/-$/, '');
    const issued = parseIssueLine(lines[start + 2] || '');
    if (!name || !issued) throw new SrfParseError(`Zone block at line ${start + 1}: name or issue time missing`);

    // Expiry from the UGC line: -DDHHMM- in UTC. Roll to next month if it would land before issuance.
    const [, , dd2, hh2, mm2] = ugcMatch;
    let expires = new Date(Date.UTC(issued.instant.getUTCFullYear(), issued.instant.getUTCMonth(), Number(dd2), Number(hh2), Number(mm2)));
    if (expires < issued.instant) {
      expires = new Date(Date.UTC(issued.instant.getUTCFullYear(), issued.instant.getUTCMonth() + 1, Number(dd2), Number(hh2), Number(mm2)));
    }
    zones.push(parseZone(ugcMatch, name, lines.slice(start + 3, end), issued, expires));
  });

  return {
    product: 'SRFHFO',
    wmoHeader: lines[wmoIdx].trim(),
    issuedAt: productIssued.iso,
    discussion,
    zones,
    warnings: productWarnings,
  };
}

/** Pick one zone (e.g. "Kauai") out of a parsed product. Throws if it is missing. */
export function getZoneForecast(parsed, name) {
  const zone = parsed.zones.find((z) => z.name.toLowerCase() === name.toLowerCase());
  if (!zone) {
    throw new SrfParseError(`Zone "${name}" not found (have: ${parsed.zones.map((z) => z.name).join(', ')})`);
  }
  return zone;
}
