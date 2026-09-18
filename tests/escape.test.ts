import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEscape, escapeMode, escapeJavascript, unescapeJavascript, escapeCsv, unescapeCsv, escapeShell, escapeRegex, escapeXml, unescapeXml, escapeSql, unescapeJson } from '../src/modes/escape.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options });
const SAMPLE = escapeMode.sample;

test('empty input is empty', () => {
  assert.deepEqual(runEscape('', ctx()), { output: '', status: '' });
});

test('sample escapes for every language without error', () => {
  for (const language of ['json', 'javascript', 'csv', 'shell', 'regex', 'xml', 'sql']) {
    const r = runEscape(SAMPLE, ctx({ language }));
    assert.equal(r.error, undefined, language);
    assert.ok(r.output.length > 0, language);
    assert.match(r.status!, /^Escaped for /);
  }
});

test('json escape with and without quotes, and unescape round-trip', () => {
  const r = runEscape(SAMPLE, ctx({ language: 'json' }));
  assert.equal(r.output, 'He said \\"hi\\" \\\\ tab:\\there\\nline 2 with \'quotes\' & <tags>');
  assert.equal(runEscape(SAMPLE, ctx({ language: 'json', quotes: true })).output, JSON.stringify(SAMPLE));
  assert.equal(runEscape(r.output, ctx({ language: 'json', direction: 'unescape' })).output, SAMPLE);
  assert.equal(runEscape(JSON.stringify(SAMPLE), ctx({ language: 'json', direction: 'unescape' })).output, SAMPLE);
  assert.equal(unescapeJson('\\u00e9\\u2764'), 'é❤');
});

test('json unescape errors carry line/col and hint', () => {
  const r = runEscape('ok\\n\nbad\\q', ctx({ language: 'json', direction: 'unescape' }));
  assert.equal(r.output, '');
  assert.match(r.error!.message, /Invalid JSON escape "\\q"/);
  assert.equal(r.error?.line, 2);
  assert.equal(r.error?.col, 4);
  assert.ok(r.error?.hint);
  assert.match(runEscape('\\u12', ctx({ language: 'json', direction: 'unescape' })).error!.message, /unicode/);
});

test('javascript escaping is single-quote safe and round-trips', () => {
  assert.equal(escapeJavascript("it's\n\t\\ \0 \u2028x"), "it\\'s\\n\\t\\\\ \\0 \\u2028x");
  assert.equal(escapeJavascript('\x01'), '\\x01');
  assert.equal(runEscape("a'b", ctx({ language: 'javascript', quotes: true })).output, "'a\\'b'");
  assert.equal(unescapeJavascript("'it\\'s \\x41\\u0042\\u{1F600}\\n\\q'"), "it's AB😀\nq");
  assert.equal(unescapeJavascript(escapeJavascript(SAMPLE)), SAMPLE);
  assert.match(runEscape('\\u{zz}', ctx({ language: 'javascript', direction: 'unescape' })).error!.message, /u\{…\}/);
});

test('csv quoting per RFC 4180', () => {
  assert.equal(escapeCsv('plain'), 'plain');
  assert.equal(escapeCsv('a,b'), '"a,b"');
  assert.equal(escapeCsv('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsv('multi\nline'), '"multi\nline"');
  assert.equal(unescapeCsv('"say ""hi"""'), 'say "hi"');
  assert.equal(unescapeCsv('plain'), 'plain');
  assert.match(runEscape('"open', ctx({ language: 'csv', direction: 'unescape' })).error!.message, /Unterminated/);
  assert.match(runEscape('"a"b"', ctx({ language: 'csv', direction: 'unescape' })).error!.message, /Lone quote/);
});

test('shell, regex and sql escaping', () => {
  assert.equal(escapeShell("it's a test"), "'it'\\''s a test'");
  assert.equal(escapeRegex('a.b*c?(d)[e]{f}|g^$\\/h-i'), 'a\\.b\\*c\\?\\(d\\)\\[e\\]\\{f\\}\\|g\\^\\$\\\\\\/h\\-i');
  assert.equal(new RegExp(escapeRegex('1+1=2?')).test('so 1+1=2? yes'), true);
  assert.equal(escapeSql("O'Brien"), "O''Brien");
});

test('xml escapes and unescapes including numeric refs', () => {
  assert.equal(escapeXml('<a href="x">Tom & \'Jerry\'</a>'), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;');
  assert.equal(unescapeXml('&lt;&#65;&#x42;&amp;&unknown;'), '<AB&&unknown;');
  const r = runEscape('&lt;b&gt;', ctx({ language: 'xml', direction: 'unescape' }));
  assert.equal(r.output, '<b>');
  assert.match(r.status!, /^Unescaped XML/);
});

test('one-way languages refuse to unescape with a hint', () => {
  for (const language of ['shell', 'regex', 'sql']) {
    const r = runEscape("'x'", ctx({ language, direction: 'unescape' }));
    assert.equal(r.output, '');
    assert.match(r.error!.message, /one-way/);
    assert.ok(r.error!.hint, language);
    assert.match(r.status!, /^Cannot unescape/);
  }
});

test('unknown language falls back to json', () => {
  assert.equal(runEscape('a"b', ctx({ language: 'nope' })).output, 'a\\"b');
});
