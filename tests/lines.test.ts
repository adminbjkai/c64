import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLines, linesMode, seededShuffle, wrapLine } from '../src/modes/lines.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options });
const run = (input: string, options: Record<string, unknown> = {}) => runLines(input, ctx(options));

test('empty input is empty', () => {
  assert.deepEqual(run(''), { output: '', status: '' });
});

test('sample sorts by default; trailing newline does not count as a line', () => {
  const r = run(linesMode.sample);
  assert.equal(r.error, undefined);
  assert.equal(r.output, '\nBanana\napple\napple\nbanana\ncherry\nfile10.txt\nfile2.txt');
  assert.equal(r.status, 'Sort A→Z · 8 lines → 8 lines');
});

test('sort variants', () => {
  const s = 'b\nB\na\nfile10\nfile2\nccc';
  assert.equal(run(s, { op: 'sort' }).output, 'B\na\nb\nccc\nfile10\nfile2');
  assert.equal(run(s, { op: 'sort', caseInsensitive: true }).output, 'a\nb\nB\nccc\nfile10\nfile2');
  assert.equal(run(s, { op: 'sort-desc' }).output, 'file2\nfile10\nccc\nb\na\nB');
  assert.equal(run(s, { op: 'sort-natural' }).output, 'a\nb\nB\nccc\nfile2\nfile10');
  assert.equal(run(s, { op: 'sort-length' }).output, 'B\na\nb\nccc\nfile2\nfile10');
  assert.equal(run(s, { op: 'reverse' }).output, 'ccc\nfile2\nfile10\na\nB\nb');
});

test('shuffle is deterministic per seed and is a permutation', () => {
  const items = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const a = seededShuffle(items, '1');
  assert.deepEqual(a, seededShuffle(items, '1'));
  assert.notDeepEqual(a, items);
  assert.deepEqual(a.slice().sort(), items);
  assert.notDeepEqual(seededShuffle(items, 'other'), a);
  assert.equal(run(items.join('\n'), { op: 'shuffle' }).output, a.join('\n'));
  assert.equal(run(items.join('\n'), { op: 'shuffle', seed: 'other' }).output, seededShuffle(items, 'other').join('\n'));
});

test('dedupe, dedupe-consecutive, remove-empty, trim', () => {
  const s = 'a\nA\na\n\n  b  \nb\nb\na';
  assert.equal(run(s, { op: 'dedupe' }).output, 'a\nA\n\n  b  \nb');
  assert.equal(run(s, { op: 'dedupe', caseInsensitive: true }).output, 'a\n\n  b  \nb');
  assert.equal(run(s, { op: 'dedupe-consecutive' }).output, 'a\nA\na\n\n  b  \nb\na');
  assert.equal(run(s, { op: 'remove-empty' }).output, 'a\nA\na\n  b  \nb\nb\na');
  assert.equal(run(s, { op: 'trim' }).output, 'a\nA\na\n\nb\nb\nb\na');
  assert.equal(run(s, { op: 'dedupe', trimFirst: true }).output, 'a\nA\n\nb');
  assert.equal(run(s, { op: 'dedupe' }).status, 'Remove duplicates · 8 lines → 5 lines');
});

test('number and unnumber', () => {
  assert.equal(run('a\nb', { op: 'number' }).output, '1. a\n2. b');
  assert.equal(run('1. a\n2) b\n- c\n* d\n• e\n[ ] f\n(3) g\nh', { op: 'unnumber' }).output, 'a\nb\nc\nd\ne\nf\ng\nh');
});

test('prefix/suffix, join, split', () => {
  assert.equal(run('a\nb', { op: 'prefix-suffix', prefix: '- ', suffix: ';' }).output, '- a;\n- b;');
  assert.equal(run('a\nb\nc', { op: 'join' }).output, 'a, b, c');
  assert.equal(run('a\nb\nc', { op: 'join', separator: '\\t' }).output, 'a\tb\tc');
  const sp = run('a, b,c , d', { op: 'split' });
  assert.equal(sp.output, 'a\nb,c\nd');
  assert.equal(sp.status, 'Split by separator · 1 line → 3 lines');
  assert.equal(run('a;b;c', { op: 'split', separator: ';' }).output, 'a\nb\nc');
  const bad = run('a', { op: 'split', separator: '' });
  assert.match(bad.error!.message, /Separator is empty/);
  assert.ok(bad.error!.hint);
});

test('unique-count orders by frequency then first appearance', () => {
  assert.equal(run('x\ny\nx\nz\ny\nx', { op: 'unique-count' }).output, '3\tx\n2\ty\n1\tz');
  assert.equal(run('a\nA\nb', { op: 'unique-count', caseInsensitive: true }).output, '2\ta\n1\tb');
});

test('wrap and truncate honour width', () => {
  assert.deepEqual(wrapLine('the quick brown fox jumps over the lazy dog', 15), ['the quick brown', 'fox jumps over', 'the lazy dog']);
  assert.deepEqual(wrapLine('supercalifragilistic word', 5), ['supercalifragilistic', 'word']);
  assert.deepEqual(wrapLine('', 10), ['']);
  assert.equal(run('one two three four\nfive', { op: 'wrap', width: '9' }).output, 'one two\nthree\nfour\nfive');
  assert.equal(run('abcdefghij\nabc', { op: 'truncate', width: '5' }).output, 'abcd…\nabc');
  // bad width falls back to 80
  assert.equal(run('short line', { op: 'wrap', width: 'x' }).output, 'short line');
});

test('unknown op falls back to sort', () => {
  assert.equal(run('b\na', { op: 'nope' }).output, 'a\nb');
});
