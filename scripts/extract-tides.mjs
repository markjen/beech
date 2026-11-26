// Builds src/world/tideStations.json from the TICON-3 global tide-gauge
// harmonic constants (Hart-Davis et al., PANGAEA, CC-BY 4.0):
//   https://doi.org/10.1594/PANGAEA.951610
// Download TICON_3.zip from there, unzip, then:
//   node scripts/extract-tides.mjs /path/to/TICON_3.txt
// For each beach in src/world/locations.ts it picks the nearest *coastal* gauge and
// keeps the constituents the prediction engine (src/world/tides.ts) knows.
import fs from 'node:fs';

// The beaches (id, lat, lon) come straight from src/world/locations.ts.
const BEACHES = {};
for (const m of fs.readFileSync('src/world/locations.ts', 'utf8').matchAll(/id: '([a-z]+)'.*?lat: (-?[\d.]+), lon: (-?[\d.]+)/g)) {
  BEACHES[m[1]] = [+m[2], +m[3]];
}

const KNOWN = new Set([
  'M2', 'S2', 'N2', 'K2', 'K1', 'O1', 'P1', 'Q1', '2N2', 'MU2', 'NU2', 'L2', 'T2', 'J1',
  'M4', 'MS4', 'MN4', 'M6', 'MF', 'MM', 'SSA', 'SA', 'M3', 'S4', 'MK3', '2Q1', 'OO1', 'LDA2',
]);

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/extract-tides.mjs TICON_3.txt');
  process.exit(1);
}
const gauges = new Map(); // "lat,lon" -> { lat, lon, type, cons: {} }
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  const c = line.trim().split(/\t+/);
  if (c.length < 14) continue;
  const key = `${c[0]},${c[1]}`;
  let g = gauges.get(key);
  if (!g) {
    g = { lat: +c[0], lon: +c[1], type: c[13], source: c[12], cons: {} };
    gauges.set(key, g);
  }
  const name = c[2].toUpperCase();
  if (KNOWN.has(name)) g.cons[name] = [+(+c[3] / 100).toFixed(4), +(+c[4]).toFixed(2)]; // metres, degrees
}

const R = 6371;
const dist = (a, b, c, d) => {
  const r = Math.PI / 180;
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

const out = {};
for (const [id, [lat, lon]] of Object.entries(BEACHES)) {
  let best = null;
  for (const g of gauges.values()) {
    if (g.type !== 'Coastal' || !g.cons.M2) continue;
    const d = dist(lat, lon, g.lat, g.lon);
    if (!best || d < best.d) best = { d, g };
  }
  out[id] = {
    gauge: { lat: best.g.lat, lon: best.g.lon, km: +best.d.toFixed(1), source: best.g.source },
    cons: best.g.cons,
  };
  console.log(
    id.padEnd(12),
    `${best.d.toFixed(1).padStart(6)} km`,
    `M2 ${best.g.cons.M2[0].toFixed(3)} m`,
    `K1 ${(best.g.cons.K1?.[0] ?? 0).toFixed(3)} m`,
    `(${Object.keys(best.g.cons).length} constituents, ${best.g.source})`,
  );
}
fs.writeFileSync(
  'src/world/tideStations.json',
  JSON.stringify(
    {
      _source: 'TICON-3 (Hart-Davis et al.), https://doi.org/10.1594/PANGAEA.951610, CC-BY 4.0. Amplitudes in metres, Greenwich phase lags in degrees.',
      stations: out,
    },
    null,
    1,
  ),
);
