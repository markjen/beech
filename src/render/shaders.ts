// GLSL for all custom materials. Written in GLSL ES 1.0 style; Babylon
// converts it for WebGL2 (and WebGPU) automatically.

const FIELD_COMMON = /* glsl */ `
uniform sampler2D fieldPrev;
uniform sampler2D fieldCur;
uniform float frameMix;
uniform vec2 gridSize;
uniform float cellSize;
uniform float centerX;
uniform float originZ;
/** 1 = neighbor snapshot (animate waves/foam in shader); 0 = live simulated beach */
uniform float staticWater;
/** x = 1 if linked to a beach on -X; y = 1 if linked to a beach on +X */
uniform vec2 linkedSides;
uniform sampler2D negFieldPrev;
uniform sampler2D negFieldCur;
uniform float negMix;
uniform float negStatic;
uniform sampler2D posFieldPrev;
uniform sampler2D posFieldCur;
uniform float posMix;
uniform float posStatic;
/** how many rows the -X and +X neighbors' fields have (a beach is deeper with sand rows inland) */
uniform float negRows;
uniform float posRows;
uniform vec3 swellA;
uniform vec3 swellW;
uniform vec3 swellP;
uniform vec3 swellK;
uniform float swellEnv;
uniform float simTime;
uniform float tide;
uniform float zEdge;

float slabX(float cx, float cX) {
  float halfW = gridSize.x * cellSize * 0.5;
  if (cx <= 0.5) return cX - halfW;
  if (cx >= gridSize.x - 1.5) return cX + halfW;
  return cX - halfW + (cx + 0.5) * cellSize;
}

float seamW(float distCells, float blendCells) {
  return distCells >= blendCells ? 0.0 : 0.5 * (1.0 - smoothstep(0.0, blendCells, distCells));
}

vec4 rawTex(sampler2D fPrev, sampler2D fCur, float fMix, vec2 c) {
  vec2 uv = (clamp(c, vec2(0.0), gridSize - 1.0) + 0.5) / gridSize;
  return mix(texture2D(fPrev, uv), texture2D(fCur, uv), fMix);
}

/** a neighbor's field, which has this many rows (the same width as ours) */
vec4 rawTexR(float rows, sampler2D fPrev, sampler2D fCur, float fMix, vec2 c) {
  vec2 g = vec2(gridSize.x, rows);
  vec2 uv = (clamp(c, vec2(0.0), g - 1.0) + 0.5) / g;
  return mix(texture2D(fPrev, uv), texture2D(fCur, uv), fMix);
}

float staticWet(float sandH, float d, float ampSum) {
  if (d > 0.004) return 1.0;
  float capRef = tide + ampSum * 0.06;
  float cap = clamp(1.0 - (sandH - capRef) / 0.35, 0.0, 1.0) * 0.8;
  float swashWet = smoothstep(tide + ampSum * 0.44 + 0.02, tide + ampSum * 0.08, sandH) * 0.96;
  return max(cap, swashWet);
}
`;

/** Lightweight sand + wetness helpers for sandVertex (zero wave trig). */
const SAND_FIELD = /* glsl */ `
${FIELD_COMMON}
vec3 sandSample(sampler2D fPrev, sampler2D fCur, float fMix, float isStat, vec2 c, float ampSum) {
  vec4 f = rawTex(fPrev, fCur, fMix, c);
  if (isStat <= 0.0) return f.rgb;
  float d = max(0.0, tide - f.r);
  vec3 s = vec3(f.r, d, staticWet(f.r, d, ampSum));
  // between 0 and 1 only while the waves move onto a beach (a uniform: no divergence)
  return isStat >= 1.0 ? s : mix(f.rgb, s, isStat);
}

vec3 sandSampleR(float rows, sampler2D fPrev, sampler2D fCur, float fMix, float isStat, vec2 c, float ampSum) {
  vec4 f = rawTexR(rows, fPrev, fCur, fMix, c);
  if (isStat <= 0.0) return f.rgb;
  float d = max(0.0, tide - f.r);
  vec3 s = vec3(f.r, d, staticWet(f.r, d, ampSum));
  return isStat >= 1.0 ? s : mix(f.rgb, s, isStat);
}

vec3 applySandDelta(vec3 s, vec3 delta, float w) {
  return vec3(s.x + delta.x * w, max(0.0, s.y + delta.y * w), clamp(s.z + delta.z * w, 0.0, 1.0));
}
`;

/** Water + wave-front helpers for waterVertex and skirtVertex (single wave eval per vertex). */
const FIELD = /* glsl */ `
${FIELD_COMMON}
// Analytical rolling wave + surf zone synced to the live swell: vec4(eta, hWave, dhdt, surfZone)
vec4 waveParams(float wx, float wz) {
  float u = max(0.0, wz - zEdge);
  float lag = wz < zEdge ? (wz - zEdge) / 3.6 : (u / 3.7 + 0.0042 * u * u);
  float shoal = mix(1.0, 0.65, smoothstep(0.0, 7.0, u)) + 0.25 * smoothstep(10.0, 16.0, u);
  float shoreFade = 1.0 - smoothstep(19.0, 23.0, u);
  vec3 ph = swellW * (simTime - lag) + swellP - swellK * wx;
  float hWave = dot(swellA, sin(ph)) * swellEnv * shoal * shoreFade;
  float dhdt = dot(swellA * swellW, cos(ph)) * swellEnv * shoal * shoreFade;
  float swashBoost = max(0.0, hWave) * 0.25 * smoothstep(13.0, 17.0, u);
  float eta = tide + hWave + swashBoost;
  float surfZone = smoothstep(10.0, 14.5, u) * shoreFade;
  return vec4(eta, hWave, dhdt, surfZone);
}

vec4 evalFromWave(vec4 raw, float isStat, vec4 wp, float ampSum) {
  if (isStat <= 0.0) return raw;
  float d = max(0.0, wp.x - raw.r);
  float wet = staticWet(raw.r, d, ampSum);
  float thin = smoothstep(0.45, 0.02, d) * smoothstep(0.003, 0.015, d);
  float bore = smoothstep(0.0, 0.22, wp.z) * smoothstep(0.55, 0.05, d) * smoothstep(0.003, 0.02, d);
  float edgeFoam = smoothstep(0.14, 0.008, d) * smoothstep(0.003, 0.012, d) * (0.35 + 0.65 * smoothstep(-0.12, 0.08, wp.y));
  float foam = clamp((bore * 0.85 + edgeFoam * 0.85) * wp.w * (0.4 + 0.6 * thin), 0.0, 1.0);
  vec4 s = vec4(raw.r, d, wet, foam);
  return isStat >= 1.0 ? s : mix(raw, s, isStat);
}

vec4 seamBlend(vec4 self, vec4 selfEdge, vec4 otherEdge, float w) {
  if (w <= 0.0) return self;
  float sand = self.r + (otherEdge.r - selfEdge.r) * w;
  float dDiff = otherEdge.g - selfEdge.g;
  float spillGate = (self.g > 0.003 || dDiff <= 0.0) ? 1.0 : smoothstep(0.18, 0.0, self.r - selfEdge.r);
  float d = max(0.0, self.g + dDiff * w * spillGate);
  float wet = clamp(self.b + (otherEdge.b - selfEdge.b) * w, 0.0, 1.0);
  float foam = clamp(self.a + (otherEdge.a - selfEdge.a) * w, 0.0, 1.0);
  return vec4(sand, d, wet, foam);
}
`;

const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

const FACET = /* glsl */ `
vec3 facetNormal(vec3 p) {
  vec3 n = normalize(cross(dFdx(p), dFdy(p)));
  return n.y < 0.0 ? -n : n;
}
float toonRamp(float ndl) {
  // three soft bands: shade / half-lit / lit
  return 0.3 + 0.35 * smoothstep(-0.02, 0.1, ndl) + 0.35 * smoothstep(0.45, 0.58, ndl);
}
`;

const LIGHT_UNIFORMS = /* glsl */ `
uniform vec3 sunDir;
uniform vec3 sunCol;
uniform vec3 ambCol;
uniform vec3 shadowCol;
uniform vec3 cameraDir;
`;

// ------------------------------------------------------------------ sand

export const sandVertex = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
uniform sampler2D restTex;
${SAND_FIELD}
varying vec3 vWorld;
varying float vWet;
varying float vCav;
varying float vDug;
varying float vWater;
varying vec3 vNormal;
void main() {
  vec2 c = floor(uv * gridSize);
  float nx = gridSize.x;
  float ny = gridSize.y;
  float cy = c.y;
  float cyD1 = max(0.0, cy - 1.0);
  float cyU1 = min(ny - 1.0, cy + 1.0);
  float cyD2 = max(0.0, cy - 2.0);
  float cyU2 = min(ny - 1.0, cy + 2.0);
  float blendCells = 1.75 / cellSize;
  float ampSum = swellA.x + swellA.y + swellA.z;

  vec3 f = sandSample(fieldPrev, fieldCur, frameMix, staticWater, c, ampSum);
  vec3 fl = sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(max(0.0, c.x - 1.0), cy), ampSum);
  vec3 fr = sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(min(nx - 1.0, c.x + 1.0), cy), ampSum);
  vec3 fd = sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(c.x, cyD1), ampSum);
  vec3 fu = sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(c.x, cyU1), ampSum);
  float hl2 = sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(max(0.0, c.x - 2.0), cy), ampSum).x;
  float hr2 = sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(min(nx - 1.0, c.x + 2.0), cy), ampSum).x;
  float hd2 = sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(c.x, cyD2), ampSum).x;
  float hu2 = sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(c.x, cyU2), ampSum).x;
  float restH = texture2D(restTex, (c + 0.5) / gridSize).r;

  if (linkedSides.x > 0.5 && c.y < negRows - 0.5 && c.x < blendCells + 2.5) {
    vec3 se = sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(0.0, cy), ampSum);
    vec3 oe = sandSampleR(negRows, negFieldPrev, negFieldCur, negMix, negStatic, vec2(nx - 1.0, cy), ampSum);
    vec3 delta = oe - se;
    float w0 = seamW(c.x, blendCells);
    f = applySandDelta(f, delta, w0);
    if (c.x < 0.5) {
      fl = applySandDelta(sandSampleR(negRows, negFieldPrev, negFieldCur, negMix, negStatic, vec2(nx - 2.0, cy), ampSum), -delta, seamW(1.0, blendCells));
    } else {
      fl = applySandDelta(fl, delta, seamW(c.x - 1.0, blendCells));
    }
    fr = applySandDelta(fr, delta, seamW(c.x + 1.0, blendCells));
    if (c.x < 1.5) {
      float d2 = 2.0 - c.x;
      hl2 = sandSampleR(negRows, negFieldPrev, negFieldCur, negMix, negStatic, vec2(nx - 1.0 - d2, cy), ampSum).x - delta.x * seamW(d2, blendCells);
    } else {
      hl2 += delta.x * seamW(c.x - 2.0, blendCells);
    }
    hr2 += delta.x * seamW(c.x + 2.0, blendCells);
    if (w0 > 0.0) {
      vec3 dD1 = sandSampleR(negRows, negFieldPrev, negFieldCur, negMix, negStatic, vec2(nx - 1.0, cyD1), ampSum)
               - sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(0.0, cyD1), ampSum);
      vec3 dU1 = sandSampleR(negRows, negFieldPrev, negFieldCur, negMix, negStatic, vec2(nx - 1.0, cyU1), ampSum)
               - sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(0.0, cyU1), ampSum);
      fd = applySandDelta(fd, dD1, w0);
      fu = applySandDelta(fu, dU1, w0);
      hd2 += (sandSampleR(negRows, negFieldPrev, negFieldCur, negMix, negStatic, vec2(nx - 1.0, cyD2), ampSum).x
            - sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(0.0, cyD2), ampSum).x) * w0;
      hu2 += (sandSampleR(negRows, negFieldPrev, negFieldCur, negMix, negStatic, vec2(nx - 1.0, cyU2), ampSum).x
            - sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(0.0, cyU2), ampSum).x) * w0;
      float rSelf = texture2D(restTex, vec2(0.5 / nx, (cy + 0.5) / ny)).r;
      float rOther = texture2D(restTex, vec2((nx - 0.5) / nx, (cy + 0.5) / ny)).r;
      restH += (rOther - rSelf) * w0;
    }
  } else if (linkedSides.y > 0.5 && c.y < posRows - 0.5 && (nx - 1.0 - c.x) < blendCells + 2.5) {
    float dist = nx - 1.0 - c.x;
    vec3 se = sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(nx - 1.0, cy), ampSum);
    vec3 oe = sandSampleR(posRows, posFieldPrev, posFieldCur, posMix, posStatic, vec2(0.0, cy), ampSum);
    vec3 delta = oe - se;
    float w0 = seamW(dist, blendCells);
    f = applySandDelta(f, delta, w0);
    fl = applySandDelta(fl, delta, seamW(dist + 1.0, blendCells));
    if (dist < 0.5) {
      fr = applySandDelta(sandSampleR(posRows, posFieldPrev, posFieldCur, posMix, posStatic, vec2(1.0, cy), ampSum), -delta, seamW(1.0, blendCells));
    } else {
      fr = applySandDelta(fr, delta, seamW(dist - 1.0, blendCells));
    }
    hl2 += delta.x * seamW(dist + 2.0, blendCells);
    if (dist < 1.5) {
      float d2 = 2.0 - dist;
      hr2 = sandSampleR(posRows, posFieldPrev, posFieldCur, posMix, posStatic, vec2(d2, cy), ampSum).x - delta.x * seamW(d2, blendCells);
    } else {
      hr2 += delta.x * seamW(dist - 2.0, blendCells);
    }
    if (w0 > 0.0) {
      vec3 dD1 = sandSampleR(posRows, posFieldPrev, posFieldCur, posMix, posStatic, vec2(0.0, cyD1), ampSum)
               - sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(nx - 1.0, cyD1), ampSum);
      vec3 dU1 = sandSampleR(posRows, posFieldPrev, posFieldCur, posMix, posStatic, vec2(0.0, cyU1), ampSum)
               - sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(nx - 1.0, cyU1), ampSum);
      fd = applySandDelta(fd, dD1, w0);
      fu = applySandDelta(fu, dU1, w0);
      hd2 += (sandSampleR(posRows, posFieldPrev, posFieldCur, posMix, posStatic, vec2(0.0, cyD2), ampSum).x
            - sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(nx - 1.0, cyD2), ampSum).x) * w0;
      hu2 += (sandSampleR(posRows, posFieldPrev, posFieldCur, posMix, posStatic, vec2(0.0, cyU2), ampSum).x
            - sandSample(fieldPrev, fieldCur, frameMix, staticWater, vec2(nx - 1.0, cyU2), ampSum).x) * w0;
      float rSelf = texture2D(restTex, vec2((nx - 0.5) / nx, (cy + 0.5) / ny)).r;
      float rOther = texture2D(restTex, vec2(0.5 / nx, (cy + 0.5) / ny)).r;
      restH += (rOther - rSelf) * w0;
    }
  }

  float h = f.x;
  vNormal = normalize(vec3(fl.x - fr.x, 2.0 * cellSize, fd.x - fu.x));
  float a = (hr2 + hl2 + hu2 + hd2) * 0.25;
  vCav = clamp((a - h) * 6.0, 0.0, 1.0);
  vDug = restH - h;
  // soften the per-cell wetness so the wet line doesn't stair-step
  vWet = f.z * 0.4 + (fl.z + fr.z + fd.z + fu.z) * 0.15;
  vWater = f.y;
  vec4 wp = world * vec4(position.x, h, position.z, 1.0);
  vWorld = wp.xyz;
  gl_Position = viewProjection * wp;
}
`;

export const sandFragment = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying float vWet;
varying float vCav;
varying float vDug;
varying float vWater;
varying vec3 vNormal;
${LIGHT_UNIFORMS}
uniform vec3 sandDry;
uniform vec3 sandWet;
uniform vec3 sandDeep;
uniform vec4 brush;
uniform vec3 brushCol;
${NOISE}
${FACET}
void main() {
  // mostly smooth (clean toon bands) with a hint of facet for the low-poly feel
  vec3 N = normalize(mix(normalize(vNormal), facetNormal(vWorld), 0.3));
  float ndl = dot(N, -sunDir);
  float ramp = toonRamp(ndl);
  float wet = clamp(vWet, 0.0, 1.0);
  vec3 base = mix(sandDry, sandWet, wet * wet * (3.0 - 2.0 * wet));
  base = mix(base, sandDeep, clamp(vDug * 2.0, 0.0, 0.65) * (1.0 - wet * 0.5));
  // fine smooth grain (blocky hash noise showed up close in the chair view)
  base *= 0.975 + 0.05 * vnoise(vWorld.xz * 34.0);
  vec3 col = base * mix(shadowCol, sunCol, ramp) + base * ambCol * 0.1;
  vec3 R = reflect(sunDir, N);
  float spec = pow(max(dot(R, -cameraDir), 0.0), 20.0);
  col += sunCol * spec * 0.16 * wet * (1.0 - clamp(vWater * 30.0, 0.0, 1.0));
  col *= 1.0 - vCav * 0.3;
  float d = length(vWorld.xz - brush.xy);
  float w = brush.z * 0.1 + 0.015;
  float ring = 1.0 - smoothstep(0.0, w, abs(d - brush.z));
  float fill = (1.0 - smoothstep(brush.z * 0.85, brush.z, d)) * 0.1;
  col = mix(col, brushCol, clamp(ring * 0.6 + fill, 0.0, 1.0) * brush.w);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------ water

export const waterVertex = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float time;
${FIELD}
varying vec3 vWorld;
varying float vDepth;
varying float vFoam;
void main() {
  vec2 c = floor(uv * gridSize);
  float nx = gridSize.x;
  float ny = gridSize.y;
  float cy = c.y;
  float cyD1 = max(0.0, cy - 1.0);
  float cyU1 = min(ny - 1.0, cy + 1.0);
  float wz = originZ + (cy + 0.5) * cellSize;
  float wx = slabX(c.x, centerX);
  float blendCells = 1.75 / cellSize;
  float halfW = nx * cellSize * 0.5;
  float ampSum = swellA.x + swellA.y + swellA.z;

  vec4 wpC = staticWater > 0.0 ? waveParams(wx, wz) : vec4(0.0);
  vec4 f = evalFromWave(rawTex(fieldPrev, fieldCur, frameMix, c), staticWater, wpC, ampSum);
  vec4 l = evalFromWave(rawTex(fieldPrev, fieldCur, frameMix, vec2(max(0.0, c.x - 1.0), cy)), staticWater, wpC, ampSum);
  vec4 r = evalFromWave(rawTex(fieldPrev, fieldCur, frameMix, vec2(min(nx - 1.0, c.x + 1.0), cy)), staticWater, wpC, ampSum);
  vec4 dn = evalFromWave(rawTex(fieldPrev, fieldCur, frameMix, vec2(c.x, cyD1)), staticWater, wpC, ampSum);
  vec4 up = evalFromWave(rawTex(fieldPrev, fieldCur, frameMix, vec2(c.x, cyU1)), staticWater, wpC, ampSum);

  if (linkedSides.x > 0.5 && c.y < negRows - 0.5 && c.x < blendCells + 1.5) {
    vec4 wpS = (staticWater > 0.0 || negStatic > 0.0) ? waveParams(centerX - halfW, wz) : vec4(0.0);
    vec4 se = evalFromWave(rawTex(fieldPrev, fieldCur, frameMix, vec2(0.0, cy)), staticWater, wpS, ampSum);
    vec4 oe = evalFromWave(rawTexR(negRows, negFieldPrev, negFieldCur, negMix, vec2(nx - 1.0, cy)), negStatic, wpS, ampSum);
    float w0 = seamW(c.x, blendCells);
    f = seamBlend(f, se, oe, w0);
    if (c.x < 0.5) {
      vec4 oL = evalFromWave(rawTexR(negRows, negFieldPrev, negFieldCur, negMix, vec2(nx - 2.0, cy)), negStatic, wpS, ampSum);
      l = seamBlend(oL, oe, se, seamW(1.0, blendCells));
    } else {
      l = seamBlend(l, se, oe, seamW(c.x - 1.0, blendCells));
    }
    r = seamBlend(r, se, oe, seamW(c.x + 1.0, blendCells));
    if (w0 > 0.0) {
      vec4 seD = evalFromWave(rawTex(fieldPrev, fieldCur, frameMix, vec2(0.0, cyD1)), staticWater, wpS, ampSum);
      vec4 oeD = evalFromWave(rawTexR(negRows, negFieldPrev, negFieldCur, negMix, vec2(nx - 1.0, cyD1)), negStatic, wpS, ampSum);
      vec4 seU = evalFromWave(rawTex(fieldPrev, fieldCur, frameMix, vec2(0.0, cyU1)), staticWater, wpS, ampSum);
      vec4 oeU = evalFromWave(rawTexR(negRows, negFieldPrev, negFieldCur, negMix, vec2(nx - 1.0, cyU1)), negStatic, wpS, ampSum);
      dn = seamBlend(dn, seD, oeD, w0);
      up = seamBlend(up, seU, oeU, w0);
    }
  } else if (linkedSides.y > 0.5 && c.y < posRows - 0.5 && (nx - 1.0 - c.x) < blendCells + 1.5) {
    float dist = nx - 1.0 - c.x;
    vec4 wpS = (staticWater > 0.0 || posStatic > 0.0) ? waveParams(centerX + halfW, wz) : vec4(0.0);
    vec4 se = evalFromWave(rawTex(fieldPrev, fieldCur, frameMix, vec2(nx - 1.0, cy)), staticWater, wpS, ampSum);
    vec4 oe = evalFromWave(rawTexR(posRows, posFieldPrev, posFieldCur, posMix, vec2(0.0, cy)), posStatic, wpS, ampSum);
    float w0 = seamW(dist, blendCells);
    f = seamBlend(f, se, oe, w0);
    l = seamBlend(l, se, oe, seamW(dist + 1.0, blendCells));
    if (dist < 0.5) {
      vec4 oR = evalFromWave(rawTexR(posRows, posFieldPrev, posFieldCur, posMix, vec2(1.0, cy)), posStatic, wpS, ampSum);
      r = seamBlend(oR, oe, se, seamW(1.0, blendCells));
    } else {
      r = seamBlend(r, se, oe, seamW(dist - 1.0, blendCells));
    }
    if (w0 > 0.0) {
      vec4 seD = evalFromWave(rawTex(fieldPrev, fieldCur, frameMix, vec2(nx - 1.0, cyD1)), staticWater, wpS, ampSum);
      vec4 oeD = evalFromWave(rawTexR(posRows, posFieldPrev, posFieldCur, posMix, vec2(0.0, cyD1)), posStatic, wpS, ampSum);
      vec4 seU = evalFromWave(rawTex(fieldPrev, fieldCur, frameMix, vec2(nx - 1.0, cyU1)), staticWater, wpS, ampSum);
      vec4 oeU = evalFromWave(rawTexR(posRows, posFieldPrev, posFieldCur, posMix, vec2(0.0, cyU1)), posStatic, wpS, ampSum);
      dn = seamBlend(dn, seD, oeD, w0);
      up = seamBlend(up, seU, oeU, w0);
    }
  }

  float d = f.g;
  float y = f.r + d;
  // blend the outermost 3 offshore rows smoothly to oceanVertex's exact swell
  // elevation and slope so j = 0 meets the far ocean with continuous normals
  if (d >= 0.003 && cy < 3.5) {
    float offBlend = 1.0 - smoothstep(0.0, 3.0, cy);
    float ttOff = simTime - (wz - zEdge) / 3.6;
    float oceanY = tide + dot(swellA, sin(swellW * ttOff + swellP - swellK * wx)) * swellEnv;
    y = mix(y, oceanY, offBlend);
  }
  // dry cells tuck just under the sand so the waterline sits close to the true edge
  if (d < 0.003) y = f.r - 0.012;
  vec4 wp = world * vec4(position.x, y, position.z, 1.0);
  float rip = (sin(wp.x * 2.3 + time * 1.7) + sin(wp.z * 2.9 - time * 1.3 + wp.x * 0.8)) * 0.006;
  wp.y += rip * clamp(d * 4.0, 0.0, 1.0) * smoothstep(0.0, 3.5, wp.z - zEdge);
  // softened depth/foam for colour and alpha (geometry keeps the exact depth)
  vDepth = d * 0.4 + (l.g + r.g + dn.g + up.g) * 0.15;
  vFoam = f.a * 0.4 + (l.a + r.a + dn.a + up.a) * 0.15;
  vWorld = wp.xyz;
  gl_Position = viewProjection * wp;
}
`;

export const waterFragment = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying float vDepth;
varying float vFoam;
${LIGHT_UNIFORMS}
uniform vec3 shallowCol;
uniform vec3 deepCol;
uniform vec3 foamCol;
uniform float time;
${NOISE}
${FACET}
void main() {
  vec3 N = facetNormal(vWorld);
  float ndl = dot(N, -sunDir);
  float ramp = 0.65 + 0.35 * smoothstep(0.3, 0.7, ndl);
  float dt = smoothstep(0.0, 1.1, vDepth);
  vec3 col = mix(shallowCol, deepCol, dt) * mix(shadowCol * 1.1, sunCol, ramp);
  float spec = pow(max(dot(reflect(sunDir, N), -cameraDir), 0.0), 50.0);
  col += sunCol * spec * 0.3;
  // lacy foam: bubbles from two octaves of drifting noise, solid only at the core
  float n = vnoise(vWorld.xz * 7.0 + vec2(time * 0.25, -time * 0.15)) * 0.6 +
            vnoise(vWorld.xz * 17.0 - vec2(time * 0.4, time * 0.1)) * 0.4;
  float lace = smoothstep(0.47, 0.55, vFoam * 0.82 + (n - 0.5) * 0.9);
  float core = smoothstep(0.75, 0.95, vFoam);
  float foam = max(lace * 0.85, core);
  float edge = 1.0 - smoothstep(0.0, 0.03, vDepth);
  col = mix(col, foamCol, max(foam * 0.9, edge * 0.25));
  // keep shallow water see-through, then reach full opacity offshore so the
  // underwater slab cutoff disappears and the far ocean can tuck underneath cleanly
  float deepOpacity = smoothstep(1.15, 2.05, vDepth);
  float a = smoothstep(0.0, 0.03, vDepth) * mix(mix(0.45, 0.9, dt), 1.0, deepOpacity);
  a = max(a, foam * 0.9 * smoothstep(0.0, 0.008, vDepth));
  gl_FragColor = vec4(col, a);
}
`;

// ------------------------------------------------------------------ far ocean

export const oceanVertex = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
uniform vec3 swellA;
uniform vec3 swellW;
uniform vec3 swellP;
/** alongshore wavenumbers (crests at an angle) and the set envelope */
uniform vec3 swellK;
uniform float swellEnv;
uniform float simTime;
uniform float tide;
uniform float zEdge;
uniform float waveSpeed;
varying vec3 vWorld;
varying float vCrest;
void main() {
  // a swell travelling toward +z that equals the sim's boundary forcing at zEdge
  float wx = (world * vec4(position, 1.0)).x;
  float tt = simTime - (position.z - zEdge) / waveSpeed;
  vec3 s = swellA * sin(swellW * tt + swellP - swellK * wx) * swellEnv;
  float h = s.x + s.y + s.z;
  float chop = sin(wx * 0.9 + simTime * 1.1 + position.z * 0.4) * 0.03 +
               sin(wx * 0.35 - position.z * 0.7 - simTime * 0.8) * 0.04;
  float y = tide + h + chop * smoothstep(0.0, 8.0, zEdge - position.z);
  vCrest = h / max(0.001, (swellA.x + swellA.y + swellA.z) * swellEnv);
  vec4 wp = world * vec4(position.x, y, position.z, 1.0);
  vWorld = wp.xyz;
  gl_Position = viewProjection * wp;
}
`;

export const oceanFragment = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying float vCrest;
${LIGHT_UNIFORMS}
uniform vec3 oceanCol;
uniform vec3 deepCol;
uniform vec3 foamCol;
uniform vec3 fogCol;
uniform float zEdge;
uniform float halfX;
uniform float centerX;
uniform float fadeNear;
uniform float fadeFar;
/** 1 = diorama apron (soft cut sides, fades out); 0 = open sea to the horizon */
uniform float apron;
/** x = 1 if linked on -X, y = 1 if linked on +X (linked sides don't fade out) */
uniform vec2 linkedSides;
/** open sea only: up to 8 drawn beach centres (unused slots = 1e7) and each
 * slab's half-width — leave the sea out from under drawn beaches so it never
 * shows through their sand, while keeping open sea over unlinked gaps */
uniform vec4 slabA;
uniform vec4 slabB;
uniform float slabHalf;
${FACET}
void main() {
  if (apron < 0.5 && vWorld.z > zEdge + 0.35) {
    vec4 da = abs(vec4(vWorld.x) - slabA);
    vec4 db = abs(vec4(vWorld.x) - slabB);
    if (min(min(min(da.x, da.y), min(da.z, da.w)), min(min(db.x, db.y), min(db.z, db.w))) < slabHalf) discard;
  }
  vec3 N = facetNormal(vWorld);
  float ndl = dot(N, -sunDir);
  float dist = zEdge - vWorld.z;
  // match waterFragment lighting/spec/crest identically at dist = 0, then ease into far-ocean look
  float farT = smoothstep(0.0, 10.0, dist);
  float rampBase = mix(0.65, 0.70, farT);
  float ramp = rampBase + (1.0 - rampBase) * smoothstep(0.3, 0.7, ndl);
  vec3 col = mix(deepCol, oceanCol, smoothstep(0.0, 25.0, dist)) * mix(shadowCol * 1.1, sunCol, ramp);
  col = mix(col, foamCol, smoothstep(0.55, 1.0, vCrest) * 0.18 * smoothstep(0.0, 6.0, dist));
  float spec = pow(max(dot(reflect(sunDir, N), -cameraDir), 0.0), mix(50.0, 40.0, farT));
  col += sunCol * spec * mix(0.3, 0.25, farT);
  float f = smoothstep(fadeNear, fadeFar, dist);
  float a;
  if (apron > 0.5) {
    // soften the cut sides a little as the sea recedes into the mist (linked sides stay continuous)
    float relX = vWorld.x - centerX;
    float sideFade = 0.0;
    if (relX < 0.0 && linkedSides.x < 0.5) {
      sideFade = smoothstep(halfX - 0.5 - dist * 0.25, halfX, -relX);
    } else if (relX > 0.0 && linkedSides.y < 0.5) {
      sideFade = smoothstep(halfX - 0.5 - dist * 0.25, halfX, relX);
    }
    f = max(f, sideFade * smoothstep(0.0, 6.0, dist));
    col = mix(col, fogCol, f * 0.55);
    a = 1.0 - f;
  } else {
    // open sea: haze toward the horizon, see-through in the shallows, opaque & seamless at zEdge
    col = mix(col, fogCol, f * 0.85);
    a = mix(0.82, 1.0, smoothstep(-8.0, -0.5, dist));
  }
  gl_FragColor = vec4(col, a);
}
`;

// ------------------------------------------------------------------ slab sides

export const skirtVertex = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float bottomY;
uniform float isWater;
${FIELD}
varying vec3 vWorld;
varying vec3 vNormal;
varying float vTop;
varying float vWet;
varying float vDepth;
void main() {
  vNormal = normal;
  // a linked side has no skirt, except where this beach runs deeper inland than its neighbor
  float skirtRow = floor(uv.y * gridSize.y);
  if ((normal.x < -0.5 && linkedSides.x > 0.5 && skirtRow < negRows - 0.5) || (normal.x > 0.5 && linkedSides.y > 0.5 && skirtRow < posRows - 0.5)) {
    vWorld = vec3(0.0);
    vTop = 0.0;
    vWet = 0.0;
    vDepth = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 c = floor(uv * gridSize);
  float nx = gridSize.x;
  float cy = c.y;
  float wz = originZ + (cy + 0.5) * cellSize;
  float wx = slabX(c.x, centerX);
  float blendCells = 1.75 / cellSize;
  float halfW = nx * cellSize * 0.5;
  float ampSum = swellA.x + swellA.y + swellA.z;
  vec4 wpC = staticWater > 0.0 ? waveParams(wx, wz) : vec4(0.0);
  vec4 f = evalFromWave(rawTex(fieldPrev, fieldCur, frameMix, c), staticWater, wpC, ampSum);
  if (linkedSides.x > 0.5 && c.y < negRows - 0.5 && c.x < blendCells) {
    vec4 wpS = (staticWater > 0.0 || negStatic > 0.0) ? waveParams(centerX - halfW, wz) : vec4(0.0);
    vec4 se = evalFromWave(rawTex(fieldPrev, fieldCur, frameMix, vec2(0.0, cy)), staticWater, wpS, ampSum);
    vec4 oe = evalFromWave(rawTexR(negRows, negFieldPrev, negFieldCur, negMix, vec2(nx - 1.0, cy)), negStatic, wpS, ampSum);
    f = seamBlend(f, se, oe, seamW(c.x, blendCells));
  } else if (linkedSides.y > 0.5 && c.y < posRows - 0.5 && (nx - 1.0 - c.x) < blendCells) {
    float dist = nx - 1.0 - c.x;
    vec4 wpS = (staticWater > 0.0 || posStatic > 0.0) ? waveParams(centerX + halfW, wz) : vec4(0.0);
    vec4 se = evalFromWave(rawTex(fieldPrev, fieldCur, frameMix, vec2(nx - 1.0, cy)), staticWater, wpS, ampSum);
    vec4 oe = evalFromWave(rawTexR(posRows, posFieldPrev, posFieldCur, posMix, vec2(0.0, cy)), posStatic, wpS, ampSum);
    f = seamBlend(f, se, oe, seamW(dist, blendCells));
  }
  float y;
  if (isWater > 0.5) {
    float d = f.g < 0.003 ? 0.0 : f.g;
    y = position.y > 0.5 ? f.r + d : f.r;
  } else {
    y = position.y > 0.5 ? f.r : bottomY;
  }
  vTop = f.r;
  vWet = f.b;
  vDepth = f.g;
  vec4 wp = world * vec4(position.x, y, position.z, 1.0);
  vWorld = wp.xyz;
  gl_Position = viewProjection * wp;
}
`;

export const skirtFragment = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vTop;
varying float vWet;
varying float vDepth;
${LIGHT_UNIFORMS}
uniform vec3 sandDry;
uniform vec3 sandWet;
uniform vec3 strataA;
uniform vec3 strataB;
uniform vec3 rock;
uniform vec3 shallowCol;
uniform vec3 deepCol;
uniform float isWater;
void main() {
  float ndl = dot(normalize(vNormal), -sunDir);
  float lit = 0.55 + 0.45 * smoothstep(-0.2, 0.5, ndl);
  vec3 col;
  float a = 1.0;
  if (isWater > 0.5) {
    col = mix(shallowCol, deepCol, 0.55);
    float below = vTop + vDepth - vWorld.y;
    col = mix(col, deepCol * 0.9, smoothstep(0.0, 1.0, below));
    a = vDepth < 0.003 ? 0.0 : 0.72;
  } else {
    float below = vTop - vWorld.y;
    float wob = sin(vWorld.x * 0.7 + vWorld.z * 0.5) * 0.06;
    float band = floor((vWorld.y + 6.0 + wob) / 0.42);
    col = mod(band, 2.0) < 1.0 ? strataA : strataB;
    col = mix(col, rock, step(vWorld.y + wob, -1.75));
    vec3 topCol = mix(sandDry, sandWet, clamp(vWet, 0.0, 1.0));
    col = mix(col, topCol, 1.0 - smoothstep(0.1, 0.14, below));
  }
  col *= mix(shadowCol, sunCol, lit);
  gl_FragColor = vec4(col, a);
}
`;

// ------------------------------------------------------------------ flat blocks (rock base)

// Props are drawn as thin instances (src/render/objects.ts): Babylon defines
// INSTANCES and THIN_INSTANCES and supplies world0..3; other meshes on this
// shader (the horizon's) use the plain world matrix.
export const flatVertex = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
#include<instancesDeclaration>
uniform mat4 viewProjection;
/** > 0 only for flag cloths: flutters the pennant in local Y on the GPU */
uniform float windTime;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  #include<instancesVertex>
  vec3 pos = position;
  vec3 nrm = normal;
  if (windTime > 0.0) {
    float ph = finalWorld[3].x * 1.7 + finalWorld[3].z * 2.3;
    float a = sin(windTime * 3.1 + ph) * 0.35 + sin(windTime * 7.3 + ph) * 0.1;
    float c = cos(a);
    float s = sin(a);
    pos = vec3(pos.x * c + pos.z * s, pos.y, -pos.x * s + pos.z * c);
    nrm = vec3(nrm.x * c + nrm.z * s, nrm.y, -nrm.x * s + nrm.z * c);
  }
  vec4 wp = finalWorld * vec4(pos, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(finalWorld) * nrm);
  gl_Position = viewProjection * wp;
}
`;

export const flatFragment = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vWorld;
${LIGHT_UNIFORMS}
uniform vec3 baseCol;
uniform vec3 fogCol;
uniform float fadeTop;
uniform float fadeBottom;
/** specular strength, 0 for matte props (set by createPropMaterial) */
uniform float shine;
void main() {
  float ndl = dot(normalize(vNormal), -sunDir);
  float lit = 0.5 + 0.5 * smoothstep(-0.2, 0.5, ndl);
  vec3 col = baseCol * mix(shadowCol, sunCol, lit);
  float spec = pow(max(dot(reflect(sunDir, normalize(vNormal)), -cameraDir), 0.0), 24.0) * shine;
  col += sunCol * spec;
  col = mix(col, fogCol, (1.0 - smoothstep(fadeBottom, fadeTop, vWorld.y)) * 0.85);
#ifdef GHOST
  // a preview, not placed yet (docs/PIERS.md): see-through by a fine
  // screen-door pattern (no sorting against the water) and paler
  vec2 px = floor(gl_FragCoord.xy);
  if (mod(px.x + px.y, 2.0) < 1.0) discard;
  col = mix(col, vec3(1.0), 0.35);
#endif
  gl_FragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------ static shore (chair view)

/**
 * The beach either side of the simulated ones: flat-shaded sand with a swash
 * painted on. The run-up line rises and falls with the same swell as the
 * simulation (shifted a little along the shore so it isn't in lock-step),
 * leaving a darker wet band and a lacy foam edge.
 */
export const shoreFragment = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vWorld;
${LIGHT_UNIFORMS}
uniform vec3 baseCol;
uniform vec3 wetCol;
uniform vec3 foamCol;
uniform vec3 fogCol;
uniform float fadeTop;
uniform float fadeBottom;
uniform float tide;
uniform float simTime;
uniform vec3 swellA;
uniform vec3 swellW;
uniform vec3 swellP;
uniform vec3 swellK;
uniform float swellEnv;
${NOISE}
void main() {
  float x = vWorld.x;
  // swell at this point of the shore (it arrives at an angle, in sets)
  vec3 ph = swellW * simTime + swellP - swellK * x;
  float s = dot(swellA, sin(ph)) * swellEnv;
  float run = tide + 0.12 + max(s, -0.1) * 1.6;
  float h = vWorld.y;
  // wet: below the run-up, and a while after it falls back
  float wetTop = tide + 0.12 + dot(swellA, vec3(1.0)) * 1.2 * max(1.0, swellEnv);
  float wet = 1.0 - smoothstep(wetTop - 0.15, wetTop + 0.1, h);
  vec3 base = mix(baseCol, wetCol, wet);
  float ndl = dot(normalize(vNormal), -sunDir);
  float lit = 0.5 + 0.5 * smoothstep(-0.2, 0.5, ndl);
  vec3 col = base * mix(shadowCol, sunCol, lit);
  // foam: a broken line at the run-up edge, thinning out below it
  float n = vnoise(vWorld.xz * vec2(1.3, 3.0) + vec2(simTime * 0.15, 0.0));
  float edge = exp(-abs(h - run) / 0.05) * smoothstep(0.15, 0.45, n);
  float trail = smoothstep(run, run - 0.1, h) * smoothstep(run - 0.5, run - 0.15, h) * smoothstep(0.4, 0.7, n) * 0.8;
  col = mix(col, foamCol, clamp(edge + trail, 0.0, 1.0));
  col = mix(col, fogCol, (1.0 - smoothstep(fadeBottom, fadeTop, vWorld.y)) * 0.85);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------ beach animals

/**
 * Single-draw-call flat-shaded animal mesh with per-vertex colours and
 * lightweight GPU animation packed into `uv`:
 *   uv.x: leg gait group (-1 or +1 for alternating legs, 0 for body/claws)
 *   uv.y: claw wave weight (1 on claws, 0 elsewhere; a sandpiper's wings)
 * and an optional colour change (`tint` toward `tintCol`, masked by colour alpha).
 */
export const animalVertex = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec4 color;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float scuttlePhase;
uniform float scuttleAmp;
uniform float clawWave;
uniform float tint;
uniform vec3 tintCol;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vColor;
void main() {
  vec3 pos = position;
  if (abs(uv.x) > 0.5 && scuttleAmp > 0.001) {
    float ph = scuttlePhase + (uv.x > 0.0 ? 0.0 : 3.14159265);
    float lift = max(0.0, sin(ph)) * 0.14 * scuttleAmp;
    float stride = cos(ph) * 0.11 * scuttleAmp;
    pos.y += lift;
    pos.z += stride * sign(pos.x);
  }
  if (uv.y > 0.05 && clawWave > 0.001) {
    float wave = sin(scuttlePhase * 0.7 + (pos.x > 0.0 ? 0.0 : 1.4)) * 0.12 * clawWave * uv.y;
    pos.y += max(0.0, wave) + 0.05 * clawWave * uv.y;
  }
  vec4 wp = world * vec4(pos, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(world) * normal);
  // colour change (the octopus blending into the sand): colour alpha masks it (eyes, snacks: 0)
  vColor = mix(color.rgb, tintCol, clamp(tint, 0.0, 1.0) * color.a);
  gl_Position = viewProjection * wp;
}
`;

export const animalFragment = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vColor;
${LIGHT_UNIFORMS}
uniform float shine;
void main() {
  vec3 N = normalize(vNormal);
  float ndl = dot(N, -sunDir);
  float lit = 0.5 + 0.5 * smoothstep(-0.2, 0.5, ndl);
  vec3 col = vColor * mix(shadowCol, sunCol, lit);
  float spec = pow(max(dot(reflect(sunDir, N), -cameraDir), 0.0), 24.0) * shine;
  col += sunCol * spec;
  gl_FragColor = vec4(col, 1.0);
}
`;

