import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStringUtils, stringUtilsMode } from '../src/modes/string-utils.js';
import { slugify, deburr, reverseString, rot13, rot47, nato, obfuscate, toRoman, fromRoman, roman, unicodeEscape, unicodeUnescape, unicodeEscapeAuto, codePoints } from '../src/lib/strings.js';
import type { TableData } from '../src/modes/csv.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options });

test('slugify: defaults, sample, lowercase, separator, maxLength', () => {
  assert.equal(slugify('Crème Brûlée & Zürich — 2024 Edition!'), 'creme-brulee-zurich-2024-edition');
  assert.equal(slugify('Hello World', { lowercase: false }), 'Hello-World');
  assert.equal(slugify('Hello World', { separator: '_' }), 'hello_world');
  assert.equal(slugify('the quick brown fox jumps', { maxLength: 15 }), 'the-quick-brown');
  assert.equal(slugify('the quick brown fox jumps', { maxLength: 17 }), 'the-quick-brown');
  assert.equal(slugify('  --leading and trailing--  '), 'leading-and-trailing');
  const r = runStringUtils(stringUtilsMode.sample, ctx(stringUtilsMode.sampleOptions));
  assert.equal(r.output, 'creme-brulee-zurich-2024-edition');
  assert.equal(r.error, undefined);
  assert.equal(runStringUtils('Hello World', ctx({ op: 'slugify', lowercase: false, separator: '.', maxLength: '20' })).output, 'Hello.World');
});

test('deburr strips diacritics and expands ligatures', () => {
  assert.equal(deburr('Crème Brûlée à la Zürich'), 'Creme Brulee a la Zurich');
  assert.equal(deburr('Ærøskøbing Straße Łódź Œuvre'), 'AEroskobing Strasse Lodz OEuvre');
  assert.equal(deburr('ñ Ñ ç Ç'), 'n N c C');
  assert.equal(runStringUtils('Ñandú\nGarçon', ctx({ op: 'deburr' })).output, 'Nandu\nGarcon');
});

test('reverse is code-point safe', () => {
  assert.equal(reverseString('abc'), 'cba');
  assert.equal(reverseString('a😀b'), 'b😀a');
  assert.equal(runStringUtils('ab\ncd', ctx({ op: 'reverse' })).output, 'ba\ndc');
  assert.equal(runStringUtils('ab\ncd', ctx({ op: 'reverse', perLine: false })).output, 'dc\nba');
});

test('rot13 and rot47 are involutions with known vectors', () => {
  assert.equal(rot13('Hello, World!'), 'Uryyb, Jbeyq!');
  assert.equal(rot13(rot13('Hello, World!')), 'Hello, World!');
  assert.equal(rot47('Hello, World!'), 'w6==@[ (@C=5P');
  assert.equal(rot47(rot47('Hello, World!')), 'Hello, World!');
  assert.equal(runStringUtils('abc', ctx({ op: 'rot13' })).output, 'nop');
  assert.equal(runStringUtils('abc', ctx({ op: 'rot47' })).output, '234');
});

test('nato spells each character, keeping case and marking spaces/unknowns', () => {
  assert.equal(nato('Ab 1-x?'), "ALFA Bravo (space) One Dash X-ray '?'");
  assert.equal(runStringUtils('c64', ctx({ op: 'nato' })).output, 'Charlie Six Four');
});

test('obfuscate masks the middle keeping N chars on each side', () => {
  assert.equal(obfuscate('4111111111111111', 4), '4111********1111');
  assert.equal(obfuscate('secret', 2), 'se**et');
  assert.equal(obfuscate('abcd', 2), '****');
  assert.equal(obfuscate('hello', 0), '*****');
  assert.equal(runStringUtils('user@example.com', ctx({ op: 'obfuscate', keep: '3' })).output, 'use**********com');
  assert.equal(runStringUtils('user@example.com', ctx({ op: 'obfuscate', keep: 'x' })).output, 'us************om');
});

test('roman numerals both ways, per line, auto-detect direction', () => {
  assert.equal(toRoman(1994), 'MCMXCIV');
  assert.equal(toRoman(3999), 'MMMCMXCIX');
  assert.equal(toRoman(4), 'IV');
  assert.equal(fromRoman('MCMXCIV'), 1994);
  assert.equal(fromRoman('mmxxiv'), 2024);
  assert.equal(roman(' 42 '), 'XLII');
  assert.equal(roman('XLII'), '42');
  assert.throws(() => toRoman(0), /out of range/);
  assert.throws(() => fromRoman('IIII'), /not a valid Roman numeral/);
  const r = runStringUtils('1994\nXLII\n\n2024', ctx({ op: 'roman' }));
  assert.equal(r.output, 'MCMXCIV\n42\n\nMMXXIV');
  assert.equal(r.error, undefined);
});

test('roman errors carry the line number and do not stop the other lines', () => {
  const r = runStringUtils('10\nABC\n4000\nV', ctx({ op: 'roman' }));
  assert.equal(r.output.split('\n')[0], 'X');
  assert.match(r.output.split('\n')[1]!, /^✗ "ABC" is not a valid Roman numeral/);
  assert.match(r.output.split('\n')[2]!, /^✗ 4000 is out of range/);
  assert.equal(r.output.split('\n')[3], '5');
  assert.equal(r.error?.line, 2);
  assert.equal(r.error?.col, 1);
  assert.match(r.error?.hint ?? '', /1–3999/);
  assert.match(r.status!, /2 of 4 lines failed/);
});

test('unicode escape and unescape round-trip, auto-detect direction', () => {
  assert.equal(unicodeEscape('héllo 😀'), 'h\\u00e9llo \\ud83d\\ude00');
  assert.equal(unicodeUnescape('h\\u00e9llo \\ud83d\\ude00 \\u{1F600} \\x41'), 'héllo 😀 😀 A');
  assert.equal(unicodeEscapeAuto('h\\u00e9llo').direction, 'unescape');
  assert.equal(unicodeEscapeAuto('héllo').direction, 'escape');
  assert.equal(unicodeEscapeAuto('plain').text, 'plain');
  assert.equal(runStringUtils('h\\u00e9llo', ctx({ op: 'unicode-escape' })).output, 'héllo');
  assert.equal(runStringUtils('héllo', ctx({ op: 'unicode-escape' })).output, 'h\\u00e9llo');
  assert.match(runStringUtils('héllo', ctx({ op: 'unicode-escape' })).status!, /escaped/);
});

test('codepoints lists each char with U+XXXX and byte lengths, as a table view', () => {
  const cps = codePoints('aé€😀');
  assert.deepEqual(cps.map((c) => c.codePoint), ['U+0061', 'U+00E9', 'U+20AC', 'U+1F600']);
  assert.deepEqual(cps.map((c) => c.utf8), [1, 2, 3, 4]);
  assert.deepEqual(cps.map((c) => c.utf16), [2, 2, 2, 4]);
  assert.equal(cps[0]!.category, 'Lowercase letter');
  assert.equal(cps[2]!.category, 'Symbol');
  const r = runStringUtils('aé€😀', ctx({ op: 'codepoints' }));
  assert.equal(r.view?.kind, 'table');
  const d = r.view?.data as TableData;
  assert.equal(d.rows.length, 4);
  assert.deepEqual(d.header, ['Char', 'Code point', 'Decimal', 'Category', 'UTF-8 bytes', 'UTF-16 bytes']);
  assert.deepEqual(d.rows[3], ['😀', 'U+1F600', '128512', 'Symbol', '4', '4']);
  assert.equal(r.status, '4 code points · 5 UTF-16 units · 10 bytes UTF-8 · 10 bytes UTF-16');
  assert.match(r.output, /^U\+0061 {3}"a" {6}Lowercase letter {2}utf-8 1 B · utf-16 2 B\n/);
  assert.equal((runStringUtils('a\nb', ctx({ op: 'codepoints' })).view?.data as TableData).rows[1]![0], '\\n');
});

test('perLine toggle off treats the whole input as one string', () => {
  assert.equal(runStringUtils('Hello\nWorld', ctx({ op: 'slugify' })).output, 'hello\nworld');
  assert.equal(runStringUtils('Hello\nWorld', ctx({ op: 'slugify', perLine: false })).output, 'hello-world');
  assert.equal(runStringUtils('ab\ncd', ctx({ op: 'nato', perLine: false })).output, "Alfa Bravo '\n' Charlie Delta");
});

test('empty input and unknown op fall back sanely', () => {
  assert.deepEqual(runStringUtils('', ctx({ op: 'rot13' })), { output: '', status: '' });
  assert.equal(runStringUtils('Some Text', ctx({ op: 'nope' })).output, 'some-text');
  assert.match(runStringUtils('Some Text', ctx()).status!, /^Slugify · 1 line · 9 chars$/);
});
