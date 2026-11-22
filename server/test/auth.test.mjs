// Unit test for ID-token verification with locally generated keys (no network).
//   node --experimental-strip-types test/auth.test.mjs   (Node 22+)
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';
import { verifyGoogleIdToken, verifyAppleIdToken } from '../src/auth.ts';

let failed = 0;
const check = async (p, expectOk, msg) => {
  let ok;
  try {
    await p;
    ok = true;
  } catch {
    ok = false;
  }
  console.log(`${ok === expectOk ? 'ok  ' : 'FAIL'} ${msg}`);
  if (ok !== expectOk) failed++;
};

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
const keys = createLocalJWKSet({ keys: [jwk] });
const other = await generateKeyPair('RS256');
const sign = (claims, key = privateKey, exp = '1h') =>
  new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuedAt().setExpirationTime(exp).sign(key);

const good = await sign({ iss: 'https://accounts.google.com', aud: 'web-client', sub: '123', given_name: 'Ada' });
await check(verifyGoogleIdToken(good, ['web-client'], keys), true, 'valid google token');
const who = await verifyGoogleIdToken(good, ['web-client'], keys);
console.log(who.sub === '123' && who.name === 'Ada' ? 'ok   reads sub and first name' : (failed++, 'FAIL reads sub and first name'));
await check(verifyGoogleIdToken(good, ['someone-else'], keys), false, 'wrong audience is rejected');
await check(verifyGoogleIdToken(await sign({ iss: 'https://evil.example', aud: 'web-client', sub: '1' }), ['web-client'], keys), false, 'wrong issuer is rejected');
await check(verifyGoogleIdToken(await sign({ iss: 'accounts.google.com', aud: 'web-client', sub: '1' }, privateKey, '-5m'), ['web-client'], keys), false, 'expired token is rejected');
await check(verifyGoogleIdToken(await sign({ iss: 'accounts.google.com', aud: 'web-client', sub: '1' }, other.privateKey), ['web-client'], keys), false, 'token signed by another key is rejected');
await check(verifyGoogleIdToken(good, [], keys), false, 'unconfigured client ids reject everything');
const apple = await sign({ iss: 'https://appleid.apple.com', aud: 'app.beech.beach', sub: 'apple-1' });
await check(verifyAppleIdToken(apple, ['app.beech.beach'], 'Ada', keys), true, 'valid apple token');
await check(verifyAppleIdToken(good, ['app.beech.beach'], '', keys), false, 'a google token is not an apple token');

console.log(failed ? `${failed} FAILED` : 'AUTH UNIT PASS');
process.exit(failed ? 1 : 0);
