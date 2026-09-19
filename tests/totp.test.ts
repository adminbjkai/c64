import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32Decode, base32Encode, hotp, totp, parseOtpAuth, buildOtpAuth } from '../src/lib/otp.js';
import { runTotp, totpMode } from '../src/modes/totp.js';
import type { TotpData } from '../src/modes/totp.js';

const ctx = (options: Record<string, unknown> = {}, pretty = false) => ({ pretty, options });
const enc = (s: string) => new TextEncoder().encode(s);
const KEY20 = '12345678901234567890';
const KEY20_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const KEY32 = '12345678901234567890123456789012';
const KEY64 = '1234567890123456789012345678901234567890123456789012345678901234';

test('base32 round-trips and tolerates spaces, hyphens, lowercase and padding', () => {
  assert.equal(base32Encode(enc(KEY20)), KEY20_B32);
  assert.deepEqual(base32Decode(KEY20_B32), enc(KEY20));
  assert.deepEqual(base32Decode('gezd gnbv-gy3t qojq gezd-gnbv gy3t qojq'), enc(KEY20));
  assert.deepEqual(base32Decode('JBSWY3DPEHPK3PXP===='), new Uint8Array([72, 101, 108, 108, 111, 33, 0xde, 0xad, 0xbe, 0xef]));
  assert.throws(() => base32Decode('ABC1'), /'1' is not a Base32 character/);
  assert.throws(() => base32Decode('   '), /empty/);
});

test('RFC 4226 HOTP vectors (6 digits, SHA-1)', async () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  for (let i = 0; i < expected.length; i++) assert.equal(await hotp(enc(KEY20), BigInt(i)), expected[i]);
});

test('RFC 6238 TOTP vectors, 8 digits', async () => {
  const at = (sec: number, key: string, algorithm: 'SHA1' | 'SHA256' | 'SHA512') => totp(enc(key), sec * 1000, { digits: 8, algorithm });
  assert.equal(await at(59, KEY20, 'SHA1'), '94287082');
  assert.equal(await at(1111111109, KEY20, 'SHA1'), '07081804');
  assert.equal(await at(1111111111, KEY20, 'SHA1'), '14050471');
  assert.equal(await at(1234567890, KEY20, 'SHA1'), '89005924');
  assert.equal(await at(2000000000, KEY20, 'SHA1'), '69279037');
  assert.equal(await at(59, KEY32, 'SHA256'), '46119246');
  assert.equal(await at(1234567890, KEY32, 'SHA256'), '91819424');
  assert.equal(await at(59, KEY64, 'SHA512'), '90693936');
  assert.equal(await at(20000000000, KEY64, 'SHA512'), '47863826');
});

test('mode computes current/prev/next codes and remaining seconds from options.now', async () => {
  const r = await runTotp(KEY20_B32, ctx({ now: 59 * 1000, digits: '8' }));
  assert.equal(r.error, undefined);
  assert.equal(r.output, '94287082');
  const d = r.view?.data as TotpData;
  assert.equal(r.view?.kind, 'totp');
  assert.equal(d.code, '94287082');
  assert.equal(d.remaining, 1);
  assert.equal(d.counter, '1');
  assert.equal(d.prev, await hotp(enc(KEY20), 0n, 8));
  assert.equal(d.next, await hotp(enc(KEY20), 2n, 8));
  assert.match(r.status!, /^TOTP · SHA1 · 8 digits · 30 s · 1 s left$/);
  const pretty = await runTotp(KEY20_B32, ctx({ now: 59 * 1000, digits: '8' }, true));
  assert.match(pretty.output, /^TOTP code: 94287082\n/);
  assert.match(pretty.output, /otpauth:\/\/totp\//);
  assert.match(pretty.output, /Previous: /);
});

test('mode: algorithm, period and hotp/counter controls', async () => {
  const sha256 = await runTotp(base32Encode(enc(KEY32)), ctx({ now: 59 * 1000, digits: '8', algorithm: 'SHA256' }));
  assert.equal(sha256.output, '46119246');
  const p60 = await runTotp(KEY20_B32, ctx({ now: 119 * 1000, period: '60' }));
  assert.equal((p60.view?.data as TotpData).counter, '1');
  assert.equal((p60.view?.data as TotpData).remaining, 1);
  const h0 = await runTotp(KEY20_B32, ctx({ mode: 'hotp', counter: '0' }));
  assert.equal(h0.output, '755224');
  const h1 = await runTotp(KEY20_B32, ctx({ mode: 'hotp', counter: '1' }));
  assert.equal(h1.output, '287082');
  assert.equal((h1.view?.data as TotpData).prev, '755224');
  assert.equal((h1.view?.data as TotpData).next, '359152');
  assert.match(h1.status!, /^HOTP · SHA1 · 6 digits · counter 1$/);
  assert.match((h1.view?.data as TotpData).url, /^otpauth:\/\/hotp\/.*counter=1/);
  const bad = await runTotp(KEY20_B32, ctx({ mode: 'hotp', counter: 'x' }));
  assert.match(bad.error!.message, /not a non-negative integer/);
});

test('otpauth URL parsing fills the options and the URL is rebuilt', async () => {
  const a = parseOtpAuth('otpauth://totp/ACME%20Co:john@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60');
  assert.equal(a.type, 'totp');
  assert.equal(a.issuer, 'ACME Co');
  assert.equal(a.account, 'john@example.com');
  assert.equal(a.secret, 'JBSWY3DPEHPK3PXP');
  assert.equal(a.algorithm, 'SHA256');
  assert.equal(a.digits, 8);
  assert.equal(a.period, 60);
  const rebuilt = buildOtpAuth(a);
  assert.equal(rebuilt, 'otpauth://totp/ACME%20Co%3Ajohn%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60');
  assert.deepEqual(parseOtpAuth(rebuilt), a);
  assert.throws(() => parseOtpAuth('otpauth://totp/x'), /no secret/);
  assert.throws(() => parseOtpAuth('https://example.com'), /Not an otpauth/);

  const r = await runTotp(`otpauth://totp/x?secret=${KEY20_B32}&digits=8&algorithm=SHA1`, ctx({ now: 1234567890 * 1000, digits: '6', algorithm: 'SHA512' }));
  assert.equal(r.output, '89005924'); // URL digits (8) and algorithm win over the controls
  assert.deepEqual(r.notes, ['Options were taken from the otpauth:// URL.']);
  const hh = await runTotp(`otpauth://hotp/x?secret=${KEY20_B32}&counter=3`, ctx({}));
  assert.equal(hh.output, '969429');
});

test('sample runs; empty input; bad secret error', async () => {
  const s = await runTotp(totpMode.sample, ctx({ now: 1_700_000_000_000 }));
  assert.equal(s.error, undefined);
  assert.match(s.output, /^\d{6}$/);
  assert.deepEqual(await runTotp('', ctx()), { output: '', status: '' });
  const bad = await runTotp('not base32 !!!', ctx());
  assert.match(bad.error!.message, /not a Base32 character/);
  assert.equal(bad.status, 'Invalid secret');
  const short = await runTotp('JBSWY3DP', ctx({ now: 0 }));
  assert.match(short.notes![0]!, /Short secret/);
});
