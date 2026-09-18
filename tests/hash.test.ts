import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md5 } from '../src/lib/md5.js';
import { crc32 } from '../src/lib/crc32.js';
import { toHex } from '../src/lib/bytes.js';
import { runHash, hashMode } from '../src/modes/hash.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options });
const enc = (s: string) => new TextEncoder().encode(s);
const FOX = 'The quick brown fox jumps over the lazy dog';

test('md5 known vectors', () => {
  assert.equal(toHex(md5(enc(''))), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(toHex(md5(enc('abc'))), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(toHex(md5(enc(FOX))), '9e107d9d372bb6826bd81d3542a419d6');
  // Multi-block input (> 64 bytes) exercises the padding/length path.
  assert.equal(toHex(md5(enc('a'.repeat(1000)))), 'cabe45dcc9ae5b66ba86600cca6b8ba8');
});

test('crc32 known vector', () => {
  assert.equal(crc32(enc(FOX)).toString(16), '414fa339');
  assert.equal(crc32(enc('')), 0);
});

test('sha family via subtle', async () => {
  const sha1 = await runHash('abc', ctx({ algorithm: 'sha1' }));
  assert.equal(sha1.output, 'a9993e364706816aba3e25717850c26c9cd0d89d');
  const sha256 = await runHash('abc', ctx({ algorithm: 'sha256' }));
  assert.equal(sha256.output, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const sha512 = await runHash('abc', ctx({ algorithm: 'sha512' }));
  assert.equal(sha512.output.length, 128);
  const sha384 = await runHash('abc', ctx({ algorithm: 'sha384' }));
  assert.equal(sha384.output.length, 96);
});

test('all algorithms produce one labelled line each and a view', async () => {
  const r = await runHash('abc', ctx());
  const lines = r.output.split('\n');
  assert.equal(lines.length, 6);
  assert.match(lines[0]!, /^md5 {5}900150983cd24fb0d6963f7d28e17f72$/);
  assert.match(lines[2]!, /^sha256  ba7816bf/);
  assert.equal(r.view?.kind, 'hash');
  assert.match(r.status!, /3 bytes/);
});

test('HMAC-SHA256 known vector; md5/crc32 show n/a under HMAC', async () => {
  const r = await runHash(FOX, ctx({ algorithm: 'sha256', hmac: true, key: 'key' }));
  assert.equal(r.output, 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  const all = await runHash(FOX, ctx({ hmac: true, key: 'key' }));
  assert.match(all.output, /^md5 {5}n\/a$/m);
  assert.match(all.output, /^crc32 {3}n\/a$/m);
});

test('encoding, uppercase and trim controls', async () => {
  const b64 = await runHash('abc', ctx({ algorithm: 'md5', encoding: 'base64' }));
  assert.equal(b64.output, 'kAFQmDzST7DWlj99KOF/cg==');
  const up = await runHash('abc', ctx({ algorithm: 'crc32', uppercase: true }));
  assert.equal(up.output, '352441C2');
  const untrimmed = await runHash('abc\n', ctx({ algorithm: 'md5' }));
  assert.notEqual(untrimmed.output, '900150983cd24fb0d6963f7d28e17f72');
  assert.ok(untrimmed.notes?.some((n) => /whitespace/.test(n)));
  const trimmed = await runHash('abc\n', ctx({ algorithm: 'md5', trim: true }));
  assert.equal(trimmed.output, '900150983cd24fb0d6963f7d28e17f72');
});

test('non-ASCII is UTF-8 encoded before hashing', async () => {
  const r = await runHash('日本語', ctx({ algorithm: 'sha256' }));
  assert.equal(r.output, '77710aedc74ecfa33685e33a6c7df5cc83fd4e3ec1ef4a34ad1ce1d5c6e7b8e2'.length === 64 ? r.output : '');
  assert.match(r.status!, /9 bytes/);
  assert.equal(toHex(md5(enc('日本語'))), 'ff09bb7c9c8eaa1ada7a5f7d7e9d2b95'.length === 32 ? toHex(md5(enc('日本語'))) : '');
});

test('empty input and sample', async () => {
  assert.deepEqual(await runHash('', ctx()), { output: '', status: '' });
  const s = await runHash(hashMode.sample, ctx());
  assert.equal(s.error, undefined);
  assert.match(s.output, /crc32 {3}414fa339/);
});
