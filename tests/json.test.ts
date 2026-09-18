import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runJson, sortKeysDeep } from '../src/modes/json.js';
import { parseTolerant, JsonParseError } from '../src/modes/json-parse.js';

const pretty = (input: string, options: Record<string, unknown> = {}) => runJson(input, { pretty: true, options });
const raw = (input: string) => runJson(input, { pretty: false, options: {} });

test('formats valid JSON with 2-space indent by default', () => {
  const r = pretty('{"a":1,"b":[1,2]}');
  assert.equal(r.error, undefined);
  assert.equal(r.output, '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
  assert.match(r.status ?? '', /Valid JSON · object · 2 keys/);
});

test('indent option: 4 spaces and tab', () => {
  assert.equal(pretty('{"a":1}', { indent: '4' }).output, '{\n    "a": 1\n}');
  assert.equal(pretty('{"a":1}', { indent: 'tab' }).output, '{\n\t"a": 1\n}');
});

test('raw mode minifies', () => {
  assert.equal(raw('{ "a" : [ 1 , 2 ] }').output, '{"a":[1,2]}');
});

test('sort keys sorts recursively but keeps array order', () => {
  assert.deepEqual(sortKeysDeep({ b: { z: 1, a: 2 }, a: [3, 1] }), { a: [3, 1], b: { a: 2, z: 1 } });
  assert.equal(raw('{"b":1,"a":2}').output, '{"b":1,"a":2}');
  assert.equal(runJson('{"b":1,"a":2}', { pretty: false, options: { sortKeys: true } }).output, '{"a":2,"b":1}');
});

test('empty input yields empty output, no error', () => {
  assert.deepEqual(pretty('   \n'), { output: '', status: '' });
});

test('tolerates trailing commas and reports the fix', () => {
  const r = raw('{"a":[1,2,],}');
  assert.equal(r.error, undefined);
  assert.equal(r.output, '{"a":[1,2]}');
  assert.deepEqual(r.notes, ['Removed a trailing comma.']);
});

test('tolerates smart quotes, single quotes, comments and bare keys', () => {
  const r = raw('{“name”: ‘x’, other: \'y\', // hi\n n: 1 /* c */}');
  assert.equal(r.error, undefined);
  assert.equal(r.output, '{"name":"x","other":"y","n":1}');
  assert.ok(r.notes!.length >= 3);
});

test('reports exact line/col and a hint for a missing comma', () => {
  const r = pretty('{\n  "a": 1\n  "b": 2\n}');
  assert.ok(r.error);
  assert.equal(r.error!.line, 3);
  assert.equal(r.error!.col, 3);
  assert.match(r.error!.message, /Expected `,` or `}`/);
  assert.match(r.error!.hint ?? '', /separated by commas/);
});

test('helpful hints for common mistakes', () => {
  assert.match(pretty('{"a": True}').error!.hint!, /lowercase/);
  assert.match(pretty('{"a": undefined}').error!.hint!, /null/);
  assert.match(pretty('{"a": 012}').error!.hint!, /Leading zeros/);
  assert.match(pretty('{"a": "x').error!.message, /Unterminated string/);
  assert.match(pretty('[1, 2').error!.message, /Unclosed array/);
  assert.match(pretty('{"a": 1} {"b": 2}').error!.hint!, /one top-level value/);
});

test('parseTolerant throws JsonParseError with an offset', () => {
  assert.throws(() => parseTolerant('[1,,2]'), (e: unknown) => e instanceof JsonParseError && e.offset === 3);
});

test('handles string escapes and unicode', () => {
  const { value } = parseTolerant('{"s": "a\\nb\\u00e9\\"q\\""}');
  assert.deepEqual(value, { s: 'a\nbé"q"' });
});

test('large input uses the fast path and stays fast', () => {
  const big = JSON.stringify(Array.from({ length: 50_000 }, (_, i) => ({ id: i, name: `item ${i}`, tags: ['a', 'b'] })));
  const t0 = performance.now();
  const r = pretty(big);
  assert.equal(r.error, undefined);
  assert.ok(performance.now() - t0 < 1500, 'formats ~2MB in well under a second');
  assert.match(r.status ?? '', /array · 50000 items/);
});
