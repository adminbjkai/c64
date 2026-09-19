import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runJsonPatch, jsonPatchMode } from '../src/modes/json-patch.js';
import type { StructDiffData } from '../src/views/struct-diff.js';

const ctx = (options: Record<string, unknown> = {}, pretty = true, inputB = '') => ({ pretty, options, inputB });

test('sample applies every op kind; Pretty is indented, Raw minified', () => {
  const r = runJsonPatch(jsonPatchMode.sample, ctx({}, true, jsonPatchMode.sampleB));
  assert.equal(r.error, undefined);
  const expected = { name: 'Widget Pro', price: 9.99, tags: ['b', 'c', 'a'], stock: { online: 7, price: 9.99 } };
  assert.deepEqual(JSON.parse(r.output), expected);
  assert.match(r.output, /^\{\n  "name"/);
  assert.equal(r.status, '7 ops applied · 1 test · 1 replace · 2 add · 1 move · 1 copy · 1 remove');
  assert.equal(r.view, undefined);
  const raw = runJsonPatch(jsonPatchMode.sample, ctx({}, false, jsonPatchMode.sampleB));
  assert.equal(raw.output, JSON.stringify(expected));
});

test('auto format: object patch is a merge patch; format control forces either', () => {
  const doc = '{"a":"b","c":{"d":"e","f":"g"}}';
  const merge = '{"a":"z","c":{"f":null}}';
  const r = runJsonPatch(doc, ctx({}, false, merge));
  assert.equal(r.output, '{"a":"z","c":{"d":"e"}}');
  assert.equal(r.status, 'Merge patch applied · 2 top-level keys');
  const forced = runJsonPatch(doc, ctx({ format: 'json-patch' }, false, merge));
  assert.match(forced.error!.message, /must be an array/);
  const forcedMerge = runJsonPatch(doc, ctx({ format: 'merge-patch' }, false, '["x"]'));
  assert.equal(forcedMerge.output, '["x"]');
  assert.ok(forcedMerge.notes!.some((n) => /replaces the whole document/.test(n)));
});

test('failing op reports its index and reason', () => {
  const r = runJsonPatch('{"a":{"b":1}}', ctx({}, true, '[{"op":"replace","path":"/a/b","value":2},{"op":"remove","path":"/a/c"}]'));
  assert.equal(r.output, '');
  assert.match(r.error!.message, /^op 1: path "\/a\/c" does not exist/);
  assert.equal(r.status, 'Failed at op 1');
  const t = runJsonPatch('{"a":1}', ctx({}, true, '[{"op":"test","path":"/a","value":2}]'));
  assert.match(t.error!.message, /^op 0 \(test \/a\): value is 1, expected 2/);
  const idx = runJsonPatch('{"a":[1]}', ctx({}, true, '[{"op":"add","path":"/a/3","value":1}]'));
  assert.match(idx.error!.message, /out of range/);
  assert.match(idx.error!.hint!, /"-"/);
});

test('showDiff attaches a struct-diff view of document → result', () => {
  const r = runJsonPatch('{"a":1,"b":[1,2]}', ctx({ showDiff: true }, true, '[{"op":"replace","path":"/a","value":2},{"op":"add","path":"/b/-","value":3}]'));
  assert.equal(r.view!.kind, 'struct-diff');
  const d = r.view!.data as StructDiffData;
  assert.deepEqual(d.summary, { added: 1, removed: 0, changed: 1, typeChanges: 0, moved: 0 });
  assert.deepEqual(d.labels, ['Document', 'Result']);
  assert.deepEqual(JSON.parse(r.output), { a: 2, b: [1, 2, 3] });
});

test('empty inputs and parse errors attributed to Document / Patch', () => {
  assert.deepEqual(runJsonPatch('', ctx()), { output: '', status: '' });
  assert.match(runJsonPatch('{"a":1}', ctx({}, true, ''))!.error!.message, /^Patch: nothing/);
  const badDoc = runJsonPatch('{"a":', ctx({}, true, '[]'));
  assert.match(badDoc.error!.message, /^Document: /);
  assert.equal(badDoc.error!.line, 1);
  const badPatch = runJsonPatch('{}', ctx({}, true, '[{"op":"add"'));
  assert.match(badPatch.error!.message, /^Patch: /);
  // An empty document with a patch: the document is null and can be replaced whole.
  assert.equal(runJsonPatch('', ctx({}, false, '[{"op":"add","path":"","value":{"x":1}}]')).output, '{"x":1}');
});
