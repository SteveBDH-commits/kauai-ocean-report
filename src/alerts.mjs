// Active NWS alerts for Kauai, from the free public API at api.weather.gov (no key; a User-Agent is required).
//
// Kauai alerts are selected two ways so we don't miss any:
//   1. the alert's UGC zone list overlaps the Kauai zones listed in the surf zone forecast, or
//   2. the alert's area description mentions "Kauai" (this catches the marine zones such as
//      "Kauai Windward Waters", which use a different zone-code prefix).

export const ALERTS_URL = 'https://api.weather.gov/alerts/active?area=HI';

const SEVERITY_RANK = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };

// Events a beach-goer should see prominently. Everything else for Kauai is still passed along, flagged false.
const OCEAN_RELEVANT_RE = /surf|rip current|beach|small craft|gale|storm|hurricane|tropical|tsunami|flood|wind|coastal|marine|seas|swell/i;

export function normalizeAlerts(geojson, { kauaiZones = [] } = {}) {
  const features = Array.isArray(geojson?.features) ? geojson.features : null;
  if (!features) throw new Error('Alerts response is not a GeoJSON FeatureCollection');

  const zoneSet = new Set(kauaiZones);
  const items = [];

  for (const f of features) {
    const p = f?.properties;
    if (!p) continue;
    if (p.status && p.status !== 'Actual') continue; // skip Test / Exercise / Draft
    if (p.messageType === 'Cancel') continue;

    const ugc = Array.isArray(p.geocode?.UGC) ? p.geocode.UGC : [];
    const inKauaiZone = ugc.some((z) => zoneSet.has(z));
    const mentionsKauai = /kauai/i.test(p.areaDesc || '');
    if (!inKauaiZone && !mentionsKauai) continue;

    items.push({
      id: p.id ?? null,
      event: p.event ?? 'Unknown',
      severity: p.severity ?? 'Unknown',
      urgency: p.urgency ?? 'Unknown',
      certainty: p.certainty ?? 'Unknown',
      headline: p.headline ?? null,
      description: p.description ?? null,
      instruction: p.instruction ?? null,
      areaDesc: p.areaDesc ?? null,
      senderName: p.senderName ?? null,
      sent: p.sent ?? null,
      effective: p.effective ?? null,
      onset: p.onset ?? null,
      expires: p.expires ?? null,
      ends: p.ends ?? null,
      oceanRelevant: OCEAN_RELEVANT_RE.test(p.event || ''),
    });
  }

  items.sort((a, b) => {
    const r = (SEVERITY_RANK[a.severity] ?? 4) - (SEVERITY_RANK[b.severity] ?? 4);
    if (r) return r;
    return String(a.onset || a.effective || '').localeCompare(String(b.onset || b.effective || ''));
  });
  return items;
}

/** Drop alerts whose end/expiry time has passed (used when re-showing older alerts after a failed refresh). */
export function dropExpiredAlerts(items, now = new Date()) {
  return items.filter((a) => {
    const end = a.ends || a.expires;
    return !end || new Date(end) > now;
  });
}

export async function fetchAlertsJson({ userAgent, fetchImpl = fetch, url = ALERTS_URL, timeoutMs = 20000 } = {}) {
  if (!userAgent) throw new Error('A User-Agent (with a contact email) is required by api.weather.gov');
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': userAgent, Accept: 'application/geo+json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Alerts request failed: HTTP ${res.status}`);
  return res.json();
}
