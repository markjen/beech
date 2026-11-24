import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';

/**
 * Stamp each build with an id: a hash of the built file names, which carry
 * content hashes, so the id changes exactly when the app's code or assets
 * do. It goes into index.html (`<meta name="beech-build">`) and into
 * `version.json`; an open tab compares the two to know a new version is
 * live (src/platform/update.ts).
 */
function buildId(): Plugin {
  return {
    name: 'beech-build-id',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const names = Object.keys(bundle)
        .filter((f) => !f.endsWith('.html') && f !== 'version.json')
        .sort();
      const id = createHash('sha256').update(names.join('\n')).digest('hex').slice(0, 12);
      let stamped = false;
      for (const f of Object.values(bundle)) {
        if (f.type !== 'asset' || !f.fileName.endsWith('.html') || typeof f.source !== 'string') continue;
        const next = f.source.replace('<meta name="beech-build" content="dev"', `<meta name="beech-build" content="${id}"`);
        stamped ||= next !== f.source;
        f.source = next;
      }
      if (!stamped) this.error('beech-build meta tag not found in index.html');
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ build: id })}\n` });
    },
  };
}

// Relative base so the same build works on GitHub Pages (/beech/), any static
// host, and inside the Capacitor native shells (file-like origin).
export default defineConfig({
  base: './',
  plugins: [buildId()],
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
