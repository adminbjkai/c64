import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runJsonTable, jsonTableMode, toRecords, toMarkdownTable } from '../src/modes/json-table.js';
import type { TableData } from '../src/modes/csv.js';

const ctx = (options: Record<string, unknown> = {}, pretty = true) => ({ pretty, options });
const ROWS = '[{"name":"Ada","age":36,"tags":["a","b"],"addr":{"city":"London"}},{"name":"Bob","age":9},{"name":"Cy","age":100,"addr":{"city":"Oslo","zip":"0150"}}]';

test('sample runs: table view, flattened columns, status', () => {
  const r = runJsonTable(jsonTableMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.equal(r.view?.kind, 'table');
  const d = r.view!.data as TableData;
  assert.deepEqual(d.header, ['sku', 'name', 'qty', 'price', 'dims.w', 'dims.h', 'tags[0]', 'tags[1]']);
  assert.equal(d.rows.length, 3);
  assert.equal(d.total, 3);
  assert.equal(r.status, '3 rows · 8 columns');
});

test('empty input', () => {
  assert.deepEqual(runJsonTable('', ctx()), { output: '', status: '' });
});

test('CSV output is the default; missing cells are empty', () => {
  const r = runJsonTable(ROWS, ctx({}, false));
  assert.equal(r.view, undefined);
  assert.equal(r.output, 'name,age,tags[0],tags[1],addr.city,addr.zip\nAda,36,a,b,London,\nBob,9,,,,\nCy,100,,,Oslo,0150');
});

test('flatten off keeps nested values as JSON cells', () => {
  const r = runJsonTable(ROWS, ctx({ flatten: false }));
  const d = r.view!.data as TableData;
  assert.deepEqual(d.header, ['name', 'age', 'tags', 'addr']);
  assert.equal(d.rows[0]![2], '["a","b"]');
  assert.equal(d.rows[0]![3], '{"city":"London"}');
});

test('sortBy is numeric-aware; -col sorts descending', () => {
  const asc = runJsonTable(ROWS, ctx({ sortBy: 'age' })).view!.data as TableData;
  assert.deepEqual(
    asc.rows.map((r) => r[0]),
    ['Bob', 'Ada', 'Cy'],
  );
  const desc = runJsonTable(ROWS, ctx({ sortBy: '-age' })).view!.data as TableData;
  assert.deepEqual(
    desc.rows.map((r) => r[0]),
    ['Cy', 'Ada', 'Bob'],
  );
  const byName = runJsonTable(ROWS, ctx({ sortBy: '-name' })).view!.data as TableData;
  assert.deepEqual(
    byName.rows.map((r) => r[0]),
    ['Cy', 'Bob', 'Ada'],
  );
  const missing = runJsonTable(ROWS, ctx({ sortBy: 'nope' }));
  assert.ok(missing.notes?.some((n) => /"nope" not found/.test(n)));
});

test('filter is a case-insensitive substring across all cells', () => {
  const r = runJsonTable(ROWS, ctx({ filter: 'LON' }));
  const d = r.view!.data as TableData;
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0]![0], 'Ada');
  assert.equal(r.status, '1 row · 6 columns · filtered from 3');
});

test('sortColumns orders the header naturally', () => {
  const d = runJsonTable('[{"b":1,"a10":2,"a2":3}]', ctx({ sortColumns: true })).view!.data as TableData;
  assert.deepEqual(d.header, ['a2', 'a10', 'b']);
});

test('output formats: tsv, markdown, json', () => {
  assert.equal(runJsonTable('[{"a":1,"b":"x"}]', ctx({ output: 'tsv' })).output, 'a\tb\n1\tx');
  assert.equal(runJsonTable('[{"a":1,"b":"x|y"}]', ctx({ output: 'markdown' })).output, '| a | b |\n| --- | --- |\n| 1 | x\\|y |');
  assert.equal(runJsonTable('[{"a":1},{"b":2}]', ctx({ output: 'json' }, false)).output, '[\n  {\n    "a": "1",\n    "b": ""\n  },\n  {\n    "a": "",\n    "b": "2"\n  }\n]');
  assert.equal(toMarkdownTable(['x'], [['a\nb']]), '| x |\n| --- |\n| a b |');
});

test('NDJSON is auto-detected', () => {
  const r = runJsonTable('{"a":1}\n{"a":2,"b":3}\n', ctx());
  assert.equal(r.error, undefined);
  assert.ok(r.notes?.some((n) => /2 NDJSON lines/.test(n)));
  assert.equal(r.status, '2 rows · 2 columns');
});

test('object of objects gets a _key column; single array key is unwrapped', () => {
  const oo = runJsonTable('{"x":{"n":1},"y":{"n":2}}', ctx());
  assert.deepEqual((oo.view!.data as TableData).header, ['_key', 'n']);
  assert.deepEqual((oo.view!.data as TableData).rows, [
    ['x', '1'],
    ['y', '2'],
  ]);
  const wrapped = runJsonTable('{"total":2,"items":[{"n":1},{"n":2}]}', ctx());
  assert.ok(wrapped.notes?.some((n) => /"items" array/.test(n)));
  assert.equal(wrapped.status, '2 rows · 1 column');
  assert.deepEqual(toRecords('{"only":1}').records, [{ only: 1 }]);
});

test('arrays of primitives / arrays get value or numbered columns', () => {
  assert.deepEqual((runJsonTable('["x","y"]', ctx()).view!.data as TableData).header, ['value']);
  assert.deepEqual((runJsonTable('[[1,2],[3]]', ctx()).view!.data as TableData).header, ['0', '1']);
});

test('deep nesting is capped at 5 levels', () => {
  const d = runJsonTable('[{"a":{"b":{"c":{"d":{"e":{"f":1}}}}}}]', ctx()).view!.data as TableData;
  assert.deepEqual(d.header, ['a.b.c.d.e']);
  assert.equal(d.rows[0]![0], '{"f":1}');
});

test('rows are capped at 2000 in the view but total is reported', () => {
  const big = JSON.stringify(Array.from({ length: 2500 }, (_, i) => ({ i })));
  const d = runJsonTable(big, ctx()).view!.data as TableData;
  assert.equal(d.rows.length, 2000);
  assert.equal(d.total, 2500);
});

test('errors: invalid JSON with position, non-array scalar', () => {
  assert.ok(runJsonTable('[{"a":', ctx()).error?.line);
  assert.match(runJsonTable('42', ctx()).error!.message, /Expected an array/);
});
