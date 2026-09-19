import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGzip, gzipMode, compressBytes, decodeInput, sniffCompressed } from '../src/modes/gzip.js';
import { utf8Encode, toHex, bytesToBase64 } from '../src/lib/bytes.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: true, options });
const TEXT = 'The quick brown fox jumps over the lazy dog. '.repeat(20);

test('sample decompresses to JSON text', async () => {
  const r = await runGzip(gzipMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.equal(r.output, '{"hello":"world","n":1}');
  assert.match(r.status!, /^\d+ B → \d+ B · gzip$/);
});

test('empty input', async () => {
  assert.deepEqual(await runGzip('', ctx()), { output: '', status: '' });
});

test('round trip for each algorithm via base64', async () => {
  for (const algorithm of ['gzip', 'deflate', 'deflate-raw'] as const) {
    const packed = await runGzip(TEXT, ctx({ direction: 'compress', algorithm }));
    assert.equal(packed.error, undefined, algorithm);
    assert.match(packed.status!, new RegExp(`^900 B → \\d+ B \\(\\d+% smaller\\) · ${algorithm} · base64$`));
    const back = await runGzip(packed.output, ctx({ direction: 'decompress', algorithm }));
    assert.equal(back.output, TEXT, algorithm);
  }
});

test('round trip via hex', async () => {
  const packed = await runGzip(TEXT, ctx({ direction: 'compress', encoding: 'hex' }));
  assert.match(packed.output, /^1f8b/);
  const back = await runGzip(packed.output, ctx({ direction: 'decompress', encoding: 'hex' }));
  assert.equal(back.output, TEXT);
});

test('auto: compresses plain text, decompresses gzip and zlib by header (overriding the algorithm)', async () => {
  const plain = await runGzip('hello', ctx());
  assert.match(plain.status!, /· gzip · base64$/);
  const gz = bytesToBase64(await compressBytes(utf8Encode('gzip data'), 'gzip'));
  assert.equal((await runGzip(gz, ctx({ algorithm: 'deflate' }))).output, 'gzip data');
  const zl = toHex(await compressBytes(utf8Encode('zlib data'), 'deflate'));
  const r = await runGzip(zl, ctx());
  assert.equal(r.output, 'zlib data');
  assert.ok(r.notes?.some((n) => /zlib header.*deflate/.test(n)));
  assert.ok(r.notes?.some((n) => /detected as hex/.test(n)));
});

test('auto: base64-looking text without a header is compressed as text with a note', async () => {
  const r = await runGzip('SGVsbG8gV29ybGQxMjM0NTY3ODkw', ctx());
  assert.match(r.status!, /· gzip · base64$/);
  assert.ok(r.notes?.some((n) => /no gzip\/zlib header/.test(n)));
});

test('decodeInput and sniffCompressed', () => {
  assert.equal(decodeInput('1f8b08')!.encoding, 'hex');
  assert.equal(decodeInput('H4sI')!.encoding, 'base64');
  assert.equal(decodeInput('not base64!'), null);
  assert.equal(sniffCompressed(new Uint8Array([0x1f, 0x8b, 8])), 'gzip');
  assert.equal(sniffCompressed(new Uint8Array([0x78, 0x9c])), 'deflate');
  assert.equal(sniffCompressed(new Uint8Array([0x78, 0x00])), null);
  assert.equal(sniffCompressed(new Uint8Array([1, 2])), null);
});

test('bad data: friendly errors with hints', async () => {
  const wrongAlg = await runGzip(bytesToBase64(await compressBytes(utf8Encode('x'), 'gzip')), ctx({ direction: 'decompress', algorithm: 'deflate' }));
  assert.equal(wrongAlg.error?.message, 'Not valid deflate data — check the algorithm');
  assert.match(wrongAlg.error!.hint!, /gzip header/);
  const garbage = await runGzip('AAAAAAAAAAAAAAAA', ctx({ direction: 'decompress' }));
  assert.match(garbage.error!.message, /Not valid gzip data/);
  assert.match(garbage.error!.hint!, /No gzip .* header/);
  const notEncoded = await runGzip('this is not base64 at all!!', ctx({ direction: 'decompress' }));
  assert.match(notEncoded.error!.message, /not valid Base64 or hex/);
  assert.equal(notEncoded.status, 'Invalid compressed input');
});

test('decompressed invalid UTF-8 is noted', async () => {
  const packed = bytesToBase64(await compressBytes(new Uint8Array([0xff, 0xfe, 0x41]), 'gzip'));
  const r = await runGzip(packed, ctx());
  assert.ok(r.notes?.some((n) => /not valid UTF-8/.test(n)));
  assert.ok(r.output.endsWith('A'));
});
