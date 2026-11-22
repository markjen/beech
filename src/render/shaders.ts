// GLSL for all custom materials. Written in GLSL ES 1.0 style; Babylon
// converts it for WebGL2 (and WebGPU) automatically.

const FIELD = /* glsl */ `
uniform sampler2D fieldPrev;
uniform sampler2D fieldCur;
uniform float frameMix;
uniform vec2 gridSize;
vec4 fieldAt(vec2 c) {
  vec2 uv = (clamp(c, vec2(0.0), gridSize - 1.0) + 0.5) / gridSize;
  return mix(texture2D(fieldPrev, uv), texture2D(fieldCur, uv), frameMix);
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
${FIELD}
varying vec3 vWorld;
varying float vWet;
varying float vCav;
varying float vDug;
varying float vWater;
varying vec3 vNormal;
uniform float cellSize;
void main() {
  vec2 c = floor(uv * gridSize);
  vec4 f = fieldAt(c);
  float h = f.r;
  float hl = fieldAt(c - vec2(1.0, 0.0)).r;
  float hr = fieldAt(c + vec2(1.0, 0.0)).r;
  float hd = fieldAt(c - vec2(0.0, 1.0)).r;
  float hu = fieldAt(c + vec2(0.0, 1.0)).r;
  vNormal = normalize(vec3(hl - hr, 2.0 * cellSize, hd - hu));
  float a = (fieldAt(c + vec2(2.0, 0.0)).r + fieldAt(c - vec2(2.0, 0.0)).r +
             fieldAt(c + vec2(0.0, 2.0)).r + fieldAt(c - vec2(0.0, 2.0)).r) * 0.25;
  vCav = clamp((a - h) * 6.0, 0.0, 1.0);
  vDug = texture2D(restTex, (c + 0.5) / gridSize).r - h;
  // soften the per-cell wetness so the wet line doesn't stair-step
  vWet = f.b * 0.4 + (fieldAt(c - vec2(1.0, 0.0)).b + fieldAt(c + vec2(1.0, 0.0)).b +
                      fieldAt(c - vec2(0.0, 1.0)).b + fieldAt(c + vec2(0.0, 1.0)).b) * 0.15;
  vWater = f.g;
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
  vec4 f = fieldAt(c);
  vec4 l = fieldAt(c - vec2(1.0, 0.0));
  vec4 r = fieldAt(c + vec2(1.0, 0.0));
  vec4 dn = fieldAt(c - vec2(0.0, 1.0));
  vec4 up = fieldAt(c + vec2(0.0, 1.0));
  float d = f.g;
  float y = f.r + d;
  // dry cells tuck just under the sand so the waterline sits close to the true edge
  if (d < 0.003) y = f.r - 0.012;
  float rip = (sin(position.x * 2.3 + time * 1.7) + sin(position.z * 2.9 - time * 1.3 + position.x * 0.8)) * 0.006;
  y += rip * clamp(d * 4.0, 0.0, 1.0);
  // softened depth/foam for colour and alpha (geometry keeps the exact depth)
  vDepth = d * 0.4 + (l.g + r.g + dn.g + up.g) * 0.15;
  vFoam = f.a * 0.4 + (l.a + r.a + dn.a + up.a) * 0.15;
  vec4 wp = world * vec4(position.x, y, position.z, 1.0);
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
  float a = smoothstep(0.0, 0.03, vDepth) * mix(0.45, 0.9, dt);
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
uniform float simTime;
uniform float tide;
uniform float zEdge;
uniform float waveSpeed;
varying vec3 vWorld;
varying float vCrest;
void main() {
  // a swell travelling toward +z that equals the sim's boundary forcing at zEdge
  float tt = simTime - (position.z - zEdge) / waveSpeed;
  vec3 s = swellA * sin(swellW * tt + swellP);
  float h = s.x + s.y + s.z;
  float chop = sin(position.x * 0.9 + simTime * 1.1 + position.z * 0.4) * 0.03 +
               sin(position.x * 0.35 - position.z * 0.7 - simTime * 0.8) * 0.04;
  float y = tide + h + chop * smoothstep(0.0, 8.0, zEdge - position.z);
  vCrest = h / max(0.001, swellA.x + swellA.y + swellA.z);
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
/** open sea only: x centres of the simulated beaches to leave a hole for */
uniform vec3 slabs;
uniform float slabHalf;
${FACET}
void main() {
  if (apron < 0.5) {
    vec3 d = abs(vec3(vWorld.x) - slabs);
    if (vWorld.z > zEdge + 0.02 && min(d.x, min(d.y, d.z)) < slabHalf) discard;
  }
  vec3 N = facetNormal(vWorld);
  float ndl = dot(N, -sunDir);
  float ramp = 0.7 + 0.3 * smoothstep(0.3, 0.7, ndl);
  float dist = zEdge - vWorld.z;
  vec3 col = mix(deepCol, oceanCol, smoothstep(0.0, 25.0, dist)) * mix(shadowCol * 1.1, sunCol, ramp);
  col = mix(col, foamCol, smoothstep(0.55, 1.0, vCrest) * 0.18);
  float spec = pow(max(dot(reflect(sunDir, N), -cameraDir), 0.0), 40.0);
  col += sunCol * spec * 0.25;
  float f = smoothstep(fadeNear, fadeFar, dist);
  float a;
  if (apron > 0.5) {
    // soften the cut sides a little as the sea recedes into the mist
    f = max(f, smoothstep(halfX - 0.5 - dist * 0.25, halfX, abs(vWorld.x - centerX)) * smoothstep(0.0, 6.0, dist));
    col = mix(col, fogCol, f * 0.55);
    a = (1.0 - f) * 0.95;
  } else {
    // open sea: haze toward the horizon, see-through in the shallows
    col = mix(col, fogCol, f * 0.85);
    a = mix(0.82, 1.0, smoothstep(-2.0, 30.0, dist));
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
  vec2 c = floor(uv * gridSize);
  vec4 f = fieldAt(c);
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
  vNormal = normal;
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

export const flatVertex = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(world) * normal);
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
void main() {
  float ndl = dot(normalize(vNormal), -sunDir);
  float lit = 0.5 + 0.5 * smoothstep(-0.2, 0.5, ndl);
  vec3 col = baseCol * mix(shadowCol, sunCol, lit);
  col = mix(col, fogCol, (1.0 - smoothstep(fadeBottom, fadeTop, vWorld.y)) * 0.85);
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
${NOISE}
void main() {
  float x = vWorld.x;
  // swell at this point of the shore, phase-shifted along the beach
  vec3 ph = swellW * simTime + swellP - vec3(0.021, 0.017, 0.029) * x;
  float s = dot(swellA, sin(ph));
  float run = tide + 0.12 + max(s, -0.1) * 1.6;
  float h = vWorld.y;
  // wet: below the run-up, and a while after it falls back
  float wetTop = tide + 0.12 + dot(swellA, vec3(1.0)) * 1.2;
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
