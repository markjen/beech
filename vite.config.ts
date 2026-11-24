import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';

/**
 * The build's id: the commit (CI sets GITHUB_SHA), or the time for a local
 * build. The app knows its own (__APP_BUILD__) and the server serves the
 * latest as version.json, so a tab left open across a deploy can offer a
 * reload (src/platform/version.ts).
 */
function buildId(): string {
  if (process.env.BUILD_ID) return process.env.BUILD_ID;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12);
  try {
    return `${execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()}-${Date.now().toString(36)}`;
  } catch {
    return Date.now().toString(36);
  }
}
const BUILD = buildId();

const versionFile = (): Plugin => ({
  name: 'beech-version',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ build: BUILD })}\n` });
  },
});

// Relative base so the same build works on GitHub Pages (/beech/), any static
// host, and inside the Capacitor native shells (file-like origin).
export default defineConfig({
  base: './',
  define: {
    __APP_BUILD__: JSON.stringify(BUILD),
  },
  plugins: [versionFile()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
  server: {
    host: true,
  },
});
