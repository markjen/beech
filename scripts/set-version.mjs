// Set the app version everywhere at once.
//   node scripts/set-version.mjs 1.2.0 7
// -> package.json "version", Android versionName/versionCode,
//    iOS MARKETING_VERSION / CURRENT_PROJECT_VERSION.
// Store rule: the build number (second arg) must go up for every upload.
import fs from 'node:fs';

const [version, build] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !/^\d+$/.test(build ?? '')) {
  console.error('usage: node scripts/set-version.mjs <major.minor.patch> <build-number>');
  process.exit(1);
}

const edit = (file, fn) => {
  if (!fs.existsSync(file)) return console.warn('skip (missing):', file);
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  fs.writeFileSync(file, after);
  console.log(before === after ? 'unchanged:' : 'updated:', file);
};

edit('package.json', (s) => s.replace(/"version": "[^"]+"/, `"version": "${version}"`));
edit('desktop/package.json', (s) => s.replace(/"version": "[^"]+"/, `"version": "${version}"`));
edit('android/app/build.gradle', (s) =>
  s.replace(/versionCode \d+/, `versionCode ${build}`).replace(/versionName "[^"]+"/, `versionName "${version}"`),
);
edit('ios/App/App.xcodeproj/project.pbxproj', (s) =>
  s
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`),
);
