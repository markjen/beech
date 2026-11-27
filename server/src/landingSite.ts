// The beech.games landing page: https://beech.games/ (and /landing on
// every other host, so it works before the domain does).
//
// Server-rendered HTML with inline CSS and a tiny progressive-enhancement
// script for the time-of-day diorama showcase, lower on the page. Numbers that the server decides
// are read from the same constants the server and the guide use, so the page
// can't drift from the game.
//
// Starter gifts are a surprise (#9): never mention them here.

import { BEACH_CAP } from './app.js';
import { CHECKPOINTS_PER_BEACH } from './checkpoints.js';
import { DISCORD_INVITE_URL } from './community.js';
import { DIG_FIND_DAILY_CAP } from './digFinds.js';
import { COOLDOWN_MAX_MS, COOLDOWN_MIN_MS } from './pulls.js';
import { RELEASE_NOTES } from './releaseNotes.js';
import { escapeHtml as esc } from './shareMeta.js';

export const LANDING_GAME_URL = 'https://play.beech.games';
export const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=app.beech.beach';
export const LANDING_SHORE_URL = 'https://beechshore.com';

const minutes = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m >= 60 && m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`;
};

const ARROW_SVG = `<svg class="ico-arrow" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4.5 10h11m0 0-4.5-4.5M15.5 10 11 14.5" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const PLAY_STORE_SVG = `<svg class="ico-store" width="22" height="24" viewBox="0 0 24 26" fill="none" aria-hidden="true">
  <path d="M1.3 1.4C1 1.75.8 2.3.8 3.05v19.9c0 .75.2 1.3.5 1.65l.1.09 11.15-11.15v-.26L1.4 1.31l-.1.09Z" fill="#4285F4"/>
  <path d="M16.26 17.26 12.55 13.54v-.26l3.71-3.71.08.05 4.4 2.5c1.25.71 1.25 1.88 0 2.59l-4.4 2.5-.08.05Z" fill="#FBBC04"/>
  <path d="M16.34 17.21 12.55 13.41 1.3 24.66c.42.44 1.11.5 1.89.05l13.15-7.5Z" fill="#EA4335"/>
  <path d="M16.34 9.61 3.19 2.11C2.41 1.67 1.72 1.73 1.3 2.17l11.25 11.24 3.79-3.8Z" fill="#34A853"/>
</svg>`;

const APPLE_SVG = `<svg class="ico-store" width="20" height="24" viewBox="0 0 20 24" fill="currentColor" aria-hidden="true">
  <path d="M16.43 12.7c-.03-2.55 2.08-3.78 2.18-3.84-1.19-1.74-3.04-1.97-3.69-2-1.56-.16-3.06.93-3.86.93-.81 0-2.03-.91-3.35-.89-1.72.03-3.32 1-4.2 2.54-1.8 3.12-.46 7.73 1.29 10.26.86 1.24 1.87 2.63 3.21 2.58 1.29-.05 1.78-.83 3.34-.83 1.56 0 2 .83 3.35.8 1.39-.02 2.27-1.26 3.12-2.5.99-1.44 1.39-2.84 1.42-2.91-.03-.01-2.78-1.07-2.81-4.14ZM13.89 5.36c.71-.87 1.19-2.07 1.06-3.27-1.02.04-2.27.68-3 1.54-.65.75-1.23 1.98-1.07 3.15 1.14.09 2.3-.58 3.01-1.42Z"/>
</svg>`;

const GLOBE_SVG = `<svg class="ico-btn" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.65"/><path d="M2.8 10h14.4M10 2.5c2.2 2.1 3.3 4.6 3.3 7.5s-1.1 5.4-3.3 7.5c-2.2-2.1-3.3-4.6-3.3-7.5S7.8 4.6 10 2.5Z" stroke="currentColor" stroke-width="1.5"/></svg>`;

/** Minimal bespoke coastal marks for the 3 core pillars. */
const PILLAR_WAVE_SVG = `<svg width="26" height="26" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M3 16.5c2.4-2.4 4.8-2.4 7.2 0s4.8 2.4 7.2 0 4.8-2.4 7.6 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5 11.2c2-1.8 4-1.8 6 0s4 1.8 6 0 4-1.8 6 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity=".55"/><path d="M6 21.5h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity=".4"/></svg>`;

const PILLAR_SHELL_SVG = `<svg width="26" height="26" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M14 5c5.2 0 9 3.6 9 8.2 0 3.7-2.6 6.8-6.2 7.8l-.8 1.5h-4l-.8-1.5C7.6 20 5 16.9 5 13.2 5 8.6 8.8 5 14 5Z" stroke="currentColor" stroke-width="1.85" stroke-linejoin="round"/><path d="M14 5v15.5M14 14.5 9.2 7.5M14 14.5l4.8-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".55"/></svg>`;

const PILLAR_SHORE_SVG = `<svg width="26" height="26" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M5 21 14 6.5 23 21" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" opacity=".35"/><path d="M11.5 21V11.5h5V21M12.2 11.5 14 7.5l1.8 4M9 21h10" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"/><circle cx="14" cy="5.5" r="1.3" fill="currentColor"/></svg>`;

/** The landing page. `gameUrl` is where the Play buttons go. */
export function landingHtml(gameUrl: string = LANDING_GAME_URL): string {
  const newest = RELEASE_NOTES.slice(0, 2);
  const whatsNew = newest
    .map(
      (r) => `<article class="release-card">
  <div class="release-head">
    <time datetime="${esc(r.date)}">${esc(new Date(`${r.date}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }))}</time>
    <h3>${esc(r.title)}</h3>
  </div>
  <ul>${r.changes.slice(0, 3).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
</article>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>beech — a quiet place by the sea</title>
<meta name="description" content="beech is a quiet place by the sea: shape the sand, watch the waves rework it, and build a beach of your own. Play now on the web or get it on Google Play; iOS coming soon.">
<link rel="canonical" href="https://beech.games/">
<meta name="theme-color" content="#8fd0e6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#131b26" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:site_name" content="beech">
<meta property="og:title" content="beech — a quiet place by the sea">
<meta property="og:description" content="Shape the sand, watch the waves rework it, and build a beach of your own. Play now on the web or on Google Play; iOS coming soon.">
<meta property="og:url" content="https://beech.games/">
<meta property="og:image" content="https://beech.games/hero-beach.jpg">
<meta property="og:image:width" content="2048">
<meta property="og:image:height" content="1152">
<meta property="og:image:alt" content="A sunny illustrated beach in beech: a red-and-white lighthouse, beach hut, striped parasol, sandcastle, shells, and gentle waves">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="beech — a quiet place by the sea">
<meta name="twitter:description" content="Shape the sand, watch the waves rework it, and build a beach of your own. Free on the web and Google Play; iOS coming soon.">
<meta name="twitter:image" content="https://beech.games/hero-beach.jpg">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400..500&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap">
<style>
:root {
  --bg: #fbf4e7;
  --bg-deep: #f2e5ce;
  --surface: #fffcf6;
  --surface-tint: #f6ecda;
  --ink: #1d2d38;
  --ink-soft: #4e606e;
  --ink-faint: #758490;
  --line: rgba(98, 82, 62, 0.14);
  --line-strong: rgba(98, 82, 62, 0.24);
  --sea: #1a6f85;
  --sea-hover: #135a6d;
  --sea-soft: rgba(26, 111, 133, 0.11);
  --sea-ink: #fffdf8;
  --coral: #d9624c;
  --store-bg: #17232c;
  --store-bg-hover: #21323f;
  --store-fg: #fbf7f0;
  --ios-bg: rgba(255, 252, 246, 0.72);
  --ios-border: rgba(98, 82, 62, 0.22);
  --shadow-sm: 0 2px 10px rgba(38, 49, 58, 0.06);
  --shadow-md: 0 14px 36px rgba(32, 48, 60, 0.10), 0 2px 8px rgba(32, 48, 60, 0.05);
  --shadow-lg: 0 28px 68px rgba(24, 42, 54, 0.18), 0 6px 18px rgba(24, 42, 54, 0.08);
  --nav-bg: rgba(251, 244, 231, 0.78);
  --wave-back: rgba(143, 218, 210, 0.42);
  --wave-front: #fbf4e7;
  --font-display: 'Fraunces', Georgia, 'Times New Roman', serif;
  --font-sans: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #131b26;
    --bg-deep: #0e151f;
    --surface: #1b2534;
    --surface-tint: #212e40;
    --ink: #f3ede3;
    --ink-soft: #b2c0cc;
    --ink-faint: #7e90a1;
    --line: rgba(226, 214, 196, 0.12);
    --line-strong: rgba(226, 214, 196, 0.22);
    --sea: #66c8d4;
    --sea-hover: #7fd6e0;
    --sea-soft: rgba(102, 200, 212, 0.14);
    --sea-ink: #0c1b23;
    --coral: #ee826c;
    --store-bg: #223042;
    --store-bg-hover: #2c3e54;
    --store-fg: #f7f3eb;
    --ios-bg: rgba(27, 37, 52, 0.75);
    --ios-border: rgba(226, 214, 196, 0.18);
    --shadow-sm: 0 2px 12px rgba(0, 0, 0, 0.26);
    --shadow-md: 0 16px 40px rgba(0, 0, 0, 0.34);
    --shadow-lg: 0 30px 72px rgba(0, 0, 0, 0.5);
    --nav-bg: rgba(19, 27, 38, 0.8);
    --wave-back: rgba(74, 152, 174, 0.22);
    --wave-front: #131b26;
  }
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 16px/1.62 var(--font-sans);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
img { display: block; max-width: 100%; }
a { color: var(--sea); text-underline-offset: 3px; }
a:focus-visible, button:focus-visible {
  outline: 2px solid var(--sea);
  outline-offset: 3px;
}

/* Subtle tactile paper/sand grain across the page */
body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 40;
  opacity: 0.032;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 160 160' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

/* ---------- Navigation ---------- */
.topbar {
  position: sticky;
  top: 0;
  z-index: 30;
  background: var(--nav-bg);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--line);
}
.topbar-inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: var(--ink);
}
.brand img {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  box-shadow: var(--shadow-sm);
}
.brand-name {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1;
}
.nav-links {
  display: flex;
  align-items: center;
  gap: 24px;
}
.nav-links a {
  color: var(--ink-soft);
  text-decoration: none;
  font-size: 14.5px;
  font-weight: 500;
  transition: color 160ms ease;
}
.nav-links a:hover { color: var(--ink); }
.nav-links a.nav-cta {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 16px;
  border-radius: 999px;
  background: var(--sea);
  color: var(--sea-ink);
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
  transition: background 180ms ease, transform 180ms ease, box-shadow 180ms ease;
  box-shadow: 0 2px 10px rgba(26, 111, 133, 0.22);
  white-space: nowrap;
}
.nav-links a.nav-cta:hover {
  background: var(--sea-hover);
  color: var(--sea-ink);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(26, 111, 133, 0.28);
}

/* ---------- Hero ---------- */
.hero {
  position: relative;
  overflow: hidden;
  background: var(--bg);
  padding: 0 0 104px;
}
/* Full-bleed hero splash: an illustration of a beach you could build in
   the game, with no text on top of it. It spans edge to edge of the
   viewport — no side margins, no rounded corners, no shadow — and scales
   with the viewport: object-fit: cover over a viewport-relative height,
   so it zooms in and out with screen size instead of sitting at a fixed
   size. The image is never stretched, and below a 2048px viewport it is
   never upscaled. The 100% width (not 100vw) keeps it inside the
   scrollbar, so it cannot cause horizontal overflow. */
.hero-splash {
  margin: 0 0 40px;
}
.hero-splash img {
  width: 100%;
  height: clamp(240px, 42vw, 640px);
  object-fit: cover;
  object-position: center 58%;
  border-radius: 0;
}
.hero-inner {
  position: relative;
  z-index: 2;
  max-width: 780px;
  margin: 0 auto;
  text-align: center;
}
.eyebrow {
  margin: 0 0 14px;
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--sea);
}
.hero h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(44px, 5.4vw, 68px);
  font-weight: 500;
  line-height: 1.04;
  letter-spacing: -0.028em;
  color: var(--ink);
}
.hero h1 em {
  font-style: italic;
  font-weight: 400;
}
.hero-lead {
  margin: 22px auto 32px;
  max-width: 560px;
  font-size: 18px;
  line-height: 1.62;
  color: var(--ink-soft);
}

/* Primary Action Cluster */
.hero-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 14px;
}
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 15px 26px;
  border-radius: 999px;
  background: var(--sea);
  color: var(--sea-ink);
  text-decoration: none;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.005em;
  box-shadow: 0 10px 26px rgba(26, 111, 133, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.22);
  transition: background 180ms ease, transform 200ms cubic-bezier(.22,1,.36,1), box-shadow 200ms ease;
}
.btn-primary:hover {
  background: var(--sea-hover);
  transform: translateY(-2px);
  box-shadow: 0 16px 34px rgba(26, 111, 133, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.24);
}
.btn-primary .ico-arrow { transition: transform 200ms ease; }
.btn-primary:hover .ico-arrow { transform: translateX(3px); }

.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 22px;
  border-radius: 999px;
  background: rgba(255, 252, 246, 0.65);
  color: var(--ink);
  border: 1px solid var(--line-strong);
  text-decoration: none;
  font-size: 15.5px;
  font-weight: 600;
  transition: background 180ms ease, border-color 180ms ease, transform 180ms ease;
}
@media (prefers-color-scheme: dark) {
  .btn-secondary { background: rgba(27, 37, 52, 0.65); }
}
.btn-secondary:hover {
  background: var(--surface);
  border-color: var(--ink-faint);
  transform: translateY(-1px);
}

/* Store Badges Row */
.store-row {
  margin-top: 22px;
  padding-top: 22px;
  border-top: 1px solid var(--line);
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  justify-content: center;
  gap: 12px;
}
.store-btn {
  display: inline-flex;
  align-items: center;
  gap: 11px;
  padding: 10px 18px 10px 14px;
  border-radius: 14px;
  background: var(--store-bg);
  color: var(--store-fg);
  text-decoration: none;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: var(--shadow-sm);
  transition: background 180ms ease, transform 200ms cubic-bezier(.22,1,.36,1), box-shadow 200ms ease;
}
.store-btn:hover {
  background: var(--store-bg-hover);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
.store-btn .store-text,
.ios-badge .store-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.store-kicker {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.78;
}
.store-name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin-top: 2px;
}
.ios-badge {
  display: inline-flex;
  align-items: center;
  gap: 11px;
  padding: 10px 18px 10px 14px;
  border-radius: 14px;
  background: var(--ios-bg);
  color: var(--ink-soft);
  border: 1px dashed var(--ios-border);
  cursor: default;
  user-select: none;
}
.ios-badge .ico-store { opacity: 0.75; }
.ios-badge .store-name { color: var(--ink); font-weight: 600; }

.hero-sublinks {
  margin-top: 16px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 18px;
  font-size: 14px;
  color: var(--ink-faint);
}
.hero-sublinks a {
  color: var(--ink-soft);
  text-decoration: none;
  font-weight: 500;
}
.hero-sublinks a:hover { color: var(--sea); text-decoration: underline; }

/* Time-of-day atmosphere for the diorama section (matched to src/palette.ts) */
.diorama-section {
  --diorama-sky-top: #b8e0ee;
  --diorama-sky-mid: #e6f2f1;
  --diorama-sky-bottom: #fbf4e7;
  background: linear-gradient(180deg, var(--diorama-sky-top) 0%, var(--diorama-sky-mid) 48%, var(--diorama-sky-bottom) 100%);
  transition: background 450ms ease;
  border-radius: 26px;
}
.diorama-section[data-mood="dawn"] {
  --diorama-sky-top: #c2cce8;
  --diorama-sky-mid: #f5d8ce;
}
.diorama-section[data-mood="golden"] {
  --diorama-sky-top: #f2be9d;
  --diorama-sky-mid: #fce5be;
}
.diorama-section[data-mood="dusk"] {
  --diorama-sky-top: #8f95bd;
  --diorama-sky-mid: #e8bcb8;
}
@media (prefers-color-scheme: dark) {
  .diorama-section {
    --diorama-sky-top: #1b364a;
    --diorama-sky-mid: #1a2a3b;
    --diorama-sky-bottom: #131b26;
  }
  .diorama-section[data-mood="dawn"] { --diorama-sky-top: #26314c; --diorama-sky-mid: #312c3c; }
  .diorama-section[data-mood="golden"] { --diorama-sky-top: #46322b; --diorama-sky-mid: #2a2427; }
  .diorama-section[data-mood="dusk"] { --diorama-sky-top: #1d2742; --diorama-sky-mid: #282436; }
}
.diorama-section .hero-stage {
  max-width: 880px;
  margin: 0 auto;
}

/* Hero 3D Diorama Stage */
.hero-stage {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.diorama-frame {
  position: relative;
  aspect-ratio: 3 / 2;
  border-radius: 26px;
  overflow: hidden;
  background: var(--bg-deep);
  border: 1px solid rgba(255, 255, 255, 0.55);
  box-shadow: var(--shadow-lg);
}
@media (prefers-color-scheme: dark) {
  .diorama-frame { border-color: rgba(255, 255, 255, 0.12); }
}
.diorama-frame img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 550ms ease;
}
.diorama-frame img.is-active { opacity: 1; }

.stage-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  padding: 0 4px;
}
.stage-caption {
  font-size: 13px;
  color: var(--ink-soft);
  margin: 0;
  white-space: nowrap;
}
.mood-picker {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-sm);
}
.mood-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ink-soft);
  font: 600 12px/1 var(--font-sans);
  cursor: pointer;
  transition: background 180ms ease, color 180ms ease;
}
.mood-btn:hover { color: var(--ink); }
.mood-btn[aria-pressed="true"] {
  background: var(--bg-deep);
  color: var(--ink);
}
.mood-swatch {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}
.mood-swatch.dawn { background: linear-gradient(135deg, #a9b8e0, #f7d2c4); }
.mood-swatch.day { background: linear-gradient(135deg, #8fd0e6, #f6e3c3); }
.mood-swatch.golden { background: linear-gradient(135deg, #f0a98f, #fde3b3); }
.mood-swatch.dusk { background: linear-gradient(135deg, #4a4f85, #e59a9a); }

/* Animated coastal shoreline divider at the base of the hero */
.hero-waves {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 62px;
  pointer-events: none;
  z-index: 1;
}
.hero-waves svg {
  width: 112%;
  height: 100%;
  display: block;
}
.wave-back {
  fill: var(--wave-back);
  animation: tideDrift 14s ease-in-out infinite alternate;
}
.wave-front {
  fill: var(--wave-front);
  animation: tideDrift 10s ease-in-out infinite alternate-reverse;
}
@keyframes tideDrift {
  from { transform: translateX(-4%); }
  to { transform: translateX(0%); }
}
@media (prefers-reduced-motion: reduce) {
  .wave-back, .wave-front { animation: none; }
  .diorama-frame img, .btn-primary, .store-btn { transition: none; }
}

/* ---------- Main Sections ---------- */
main {
  max-width: 1120px;
  margin: 0 auto;
  padding: 28px 24px 0;
}
.section {
  padding: 56px 0;
}
.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px 28px;
  margin-bottom: 32px;
}
.section-head h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(28px, 3.4vw, 38px);
  font-weight: 500;
  line-height: 1.12;
  letter-spacing: -0.022em;
}
.section-sub {
  margin: 8px 0 0;
  max-width: 560px;
  color: var(--ink-soft);
  font-size: 16.5px;
}
.section-link {
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  color: var(--sea);
  white-space: nowrap;
}
.section-link:hover { text-decoration: underline; }

/* 3 Core Pillars */
.pillars {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.pillar {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 28px 26px;
  box-shadow: var(--shadow-sm);
  transition: transform 220ms cubic-bezier(.22,1,.36,1), box-shadow 220ms ease;
}
.pillar:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
}
.pillar-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: var(--sea-soft);
  color: var(--sea);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
}
.pillar h3 {
  margin: 0 0 10px;
  font-family: var(--font-display);
  font-size: 21px;
  font-weight: 500;
  letter-spacing: -0.015em;
}
.pillar p {
  margin: 0;
  color: var(--ink-soft);
  font-size: 15px;
  line-height: 1.65;
}

/* Editorial Feature Details (clean typographic grid, zero clutter) */
.details-grid {
  margin-top: 40px;
  padding-top: 36px;
  border-top: 1px solid var(--line);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 28px 48px;
}
.detail-item h3 {
  margin: 0 0 6px;
  font-size: 16.5px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.detail-item p {
  margin: 0;
  color: var(--ink-soft);
  font-size: 15px;
  line-height: 1.62;
}

/* Where to play band */
.play-band {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 28px;
  padding: 40px 38px;
  box-shadow: var(--shadow-md);
}
.play-band-head {
  margin-bottom: 28px;
}
.play-band-head h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(26px, 3vw, 36px);
  font-weight: 500;
  letter-spacing: -0.02em;
}
.play-band-head p {
  margin: 8px 0 0;
  color: var(--ink-soft);
  max-width: 580px;
}
.platforms {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
.platform-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 20px;
  padding: 24px;
  border-radius: 18px;
  background: var(--bg);
  border: 1px solid var(--line);
}
.platform-card.featured {
  background: var(--surface-tint);
  border-color: var(--line-strong);
}
.platform-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--sea);
  margin: 0 0 6px;
}
.platform-card h3 {
  margin: 0 0 8px;
  font-family: var(--font-display);
  font-size: 21px;
  font-weight: 500;
}
.platform-card p {
  margin: 0;
  font-size: 14.5px;
  color: var(--ink-soft);
  line-height: 1.58;
}
.platform-action {
  display: flex;
  align-items: center;
}
.platform-action .btn-primary {
  width: 100%;
  padding: 13px 18px;
  font-size: 15px;
}
.platform-action .store-btn,
.platform-action .ios-badge {
  width: 100%;
  justify-content: center;
}

/* What's new */
.releases {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}
.release-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 26px 26px 22px;
  box-shadow: var(--shadow-sm);
}
.release-head time {
  display: inline-block;
  font-size: 13px;
  font-weight: 600;
  color: var(--sea);
  margin-bottom: 6px;
}
.release-card h3 {
  margin: 0 0 14px;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 500;
  line-height: 1.25;
}
.release-card ul {
  margin: 0;
  padding-left: 18px;
  color: var(--ink-soft);
  font-size: 14.5px;
}
.release-card li { margin-bottom: 8px; }
.release-card li:last-child { margin-bottom: 0; }

/* Community Callout */
.community {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 24px 36px;
  padding: 36px 38px;
  border-radius: 24px;
  background: var(--surface-tint);
  border: 1px solid var(--line);
}
.community h2 {
  margin: 0 0 6px;
  font-family: var(--font-display);
  font-size: clamp(24px, 2.8vw, 32px);
  font-weight: 500;
  letter-spacing: -0.02em;
}
.community p {
  margin: 0;
  color: var(--ink-soft);
  max-width: 520px;
}
.community-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

/* Footer */
footer {
  max-width: 1120px;
  margin: 56px auto 0;
  padding: 32px 24px 48px;
  border-top: 1px solid var(--line);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px 24px;
  font-size: 14px;
  color: var(--ink-faint);
}
.footer-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--ink-soft);
}
.footer-brand img {
  width: 24px;
  height: 24px;
  border-radius: 6px;
}
footer nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
}
footer nav a {
  color: var(--ink-soft);
  text-decoration: none;
  font-weight: 500;
}
footer nav a:hover { color: var(--sea); text-decoration: underline; }

/* ---------- Responsive ---------- */
@media (max-width: 980px) {
  .hero { padding: 0 0 88px; }
  .hero-splash { margin-bottom: 32px; }
  .hero-lead { max-width: 580px; }
  .pillars, .platforms { grid-template-columns: 1fr; }
  .releases { grid-template-columns: 1fr; }
}
@media (max-width: 720px) {
  .topbar-inner { padding: 11px 16px; }
  .nav-links .nav-hide-sm { display: none; }
  .nav-links { gap: 14px; }
  .hero { padding: 0 0 76px; }
  .hero-splash { margin-bottom: 24px; }
  .hero-lead { margin: 14px auto 22px; font-size: 16.5px; }
  .details-grid { grid-template-columns: 1fr; gap: 22px; }
  .play-band, .community { padding: 28px 20px; border-radius: 22px; }
  .hero-actions { display: grid; grid-template-columns: 1fr auto; gap: 10px; }
  .hero-actions .btn-primary { padding: 14px 18px; font-size: 15px; }
  .hero-actions .btn-secondary { padding: 13px 16px; font-size: 14.5px; white-space: nowrap; }
  .store-row { margin-top: 16px; padding-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .store-btn, .ios-badge { padding: 9px 10px; gap: 8px; justify-content: center; }
  .store-name { font-size: 13.5px; }
  .hero-sublinks { margin-top: 12px; gap: 4px 14px; font-size: 13.5px; }
  .sublink-sep { display: none; }
  footer { flex-direction: column; align-items: flex-start; }
}
</style>
</head>
<body>

<div class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="/" aria-label="beech home">
      <img src="/icons/icon-192.png" alt="beech icon" width="34" height="34">
      <span class="brand-name">beech</span>
    </a>
    <nav class="nav-links" aria-label="Primary">
      <a class="nav-hide-sm" href="#explore">Explore</a>
      <a class="nav-hide-sm" href="#updates">What’s new</a>
      <a href="/guide">Guide</a>
      <a class="nav-hide-sm" href="${esc(LANDING_SHORE_URL)}">Shore</a>
      <a class="nav-hide-sm" href="${esc(DISCORD_INVITE_URL)}" target="_blank" rel="noopener">Discord</a>
      <a id="nav-play-web" class="nav-cta" href="${esc(gameUrl)}">Play on web</a>
    </nav>
  </div>
</div>

<header class="hero" id="hero">
  <div class="hero-splash">
    <img src="/hero-beach.jpg" alt="A sunny illustrated beach in beech: a red-and-white lighthouse, beach hut, striped parasol, sandcastle, shells, and gentle waves" width="2048" height="1152" fetchpriority="high" decoding="async">
  </div>
  <div class="hero-inner">
    <div class="hero-copy">
      <p class="eyebrow">beech · a quiet place by the sea</p>
      <h1>Shape the sand,<br>stay for the <em>tide.</em></h1>
      <p class="hero-lead">A calm little beach of your own. Dig, build, and set things down while the waves rework the shore — synced to a real beach’s tide, sun, and moon.</p>

      <div class="hero-actions">
        <a id="hero-play-web" class="btn-primary" href="${esc(gameUrl)}">
          ${GLOBE_SVG}
          <span>Play now on web</span>
          ${ARROW_SVG}
        </a>
        <a id="hero-guide" class="btn-secondary" href="/guide">How to play</a>
      </div>

      <div class="store-row" aria-label="Mobile apps">
        <a id="hero-google-play" class="store-btn" href="${esc(GOOGLE_PLAY_URL)}" target="_blank" rel="noopener">
          ${PLAY_STORE_SVG}
          <span class="store-text">
            <span class="store-kicker">Get it on</span>
            <span class="store-name">Google Play</span>
          </span>
        </a>
        <div id="hero-ios-soon" class="ios-badge" role="status" aria-label="iOS app coming soon">
          ${APPLE_SVG}
          <span class="store-text">
            <span class="store-kicker">iOS</span>
            <span class="store-name">Coming soon</span>
          </span>
        </div>
      </div>

      <div class="hero-sublinks">
        <span>Free to play · no install needed on web</span>
        <span class="sublink-sep" aria-hidden="true">·</span>
        <a href="${esc(LANDING_SHORE_URL)}">Walk the public shore →</a>
      </div>
    </div>
  </div>

  <div class="hero-waves" aria-hidden="true">
    <svg viewBox="0 0 1440 72" preserveAspectRatio="none">
      <path class="wave-back" d="M0,30 C240,62 480,2 720,32 C960,62 1200,10 1440,34 L1440,72 L0,72 Z"/>
      <path class="wave-front" d="M0,44 C260,18 520,66 780,40 C1040,16 1260,56 1440,38 L1440,72 L0,72 Z"/>
    </svg>
  </div>
</header>

<main>
  <section class="section" id="explore" aria-labelledby="explore-heading">
    <div class="section-head">
      <div>
        <p class="eyebrow">What you do</p>
        <h2 id="explore-heading">Dig, build, and let the sea do the rest.</h2>
        <p class="section-sub">Every grain responds to your hand and to the surf. Leave a cove for the water to fill, or craft a whole stretch of coast.</p>
      </div>
      <a class="section-link" href="/guide">Read the full guide →</a>
    </div>

    <div class="pillars">
      <article class="pillar">
        <div class="pillar-icon">${PILLAR_WAVE_SVG}</div>
        <h3>Sculpt living sand</h3>
        <p>Dig, build, smooth, and clear with full undo. Waves wear down what you sculpt and fill holes near the waterline. Room for up to 2,000 things — sand never counts.</p>
      </article>
      <article class="pillar">
        <div class="pillar-icon">${PILLAR_SHELL_SVG}</div>
        <h3>Finds &amp; seaside machines</h3>
        <p>The tide brings shells, sea glass, and driftwood, and digging deep can uncover up to ${DIG_FIND_DAILY_CAP} buried finds a day. Play the free claw machine (rests ${minutes(COOLDOWN_MIN_MS)} to ${minutes(COOLDOWN_MAX_MS)}) and the daily vending machine’s rotating weekly set — vending balls never slip.</p>
      </article>
      <article class="pillar">
        <div class="pillar-icon">${PILLAR_SHORE_SVG}</div>
        <h3>Neighbors &amp; the endless shore</h3>
        <p>Link beaches by code so your shorelines blend edge to edge, stroll past neighbors into everyone else’s beaches on <a href="${esc(LANDING_SHORE_URL)}">beechshore.com</a>, star favorites, gift items from your bag, and watch beaches climb the all-time and rising leaderboards.</p>
      </article>
    </div>

    <div class="details-grid">
      <div class="detail-item">
        <h3>Up to ${BEACH_CAP} beaches of your own</h3>
        <p>Keep multiple beaches open on different devices at the same time — your phone and your TV can each show a different coast.</p>
      </div>
      <div class="detail-item">
        <h3>${CHECKPOINTS_PER_BEACH} named checkpoints per beach</h3>
        <p>Save named copies of a beach at any moment and restore them onto that beach, or onto another of yours.</p>
      </div>
      <div class="detail-item">
        <h3>Portable beach files</h3>
        <p>Export any beach as a file to keep or share, and import it back anytime on the web or in the apps.</p>
      </div>
      <div class="detail-item">
        <h3>Free bag &amp; coastal shop</h3>
        <p>Rocks, driftwood, shells, sea glass, and flags are free and never run out. Collect a deckchair, parasol, surfboard, tiki torches, sandcastle, beach hut, and lighthouse — with card checkout, gift cards, and promo codes on the web.</p>
      </div>
    </div>
  </section>

  <section class="section" id="updates" aria-labelledby="updates-heading">
    <div class="section-head">
      <div>
        <p class="eyebrow">Fresh off the tide</p>
        <h2 id="updates-heading">What’s new</h2>
      </div>
      <a class="section-link" href="/guide/releases">All release notes →</a>
    </div>
    <div class="releases">
      ${whatsNew}
    </div>
  </section>

  <section class="section diorama-section" id="diorama" data-mood="day" aria-labelledby="diorama-heading">
    <div class="section-head">
      <div>
        <p class="eyebrow">Live preview</p>
        <h2 id="diorama-heading">A beach that follows the day.</h2>
        <p class="section-sub">The same beach, under a real sky — pick a time of day and watch the light change.</p>
      </div>
    </div>
    <div class="hero-stage">
      <div class="diorama-frame">
        <img data-mood="day" class="is-active" src="/landing-assets/hero-day.webp" alt="beech 3D beach diorama in daylight with a lighthouse, beach hut, striped parasol, sandcastle, golden sand dollar, and turquoise waves" width="1200" height="800" fetchpriority="high" decoding="async">
        <img data-mood="golden" src="/landing-assets/hero-golden.webp" alt="beech 3D beach diorama in warm golden hour sunlight" width="1200" height="800" loading="lazy" decoding="async">
        <img data-mood="dawn" src="/landing-assets/hero-dawn.webp" alt="beech 3D beach diorama in soft pastel dawn light" width="1200" height="800" loading="lazy" decoding="async">
        <img data-mood="dusk" src="/landing-assets/hero-dusk.webp" alt="beech 3D beach diorama in rose and indigo dusk light" width="1200" height="800" loading="lazy" decoding="async">
      </div>
      <div class="stage-bar">
        <p class="stage-caption">In-game · live sky &amp; tide</p>
        <div class="mood-picker" role="group" aria-label="Preview time of day">
          <button id="mood-dawn" type="button" class="mood-btn" data-set-mood="dawn" aria-pressed="false"><span class="mood-swatch dawn" aria-hidden="true"></span>Dawn</button>
          <button id="mood-day" type="button" class="mood-btn" data-set-mood="day" aria-pressed="true"><span class="mood-swatch day" aria-hidden="true"></span>Day</button>
          <button id="mood-golden" type="button" class="mood-btn" data-set-mood="golden" aria-pressed="false"><span class="mood-swatch golden" aria-hidden="true"></span>Golden</button>
          <button id="mood-dusk" type="button" class="mood-btn" data-set-mood="dusk" aria-pressed="false"><span class="mood-swatch dusk" aria-hidden="true"></span>Dusk</button>
        </div>
      </div>
  </section>

  <section class="section" id="play" aria-labelledby="play-heading">
    <div class="play-band">
      <div class="play-band-head">
        <p class="eyebrow">Where to play</p>
        <h2 id="play-heading">Step onto the sand in seconds.</h2>
        <p>Start right in your browser or take your beach with you on Android. Sign in to keep your beaches, link neighbors, and play the machines.</p>
      </div>

      <div class="platforms">
        <div class="platform-card featured">
          <div>
            <p class="platform-label">Available now</p>
            <h3>Web browser</h3>
            <p>Free right now at <a href="${esc(gameUrl)}">play.beech.games</a> — no download, no install. Works on desktop, laptop, tablet, and TV.</p>
          </div>
          <div class="platform-action">
            <a id="section-play-web" class="btn-primary" href="${esc(gameUrl)}">
              <span>Play now on web</span>
              ${ARROW_SVG}
            </a>
          </div>
        </div>

        <div class="platform-card">
          <div>
            <p class="platform-label">Android app</p>
            <h3>Google Play</h3>
            <p>Full tactile experience on Android with native haptics, offline sand play, and beach-file sharing.</p>
          </div>
          <div class="platform-action">
            <a id="section-google-play" class="store-btn" href="${esc(GOOGLE_PLAY_URL)}" target="_blank" rel="noopener">
              ${PLAY_STORE_SVG}
              <span class="store-text">
                <span class="store-kicker">Get it on</span>
                <span class="store-name">Google Play</span>
              </span>
            </a>
          </div>
        </div>

        <div class="platform-card">
          <div>
            <p class="platform-label">iPhone &amp; iPad</p>
            <h3>iOS coming soon</h3>
            <p>Our native iOS app is on the way. Until it lands, you can play beech right in Safari on iPhone and iPad.</p>
          </div>
          <div class="platform-action">
            <div id="section-ios-soon" class="ios-badge" role="status">
              ${APPLE_SVG}
              <span class="store-text">
                <span class="store-kicker">iOS</span>
                <span class="store-name">Coming soon</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="section" aria-labelledby="community-heading">
    <div class="community">
      <div>
        <p class="eyebrow">Community</p>
        <h2 id="community-heading">Talk to us</h2>
        <p>Feedback, bug reports, and ideas live on our Discord — come share screenshots and tell us what you’re building on your beach.</p>
      </div>
      <div class="community-actions">
        <a id="community-discord" class="btn-primary" href="${esc(DISCORD_INVITE_URL)}" target="_blank" rel="noopener">
          <span>Join our Discord</span>
          ${ARROW_SVG}
        </a>
        <a id="community-shore" class="btn-secondary" href="${esc(LANDING_SHORE_URL)}">Browse the shore</a>
      </div>
    </div>
  </section>
</main>

<footer>
  <div class="footer-brand">
    <img src="/icons/icon-192.png" alt="" width="24" height="24">
    <span>beech · a quiet place by the sea</span>
  </div>
  <nav aria-label="Footer">
    <a href="${esc(gameUrl)}">Play on web</a>
    <a href="${esc(GOOGLE_PLAY_URL)}" target="_blank" rel="noopener">Google Play</a>
    <a href="/guide">Guide</a>
    <a href="/guide/releases">Release notes</a>
    <a href="/story">How it was built</a>
    <a href="${esc(LANDING_SHORE_URL)}">Shore</a>
    <a href="/privacy.html">Privacy</a>
    <a href="${esc(DISCORD_INVITE_URL)}" target="_blank" rel="noopener">Discord</a>
    <a href="mailto:hello@beech.games">hello@beech.games</a>
  </nav>
</footer>


<script>
(() => {
  const diorama = document.getElementById('diorama');
  if (!diorama) return;
  const imgs = diorama.querySelectorAll('.diorama-frame img[data-mood]');
  const btns = diorama.querySelectorAll('[data-set-mood]');
  const setMood = (mood) => {
    diorama.dataset.mood = mood;
    imgs.forEach((img) => img.classList.toggle('is-active', img.dataset.mood === mood));
    btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setMood === mood)));
  };
  btns.forEach((b) => b.addEventListener('click', () => setMood(b.dataset.setMood)));
})();
</script>
</body>
</html>`;
}
