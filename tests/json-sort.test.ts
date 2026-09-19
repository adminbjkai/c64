import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseJson, keyComparator, runJsonSort, jsonSortMode } from '../src/modes/json-sort.js';

const ctx = (options: Record<string, unknown> = {}, pretty = true) => ({ pretty, options });
const min = (input: string, options: Record<string, unknown> = {}) => runJsonSort(input, ctx(options, false)).output;

test('sample runs with a status line', () => {
  const r = runJsonSort(jsonSortMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.match(r.status!, /^sorted · \d+ keys · \d+ arrays$/);
});

test('empty input', () => {
  assert.deepEqual(runJsonSort('', ctx()), { output: '', status: '' });
});

test('deep key sort ascending by default; Pretty is indented, Raw minified', () => {
  assert.equal(min('{"b":{"z":1,"a":2},"a":[{"y":1,"x":2}]}'), '{"a":[{"x":2,"y":1}],"b":{"a":2,"z":1}}');
  assert.equal(runJsonSort('{"b":1,"a":2}', ctx()).output, '{\n  "a": 2,\n  "b": 1\n}');
  assert.equal(runJsonSort('{"b":1,"a":2}', ctx({ indent: 'tab' })).output, '{\n\t"a": 2,\n\t"b": 1\n}');
});

test('key orders: desc, natural, length', () => {
  assert.equal(min('{"k10":1,"k2":2,"b":3}', { order: 'desc' }), '{"k2":2,"k10":1,"b":3}');
  assert.equal(min('{"k10":1,"k2":2,"b":3}', { order: 'natural' }), '{"b":3,"k2":2,"k10":1}');
  assert.equal(min('{"ccc":1,"a":2,"bb":3}', { order: 'length' }), '{"a":2,"bb":3,"ccc":1}');
  assert.deepEqual(['k10', 'k2', 'K1'].sort(keyComparator('natural')), ['K1', 'k2', 'k10']);
});

test('sortArrays sorts primitives numerically / textually and leaves objects alone without arrayKey', () => {
  assert.equal(min('[3,1,10,2]', { sortArrays: true }), '[1,2,3,10]');
  assert.equal(min('["b","a","c"]', { sortArrays: true }), '["a","b","c"]');
  assert.equal(min('["b","a"]', { sortArrays: true, order: 'desc' }), '["b","a"]');
  assert.equal(min('[{"id":"b"},{"id":"a"}]', { sortArrays: true }), '[{"id":"b"},{"id":"a"}]');
  assert.equal(min('[3,1]', {}), '[3,1]');
});

test('sortArrays with arrayKey sorts arrays of objects by that key', () => {
  assert.equal(min('[{"id":"b","n":2},{"id":"a","n":1}]', { sortArrays: true, arrayKey: 'id' }), '[{"id":"a","n":1},{"id":"b","n":2}]');
  assert.equal(min('[{"n":10},{"n":9}]', { sortArrays: true, arrayKey: 'n' }), '[{"n":9},{"n":10}]');
});

test('dropNulls removes null values from objects and arrays', () => {
  assert.equal(min('{"a":null,"b":[1,null,{"c":null}]}', { dropNulls: true }), '{"b":[1,{}]}');
});

test('dropEmpty removes empty strings, objects and arrays', () => {
  assert.equal(min('{"a":"","b":{},"c":[],"x":1}', { dropEmpty: true }), '{"x":1}');
  // Cascades: a container that becomes empty after dropping is dropped too.
  assert.equal(min('{"d":[""],"e":{"f":{}},"g":{"h":1}}', { dropEmpty: true }), '{"g":{"h":1}}');
});

test('dedupeArrays uses structural equality after key sorting', () => {
  assert.equal(min('[{"a":1,"b":2},{"b":2,"a":1},1,1,"1"]', { dedupeArrays: true }), '[{"a":1,"b":2},1,"1"]');
});

test('numbers: round2 and integers', () => {
  assert.equal(min('{"a":1.005,"b":[2.555,-1.499]}', { numbers: 'round2' }), '{"a":1,"b":[2.56,-1.5]}');
  assert.equal(min('{"a":1.9,"b":-1.9}', { numbers: 'integers' }), '{"a":1,"b":-1}');
});

test('status counts keys, arrays and dropped entries', () => {
  const r = runJsonSort('{"a":null,"b":[1,1],"c":{"d":1}}', ctx({ dropNulls: true, dedupeArrays: true }));
  assert.equal(r.status, 'sorted · 3 keys · 1 array · 2 dropped');
  assert.deepEqual(normaliseJson({ b: 1, a: [] }).stats, { keys: 2, arrays: 1, dropped: 0 });
});

test('invalid JSON reports a position', () => {
  const r = runJsonSort('{"a":1,', ctx());
  assert.ok(r.error?.line);
  assert.match(r.status!, /^Invalid JSON/);
});
