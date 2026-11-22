// Turns the built dist/index.html into a page for a claude.ai Artifact
// (a quick private web preview while GitHub Pages isn't switched on).
// The Artifact host adds its own <!doctype>/<head>/<body> skeleton, so only
// the title, the module script, the stylesheet and the body content remain.
// Usage: npm run build && node scripts/artifact-page.mjs
//   -> dist-artifact/index.html, publish with dist/assets/* as supporting files
import fs from 'node:fs';

const html = fs.readFileSync('dist/index.html', 'utf8');
const script = html.match(/<script type="module"[^>]*><\/script>/)[0];
const style = html.match(/<link rel="stylesheet"[^>]*>/)[0];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].trim();
const page = `<title>Beech Seaside Toy</title>
<meta name="description" content="A calm little beach. Draw in the sand and let the waves wash it away." />
${style}
${script}
${body}
`;
fs.mkdirSync('dist-artifact', { recursive: true });
fs.writeFileSync('dist-artifact/index.html', page);
const assets = fs.readdirSync('dist/assets');
fs.writeFileSync(
  'dist-artifact/files.json',
  JSON.stringify(Object.fromEntries(assets.map((a) => [`assets/${a}`, `dist/assets/${a}`])), null, 1),
);
console.log(page);
console.log(assets.length, 'asset files');
