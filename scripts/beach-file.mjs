#!/usr/bin/env node
// Beach files offline (docs/BEACH_FILE.md): check them, switch their sand
// encoding, or make one from a heightmap image. Uses the app's own reader
// and writer (src/world/beachFile.ts), bundled on the fly with esbuild.
//
//   node scripts/beach-file.mjs validate <file.beach.json>...
//   node scripts/beach-file.mjs rows <in> [-o out] [--grid N]     editable grid (one row per line)
//   node scripts/beach-file.mjs compact <in> [-o out] [--grid N]  small (deflate-int16le)
//   node scripts/beach-file.mjs heightmap <in.png> --min M --max M [--name NAME] [-o out]
//
// Output goes to stdout unless -o is given; messages go to stderr.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { readPng } from './lib/png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `beach files (docs/BEACH_FILE.md)

  validate <file>...                   check files; exit code 1 if any can't be opened
  rows <in> [-o out] [--grid N]        rewrite with an editable "rows" grid (shapes are baked in)
  compact <in> [-o out] [--grid N]     rewrite small ("deflate-int16le")
  heightmap <in.png> --min M --max M [--name NAME] [-o out]
                                       a greyscale image as the sand: black is M_min metres,
                                       white is M_max (relative to the untouched beach).
                                       The top of the image is the land, the bottom the sea.
                                       8 to 512 pixels each way.`;

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') out.out = argv[++i];
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

async function loadCodec() {
  const dir = mkdtempSync(path.join(tmpdir(), 'beach-file-'));
  const file = path.join(dir, 'beachFile.mjs');
  try {
    await build({
      entryPoints: [path.join(root, 'src/world/beachFile.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile: file,
      logLevel: 'error',
    });
    return await import(pathToFileURL(file).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const say = (s) => process.stderr.write(`${s}\n`);
const issue = (i) => `  ${i.path || '(file)'}: ${i.message}`;
const emit = (text, out) => (out ? writeFileSync(out, text) : process.stdout.write(text));

async function main() {
  const a = args(process.argv.slice(2));
  const [cmd, ...files] = a._;
  if (!cmd || cmd === 'help' || a.help !== undefined) {
    say(USAGE);
    return cmd ? 0 : 2;
  }
  const codec = await loadCodec();

  if (cmd === 'validate') {
    if (!files.length) throw new Error('validate needs at least one file');
    let bad = 0;
    for (const f of files) {
      const r = await codec.parseBeachFile(readFileSync(f, 'utf8'));
      if (!r.ok) {
        bad++;
        say(`✗ ${f}\n${r.errors.map(issue).join('\n')}`);
      } else {
        const things = r.beach.objects.length;
        say(`✓ ${f}${r.beach.name ? ` (${r.beach.name})` : ''}: ${things} thing${things === 1 ? '' : 's'}`);
        if (r.warnings.length) say(`  fixed while reading:\n${r.warnings.map(issue).join('\n')}`);
      }
    }
    return bad ? 1 : 0;
  }

  if (cmd === 'rows' || cmd === 'compact') {
    const [f] = files;
    if (!f) throw new Error(`${cmd} needs an input file`);
    const text = readFileSync(f, 'utf8');
    const raw = JSON.parse(text);
    const n = a.grid ? Number(a.grid) : raw?.sand?.nx && raw?.sand?.ny ? null : cmd === 'rows' ? 64 : 256;
    const nx = n ?? raw.sand.nx;
    const ny = n ?? raw.sand.ny;
    const r = await codec.parseBeachFile(text, { nx, ny });
    if (!r.ok) throw new Error(`${f} can't be opened:\n${r.errors.map(issue).join('\n')}`);
    if (r.warnings.length) say(`fixed while reading:\n${r.warnings.map(issue).join('\n')}`);
    const { name, location } = r.beach;
    emit(
      await codec.writeBeachFile(r.beach, {
        name,
        location,
        createdWith: raw.createdWith ?? 'beach-file.mjs',
        encoding: cmd === 'rows' ? 'rows' : 'deflate-int16le',
      }),
      a.out,
    );
    say(`${cmd === 'rows' ? 'rows' : 'compact'}: ${nx} x ${ny} grid${raw.shapes?.length ? ', shapes baked into the grid' : ''}`);
    return 0;
  }

  if (cmd === 'heightmap') {
    const [f] = files;
    if (!f) throw new Error('heightmap needs a PNG file');
    const min = Number(a.min);
    const max = Number(a.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error('heightmap needs --min and --max (metres), e.g. --min -0.5 --max 1');
    const { width, height, value } = readPng(readFileSync(f));
    if (width < 8 || height < 8 || width > 512 || height > 512)
      throw new Error(`the image is ${width} x ${height}; resize it to between 8 and 512 pixels each way`);
    const rows = [];
    for (let j = 0; j < height; j++) {
      // row 0 of the file is the sea (y = 0): the bottom of the image
      const y = height - 1 - j;
      const row = [];
      for (let i = 0; i < width; i++) row.push(Math.round((min + value[y * width + i] * (max - min)) * 1000));
      rows.push(row);
    }
    const file = {
      format: codec.BEACH_FORMAT,
      version: codec.BEACH_FILE_VERSION,
      name: a.name ?? path.basename(f).replace(/\.png$/i, ''),
      createdWith: 'beach-file.mjs heightmap',
      sand: { nx: width, ny: height, unit: 'mm', encoding: 'rows', data: rows },
      objects: [],
    };
    // through the reader and writer, so the output is checked and compact
    const r = await codec.parseBeachFile(JSON.stringify(file), { nx: width, ny: height });
    if (!r.ok) throw new Error(r.errors.map(issue).join('\n'));
    if (r.warnings.length) say(`fixed while reading:\n${r.warnings.map(issue).join('\n')}`);
    emit(await codec.writeBeachFile(r.beach, { name: file.name, createdWith: file.createdWith }), a.out);
    say(`heightmap: ${width} x ${height}, ${min} m (black) to ${max} m (white)`);
    return 0;
  }

  throw new Error(`unknown command "${cmd}"\n\n${USAGE}`);
}

main().then(
  (code) => process.exit(code),
  (e) => {
    say(`beach-file: ${e.message}`);
    process.exit(2);
  },
);
