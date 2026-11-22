// API end-to-end test against a running `wrangler dev` (local D1, DEV_AUTH=1).
//   npm run migrate:local && npm run dev   (in another terminal)
//   BEECH_API=http://127.0.0.1:8787 npm test
const API = process.env.BEECH_API ?? 'http://127.0.0.1:8787';
let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};
const req = (path, init = {}, token) =>
  fetch(API + path, { ...init, headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });

check((await req('/api/health')).ok, 'health');
check((await req('/api/me')).status === 401, 'me without a token is 401');
check((await req('/api/auth/google', { method: 'POST', body: '{"credential":"nope"}', headers: { 'Content-Type': 'application/json' } })).status === 401, 'bad google token is rejected');

const login = await req('/api/auth/dev', { method: 'POST', body: JSON.stringify({ name: `e2e-${Date.now()}` }), headers: { 'Content-Type': 'application/json' } });
check(login.ok, 'dev sign in');
const { token, user } = await login.json();
check(typeof token === 'string' && token.length > 30 && user?.id, 'got a session token and user');

const me = await req('/api/me', {}, token);
check(me.ok && (await me.json()).user.id === user.id, 'me returns the user');
check((await req('/api/beach', {}, token)).status === 404, 'no beach yet');

const sand = new Uint8Array(5000).map((_, i) => i % 251);
const put = await req('/api/beach', { method: 'PUT', body: sand, headers: { 'X-Beach-Location': 'bondi', 'X-Beach-Nx': '256', 'X-Beach-Ny': '192' } }, token);
check(put.ok, 'save beach');
const { version } = await put.json();
check(version === 1, 'first version is 1');
const put2 = await req('/api/beach', { method: 'PUT', body: sand, headers: { 'X-Beach-Location': 'piha', 'X-Beach-Nx': '256', 'X-Beach-Ny': '192' } }, token);
check((await put2.json()).version === 2, 'second save bumps the version');

const get = await req('/api/beach', {}, token);
const back = new Uint8Array(await get.arrayBuffer());
check(get.ok && back.length === sand.length && back.every((v, i) => v === sand[i]), 'load returns the same bytes');
check(get.headers.get('X-Beach-Location') === 'piha' && get.headers.get('X-Beach-Nx') === '256', 'load returns the metadata');

check((await req('/api/beach', { method: 'PUT', body: sand, headers: { 'X-Beach-Location': 'Bad Name!', 'X-Beach-Nx': '256', 'X-Beach-Ny': '192' } }, token)).status === 400, 'rejects a bad location');
check((await req('/api/beach', { method: 'PUT', body: new Uint8Array(900 * 1024), headers: { 'X-Beach-Location': 'bondi', 'X-Beach-Nx': '256', 'X-Beach-Ny': '192' } }, token)).status === 413, 'rejects an oversized beach');

// CORS: the native app origin is allowed, a random site is not
const pre = await fetch(API + '/api/beach', { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost', 'Access-Control-Request-Method': 'PUT' } });
check(pre.headers.get('Access-Control-Allow-Origin') === 'capacitor://localhost', 'CORS allows the app shell');
const evil = await fetch(API + '/api/me', { headers: { Origin: 'https://evil.example' } });
check(!evil.headers.get('Access-Control-Allow-Origin'), 'CORS refuses other sites');

// sign out ends the session
const login2 = await (await req('/api/auth/dev', { method: 'POST', body: JSON.stringify({ name: user.name }), headers: { 'Content-Type': 'application/json' } })).json();
check(login2.user.id === user.id, 'signing in again finds the same user');
check((await req('/api/auth/logout', { method: 'POST' }, token)).status === 204, 'sign out');
check((await req('/api/me', {}, token)).status === 401, 'old token no longer works');

// delete account removes everything
check((await req('/api/account', { method: 'DELETE' }, login2.token)).status === 204, 'delete account');
check((await req('/api/me', {}, login2.token)).status === 401, 'deleted account has no session');
const login3 = await (await req('/api/auth/dev', { method: 'POST', body: JSON.stringify({ name: user.name }), headers: { 'Content-Type': 'application/json' } })).json();
check(login3.user.id !== user.id, 'a new sign-in after deletion is a fresh account');
check((await req('/api/beach', {}, login3.token)).status === 404, 'and has no beach');

// the web app itself is served by the same Worker
const page = await fetch(API + '/');
check(page.ok && (await page.text()).includes('id="scene"'), 'serves the web app');
const deep = await fetch(API + '/some/deep/link', { headers: { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html' } });
check(deep.ok, 'single-page fallback for deep links');

console.log(failed ? `${failed} FAILED` : 'API E2E PASS');
process.exit(failed ? 1 : 0);
