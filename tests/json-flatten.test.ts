import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatten, unflatten, splitPath, looksFlattened } from '../src/lib/json-flatten.js';
import { runJsonFlatten, jsonFlattenMode } from '../src/modes/json-flatten.js';

const ctx = (options: Record<string, unknown> = {}, pretty = true) => ({ pretty, options });
const NESTED = { a: { b: [{ c: 1 }, { c: 2 }], d: 'x' }, e: {}, f: [], g: null };

test('sample runs and flattens', () => {
  const r = runJsonFlatten(jsonFlattenMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.match(r.status!, /^flattened · 8 keys/);
  const out = JSON.parse(r.output) as Record<string, unknown>;
  assert.equal(out['user.address.geo.lat'], 51.5);
  assert.equal(out['user.tags[1]'], 'code');
  assert.deepEqual(out['empty'], {});
  assert.deepEqual(out['none'], []);
});

test('empty input', () => {
  assert.deepEqual(runJsonFlatten('', ctx()), { output: '', status: '' });
});

test('flatten dot style with array indices', () => {
  assert.deepEqual(flatten(NESTED), { 'a.b[0].c': 1, 'a.b[1].c': 2, 'a.d': 'x', e: {}, f: [], g: null });
});

test('flatten dot style with arraysAsIndex off and custom delimiter', () => {
  assert.deepEqual(flatten(NESTED, { arraysAsIndex: false, delimiter: '/' }), { 'a/b/0/c': 1, 'a/b/1/c': 2, 'a/d': 'x', e: {}, f: [], g: null });
  assert.deepEqual(flatten({ a: { b: 1 } }, { delimiter: '__' }), { a__b: 1 });
});

test('flatten bracket and slash styles', () => {
  assert.deepEqual(flatten(NESTED, { style: 'bracket' }), { 'a[b][0][c]': 1, 'a[b][1][c]': 2, 'a[d]': 'x', e: {}, f: [], g: null });
  assert.deepEqual(flatten({ 'a/b': { '~x': [1] } }, { style: 'slash' }), { '/a~1b/~0x/0': 1 });
});

test('flatten a top-level array and a primitive', () => {
  assert.deepEqual(flatten([{ a: 1 }, 2]), { '[0].a': 1, '[1]': 2 });
  assert.deepEqual(flatten([{ a: 1 }], { style: 'bracket' }), { '[0][a]': 1 });
  assert.deepEqual(flatten(5), { '': 5 });
});

test('flatten respects maxDepth', () => {
  assert.deepEqual(flatten({ a: { b: { c: { d: 1 } } } }, { maxDepth: 2 }), { 'a.b': { c: { d: 1 } } });
});

test('splitPath handles every style', () => {
  assert.deepEqual(
    splitPath('a.b[0].c').map((s) => s.key),
    ['a', 'b', '0', 'c'],
  );
  assert.deepEqual(
    splitPath('a[b][0][c]', { style: 'bracket' }).map((s) => s.key),
    ['a', 'b', '0', 'c'],
  );
  assert.deepEqual(
    splitPath('/a~1b/~0x/0', { style: 'slash' }).map((s) => s.key),
    ['a/b', '~x', '0'],
  );
  assert.deepEqual(
    splitPath('a__b', { delimiter: '__' }).map((s) => s.key),
    ['a', 'b'],
  );
});

test('unflatten rebuilds objects and arrays', () => {
  assert.deepEqual(unflatten({ 'a.b[0].c': 1, 'a.b[1].c': 2, 'a.d': 'x', e: {}, f: [] }), { a: { b: [{ c: 1 }, { c: 2 }], d: 'x' }, e: {}, f: [] });
  assert.deepEqual(unflatten({ 'a.0': 1, 'a.2': 3 }), { a: [1, null, 3] });
  assert.deepEqual(unflatten({ '[0].a': 1, '[1]': 2 }), [{ a: 1 }, 2]);
});

test('unflatten with rebuildArrays off keeps numeric keys as object keys', () => {
  assert.deepEqual(unflatten({ 'a[0]': 1, 'a[1]': 2 }, { rebuildArrays: false }), { a: { '0': 1, '1': 2 } });
});

test('round trip for every style', () => {
  for (const style of ['dot', 'bracket', 'slash'] as const) {
    assert.deepEqual(unflatten(flatten(NESTED, { style }), { style }), NESTED, style);
  }
  assert.deepEqual(unflatten(flatten(NESTED, { arraysAsIndex: false }), {}), NESTED);
});

test('looksFlattened heuristic', () => {
  assert.equal(looksFlattened({ 'a.b': 1, 'c[0]': 2 }), true);
  assert.equal(looksFlattened({ 'a.b': { x: 1 } }), false);
  assert.equal(looksFlattened({ a: 1 }), false);
  assert.equal(looksFlattened({}), false);
});

test('mode auto-detects direction and notes it; Raw is minified', () => {
  const r = runJsonFlatten('{"a.b":1,"a.c[0]":2}', ctx({}, false));
  assert.equal(r.output, '{"a":{"b":1,"c":[2]}}');
  assert.match(r.status!, /^unflattened · 1 top-level key/);
  assert.ok(r.notes?.some((n) => /Auto-detected: unflatten/.test(n)));
  assert.equal(runJsonFlatten('{"a":{"b":1}}', ctx({}, false)).output, '{"a.b":1}');
});

test('mode: explicit direction, style and delimiter controls', () => {
  assert.equal(runJsonFlatten('{"a.b":1}', ctx({ direction: 'flatten' }, false)).output, '{"a.b":1}');
  assert.equal(runJsonFlatten('{"a":[{"b":1}]}', ctx({ style: 'slash' }, false)).output, '{"/a/0/b":1}');
  assert.equal(runJsonFlatten('{"a":[{"b":1}]}', ctx({ style: 'bracket' }, false)).output, '{"a[0][b]":1}');
  assert.equal(runJsonFlatten('{"a":[{"b":1}]}', ctx({ delimiter: '_', arraysAsIndex: false }, false)).output, '{"a_0_b":1}');
  assert.equal(runJsonFlatten('{"a[0]":1}', ctx({ direction: 'unflatten', rebuildArrays: false }, false)).output, '{"a":{"0":1}}');
  assert.equal(runJsonFlatten('{"a":{"b":1}}', ctx()).output, '{\n  "a.b": 1\n}');
});

test('mode errors: invalid JSON has a position; unflatten of a non-object', () => {
  const bad = runJsonFlatten('{"a":', ctx());
  assert.ok(bad.error?.line);
  const arr = runJsonFlatten('[1,2]', ctx({ direction: 'unflatten' }));
  assert.match(arr.error!.message, /needs an object/);
});
