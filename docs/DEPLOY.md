# Web deploy

The web build is a static site in `dist/` (relative paths, so it works under
any sub-path). It is installable as a PWA and runs offline after the first visit.

## GitHub Pages (set up in this repo)

`.github/workflows/deploy.yml` builds and publishes on every push to `main`.

One-time setup by a repo admin:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Merge to `main` (or run the workflow from the Actions tab).
3. The site appears at `https://<owner>.github.io/<repo>/`.

If the run fails at `configure-pages` with "Resource not accessible by
integration", step 1 hasn't been done: the workflow token can't turn Pages
on by itself.

## claude.ai artifact preview

`npm run build && node scripts/artifact-page.mjs` writes
`dist-artifact/index.html` and `dist-artifact/files.json` (the `dist/assets/*`
map). Publish the page with those supporting files through the Artifact tool.
The artifact host supplies the HTML skeleton and doesn't allow service
workers, so this preview has no offline mode.

## Any other static host

```bash
npm ci
npm run build      # typecheck + vite build -> dist/
```

Upload `dist/` as-is (Netlify, Cloudflare Pages, S3 + CloudFront, and so on).
There are no server requirements: no special headers and no rewrites. The
Web Worker is an ES module, which all current browsers support.

## Checking a build locally

```bash
npm run build
npm run smoke      # serves dist/ and drives a headless browser through dig/undo/redo + offline start
npm run preview    # or open it yourself at http://localhost:4173
```

## Offline / updates

`public/sw.js` uses network-first for page loads (so a new deploy shows up on the next
visit) and cache-first for hashed assets. If you ever change caching
behaviour, bump `CACHE` in `public/sw.js` so old caches are dropped.
