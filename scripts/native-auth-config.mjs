// Puts the Google iOS client's URL scheme into ios/App/App/Info.plist, so
// Google's sign-in sheet can hand the result back to the app.
//
//   VITE_GOOGLE_IOS_CLIENT_ID=1234-abc.apps.googleusercontent.com node scripts/native-auth-config.mjs
//
// The scheme is the client ID reversed (com.googleusercontent.apps.1234-abc).
// Client IDs are public, so the result can be committed. Run again to change
// it; with no ID set, the entry is removed.
import { readFileSync, writeFileSync } from 'node:fs';

const PLIST = 'ios/App/App/Info.plist';
const id = (process.env.VITE_GOOGLE_IOS_CLIENT_ID ?? '').trim();
if (id && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) {
  console.error(`not a Google OAuth client ID: ${id}`);
  process.exit(1);
}
const START = '\t<!-- google-signin-url-scheme -->';
const END = '\t<!-- /google-signin-url-scheme -->';
let plist = readFileSync(PLIST, 'utf8');
const at = plist.indexOf(START);
if (at >= 0) plist = plist.slice(0, at) + plist.slice(plist.indexOf(END) + END.length + 1);
if (id) {
  const scheme = id.split('.').reverse().join('.');
  const block = `${START}
\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>${scheme}</string>
\t\t\t</array>
\t\t</dict>
\t</array>
${END}
`;
  plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, `${block}</dict>\n</plist>\n`);
  console.log(`Info.plist: URL scheme ${scheme}`);
} else {
  console.log('Info.plist: no Google iOS client ID, URL scheme removed');
}
writeFileSync(PLIST, plist);
