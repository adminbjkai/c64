import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffTokens, diffLines, diffWords, diffChars, formatLineDiff, formatInlineDiff, diffStats, splitLines } from '../src/lib/diff.js';
import { runDiff, diffMode, splitSides } from '../src/modes/diff.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options });
const script = (ops: { type: string; value: string }[]) => ops.map((o) => (o.type === 'equal' ? '=' : o.type === 'insert' ? '+' : '-') + o.value).join(' ');

test('myers: classic ABCABBA -> CBABAC', () => {
  const ops = diffTokens([...'ABCABBA'], [...'CBABAC']);
  const s = diffStats(ops);
  // Shortest edit script for this pair has length 5.
  assert.equal(s.added + s.removed, 5);
  // Reconstructing both sides from the ops must round-trip.
  assert.equal(ops.filter((o) => o.type !== 'insert').map((o) => o.value).join(''), 'ABCABBA');
  assert.equal(ops.filter((o) => o.type !== 'delete').map((o) => o.value).join(''), 'CBABAC');
});

test('myers: identical inputs are all equal', () => {
  const ops = diffTokens(['a', 'b', 'c'], ['a', 'b', 'c']);
  assert.equal(script(ops), '=a =b =c');
});

test('myers: empty left side is all inserts, empty right side all deletes', () => {
  assert.equal(script(diffTokens([], ['x', 'y'])), '+x +y');
  assert.equal(script(diffTokens(['x', 'y'], [])), '-x -y');
  assert.deepEqual(diffTokens([], []), []);
});

test('myers: single replacement in the middle', () => {
  assert.equal(script(diffTokens(['a', 'b', 'c'], ['a', 'X', 'c'])), '=a -b +X =c');
});

test('myers: insert at start and end', () => {
  assert.equal(script(diffTokens(['b'], ['a', 'b', 'c'])), '+a =b +c');
});

test('splitLines: handles CRLF and trailing newline', () => {
  assert.deepEqual(splitLines('a\r\nb\n'), ['a', 'b']);
  assert.deepEqual(splitLines(''), []);
});

test('diffLines + formatLineDiff: unified prefixes', () => {
  const ops = diffLines('one\ntwo\nthree', 'one\n2\nthree');
  assert.equal(formatLineDiff(ops), ' one\n-two\n+2\n three');
});

test('ignoreWhitespace: trims and collapses runs', () => {
  assert.equal(diffStats(diffLines('a   b', '  a b  ')).removed, 1);
  const ops = diffLines('a   b', '  a b  ', { ignoreWhitespace: true });
  assert.equal(diffStats(ops).removed, 0);
  assert.equal(ops[0]?.value, 'a   b'); // original token kept
});

test('ignoreCase: case-insensitive comparison', () => {
  assert.equal(diffStats(diffLines('Hello', 'hello')).added, 1);
  assert.equal(diffStats(diffLines('Hello', 'hello', { ignoreCase: true })).added, 0);
});

test('diffWords: inline notation coalesces runs', () => {
  const ops = diffWords('the quick brown fox', 'the slow brown cat');
  assert.equal(formatInlineDiff(ops), 'the [-quick-]{+slow+} brown [-fox-]{+cat+}');
});

test('diffChars: inline notation', () => {
  assert.equal(formatInlineDiff(diffChars('kitten', 'sitting')), '[-k-]{+s+}itt[-e-]{+i+}n{+g+}');
});

test('splitSides: five-or-more equals, custom separator', () => {
  assert.deepEqual(splitSides('a\n=====\nb'), ['a', 'b']);
  assert.deepEqual(splitSides('a\n==========\nb\nc'), ['a', 'b\nc']);
  assert.equal(splitSides('a\n====\nb'), null);
  assert.deepEqual(splitSides('a\n---\nb', '---'), ['a', 'b']);
});

test('runDiff: sample runs, status and view', () => {
  const r = runDiff(diffMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.equal(r.view?.kind, 'diff');
  assert.match(r.status ?? '', /^\+2 −2 · 2 lines equal$/);
  assert.ok(r.output.includes('-The quick brown fox'));
  assert.ok(r.output.includes('+The quick red fox'));
});

test('runDiff: empty input, missing separator error, identical note', () => {
  assert.deepEqual(runDiff('', ctx()), { output: '', status: '' });
  const r = runDiff('a\nb', ctx());
  assert.ok(r.error);
  assert.equal(r.error?.hint, 'Put ===== on its own line between the two texts');
  const same = runDiff('x\ny\n=====\nx\ny', ctx());
  assert.deepEqual(same.notes, ['Texts are identical']);
  assert.equal(same.status, '+0 −0 · 2 lines equal');
});

test('runDiff: controls — word granularity, toggles, separator option', () => {
  const w = runDiff('a b\n=====\na c', ctx({ granularity: 'word' }));
  assert.equal(w.output, 'a [-b-]{+c+}');
  const ic = runDiff('A\n=====\na', ctx({ ignoreCase: true }));
  assert.deepEqual(ic.notes, ['Texts are identical']);
  const iw = runDiff('a  b\n=====\na b', ctx({ ignoreWhitespace: true }));
  assert.deepEqual(iw.notes, ['Texts are identical']);
  const sep = runDiff('a\n---\nb', ctx({ separator: '---' }));
  assert.equal(sep.output, '-a\n+b');
});
