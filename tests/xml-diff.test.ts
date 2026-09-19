import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runXmlDiff, xmlDiffMode, xmlToCanonical } from '../src/modes/xml-diff.js';
import { applyJsonPatch } from '../src/lib/structural-diff.js';
import type { StructDiffData } from '../src/views/struct-diff.js';

const ctx = (options: Record<string, unknown> = {}, pretty = true, inputB = '') => ({ pretty, options, inputB });
const ops = (d: StructDiffData) => d.changes.map((c) => `${c.op} ${c.path}`);

test('canonical mapping: attributes, text, repeated children, CDATA, comments', () => {
  const v = xmlToCanonical('<r a="1" b="2"><!-- c --><x>t</x><x><![CDATA[u]]></x><y k="v">  hi  </y><?pi z?><z/></r>');
  assert.deepEqual(v, { r: { '@a': '1', '@b': '2', x: ['t', 'u'], y: { '@k': 'v', '#text': 'hi' }, z: '' } });
  // Attribute order never matters; whitespace between elements never matters.
  assert.deepEqual(xmlToCanonical('<a x="1" y="2"/>'), xmlToCanonical('<a y="2"   x="1"></a>'));
  assert.deepEqual(xmlToCanonical('<a><b>1</b><c>2</c></a>'), xmlToCanonical('<a>\n  <b>1</b>\n  <c>2</c>\n</a>'));
  // Child order matters (index mode) — a swap is two replaces.
  const r = runXmlDiff('<a><b>1</b><b>2</b></a>', ctx({}, true, '<a><b>2</b><b>1</b></a>'));
  assert.deepEqual(ops(r.view!.data as StructDiffData), ['replace /a/b/0', 'replace /a/b/1']);
  // ... unless compared as a set.
  assert.equal(runXmlDiff('<a><b>1</b><b>2</b></a>', ctx({ arrays: 'set' }, true, '<a><b>2</b><b>1</b></a>')).status, 'Identical');
});

test('sample: attribute change, text change, repeated-child change and added element', () => {
  const r = runXmlDiff(xmlDiffMode.sample, ctx({}, true, xmlDiffMode.sampleB!));
  assert.equal(r.error, undefined);
  const d = r.view!.data as StructDiffData;
  assert.deepEqual(ops(d), ['replace /catalog/product/name', 'replace /catalog/product/price/@currency', 'add /catalog/product/sku', 'replace /catalog/product/tags/tag/1']);
  assert.equal(r.status, '3 changed · 1 added · 0 removed');
  assert.match(r.output, /^~ \/catalog\/product\/name: "Widget" → "Widget Pro"$/m);
  assert.ok(r.notes!.some((n) => /canonical/.test(n)));
  // Raw = JSON Patch against the canonical value.
  const raw = runXmlDiff(xmlDiffMode.sample, ctx({}, false, xmlDiffMode.sampleB!));
  assert.deepEqual(applyJsonPatch(xmlToCanonical(xmlDiffMode.sample), JSON.parse(raw.output)), xmlToCanonical(xmlDiffMode.sampleB!));
});

test('controls: ignoreCase and numericStrings, ignorePaths on attributes', () => {
  const a = '<p id="1" v="10"><n>Ab</n></p>';
  const b = '<p id="2" v="10.0"><n>ab</n></p>';
  assert.equal((runXmlDiff(a, ctx({}, true, b)).view!.data as StructDiffData).changes.length, 3);
  assert.equal(runXmlDiff(a, ctx({ ignoreCase: true, numericStrings: true, ignorePaths: '/p/@id' }, true, b)).status, 'Identical');
  // Trim strings defaults on for XML: padded text-only elements compare equal.
  assert.equal(runXmlDiff('<a><b> x </b></a>', ctx({}, true, '<a><b>x</b></a>')).status, 'Identical');
  assert.equal(xmlDiffMode.controls.find((c) => c.key === 'trimStrings')!.kind, 'toggle');
});

test('empty input and parse errors attributed to a side with line/col', () => {
  assert.deepEqual(runXmlDiff('', ctx()), { output: '', status: '' });
  const bad = runXmlDiff('<a>\n<b></a>', ctx({}, true, '<a/>'));
  assert.match(bad.error!.message, /^Original: /);
  assert.equal(bad.error!.line, 2);
  assert.match(bad.status!, /Invalid XML in Original/);
  const badB = runXmlDiff('<a/>', ctx({}, true, '<a><b></a>'));
  assert.match(badB.error!.message, /^Changed: /);
  assert.ok(badB.error!.col! > 0);
});
