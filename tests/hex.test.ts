import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHex, hexMode, parseHex, xxdDump, looksLikeHex, looksLikeBinary } from '../src/modes/hex.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options });

test('text → hex with separators and uppercase', () => {
  assert.equal(runHex('Hi!', ctx({ mode: 'text-to-hex' })).output, '48 69 21');
  assert.equal(runHex('Hi!', ctx({ mode: 'text-to-hex', separator: 'none' })).output, '486921');
  assert.equal(runHex('Hi!', ctx({ mode: 'text-to-hex', separator: 'colon', uppercase: true })).output, '48:69:21');
  assert.equal(runHex('Hi!', ctx({ mode: 'text-to-hex', separator: '0x' })).output, '0x48, 0x69, 0x21');
  assert.equal(runHex('Hi!', ctx({ mode: 'text-to-hex' })).status, 'Encoded · 3 bytes');
});

test('hex → text tolerates spaces, colons, 0x, newlines', () => {
  assert.equal(runHex('48 65 6c 6c 6f', ctx({ mode: 'hex-to-text' })).output, 'Hello');
  assert.equal(runHex('48:65:6C:6C:6F', ctx({ mode: 'hex-to-text' })).output, 'Hello');
  assert.equal(runHex('0x48, 0x65,\n0x6c, 0x6c, 0x6f', ctx({ mode: 'hex-to-text' })).output, 'Hello');
  assert.equal(runHex('48656c6c6f', ctx({ mode: 'hex-to-text' })).output, 'Hello');
  assert.deepEqual(Array.from(parseHex('e6 97 a5')), [0xe6, 0x97, 0xa5]);
});

test('hex errors carry line/col and hint', () => {
  const odd = runHex('48 65 6', ctx({ mode: 'hex-to-text' }));
  assert.match(odd.error!.message, /Odd number/);
  assert.equal(odd.error!.line, 1);
  assert.equal(odd.error!.col, 7);
  assert.ok(odd.error!.hint);
  const bad = runHex('48 65\n6g', ctx({ mode: 'hex-to-text' }));
  assert.match(bad.error!.message, /'g' is not a hexadecimal digit/);
  assert.equal(bad.error!.line, 2);
  assert.equal(bad.error!.col, 2);
});

test('invalid UTF-8 decodes with replacement char and a note', () => {
  const r = runHex('ff fe 41', ctx({ mode: 'hex-to-text' }));
  assert.ok(r.output.includes('�'));
  assert.ok(r.output.endsWith('A'));
  assert.ok(r.notes?.some((n) => /UTF-8/.test(n)));
});

test('hexdump is xxd-style, 16 bytes per line', () => {
  const r = runHex('Hello world\n', ctx({ mode: 'hexdump' }));
  assert.equal(r.output, '00000000: 48 65 6c 6c 6f 20 77 6f 72 6c 64 0a              Hello world.');
  const two = xxdDump(new TextEncoder().encode('0123456789abcdefXY'));
  const lines = two.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1]!, /^00000010: 58 59 +XY$/);
});

test('binary round-trip', () => {
  const enc = runHex('AB', ctx({ mode: 'text-to-binary' }));
  assert.equal(enc.output, '01000001 01000010');
  assert.equal(runHex(enc.output, ctx({ mode: 'binary-to-text' })).output, 'AB');
  const bad = runHex('0100000', ctx({ mode: 'binary-to-text' }));
  assert.match(bad.error!.message, /multiple of 8/);
});

test('auto mode sniffs hex and binary, else encodes', () => {
  assert.equal(looksLikeHex('48 65 6c'), true);
  assert.equal(looksLikeHex('hello'), false);
  assert.equal(looksLikeBinary('01000001'), true);
  assert.equal(runHex('48 65 6c 6c 6f', ctx()).output, 'Hello');
  assert.equal(runHex('01000001', ctx()).output, 'A');
  assert.equal(runHex('hello', ctx()).output, '68 65 6c 6c 6f');
});

test('empty input, sample, non-ASCII byte counts', () => {
  assert.deepEqual(runHex('', ctx()), { output: '', status: '' });
  const s = runHex(hexMode.sample, ctx());
  assert.equal(s.error, undefined);
  assert.equal(s.output, 'Hello, world!');
  assert.equal(runHex('é', ctx({ mode: 'text-to-hex' })).output, 'c3 a9');
  assert.equal(runHex('é', ctx({ mode: 'text-to-hex' })).status, 'Encoded · 2 bytes');
});
