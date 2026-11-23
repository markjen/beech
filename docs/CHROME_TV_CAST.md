# beech on a TV: Chrome fullscreen + Chromecast

How to put beech on a TV from a laptop, and what the app does (and doesn't)
do to help. Short version: **there is no "Chrome app" to build — install
beech as a PWA, tap "watch on TV", then cast the Chrome tab.**

## The verdict: packaged Chrome Apps are dead

"Chrome app" used to mean a packaged app from the Chrome Web Store. That
platform is deprecated and gone for consumers: Google removed Chrome Apps
from the Web Store on Windows, macOS and Linux in June 2022, and the last
holdout (ChromeOS) is being phased out — July 2025 was the last ChromeOS
release with user-installed Chrome Apps, with end of life in February 2028.
Google's own guidance is to migrate to standards-based web apps (PWAs).
So there is nothing to package, and no store listing to make. The modern
equivalent of "a Chrome app that runs fullscreen" is exactly what beech
already is: an installable PWA.

Sources: [Google Chrome App (Wikipedia)](https://en.wikipedia.org/wiki/Google_Chrome_App),
[End of Support for Chrome Apps](https://amplifiedlabs.zendesk.com/hc/en-us/articles/46035429109523-End-of-Support-for-Chrome-Apps).

## The recommended path (what Mark does)

1. **Install beech.** In Chrome on the laptop, open
   https://play.beech.games and click the install icon in the address bar
   (or menu → "Install beech…"). It installs as its own window and launches
   fullscreen — no browser chrome, no tabs. (This only started working with
   the fix below: the manifest used to name icon files that didn't exist, so
   Chrome never offered to install.)
2. **Tap "watch on TV".** In the app: Settings (menu, top left) →
   **watch on TV**. One tap turns on ambient mode (controls fade away when
   idle, screen kept awake), sits you on the sand (chair view) and goes
   fullscreen. Anything else also works: the "ambient (for a TV)" toggle on
   its own, or opening `https://play.beech.games/?tv=1` — same thing, no
   fullscreen (fullscreen needs a tap, browsers won't let a page take it on
   load).
3. **Cast the tab.** In Chrome: menu (⋮) → **Cast…** → pick the TV, with
   "Cast tab" as the source. The installed PWA window is a Chrome window,
   so it casts the same way. Sound follows the tab.
4. To stop: Esc exits fullscreen, or stop the cast from the Chrome menu.

Notes on the experience:

- Tab casting mirrors the tab (up to 1080p) — it is not a native 4K stream.
  For a calm beach scene that is plenty.
- Keep the laptop awake and on the same Wi-Fi as the TV; the laptop is
  doing the rendering.
- The wake lock in ambient mode keeps the *laptop* screen awake; the TV
  stays on while it is receiving the cast.
- On an installed PWA the "watch on TV" fullscreen step is a no-op — the
  app is already fullscreen — the tap still turns on ambient + chair view.

## What was fixed / built (2026-11-22)

- **Manifest icons were broken — the actual bug.** `manifest.webmanifest`
  listed `icon-48.webp` … `icon-512.webp` with `type: image/png`, but no
  `.webp` files were ever shipped (`public/icons/` only has PNGs). Chrome
  needs a real 192px and a real 512px icon before it offers install, so
  the install prompt never appeared. The manifest now points at the real
  files (`icon-192.png`, `icon-512.png`, `maskable-512.png`, with the
  maskable one marked `purpose: maskable`), plus an explicit `"id"`.
  `tests/pwa.test.ts` checks the manifest and the service worker's offline
  shell against the files on disk, so this can't silently break again.
- **"watch on TV" button** in the settings sheet (`src/ui/overlays.ts`,
  handler in `src/main.ts`): ambient + chair view + fullscreen in one tap.
  The sheet now also syncs its switches when settings change outside it,
  so the ambient toggle shows the right state after the tap.
- Already there, unchanged: the PWA itself (`display: fullscreen`,
  service worker with offline shell, `theme_color`), ambient/TV mode
  (`?tv=1`, wake lock, idle fade), the plain "full screen" button, and
  Android TV leanback launcher support in the Android app.

## Deliberately not built: a custom Cast receiver

A fancier route exists: register a **custom Cast receiver** so a phone (or
the web app) can cast beech to the TV with a cast button and the TV renders
it directly instead of mirroring a tab. That needs a Google Cast Developer
Console registration (one-time $5 fee, up to 48 h to process), a receiver
app registered at cast.google.com/publish pointing at a beech receiver page,
and a sender integration (Cast SDK) in the app. It buys direct rendering
and a proper cast button, but tab casting already covers the "laptop →
TV" case with zero setup, so it wasn't built. Revisit if phone → TV
casting becomes a real feature (see the TV item in BACKLOG.md).

Sources: [Cast developer registration](https://support.google.com/cast-developer/answer/4512496?hl=en).

## Still open

- Test on a real Android TV: D-pad focus on the settings sheet, leanback
  banner (BACKLOG.md, "TV" item). The Android app already declares the
  leanback launcher; nobody has driven it with a remote yet.
- Phone → TV casting (Cast button in the app) needs the custom receiver
  above.
