import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBase64, decodeBase64, looksLikeBase64, Base64Error } from '../src/lib/base64.js';
import { runBase64 } from '../src/modes/base64.js';

test('encodes and decodes ASCII with padding', () => {
  assert.equal(encodeBase64('hi'), 'aGk=');
  assert.equal(encodeBase64('hello'), 'aGVsbG8=');
  assert.equal(encodeBase64('hello!'), 'aGVsbG8h');
  assert.equal(decodeBase64('aGVsbG8=').text, 'hello');
});

test('round-trips Unicode via UTF-8', () => {
  const s = 'héllo — 日本語 🚀';
  const r = decodeBase64(encodeBase64(s));
  assert.equal(r.text, s);
  assert.equal(r.printable, true);
  assert.equal(r.bytes, new TextEncoder().encode(s).length);
});

test('URL-safe alphabet, no padding', () => {
  const bytes = Uint8Array.from([0xfb, 0xff, 0xbf]);
  assert.equal(encodeBase64(new TextDecoder('latin1').decode(bytes)).length > 0, true);
  assert.equal(encodeBase64('??>', { urlSafe: true }), 'Pz8-');
  assert.equal(encodeBase64('??>'), 'Pz8+');
  assert.equal(decodeBase64('Pz8-').text, '??>');
});

test('decoding ignores whitespace and tolerates missing padding', () => {
  assert.equal(decodeBase64('aGVs\nbG8').text, 'hello');
});

test('invalid characters and truncation are reported with a position', () => {
  assert.throws(() => decodeBase64('aGVs*bG8='), (e: unknown) => e instanceof Base64Error && e.offset === 4);
  assert.throws(() => decodeBase64('aGVsb'), (e: unknown) => e instanceof Base64Error && /Truncated/.test(e.message));
  assert.throws(() => decodeBase64('aGk=x'), /after `=` padding/);
});

test('binary is flagged as not printable', () => {
  const r = decodeBase64('AAEC/w==');
  assert.equal(r.printable, false);
  assert.equal(r.bytes, 4);
});

test('looksLikeBase64 heuristics', () => {
  assert.equal(looksLikeBase64('eyJhbGciOiJIUzI1NiJ9'), true);
  assert.equal(looksLikeBase64('hello world'), false);
  assert.equal(looksLikeBase64('hello'), false);
  assert.equal(looksLikeBase64('{"a":1}'), false);
});

test('mode auto-detects direction and pretty-prints decoded JSON', () => {
  const enc = runBase64('{"a":1}', { pretty: true, options: {} });
  assert.equal(enc.output, 'eyJhIjoxfQ==');
  assert.match(enc.status!, /^Encoded/);
  const dec = runBase64('eyJhIjoxfQ==', { pretty: true, options: {} });
  assert.equal(dec.output, '{\n  "a": 1\n}');
  assert.match(dec.status!, /JSON/);
  const raw = runBase64('eyJhIjoxfQ==', { pretty: false, options: { direction: 'decode' } });
  assert.equal(raw.output, '{"a":1}');
  const bad = runBase64('eyJh*', { pretty: true, options: { direction: 'decode' } });
  assert.equal(bad.error?.col, 5);
});
