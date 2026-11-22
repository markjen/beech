// Sun and moon positions for a place and time (the well-known SunCalc
// formulas, after Astronomy Answers / Meeus). Accurate to a fraction of a
// degree, which is plenty for lighting a diorama.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

const toDays = (date: Date) => date.getTime() / DAY_MS - 0.5 + J1970 - J2000;

const rightAscension = (l: number, b: number) =>
  Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
const declination = (l: number, b: number) =>
  Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
const siderealTime = (d: number, lw: number) => RAD * (280.16 + 360.9856235 * d) - lw;

function sunCoords(d: number) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

function moonCoords(d: number) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

export interface SkyPosition {
  /** compass bearing in degrees, clockwise from north */
  bearing: number;
  /** degrees above the horizon */
  elevation: number;
}

function horizontal(H: number, phi: number, dec: number): SkyPosition {
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // SunCalc's azimuth is measured from south, westward positive
  return { bearing: (((az / RAD + 180) % 360) + 360) % 360, elevation: alt / RAD };
}

export function sunPosition(date: Date, lat: number, lon: number): SkyPosition {
  const d = toDays(date);
  const c = sunCoords(d);
  return horizontal(siderealTime(d, RAD * -lon) - c.ra, RAD * lat, c.dec);
}

export function moonPosition(date: Date, lat: number, lon: number): SkyPosition {
  const d = toDays(date);
  const c = moonCoords(d);
  return horizontal(siderealTime(d, RAD * -lon) - c.ra, RAD * lat, c.dec);
}

/** fraction lit (0..1) and phase (0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter) */
export function moonIllumination(date: Date): { fraction: number; phase: number } {
  const d = toDays(date);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const sdist = 149598000;
  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra),
  );
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra),
  );
  return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI };
}
