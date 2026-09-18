import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRegex, regexMode, findMatches, compile, countGroups, MATCH_CAP, type RegexData } from '../src/modes/regex.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options });

test('sample: email pattern with named groups', () => {
  const r = runRegex(regexMode.sample, ctx({ pattern: '(?<user>\\w+)@(?<host>[\\w.]+)', flags: 'g' }));
  assert.equal(r.error, undefined);
  assert.equal(r.view?.kind, 'regex');
  const d = r.view?.data as RegexData;
  assert.equal(d.matches.length, 2);
  assert.equal(d.groupCount, 2);
  assert.deepEqual(d.groupNames, ['user', 'host']);
  assert.equal(d.matches[0]?.named['host'], 'example.com');
  assert.equal(r.status, '2 matches · 2 groups');
  assert.equal(r.output.split('\n')[0], '1: [9-24] "ada@example.com" (g1="ada", g2="example.com", user="ada", host="example.com")');
});

test('empty pattern returns cheat-sheet note; empty input returns nothing', () => {
  const r = runRegex('abc', ctx({ pattern: '' }));
  assert.equal(r.output, '');
  assert.ok(r.notes?.[0]?.includes('\\d digit'));
  assert.deepEqual(runRegex('', ctx({ pattern: 'a' })), { output: '', status: '' });
});

test('numbered groups, non-participating group is undefined', () => {
  const r = runRegex('ab a', ctx({ pattern: 'a(b)?', flags: 'g' }));
  const d = r.view?.data as RegexData;
  assert.equal(d.matches.length, 2);
  assert.equal(d.matches[0]?.groups[0], 'b');
  assert.equal(d.matches[1]?.groups[0], undefined);
  assert.ok(r.output.includes('g1=undefined'));
});

test('no g flag: only the first match, with a note', () => {
  const r = runRegex('a1 b2 c3', ctx({ pattern: '\\d', flags: '' }));
  const d = r.view?.data as RegexData;
  assert.equal(d.matches.length, 1);
  assert.equal(r.status, '1 match · 0 groups');
  assert.ok(r.notes?.some((n) => n.includes('No g flag')));
});

test('zero-length matches do not loop and advance', () => {
  const r = runRegex('abc', ctx({ pattern: 'x*', flags: 'g' }));
  const d = r.view?.data as RegexData;
  assert.equal(d.matches.length, 4); // positions 0,1,2,3
  assert.equal(d.matches[3]?.index, 3);
  const b = runRegex('one two', ctx({ pattern: '\\b', flags: 'g' }));
  assert.equal((b.view?.data as RegexData).matches.length, 4);
});

test('match cap', () => {
  const { re, global } = compile('a', 'g');
  const { matches, capped } = findMatches(re, 'a'.repeat(MATCH_CAP + 50), global);
  assert.equal(matches.length, MATCH_CAP);
  assert.equal(capped, true);
});

test('replace with $1 and $<name>', () => {
  assert.equal(runRegex('john smith', ctx({ pattern: '(\\w+) (\\w+)', action: 'replace', replacement: '$2, $1' })).output, 'smith, john');
  const r = runRegex('2026-09-18', ctx({ pattern: '(?<y>\\d+)-(?<m>\\d+)-(?<d>\\d+)', action: 'replace', replacement: '$<d>/$<m>/$<y>' }));
  assert.equal(r.output, '18/09/2026');
  assert.equal(r.status, '1 replacement · 3 groups');
  assert.equal(runRegex('a-a-a', ctx({ pattern: 'a', flags: '', action: 'replace', replacement: 'b' })).output, 'b-a-a');
});

test('split returns pretty JSON array', () => {
  const r = runRegex('a, b;c', ctx({ pattern: '[,;]\\s*', action: 'split' }));
  assert.deepEqual(JSON.parse(r.output), ['a', 'b', 'c']);
  assert.equal(r.output, '[\n  "a",\n  "b",\n  "c"\n]');
  assert.equal(r.status, '3 parts · 0 groups');
});

test('test action outputs true/false', () => {
  assert.equal(runRegex('hello', ctx({ pattern: '^h', action: 'test' })).output, 'true');
  const r = runRegex('hello', ctx({ pattern: '^x', action: 'test' }));
  assert.equal(r.output, 'false');
  assert.equal(r.status, 'No match');
});

test('invalid pattern and invalid flags produce an error with hint, no line/col', () => {
  const r = runRegex('abc', ctx({ pattern: '(unclosed' }));
  assert.ok(r.error);
  assert.match(r.error?.message ?? '', /Invalid regular expression/);
  assert.ok(r.error?.hint);
  assert.equal(r.error?.line, undefined);
  const f = runRegex('abc', ctx({ pattern: 'a', flags: 'gz' }));
  assert.ok(f.error);
  assert.equal(f.status, 'Invalid regular expression');
});

test('countGroups counts nested and named groups', () => {
  const { count, names } = countGroups(/((a)(?<n>b))(?:c)/g);
  assert.equal(count, 3);
  assert.deepEqual(names, ['n']);
});

test('flags i and m are honoured and de-duplicated', () => {
  const r = runRegex('Foo\nfoo', ctx({ pattern: '^foo$', flags: 'ggim' }));
  const d = r.view?.data as RegexData;
  assert.equal(d.matches.length, 2);
  assert.equal(d.flags, 'gim');
});
