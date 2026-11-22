// Harmonic tide prediction: h(t) = Σ f·A·cos(V(t) + u − G)
//
//   A, G  amplitude (m) and Greenwich phase lag (deg) of each constituent,
//         from a real tide gauge (TICON-3, see tideStations.json)
//   V     equilibrium argument at time t (from the Doodson numbers and the
//         mean longitudes of the moon, sun, lunar perigee and node)
//   f, u  nodal amplitude factor and phase correction (18.6-year cycle),
//         standard Schureman/Doodson approximations
//
// Accurate to a few centimetres and a few minutes against official
// predictions (see tests/tides.test.ts), which is far better than a diorama
// needs, and it runs fully offline.

const RAD = Math.PI / 180;

export type Constituents = Record<string, [amplitude: number, phaseDeg: number]>;

interface Astro {
  /** hour angle of the mean sun, + 180 (deg) */
  T: number;
  /** mean longitude of the moon */
  s: number;
  /** mean longitude of the sun */
  h: number;
  /** longitude of the lunar perigee */
  p: number;
  /** longitude of the moon's ascending node */
  N: number;
  /** longitude of the solar perigee */
  p1: number;
}

/** Mean astronomical longitudes (deg) at a UTC time (Meeus). */
export function astro(date: Date): Astro {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const Tc = (jd - 2451545.0) / 36525;
  const ut = ((date.getTime() / 3600000) % 24 + 24) % 24;
  return {
    T: 15 * ut + 180,
    s: 218.3164477 + 481267.88123421 * Tc,
    h: 280.46646 + 36000.76983 * Tc,
    p: 83.3532465 + 4069.0137287 * Tc,
    N: 125.04452 - 1934.136261 * Tc,
    p1: 282.93735 + 1.71946 * Tc,
  };
}

type Nodal = (N: number) => [f: number, u: number];

const one: Nodal = () => [1, 0];
const m2: Nodal = (N) => [1.0004 - 0.0373 * Math.cos(N * RAD) + 0.0002 * Math.cos(2 * N * RAD), -2.14 * Math.sin(N * RAD)];
const k1: Nodal = (N) => [
  1.006 + 0.115 * Math.cos(N * RAD) - 0.0088 * Math.cos(2 * N * RAD) + 0.0006 * Math.cos(3 * N * RAD),
  -8.86 * Math.sin(N * RAD) + 0.68 * Math.sin(2 * N * RAD) - 0.07 * Math.sin(3 * N * RAD),
];
const o1: Nodal = (N) => [
  1.0089 + 0.1871 * Math.cos(N * RAD) - 0.0147 * Math.cos(2 * N * RAD) + 0.0014 * Math.cos(3 * N * RAD),
  10.8 * Math.sin(N * RAD) - 1.34 * Math.sin(2 * N * RAD) + 0.19 * Math.sin(3 * N * RAD),
];
const k2: Nodal = (N) => [
  1.0241 + 0.2863 * Math.cos(N * RAD) + 0.0083 * Math.cos(2 * N * RAD) - 0.0015 * Math.cos(3 * N * RAD),
  -17.74 * Math.sin(N * RAD) + 0.68 * Math.sin(2 * N * RAD) - 0.04 * Math.sin(3 * N * RAD),
];
const j1: Nodal = (N) => [
  1.0129 + 0.1676 * Math.cos(N * RAD) - 0.017 * Math.cos(2 * N * RAD) + 0.0016 * Math.cos(3 * N * RAD),
  -12.94 * Math.sin(N * RAD) + 1.34 * Math.sin(2 * N * RAD) - 0.19 * Math.sin(3 * N * RAD),
];
const mf: Nodal = (N) => [
  1.043 + 0.414 * Math.cos(N * RAD),
  -23.74 * Math.sin(N * RAD) + 2.68 * Math.sin(2 * N * RAD) - 0.38 * Math.sin(3 * N * RAD),
];
const mm: Nodal = (N) => [1.0 - 0.13 * Math.cos(N * RAD), 0];
const pow = (base: Nodal, n: number): Nodal => (N) => {
  const [f, u] = base(N);
  return [Math.pow(f, n), u * n];
};
const prod = (a: Nodal, b: Nodal): Nodal => (N) => {
  const [fa, ua] = a(N);
  const [fb, ub] = b(N);
  return [fa * fb, ua + ub];
};

/**
 * Doodson multipliers of (T, s, h, p, N', p1) plus a phase offset (deg), and
 * the nodal correction. T is the mean solar hour angle + 180°. The offsets
 * follow Schureman (the NOAA convention, which TICON's Greenwich lags also
 * use): K1/J1/OO1 −90°, O1/P1/Q1 +90°.
 */
const TABLE: Record<string, { d: [number, number, number, number, number, number]; off: number; nodal: Nodal }> = {
  M2: { d: [2, -2, 2, 0, 0, 0], off: 0, nodal: m2 },
  S2: { d: [2, 0, 0, 0, 0, 0], off: 0, nodal: one },
  N2: { d: [2, -3, 2, 1, 0, 0], off: 0, nodal: m2 },
  K2: { d: [2, 0, 2, 0, 0, 0], off: 0, nodal: k2 },
  '2N2': { d: [2, -4, 2, 2, 0, 0], off: 0, nodal: m2 },
  MU2: { d: [2, -4, 4, 0, 0, 0], off: 0, nodal: m2 },
  NU2: { d: [2, -3, 4, -1, 0, 0], off: 0, nodal: m2 },
  L2: { d: [2, -1, 2, -1, 0, 0], off: 180, nodal: m2 },
  T2: { d: [2, 0, -1, 0, 0, 1], off: 0, nodal: one },
  LDA2: { d: [2, -1, 0, 1, 0, 0], off: 180, nodal: m2 },
  K1: { d: [1, 0, 1, 0, 0, 0], off: -90, nodal: k1 },
  O1: { d: [1, -2, 1, 0, 0, 0], off: 90, nodal: o1 },
  P1: { d: [1, 0, -1, 0, 0, 0], off: 90, nodal: one },
  Q1: { d: [1, -3, 1, 1, 0, 0], off: 90, nodal: o1 },
  '2Q1': { d: [1, -4, 1, 2, 0, 0], off: 90, nodal: o1 },
  J1: { d: [1, 1, 1, -1, 0, 0], off: -90, nodal: j1 },
  OO1: { d: [1, 2, 1, 0, 0, 0], off: -90, nodal: (N) => [1.1027 + 0.6504 * Math.cos(N * RAD) + 0.0317 * Math.cos(2 * N * RAD), -36.68 * Math.sin(N * RAD) + 4.02 * Math.sin(2 * N * RAD)] },
  M3: { d: [3, -3, 3, 0, 0, 0], off: 0, nodal: pow(m2, 1.5) },
  MK3: { d: [3, -2, 3, 0, 0, 0], off: -90, nodal: prod(m2, k1) },
  M4: { d: [4, -4, 4, 0, 0, 0], off: 0, nodal: pow(m2, 2) },
  MS4: { d: [4, -2, 2, 0, 0, 0], off: 0, nodal: m2 },
  MN4: { d: [4, -5, 4, 1, 0, 0], off: 0, nodal: pow(m2, 2) },
  S4: { d: [4, 0, 0, 0, 0, 0], off: 0, nodal: one },
  M6: { d: [6, -6, 6, 0, 0, 0], off: 0, nodal: pow(m2, 3) },
  MF: { d: [0, 2, 0, 0, 0, 0], off: 0, nodal: mf },
  MM: { d: [0, 1, 0, -1, 0, 0], off: 0, nodal: mm },
  SSA: { d: [0, 0, 2, 0, 0, 0], off: 0, nodal: one },
  SA: { d: [0, 0, 1, 0, 0, 0], off: 0, nodal: one },
};

export const SUPPORTED_CONSTITUENTS = Object.keys(TABLE);

/** Constituent speed in degrees per hour (for tests and sanity checks). */
export function speed(name: string): number {
  const c = TABLE[name];
  const rates = [15, 0.5490165, 0.0410686, 0.0046418, 0.0022064, 0.0000019];
  return c.d.reduce((acc, k, i) => acc + k * rates[i], 0);
}

/**
 * Tide height (m) relative to mean sea level at the gauge, at a UTC time.
 * The long-period annual terms (SA, SSA) are left out by default: they are
 * mostly seasonal weather, not astronomy, and they shift "mean sea level".
 */
export function tideHeight(cons: Constituents, date: Date, includeSeasonal = false): number {
  const a = astro(date);
  // Doodson's N' is the negative of the node longitude
  const vars = [a.T, a.s, a.h, a.p, -a.N, a.p1];
  let h = 0;
  for (const name in cons) {
    const c = TABLE[name];
    if (!c) continue;
    if (!includeSeasonal && (name === 'SA' || name === 'SSA')) continue;
    const [A, G] = cons[name];
    let V = c.off;
    for (let i = 0; i < 6; i++) V += c.d[i] * vars[i];
    const [f, u] = c.nodal(a.N);
    h += f * A * Math.cos((V + u - G) * RAD);
  }
  return h;
}

export interface TideExtreme {
  kind: 'high' | 'low';
  time: Date;
  height: number;
}

/** The next high and low after `from` (searches up to 26 h ahead). */
export function nextExtremes(cons: Constituents, from: Date, count = 2): TideExtreme[] {
  const out: TideExtreme[] = [];
  const step = 6 * 60000;
  let t = from.getTime();
  let prev = tideHeight(cons, new Date(t));
  let cur = tideHeight(cons, new Date(t + step));
  for (let i = 2; i < (26 * 3600000) / step && out.length < count; i++) {
    const next = tideHeight(cons, new Date(t + i * step));
    if ((cur > prev && cur >= next) || (cur < prev && cur <= next)) {
      // refine with a parabola through the three samples
      const denom = prev - 2 * cur + next;
      const off = denom !== 0 ? (0.5 * (prev - next)) / denom : 0;
      const time = new Date(t + (i - 1 + off) * step);
      out.push({ kind: cur > prev ? 'high' : 'low', time, height: tideHeight(cons, time) });
    }
    prev = cur;
    cur = next;
  }
  return out;
}

/** Rough maximum tide excursion from mean level (sum of the main amplitudes). */
export function tideRange(cons: Constituents): number {
  let r = 0;
  for (const name of ['M2', 'S2', 'N2', 'K2', 'K1', 'O1', 'P1', 'Q1']) r += cons[name]?.[0] ?? 0;
  return r;
}
