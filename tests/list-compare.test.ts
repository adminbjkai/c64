import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runListCompare, listCompareMode, splitItems, compareLists } from '../src/modes/list-compare.js';
import type { ListCompareData } from '../src/modes/list-compare.js';

const ctx = (options: Record<string, unknown> = {}, inputB = '') => ({ pretty: false, options, inputB });

test('splitItems: trims, drops blanks, de-duplicates (optionally case-folded)', () => {
  assert.deepEqual(splitItems('a\r\n b \n\nA\na\n', {}), ['a', 'b', 'A']);
  assert.deepEqual(splitItems('a\n b \nA', { ignoreCase: true }), ['a', 'b']);
  assert.deepEqual(splitItems('a\n b \na', { trim: false, unique: false }), ['a', ' b ', 'a']);
});

test('compareLists: sets keep A-order and first spelling', () => {
  const r = compareLists(['x', 'Y', 'z'], ['y', 'z', 'w'], { ignoreCase: true });
  assert.deepEqual(r.common, ['Y', 'z']);
  assert.deepEqual(r.onlyA, ['x']);
  assert.deepEqual(r.onlyB, ['w']);
  assert.deepEqual(r.union, ['x', 'Y', 'z', 'w']);
  assert.deepEqual(r.symmetric, ['x', 'w']);
  assert.equal(r.countA, 3);
});

test('sample: all sets with headings, status and view data', () => {
  const r = runListCompare(listCompareMode.sample, ctx({}, listCompareMode.sampleB));
  assert.equal(r.error, undefined);
  assert.equal(r.status, 'A 6 · B 6 · common 3');
  assert.match(r.output, /^## In both \(3\)\nbanana\ndate\nfig$/m);
  assert.match(r.output, /^## Only in A \(3\)\napple\ncherry\nelderberry$/m);
  assert.match(r.output, /^## Only in B \(3\)\nCherry\ngrape\nkiwi$/m);
  assert.equal(r.view!.kind, 'list-compare');
  const d = r.view!.data as ListCompareData;
  assert.equal(d.show, 'all');
  assert.deepEqual(d.common, ['banana', 'date', 'fig']);
  assert.equal(d.union.length, 9);
});

test('controls: show a single set, ignoreCase, trim, unique', () => {
  const a = listCompareMode.sample;
  const b = listCompareMode.sampleB;
  assert.equal(runListCompare(a, ctx({ show: 'intersection' }, b)).output, 'banana\ndate\nfig');
  assert.equal(runListCompare(a, ctx({ show: 'intersection', ignoreCase: true }, b)).output, 'banana\ncherry\ndate\nfig');
  assert.equal(runListCompare(a, ctx({ show: 'onlyB' }, b)).output, 'Cherry\ngrape\nkiwi');
  assert.equal(runListCompare(a, ctx({ show: 'symmetric', ignoreCase: true }, b)).output, 'apple\nelderberry\ngrape\nkiwi');
  assert.equal(runListCompare(a, ctx({ show: 'union', ignoreCase: true }, b)).output.split('\n').length, 8);
  // Without trim "  fig  " no longer matches; without unique the duplicate apple counts.
  const noTrim = runListCompare(a, ctx({ trim: false }, b));
  assert.match(noTrim.status!, /common 2$/);
  const dup = runListCompare(a, ctx({ unique: false }, b));
  assert.match(dup.status!, /^A 7 /);
});

test('empty input', () => {
  assert.deepEqual(runListCompare('', ctx()), { output: '', status: '' });
  const oneSide = runListCompare('a\nb', ctx({}, ''));
  assert.equal(oneSide.status, 'A 2 · B 0 · common 0');
  assert.match(oneSide.output, /## Only in A \(2\)/);
});
