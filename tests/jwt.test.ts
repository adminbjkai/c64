import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeJwt, humanTime, runJwt, jwtMode } from '../src/modes/jwt.js';
import { encodeBase64 } from '../src/lib/base64.js';

const seg = (o: unknown) => encodeBase64(JSON.stringify(o), { urlSafe: true });
const make = (header: unknown, payload: unknown, sig = 'c2ln') => `${seg(header)}.${seg(payload)}.${sig}`;
const NOW = Date.UTC(2026, 8, 16, 12, 0, 0);

test('splits and decodes header, payload and signature', () => {
  const d = decodeJwt(make({ alg: 'HS256', typ: 'JWT' }, { sub: '42', name: 'Ada' }), NOW);
  assert.deepEqual(d.header, { alg: 'HS256', typ: 'JWT' });
  assert.deepEqual(d.payload, { sub: '42', name: 'Ada' });
  assert.equal(d.signature, 'c2ln');
  assert.equal(d.alg, 'HS256');
  assert.equal(d.status, 'no-exp');
  assert.equal(d.claims.find((c) => c.name === 'sub')?.meaning, 'Subject');
});

test('renders exp/iat as dates and flags expiry', () => {
  const past = Math.floor(NOW / 1000) - 3600;
  const d = decodeJwt(make({ alg: 'RS256' }, { iat: past - 60, exp: past }), NOW);
  assert.equal(d.status, 'expired');
  const exp = d.claims.find((c) => c.name === 'exp')!;
  assert.equal(exp.warn, 'Expired');
  assert.match(exp.human!, /2026-09-16 11:00:00 UTC \(1 hour ago\)/);
  const future = decodeJwt(make({ alg: 'RS256' }, { exp: past + 7200 }), NOW);
  assert.equal(future.status, 'valid-window');
  assert.match(future.claims[0]!.human!, /in 1 hour/);
});

test('nbf in the future → not yet valid; alg none → warning', () => {
  const d = decodeJwt(make({ alg: 'none' }, { nbf: Math.floor(NOW / 1000) + 600 }, ''), NOW);
  assert.equal(d.status, 'not-yet-valid');
  assert.ok(d.warnings.some((w) => /unsigned/.test(w)));
  assert.ok(d.warnings.some((w) => /signature segment is empty/.test(w)));
});

test('rejects non-JWT input with helpful messages', () => {
  assert.throws(() => decodeJwt('a.b'), /3 dot-separated parts/);
  assert.throws(() => decodeJwt('a.b.c.d.e'), (e: Error & { hint?: string }) => /JWE/.test(e.hint ?? ''));
  assert.throws(() => decodeJwt('bm90anNvbg.bm90anNvbg.x'), /not JSON/);
  assert.throws(() => decodeJwt('*.b.c'), /not valid base64url/);
});

test('mode result always states the signature is not verified', () => {
  const r = runJwt(jwtMode.sample, { pretty: true, options: {} });
  assert.equal(r.view?.kind, 'jwt');
  assert.match(r.status!, /signature NOT verified/);
  assert.match(r.status!, /EXPIRED/);
  assert.ok(r.output.includes('"header"'));
});

test('humanTime relative phrasing', () => {
  const now = NOW;
  assert.match(humanTime(now / 1000 + 90, now), /in 2 minutes/);
  assert.match(humanTime(now / 1000 - 172800, now), /2 days ago/);
});
