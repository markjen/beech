import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPrivateKey } from 'node:crypto';
import { CompactSign } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { appleRefund, verifyAppleJws, verifyAppleTransaction } from '../src/store.js';
import { APPLE_ROOT_CA_G3_DER_BASE64 } from '../src/appleRoot.js';

// A stand-in for Apple's chain, made with openssl: a root, an intermediate and
// a leaf, carrying the same marker extensions Apple's StoreKit certificates do.
let dir = '';
let chain: string[] = []; // base64 DER: leaf, intermediate, root
let rootDer: Buffer;
let otherRootDer: Buffer;
let leafKey: ReturnType<typeof createPrivateKey>;
let hasOpenssl = true;

const ossl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
function makeChain(prefix: string, leafExt = '1.2.840.113635.100.6.11.1') {
  writeFileSync(
    path.join(dir, `${prefix}.cnf`),
    `[mid]\nbasicConstraints=critical,CA:TRUE\n1.2.840.113635.100.6.2.1=ASN1:NULL\n[leaf]\nbasicConstraints=CA:FALSE\n${leafExt}=ASN1:NULL\n`,
  );
  for (const n of ['root', 'mid', 'leaf']) ossl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', `${prefix}${n}.key`);
  ossl('req', '-x509', '-new', '-key', `${prefix}root.key`, '-subj', `/CN=${prefix} Test Root`, '-days', '30', '-out', `${prefix}root.pem`);
  ossl('req', '-new', '-key', `${prefix}mid.key`, '-subj', `/CN=${prefix} Test WWDR`, '-out', `${prefix}mid.csr`);
  ossl('x509', '-req', '-in', `${prefix}mid.csr`, '-CA', `${prefix}root.pem`, '-CAkey', `${prefix}root.key`, '-CAcreateserial', '-days', '30', '-extfile', `${prefix}.cnf`, '-extensions', 'mid', '-out', `${prefix}mid.pem`);
  ossl('req', '-new', '-key', `${prefix}leaf.key`, '-subj', `/CN=${prefix} Test StoreKit`, '-out', `${prefix}leaf.csr`);
  ossl('x509', '-req', '-in', `${prefix}leaf.csr`, '-CA', `${prefix}mid.pem`, '-CAkey', `${prefix}mid.key`, '-CAcreateserial', '-days', '30', '-extfile', `${prefix}.cnf`, '-extensions', 'leaf', '-out', `${prefix}leaf.pem`);
  const der = (n: string) => ossl('x509', '-in', `${prefix}${n}.pem`, '-outform', 'DER');
  return {
    chain: ['leaf', 'mid', 'root'].map((n) => der(n).toString('base64')),
    root: der('root'),
    key: createPrivateKey(readFileSync(path.join(dir, `${prefix}leaf.key`))),
  };
}

beforeAll(() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe' });
  } catch {
    hasOpenssl = false;
    return;
  }
  dir = mkdtempSync(path.join(tmpdir(), 'beech-store-'));
  const a = makeChain('a');
  chain = a.chain;
  rootDer = a.root;
  leafKey = a.key;
  otherRootDer = makeChain('b').root;
});

const sign = async (payload: unknown, x5c = chain, key = leafKey) =>
  new CompactSign(new TextEncoder().encode(JSON.stringify(payload))).setProtectedHeader({ alg: 'ES256', x5c }).sign(key);

const tx = {
  transactionId: '2000000123',
  bundleId: 'app.beech.beach',
  productId: 'beach_1',
  purchaseDate: 1700000000000,
  environment: 'Sandbox',
  appAccountToken: '00000000-0000-4000-8000-000000000001',
};

describe('Apple: StoreKit 2 signed transactions', () => {
  it('accepts a transaction signed through the trusted chain', async ({ skip }) => {
    if (!hasOpenssl) skip();
    const v = await verifyAppleTransaction(await sign(tx), 'app.beech.beach', { roots: [rootDer] });
    expect(v).toEqual({ store: 'apple', transactionId: '2000000123', productId: 'beach_1', environment: 'Sandbox', purchasedAt: 1700000000000, account: tx.appAccountToken });
  });

  it('rejects other roots, other apps, refunded transactions and tampering', async ({ skip }) => {
    if (!hasOpenssl) skip();
    const jws = await sign(tx);
    await expect(verifyAppleTransaction(jws, 'app.beech.beach', { roots: [otherRootDer] })).rejects.toThrow(/not signed by Apple/);
    // by default only Apple's real root is trusted
    await expect(verifyAppleTransaction(jws, 'app.beech.beach')).rejects.toThrow(/not signed by Apple/);
    await expect(verifyAppleTransaction(jws, 'com.someone.else', { roots: [rootDer] })).rejects.toThrow(/another app/);
    await expect(verifyAppleTransaction(await sign({ ...tx, revocationDate: 1 }), 'app.beech.beach', { roots: [rootDer] })).rejects.toThrow(/refunded/);
    const [h, , s] = jws.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...tx, productId: 'pack_founder' })).toString('base64url')}.${s}`;
    await expect(verifyAppleJws(forged, { roots: [rootDer] })).rejects.toThrow();
    // a chain without Apple's marker on the leaf
    const plain = makeChain('c', '1.2.3.4');
    await expect(verifyAppleJws(await sign(tx, plain.chain, plain.key), { roots: [plain.root] })).rejects.toThrow(/StoreKit/);
    // out of date
    await expect(verifyAppleJws(jws, { roots: [rootDer], now: Date.now() + 60 * 86400000 })).rejects.toThrow(/out of date/);
  });

  it('reads refunds from App Store Server Notifications', async ({ skip }) => {
    if (!hasOpenssl) skip();
    const note = await sign({ notificationType: 'REFUND', data: { bundleId: 'app.beech.beach', signedTransactionInfo: await sign(tx) } });
    expect(await appleRefund(note, 'app.beech.beach', { roots: [rootDer] })).toBe('2000000123');
    const other = await sign({ notificationType: 'DID_RENEW', data: { signedTransactionInfo: await sign(tx) } });
    expect(await appleRefund(other, 'app.beech.beach', { roots: [rootDer] })).toBeNull();
  });

  it('pins the real Apple Root CA - G3', async () => {
    const { X509Certificate } = await import('node:crypto');
    const root = new X509Certificate(Buffer.from(APPLE_ROOT_CA_G3_DER_BASE64, 'base64'));
    expect(root.subject).toContain('Apple Root CA - G3');
    expect(root.fingerprint256).toBe('63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79');
  });
});
